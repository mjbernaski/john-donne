"""Generate Chapter I with the reader's local parts and save a timing report."""
import io
import json
import math
import struct
import threading
import time
import wave
from concurrent.futures import ThreadPoolExecutor, wait, FIRST_COMPLETED
from pathlib import Path
import server

BOOK_ID = 'colony-to-province'
OUTPUT = Path('audio-library/qwen-perry-chapter-1-test')
metrics = {}
lock = threading.Lock()

class MeasuredHandler(server.PoetryRequestHandler):
    def _request_local_audio(self, text, voice, instruction=''):
        started = time.monotonic()
        entry = {'characters': len(text), 'voice': voice, 'pcmBytes': 0}
        with lock:
            metrics[self.part_index] = entry
        pcm = bytearray()
        with server.LOCAL_TTS_SLOTS, self._open_local_speech(text, voice, instruction) as response:
            while True:
                chunk = response.read1(8192)
                if not chunk:
                    break
                if not pcm:
                    entry['firstAudioSeconds'] = round(time.monotonic() - started, 3)
                pcm.extend(chunk)
                entry['pcmBytes'] = len(pcm)
        if not pcm or len(pcm) % 2:
            raise ValueError('Incomplete PCM')
        entry['generationSeconds'] = round(time.monotonic() - started, 3)
        entry['audioSeconds'] = round(len(pcm) / 48000, 3)
        entry['realTimeFactor'] = round(entry['audioSeconds'] / entry['generationSeconds'], 3)
        tail = pcm[-48000:]
        values = struct.unpack('<' + 'h' * (len(tail) // 2), tail)
        entry['lastSecondRms'] = round(math.sqrt(sum(v*v for v in values) / len(values)), 2)
        output = io.BytesIO()
        with wave.open(output, 'wb') as wav:
            wav.setparams((1, 2, 24000, 0, 'NONE', 'not compressed'))
            wav.writeframes(pcm)
        return output.getvalue()

def main():
    poems = json.loads(Path('poems-colony-to-province.json').read_text())
    chapter = next(p for p in poems if p['title'].startswith('Chapter I ·'))
    parts = server.PoetryRequestHandler._split_tts_text(chapter['content'], 5000)
    OUTPUT.mkdir(parents=True, exist_ok=True)
    report = {'book': BOOK_ID, 'chapter': chapter['title'], 'partLimit': 5000,
              'concurrency': 4, 'partCharacters': [len(p) for p in parts], 'voiceRole': 'masculine',
              'voice': server.load_tts_voices()['masculine'], 'parts': []}
    print(json.dumps(report), flush=True)
    started = time.monotonic()
    def render(index, text):
        handler = object.__new__(MeasuredHandler)
        handler.part_index = index + 1
        payload = dict(title=chapter['title'] if index == 0 else f"{chapter['title']} · Part {index + 1}", text=text,
                       voice='masculine', provider='local', kind='poem', book=BOOK_ID,
                       speakTitle=index == 0, filename=f"Perry Miller - {chapter['title']} - Part {index + 1} - Ryan.wav")
        audio, url, reused = handler._render_tts(payload, '')
        with wave.open(io.BytesIO(audio)) as wav:
            seconds = wav.getnframes() / wav.getframerate()
        result = dict(part=index+1, characters=len(text), audioSeconds=round(seconds, 3),
                      url=url, reused=reused, **{k:v for k,v in metrics.get(index+1, {}).items() if k not in {'characters', 'audioSeconds'}})
        print(json.dumps(result), flush=True)
        return index, audio, result
    recordings = {}
    with ThreadPoolExecutor(max_workers=4) as pool:
        pending = {pool.submit(render, i, text) for i, text in enumerate(parts)}
        while pending:
            completed, pending = wait(pending, timeout=30, return_when=FIRST_COMPLETED)
            for future in completed:
                index, audio, result = future.result()
                recordings[index] = audio
                report['parts'].append(result)
                (OUTPUT / 'report.json').write_text(json.dumps(report, indent=2) + '\n')
            if pending:
                print(json.dumps({'elapsedSeconds': round(time.monotonic()-started), 'completed': len(recordings),
                                  'receivedAudioSeconds': {i:round(m['pcmBytes']/48000,1) for i,m in metrics.items()}}), flush=True)
    combined = OUTPUT / 'chapter-1-ryan.wav'
    with wave.open(str(combined), 'wb') as target:
        target.setparams((1, 2, 24000, 0, 'NONE', 'not compressed'))
        for i in range(len(parts)):
            with wave.open(io.BytesIO(recordings[i])) as wav:
                target.writeframes(wav.readframes(wav.getnframes()))
    report['parts'].sort(key=lambda p: p['part'])
    report['wallSeconds'] = round(time.monotonic()-started, 3)
    report['audioSeconds'] = round(sum(p['audioSeconds'] for p in report['parts']), 3)
    report['aggregateRealTimeFactor'] = round(report['audioSeconds']/report['wallSeconds'], 3)
    report['combinedFile'] = str(combined)
    report['endingText'] = parts[-1][-400:]
    (OUTPUT / 'report.json').write_text(json.dumps(report, indent=2)+'\n')
    print(json.dumps(report), flush=True)

if __name__ == '__main__':
    main()
