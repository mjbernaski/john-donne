#!/usr/bin/env python3
"""Generate a chapter performance and automatically save one WAV.

Uses the existing server queue; this process only monitors and joins saved audio.
Optional explicit reuse keeps saved Gemini parts and fills gaps locally.
No automatic retry of failed generation.
"""
import argparse
import json
import os
import re
import secrets
import time
import wave
from pathlib import Path
from urllib.request import Request, build_opener, ProxyHandler
from urllib.parse import quote

import server


def chapter_requests(chapter, provider, voice, model):
    text = chapter['content'].strip()
    text = re.sub(r'(?m)^\s*#{3,}\s*', '', text)
    text = re.sub(r'''(?m)^\s*\d+(?=[^\W\d_]|['‘’“"(&])''', '', text)
    text = re.sub(r'(?m)^\s*(\d*[05])(?=\d+\s)', '', text)
    text = re.sub(r'\n{3,}', '\n\n', text).strip()
    limit = server.PoetryRequestHandler._narration_part_limit(chapter['title'], server.BOOKS_BY_ID['new-england-mind'], provider)
    parts = server.PoetryRequestHandler._split_tts_text(text, limit)
    return [dict(title=chapter['title'] if i == 0 else f"{chapter['title']} · Part {i + 1}",
                 text=part, voice=voice, provider=provider, model=model, kind='poem',
                 book='new-england-mind', speakTitle=i == 0,
                 filename=f"Perry Miller - {chapter['title']} - Part {i + 1} - {voice}.wav")
            for i, part in enumerate(parts)]


def join_parts(paths, output):
    """Stream PCM frames, preserving order without holding hours of audio in RAM."""
    temporary = output.with_suffix('.wav.partial')
    parameters = None
    frames = 0
    with wave.open(str(temporary), 'wb') as target:
        for path in paths:
            with wave.open(str(path), 'rb') as source:
                current = (source.getnchannels(), source.getsampwidth(), source.getframerate(), source.getcomptype())
                if parameters is None:
                    parameters = current
                    target.setparams(source.getparams())
                if current != parameters or current[3] != 'NONE':
                    raise ValueError('Incompatible audio formats; no mixed recording was saved.')
                frames += source.getnframes()
                while chunk := source.readframes(65536):
                    target.writeframesraw(chunk)
    with wave.open(str(temporary), 'rb') as check:
        if check.getnframes() != frames:
            raise ValueError('Assembled audio length does not match its parts.')
    temporary.replace(output)
    return frames / parameters[2]


