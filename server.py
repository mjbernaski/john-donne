#!/usr/bin/env python3
"""Serve the poetry site and proxy its authenticated FLUX image requests."""

from __future__ import annotations

import argparse
import base64
import io
import json
import os
import time
import wave
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen


def load_local_environment(path: Path) -> None:
    """Load simple KEY=VALUE entries without adding a dotenv dependency."""
    if not path.exists():
        return
    for raw_line in path.read_text(encoding="utf-8").splitlines():
        line = raw_line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, value = line.split("=", 1)
        key = key.strip()
        value = value.strip().strip('"').strip("'")
        if key:
            os.environ.setdefault(key, value)


def load_config(path: Path) -> dict:
    """Read local service addresses from config.json so they change without code edits."""
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except FileNotFoundError:
        return {}


def load_books(path: Path) -> list[dict]:
    """Read the per-book narration settings so prompts are not tied to one poet."""
    try:
        return json.loads(path.read_text(encoding="utf-8")).get("books", [])
    except FileNotFoundError:
        return []


BASE_DIR = Path(__file__).resolve().parent
load_local_environment(BASE_DIR / ".env")
CONFIG = load_config(BASE_DIR / "config.json")
BOOKS = load_books(BASE_DIR / "books.json")
BOOKS_BY_ID = {str(book.get("id", "")): book for book in BOOKS if book.get("id")}
DEFAULT_BOOK = BOOKS[0] if BOOKS else {}
UPSTREAMS = CONFIG.get("upstreams", {})
FLUX_BASE_URL = os.environ.get("FLUX_BASE_URL", UPSTREAMS.get("flux", "http://192.168.5.40:2222")).rstrip("/")
VLLM_BASE_URL = os.environ.get("VLLM_BASE_URL", UPSTREAMS.get("vllm", "http://192.168.5.46:8100")).rstrip("/")
FLUX_API_KEY = os.environ.get("FLUX_API_KEY", "")
GEMINI_API_KEY = os.environ.get("GEMINI_API_KEY", "")
GEMINI_TTS_MODEL = "gemini-3.1-flash-tts-preview"
GEMINI_TTS_URL = (
    f"https://generativelanguage.googleapis.com/v1beta/models/"
    f"{GEMINI_TTS_MODEL}:generateContent"
)
TTS_VOICES = {"feminine": "Gacrux", "masculine": "Algieba", "companion": "Iapetus"}
ALLOWED_GET_PATHS = {"/status"}
ALLOWED_POST_PATHS = {"/generate"}
ALLOWED_CHAT_GET_PATHS = {"/v1/models"}
ALLOWED_CHAT_POST_PATHS = {"/v1/chat/completions"}
CHAT_TIMEOUT = 300


