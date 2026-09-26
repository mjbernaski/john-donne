#!/usr/bin/env python3
"""Post periodic Perry Miller narration progress to the local Notes API."""

from __future__ import annotations

import argparse
import json
import time
from datetime import datetime
from pathlib import Path
from urllib.request import Request, urlopen


BASE_DIR = Path(__file__).resolve().parent
AUDIO_LIBRARY = BASE_DIR / "audio-library"
NOTES_TARGETS = (
    ("http://192.168.5.40:9999/note", "default"),
    ("http://192.168.5.46:9999/note", "app"),
)
EXPECTED_PARTS = 5525
PROGRESS_PATH = BASE_DIR / "perry-tts-progress.json"


def status_text() -> str:
    try:
        progress = json.loads(PROGRESS_PATH.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        progress = None
    if progress:
        ready = int(progress.get("completed", 0)) + int(progress.get("reused", 0))
        total = int(progress.get("total", EXPECTED_PARTS))
        current = str(progress.get("current", "unknown")).replace(" · ", " — ")
        failures = int(progress.get("failed", 0))
        stamp = datetime.now().astimezone().strftime("%H:%M %Z")
        return (
            f"[john-donne/Perry Miller TTS] running\n"
            f"{ready:,}/{total:,} ready ({ready / total * 100:.1f}%) · {failures:,} failed\n"
            f"current: {current}\nupdated {stamp}"
        )

    renders: list[tuple[float, str]] = []
    for metadata_path in AUDIO_LIBRARY.glob("*.json"):
        try:
            name = str(json.loads(metadata_path.read_text(encoding="utf-8")).get("filename", ""))
        except (OSError, json.JSONDecodeError):
            continue
        if name.startswith("Perry Miller -") and "Local voice 1" in name:
            renders.append((metadata_path.stat().st_mtime, name.removesuffix(".wav")))

    now = time.time()
    if renders:
        latest_time, latest_name = max(renders)
        age = max(0, round(now - latest_time))
        # Corrected local parts normally finish in well under a minute. Two
        # minutes without a saved result is a meaningful stall, not activity.
        activity = "active" if age < 120 else f"stopped or stalled — no new file for {age // 60}m"
        latest = latest_name.removeprefix("Perry Miller - ")
    else:
        activity = "waiting for first completed file"
        latest = "none"
    completed = len(renders)
    percent = completed / EXPECTED_PARTS * 100
    stamp = datetime.now().astimezone().strftime("%H:%M %Z")
    return (
        f"[john-donne/Perry Miller TTS] {activity}\n"
        f"{completed:,} saved render records / about {EXPECTED_PARTS:,} corrected parts ({percent:.1f}%)\n"
        f"latest: {latest}\nupdated {stamp}"
    )


def post(text: str) -> None:
    errors = []
    for url, channel in NOTES_TARGETS:
        request = Request(
            url,
            data=json.dumps({"channel": channel, "text": text}).encode("utf-8"),
            headers={"Content-Type": "application/json"},
            method="POST",
        )
        try:
            with urlopen(request, timeout=10) as response:
                if response.status >= 300:
                    raise RuntimeError(f"HTTP {response.status}")
        except Exception as error:
            errors.append(f"{url}/{channel}: {error}")
    if errors:
        raise RuntimeError("; ".join(errors))


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--interval", type=int, default=300)
    parser.add_argument("--once", action="store_true")
    args = parser.parse_args()
    while True:
        text = status_text()
        try:
            post(text)
            print(text, flush=True)
        except Exception as error:
            print(f"Notes update failed: {error}", flush=True)
        if args.once:
            return
        time.sleep(max(30, args.interval))


if __name__ == "__main__":
    main()
