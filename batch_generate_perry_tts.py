#!/usr/bin/env python3
"""Resumably generate the complete Perry Miller collection with local TTS."""

from __future__ import annotations

import argparse
import io
import json
import re
import time
import wave
from datetime import datetime
from pathlib import Path
from urllib.request import Request, urlopen

import server


BASE_DIR = Path(__file__).resolve().parent
BOOK_ID = "new-england-mind"
BOOK = server.BOOKS_BY_ID[BOOK_ID]
SOURCE = BASE_DIR / "poems-new-england-mind.json"
PROGRESS = BASE_DIR / "perry-tts-progress.json"
NOTES_TARGETS = (
    ("http://192.168.5.40:9999/note", "default"),
    ("http://192.168.5.46:9999/note", "app"),
)
PART_LIMIT = 300
VOICE_ROLE = "feminine"
VOICE_LABEL = "Local voice 1"


def initial_parts(text: str) -> list[str]:
    return server.PoetryRequestHandler._split_tts_text(text, PART_LIMIT)


def rebalance(parts: list[str]) -> list[str]:
    # Keep natural boundaries, even when they produce a short part. Retained
    # for the chapter recovery script, which calls this after initial_parts.
    return list(parts)


def jobs() -> list[dict]:
    poems = json.loads(SOURCE.read_text(encoding="utf-8"))
    result = []
    for poem in poems:
        parts = rebalance(initial_parts(str(poem["content"])))
        for index, text in enumerate(parts):
            title = poem["title"] if len(parts) == 1 else f"{poem['title']} · Part {index + 1}"
            filename_bits = ["Perry Miller", poem["title"]]
            if len(parts) > 1:
                filename_bits.append(f"Part {index + 1}")
            filename_bits.append(VOICE_LABEL)
            filename = " - ".join(filename_bits) + ".wav"
            key = server.audio_library_key(
                title, text, VOICE_ROLE, "poem", BOOK_ID, index == 0, "local", server.LOCAL_TTS_MODEL
            )
            result.append({
                "chapter": poem["title"], "index": index, "total": len(parts),
                "title": title, "text": text, "filename": filename, "key": key,
            })
    return result


def post_note(text: str) -> None:
    errors = []
    for url, channel in NOTES_TARGETS:
        request = Request(
            url,
            data=json.dumps({"channel": channel, "text": text}).encode("utf-8"),
            headers={"Content-Type": "application/json"},
            method="POST",
        )
        try:
            with urlopen(request, timeout=10):
                pass
        except Exception as error:
            errors.append(f"{url}: {error}")
    if errors:
        raise RuntimeError("; ".join(errors))


def write_progress(state: dict) -> None:
    temporary = PROGRESS.with_suffix(".json.tmp")
    temporary.write_text(json.dumps(state, indent=2) + "\n", encoding="utf-8")
    temporary.replace(PROGRESS)


def make_status(state: dict, current: dict | None, started: float, complete: bool = False) -> str:
    elapsed = max(1, time.time() - started)
    done = state["completed"] + state["reused"]
    rate = state["completed"] / elapsed * 3600
    remaining = state["total"] - done
    eta = remaining / rate if rate > 0 else 0
    phase = "complete" if complete else "running"
    item = "all parts saved" if current is None else f"{current['chapter']} — part {current['index'] + 1}/{current['total']}"
    eta_text = "" if complete or not eta else f" · ETA {eta:.1f}h"
    stamp = datetime.now().astimezone().strftime("%H:%M %Z")
    return (
        f"[john-donne/Perry Miller TTS] {phase}\n"
        f"{done:,}/{state['total']:,} ready ({done / state['total'] * 100:.1f}%) · "
        f"{state['reused']:,} reused · {state['failed']:,} failed{eta_text}\n"
        f"current: {item}\nupdated {stamp}"
    )


def generate(job: dict) -> None:
    transcript = f"{job['title']}.\n\n{job['text']}" if job["index"] == 0 else job["text"]
    voice = server.load_tts_voices()[VOICE_ROLE]
    instruction = str(BOOK.get("readingNotes", "Measured and natural."))
    upstream_wav = server.PoetryRequestHandler._request_local_audio(None, transcript, voice, instruction)
    with wave.open(io.BytesIO(upstream_wav), "rb") as source:
        frames = source.readframes(source.getnframes())
        channels = source.getnchannels()
        width = source.getsampwidth()
        rate = source.getframerate()
    output = io.BytesIO()
    with wave.open(output, "wb") as target:
        target.setnchannels(channels)
        target.setsampwidth(width)
        target.setframerate(rate)
        target.writeframes(frames)
    server.cache_audio(job["filename"], output.getvalue(), job["key"])


def stitch_chapter(queue: list[dict], end_position: int) -> None:
    """Persist one lossless chapter WAV after its final part is available."""
    chapter = queue[end_position]["chapter"]
    chapter_jobs = []
    position = end_position
    while position >= 0 and queue[position]["chapter"] == chapter:
        chapter_jobs.append(queue[position])
        position -= 1
    chapter_jobs.reverse()
    paths = [server.AUDIO_LIBRARY_PATH / f"{job['key']}.wav" for job in chapter_jobs]
    if not all(path.exists() for path in paths):
        return
    key = server.stitched_audio_key([job["key"] for job in chapter_jobs])
    if (server.AUDIO_LIBRARY_PATH / f"{key}.wav").exists():
        return
    filename = f"Perry Miller - {chapter} - Complete chapter - {VOICE_LABEL}.wav"
    server.cache_audio(filename, server.stitch_wav_files(paths), key)
    print(f"STITCHED {chapter}: {len(chapter_jobs)} parts", flush=True)


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--note-interval", type=int, default=60)
    parser.add_argument("--max-retries", type=int, default=5)
    args = parser.parse_args()
    queue = jobs()
    state = {"total": len(queue), "completed": 0, "reused": 0, "failed": 0, "startedAt": datetime.now().astimezone().isoformat()}
    started = time.time()
    last_note = 0.0
    for position, job in enumerate(queue):
        audio_path = server.AUDIO_LIBRARY_PATH / f"{job['key']}.wav"
        if audio_path.exists():
            state["reused"] += 1
        else:
            for attempt in range(args.max_retries):
                try:
                    generate(job)
                    state["completed"] += 1
                    break
                except Exception as error:
                    if attempt + 1 == args.max_retries:
                        state["failed"] += 1
                        print(f"FAILED {job['title']}: {error}", flush=True)
                    else:
                        time.sleep(min(30, 2 ** attempt))
        now = time.time()
        state.update({"position": position + 1, "current": job["title"], "updatedAt": datetime.now().astimezone().isoformat()})
        write_progress(state)
        if position + 1 == len(queue) or queue[position + 1]["chapter"] != job["chapter"]:
            stitch_chapter(queue, position)
        if now - last_note >= args.note_interval:
            status = make_status(state, job, started)
            try:
                post_note(status)
            except Exception as error:
                print(f"Notes update failed: {error}", flush=True)
            print(status, flush=True)
            last_note = now
    status = make_status(state, None, started, complete=True)
    write_progress(state)
    post_note(status)
    print(status, flush=True)


if __name__ == "__main__":
    main()