class PoetryRequestHandler(SimpleHTTPRequestHandler):
    """Static-file handler with small, allow-listed FLUX and model reverse proxies."""

    def do_GET(self) -> None:  # noqa: N802 - stdlib handler API
        if self.path.startswith("/api/flux/"):
            upstream_path = self.path.removeprefix("/api/flux")
            if upstream_path in ALLOWED_GET_PATHS or upstream_path.startswith("/images/"):
                self._proxy_flux("GET", upstream_path)
            else:
                self.send_error(404, "Unknown FLUX endpoint")
            return
        if self.path.startswith("/api/chat/"):
            upstream_path = self.path.removeprefix("/api/chat")
            if upstream_path in ALLOWED_CHAT_GET_PATHS:
                self._proxy_chat("GET", upstream_path)
            else:
                self.send_error(404, "Unknown model endpoint")
            return
        super().do_GET()

    def do_POST(self) -> None:  # noqa: N802 - stdlib handler API
        if self.path == "/api/tts":
            self._generate_tts()
            return
        if self.path.startswith("/api/flux/"):
            upstream_path = self.path.removeprefix("/api/flux")
            if upstream_path in ALLOWED_POST_PATHS:
                self._proxy_flux("POST", upstream_path)
            else:
                self.send_error(404, "Unknown FLUX endpoint")
            return
        if self.path.startswith("/api/chat/"):
            upstream_path = self.path.removeprefix("/api/chat")
            if upstream_path in ALLOWED_CHAT_POST_PATHS:
                self._proxy_chat("POST", upstream_path)
            else:
                self.send_error(404, "Unknown model endpoint")
            return
        self.send_error(405, "POST is only supported for the proxies and Gemini TTS")

    def _generate_tts(self) -> None:
        api_key = GEMINI_API_KEY or self.headers.get("X-Gemini-API-Key", "")
        if not api_key:
            self._send_json(401, {"error": "A Gemini API key is required."})
            return

        try:
            length = int(self.headers.get("Content-Length", "0"))
            payload = json.loads(self.rfile.read(length) or b"{}")
            title = str(payload.get("title", "")).strip()
            text = str(payload.get("text", "")).strip()
            voice = TTS_VOICES.get(str(payload.get("voice", "")))
            kind = str(payload.get("kind", "poem"))
            if not title or not text or not voice or kind not in {"poem", "response"}:
                self._send_json(400, {"error": "title, text, kind, and a supported voice are required."})
                return

            book = self._resolve_book(payload.get("book"))
            pcm_chunks = []
            chunks = self._split_tts_text(text)
            for index, chunk in enumerate(chunks):
                transcript = f"{title}.\n\n{chunk}" if kind == "poem" and index == 0 else chunk
                prompt = self._build_tts_prompt(transcript, index, len(chunks), kind, book)
                pcm_chunks.append(self._request_gemini_audio(api_key, voice, prompt))

            audio_buffer = io.BytesIO()
            with wave.open(audio_buffer, "wb") as wav_file:
                wav_file.setnchannels(1)
                wav_file.setsampwidth(2)
                wav_file.setframerate(24000)
                wav_file.writeframes(b"".join(pcm_chunks))
            audio = audio_buffer.getvalue()
            self.send_response(200)
            self.send_header("Content-Type", "audio/wav")
            self.send_header("Content-Length", str(len(audio)))
            self.send_header("Cache-Control", "no-store")
            self.end_headers()
            self.wfile.write(audio)
        except (ValueError, json.JSONDecodeError) as error:
            self._send_json(400, {"error": str(error)})
        except HTTPError as error:
            detail = error.read().decode("utf-8", errors="replace")
            self._send_json(error.code, {"error": f"Gemini TTS request failed: {detail}"})
        except (URLError, TimeoutError) as error:
            reason = getattr(error, "reason", str(error))
            self._send_json(502, {"error": f"Gemini TTS unavailable: {reason}"})
        except Exception as error:  # Keep proxy failures legible to the browser.
            self.log_error("Gemini TTS failure: %s", error)
            self._send_json(502, {"error": f"Could not generate narration: {error}"})

    @staticmethod
    def _split_tts_text(text: str, limit: int = 1800) -> list[str]:
        """Split on stanzas, then lines, to keep each performance under a few minutes."""
        chunks = []
        current = ""
        for stanza in text.split("\n\n"):
            sections = [stanza]
            if len(stanza) > limit:
                sections = []
                section = ""
                for line in stanza.splitlines():
                    candidate = f"{section}\n{line}".strip()
                    if section and len(candidate) > limit:
                        sections.append(section)
                        section = line
                    else:
                        section = candidate
                if section:
                    sections.append(section)

            for section in sections:
                candidate = f"{current}\n\n{section}".strip()
                if current and len(candidate) > limit:
                    chunks.append(current)
                    current = section
                else:
                    current = candidate
        if current:
            chunks.append(current)
        return chunks

    @staticmethod
    def _resolve_book(book_id) -> dict:
        """Map the requested book id onto a books.json record; never trust the raw value."""
        return BOOKS_BY_ID.get(str(book_id or ""), DEFAULT_BOOK)

    @staticmethod
    def _build_tts_prompt(transcript: str, index: int, total: int, kind: str, book: dict) -> str:
        continuation = "This is a continuation; preserve the established voice and cadence." if index else ""
        poet = str(book.get("poet", "the poet"))
        if kind == "response":
            return f"""Synthesize speech for an exact reading of literary commentary. Do not speak these directions.

AUDIO PROFILE: A clear, warm literary companion explaining {poet} to an attentive reader.
DIRECTOR'S NOTES: Natural and conversational, with intelligent emphasis and an unhurried explanatory cadence. Make quotations distinct without theatrical exaggeration. Do not add, omit, summarize, explain, or repeat any words. {continuation}
PART: {index + 1} of {total}

TRANSCRIPT — SPEAK ONLY THE TEXT BELOW
{transcript}"""
        reader_profile = str(book.get("readerProfile", f"A seasoned reader of poetry performing {poet} for an attentive audience."))
        reading_scene = str(book.get("readingScene", "A quiet reading room with close, warm acoustics."))
        reading_notes = str(book.get("readingNotes", "Measured and contemplative, but never flat. Use intelligent rhetorical emphasis, natural breath at line endings, and slightly longer pauses between stanzas."))
        return f"""Synthesize speech for an exact literary reading. Do not speak these directions.

AUDIO PROFILE: {reader_profile}
SCENE: {reading_scene}
DIRECTOR'S NOTES: {reading_notes} Do not add, omit, explain, modernize, or repeat any words. {continuation}
PART: {index + 1} of {total}

TRANSCRIPT — SPEAK ONLY THE TEXT BELOW
{transcript}"""

    def _request_gemini_audio(self, api_key: str, voice: str, prompt: str) -> bytes:
        body = json.dumps({
            "contents": [{"role": "user", "parts": [{"text": prompt}]}],
            "generationConfig": {
                "responseModalities": ["AUDIO"],
                "speechConfig": {
                    "voiceConfig": {
                        "prebuiltVoiceConfig": {"voiceName": voice}
                    }
                },
            },
        }).encode()
        request = Request(
            GEMINI_TTS_URL,
            data=body,
            headers={"Content-Type": "application/json", "x-goog-api-key": api_key},
            method="POST",
        )

        last_error = None
        for attempt in range(3):
            try:
                with urlopen(request, timeout=180) as response:
                    payload = json.loads(response.read())
                parts = payload.get("candidates", [{}])[0].get("content", {}).get("parts", [])
                audio_part = next((part.get("inlineData") for part in parts if part.get("inlineData")), None)
                if audio_part and audio_part.get("data"):
                    audio = base64.b64decode(audio_part["data"])
                    if audio.startswith(b"RIFF"):
                        with wave.open(io.BytesIO(audio), "rb") as wav_file:
                            return wav_file.readframes(wav_file.getnframes())
                    return audio
                last_error = ValueError("Gemini returned no audio payload.")
            except HTTPError as error:
                last_error = error
                if error.code < 500:
                    raise
            if attempt < 2:
                time.sleep(1.5 * (attempt + 1))
        raise last_error or ValueError("Gemini returned no audio payload.")

    def _send_json(self, status: int, payload: dict) -> None:
        body = json.dumps(payload).encode()
        self._send_proxy_response(status, {"Content-Type": "application/json"}, body)

    def _proxy_flux(self, method: str, upstream_path: str) -> None:
        api_key = FLUX_API_KEY or self.headers.get("X-API-Key", "")
        self._proxy(
            f"{FLUX_BASE_URL}{upstream_path}",
            method,
            {"X-API-Key": api_key} if api_key else {},
            timeout=45,
            unavailable=lambda reason: {"success": False, "error": f"FLUX server unavailable: {reason}"},
        )

    def _proxy_chat(self, method: str, upstream_path: str) -> None:
        """Relay OpenAI-compatible model traffic so browsers never need LAN access."""
        self._proxy(
            f"{VLLM_BASE_URL}{upstream_path}",
            method,
            {},
            timeout=CHAT_TIMEOUT,
            unavailable=lambda reason: {"error": {"message": f"Model server unavailable: {reason}"}},
            stream=True,
        )

    def _proxy(self, url: str, method: str, extra_headers: dict, timeout: int, unavailable, stream: bool = False) -> None:
        length = int(self.headers.get("Content-Length", "0"))
        body = self.rfile.read(length) if length else None
        headers = {"Accept": self.headers.get("Accept", "application/json"), **extra_headers}
        if body is not None:
            headers["Content-Type"] = self.headers.get("Content-Type", "application/json")

        request = Request(url, data=body, headers=headers, method=method)
        try:
            with urlopen(request, timeout=timeout) as response:
                if stream:
                    self._stream_proxy_response(response)
                else:
                    self._send_proxy_response(response.status, response.headers, response.read())
        except HTTPError as error:
            self._send_proxy_response(error.code, error.headers, error.read())
        except (URLError, TimeoutError) as error:
            reason = getattr(error, "reason", str(error))
            message = json.dumps(unavailable(reason))
            self._send_proxy_response(502, {"Content-Type": "application/json"}, message.encode())

    def _stream_proxy_response(self, response) -> None:
        """Forward the body chunk by chunk, without Content-Length, to keep tokens live."""
        self.send_response(response.status)
        self.send_header("Content-Type", response.headers.get("Content-Type", "application/octet-stream"))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        try:
            while True:
                chunk = response.read1(8192)
                if not chunk:
                    break
                self.wfile.write(chunk)
                self.wfile.flush()
        except (BrokenPipeError, ConnectionResetError):
            pass  # The reader stopped the response or closed the page.

    def _send_proxy_response(self, status: int, headers, body: bytes) -> None:
        self.send_response(status)
        self.send_header("Content-Type", headers.get("Content-Type", "application/octet-stream"))
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", headers.get("Cache-Control", "no-store"))
        self.end_headers()
        self.wfile.write(body)


def main() -> None:
    server_config = CONFIG.get("server", {})
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--host", default=server_config.get("host", "0.0.0.0"), help="bind address")
    parser.add_argument("--port", type=int, default=server_config.get("port", 8000), help="port")
    args = parser.parse_args()

    os.chdir(BASE_DIR)
    server = ThreadingHTTPServer((args.host, args.port), PoetryRequestHandler)
    print(f"Serving John Donne poems at http://{args.host}:{args.port}")
    print(f"Proxying image requests to {FLUX_BASE_URL}")
    print(f"Proxying model requests to {VLLM_BASE_URL}")
    server.serve_forever()


if __name__ == "__main__":
    main()
