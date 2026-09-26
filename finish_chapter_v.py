#!/usr/bin/env python3
"""Fill missing Chapter V Gemini parts with local speech and join the chapter."""

import io
import json
import re
import time
import wave
from pathlib import Path

import batch_generate_perry_tts as batch
import server


ROOT = Path(__file__).resolve().parent
CHAPTER = next(p for p in json.loads((ROOT / "poems-new-england-mind.json").read_text())
               if p["title"] == "Chapter V · The Instrument of Reason")
OUTPUT = server.AUDIO_LIBRARY_PATH / "Perry Miller - Chapter V - Complete chapter - Gemini with local fallback.wav"
PROGRESS = ROOT / "chapter-v-fallback-progress.json"


def chapter_parts():
    text = CHAPTER["content"].strip()
    text = re.sub(r"(?m)^\s*#{3,}\s*", "", text)
    text = re.sub(r"(?m)^\s*\d+(?=[^\W\d_]|['‘’“\"(&])", "", text)
    text = re.sub(r"(?m)^\s*(\d*[05])(?=\d+\s)", "", text)
    text = re.sub(r"\n{3,}", "\n\n", text).strip()
    batch.PART_LIMIT = 1800
    return batch.rebalance(batch.initial_parts(text))


def normalized_local_audio(text):
    chunks = server.PoetryRequestHandler._split_tts_text(text, 300)
    frames = []
    audio_format = None
    voice = server.load_tts_voices()["feminine"]
    instruction = server.BOOKS_BY_ID["new-england-mind"].get("readingNotes", "Measured and natural.")
    for chunk in chunks:
        audio = server.PoetryRequestHandler._request_local_audio(None, chunk, voice, instruction)
        with wave.open(io.BytesIO(audio), "rb") as wav:
            current_format = (wav.getnchannels(), wav.getsampwidth(), wav.getframerate())
            if audio_format and current_format != audio_format:
                raise ValueError("Local audio format changed within a part")
            audio_format = current_format
            frames.append(wav.readframes(wav.getnframes()))
    output = io.BytesIO()
    with wave.open(output, "wb") as wav:
        wav.setnchannels(audio_format[0])
        wav.setsampwidth(audio_format[1])
        wav.setframerate(audio_format[2])
        wav.writeframes(b"".join(frames))
    return output.getvalue()


def main():
    parts = chapter_parts()
    paths = []
    fallback = []
    for index, text in enumerate(parts, 1):
        title = CHAPTER["title"] if index == 1 else f"{CHAPTER['title']} · Part {index}"
        gemini_key = server.audio_library_key(title, text, "feminine", "poem", "new-england-mind",
                                              index == 1, "gemini", server.DEFAULT_GEMINI_TTS_MODEL)
        gemini_path = server.AUDIO_LIBRARY_PATH / f"{gemini_key}.wav"
        local_key = server.audio_library_key(title, text, "feminine", "poem", "new-england-mind",
                                             index == 1, "local", server.LOCAL_TTS_MODEL)
        local_path = server.AUDIO_LIBRARY_PATH / f"{local_key}.wav"
        if index != 1 and gemini_path.exists():
            paths.append(gemini_path)
            continue
        fallback.append(index)
        if not local_path.exists():
            transcript = f"{title}.\n\n{text}" if index == 1 else text
            for attempt in range(5):
                try:
                    server.cache_audio(f"Perry Miller - Chapter V - Part {index} - Local fallback.wav",
                                       normalized_local_audio(transcript), local_key)
                    break
                except Exception as error:
                    print(f"Part {index}, attempt {attempt + 1}: {error}", flush=True)
                    if attempt == 4:
                        raise
                    time.sleep(min(30, 2 ** attempt))
        paths.append(local_path)
        PROGRESS.write_text(json.dumps({"parts": len(parts), "fallback": fallback,
                                        "lastCompleted": index}, indent=2) + "\n")
        print(f"Ready part {index}/{len(parts)}", flush=True)
    temporary = OUTPUT.with_suffix(".tmp")
    temporary.write_bytes(server.stitch_wav_files(paths))
    temporary.replace(OUTPUT)
    PROGRESS.write_text(json.dumps({"parts": len(parts), "fallback": fallback,
                                    "complete": True, "output": str(OUTPUT)}, indent=2) + "\n")
    print(f"Complete: {OUTPUT}", flush=True)


if __name__ == "__main__":
    main()