def plan_local_completion(chapter, voice, gemini_voice, gemini_model):
    """Reuse only exact saved Gemini parts; never submit a new cloud request."""
    handler = object.__new__(server.PoetryRequestHandler)
    requests, paths, reused_gemini = [], [], 0
    for part in chapter_requests(chapter, 'gemini', gemini_voice, gemini_model):
        gemini_path = server.AUDIO_LIBRARY_PATH / f'{handler._tts_request(part)[-2]}.wav'
        if gemini_path.exists():
            paths.append(gemini_path)
            reused_gemini += 1
            continue
        local = {**part, 'provider': 'local', 'voice': voice, 'model': server.LOCAL_TTS_MODEL,
                 'filename': part['filename'].replace(gemini_voice, 'Local male voice')}
        local_path = server.AUDIO_LIBRARY_PATH / f'{handler._tts_request(local)[-2]}.wav'
        paths.append(local_path)
        if not local_path.exists():
            requests.append(local)
    return requests, paths, reused_gemini


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--chapter', default='IX')
    parser.add_argument('--provider', choices=['local', 'gemini'], required=True)
    parser.add_argument('--voice', required=True)
    parser.add_argument('--model', default='gemini-2.5-flash-preview-tts')
    parser.add_argument('--dry-run', action='store_true')
    parser.add_argument('--reuse-gemini-model')
    parser.add_argument('--reuse-gemini-voice', default='Orus')
    args = parser.parse_args()
    chapters = json.loads((server.BASE_DIR / 'poems-new-england-mind.json').read_text())
    chapter = next(p for p in chapters if p['title'].startswith(f'Chapter {args.chapter} ·'))
    requests = chapter_requests(chapter, args.provider, args.voice, args.model)
    handler = object.__new__(server.PoetryRequestHandler)
    paths = [server.AUDIO_LIBRARY_PATH / f'{handler._tts_request(p)[-2]}.wav' for p in requests]
    reused_gemini = 0
    if args.reuse_gemini_model:
        if args.provider != 'local':
            parser.error('--reuse-gemini-model requires --provider local')
        requests, paths, reused_gemini = plan_local_completion(
            chapter, args.voice, args.reuse_gemini_voice, args.reuse_gemini_model)
    voice_name = server.resolve_gemini_voice(args.voice) if args.provider == 'gemini' else server.load_tts_voices()[args.voice]
    model = args.model if args.provider == 'gemini' else server.LOCAL_TTS_MODEL
    filename = f"Perry Miller - {chapter['title'].replace(' · ', ' - ')} - Complete - {voice_name} - {model}.wav"
    if args.reuse_gemini_model:
        filename = f"Perry Miller - {chapter['title'].replace(' · ', ' - ')} - Complete - {args.reuse_gemini_voice} with local male voice.wav"
    output = server.AUDIO_LIBRARY_PATH / filename
    progress = server.AUDIO_LIBRARY_PATH / f'chapter-{args.chapter}-{args.provider}-{args.voice}-progress.json'
    web_progress = server.AUDIO_LIBRARY_PATH / f'chapter-recording-new-england-mind-{args.chapter}.json'
    state = dict(chapter=chapter['title'], provider=args.provider, voice=voice_name, model=model,
                 total=len(paths), saved=sum(p.exists() for p in paths), reusedGemini=reused_gemini, output=str(output))
    already_saved = state['saved'] if args.reuse_gemini_model else 0
    print(json.dumps(state), flush=True)
    if args.dry_run:
        return
    def save_state():
        temporary = progress.with_suffix('.json.tmp')
        temporary.write_text(json.dumps(state, indent=2) + '\n')
        temporary.replace(progress)
        published = {key: value for key, value in state.items() if key != 'output'}
        published['book'] = 'new-england-mind'
        published['label'] = f'{args.reuse_gemini_voice} + local male voice' if args.reuse_gemini_model else voice_name
        published['parts'] = [dict(index=i + 1, url=f'/api/tts/audio/{path.stem}/Part%20{i + 1}.wav')
                              for i, path in enumerate(paths) if path.exists()]
        published['saved'] = len(published['parts'])
        temporary = web_progress.with_suffix('.json.tmp')
        temporary.write_text(json.dumps(published, indent=2) + '\n')
        temporary.replace(web_progress)
    opener = build_opener(ProxyHandler({}))
    base = f"http://127.0.0.1:{server.CONFIG.get('server', {}).get('port', 8888)}"
    try:
        if not all(p.exists() for p in paths):
            request = Request(base + '/api/tts/jobs', json.dumps({'parts': requests}).encode(),
                              {'Content-Type': 'application/json'}, method='POST')
            with opener.open(request, timeout=30) as response:
                job = json.load(response)
            while True:
                completed = already_saved + job['completed']
                state.update(state=job['state'], completed=completed, saved=sum(p.exists() for p in paths),
                             reused=already_saved + job['reused'], job=job['id'])
                save_state()
                print(f"{job['state']}: {completed}/{len(paths)} parts, {state['reused']} reused", flush=True)
                if job['state'] == 'failed':
                    raise RuntimeError(job['error'])
                if job['state'] == 'done':
                    break
                time.sleep(15)
                with opener.open(base + '/api/tts/jobs/' + job['id'], timeout=30) as response:
                    job = json.load(response)
        state.update(state='joining')
        save_state()
        seconds = join_parts(paths, output)
        # Register the single file in the range-capable audio endpoint. A hard
        # link avoids storing a second copy of a potentially hours-long WAV.
        complete_key = server.stitched_audio_key([path.stem for path in paths])
        link = server.AUDIO_LIBRARY_PATH / f'{complete_key}.{secrets.token_hex(6)}.tmp'
        os.link(output, link)
        link.replace(server.AUDIO_LIBRARY_PATH / f'{complete_key}.wav')
        (server.AUDIO_LIBRARY_PATH / f'{complete_key}.json').write_text(json.dumps({'filename': filename}))
        state.update(state='complete', seconds=seconds, bytes=output.stat().st_size, saved=len(paths))
        state['url'] = f'/api/tts/audio/{complete_key}/{quote(filename)}'
        state['filename'] = filename
        save_state()
        print(json.dumps(state), flush=True)
    except Exception as error:
        state.update(state='stopped', error=str(error))
        save_state()
        raise


if __name__ == '__main__':
    main()
