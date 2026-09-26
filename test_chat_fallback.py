import io
import json
import unittest
from unittest.mock import patch
from urllib.error import HTTPError, URLError

import server


class ChatFallbackTests(unittest.TestCase):
    def handler(self, payload=None):
        handler = object.__new__(server.PoetryRequestHandler)
        body = json.dumps(payload).encode() if payload else b""
        handler.headers = {"Content-Length": str(len(body))}
        handler.rfile = io.BytesIO(body)
        handler._stream_proxy_response = lambda response: response.read()
        handler._send_proxy_response = lambda *args: setattr(handler, "result", args)
        handler._send_json = lambda *args: setattr(handler, "result", args)
        return handler

    def setUp(self):
        self.primary = patch.object(server, "VLLM_BASE_URL", "http://primary")
        self.fallback = patch.object(server, "VLLM_FALLBACK_URL", "http://fallback")
        self.primary.start()
        self.fallback.start()
        self.addCleanup(self.primary.stop)
        self.addCleanup(self.fallback.stop)

    def test_discovery_falls_back_when_primary_is_offline(self):
        with patch.object(server, "urlopen", side_effect=[URLError("offline"), io.BytesIO(b'{}')]) as opening:
            self.handler()._proxy_chat("GET", "/v1/models")
        self.assertEqual(opening.call_args.args[0].full_url, "http://fallback/v1/models")

    def test_completion_switches_model_and_preserves_messages(self):
        payload = {"model": "old-model", "messages": [{"role": "user", "content": "Hello"}], "stream": True}
        with patch.object(server, "urlopen", side_effect=[URLError("offline"), io.BytesIO(b'{"data":[{"id":"bonsai"}]}'), io.BytesIO(b'data: done')]) as opening:
            self.handler(payload)._proxy_chat("POST", "/v1/chat/completions")
        request = opening.call_args.args[0]
        self.assertEqual(request.full_url, "http://fallback/v1/chat/completions")
        self.assertEqual(json.loads(request.data), {**payload, "model": "bonsai"})

    def test_primary_recovery_remaps_saved_fallback_model(self):
        with patch.object(server, "urlopen", side_effect=[io.BytesIO(b'{"data":[{"id":"primary-model"}]}'), io.BytesIO(b'ok')]) as opening:
            self.handler({"model": "bonsai"})._proxy_chat("POST", "/v1/chat/completions")
        self.assertEqual(opening.call_args.args[0].full_url, "http://primary/v1/chat/completions")
        self.assertEqual(json.loads(opening.call_args.args[0].data)["model"], "primary-model")

    def test_http_errors_only_fail_over_for_unavailability(self):
        for status in (400, 401, 429, 503):
            with self.subTest(status=status):
                error = HTTPError("http://primary", status, "error", {}, io.BytesIO(b'error'))
                with patch.object(server, "urlopen", side_effect=[error, io.BytesIO(b'ok')]) as opening:
                    self.handler()._proxy_chat("GET", "/v1/models")
                self.assertEqual(opening.call_count, 2 if status in (429, 503) else 1)

    def test_both_offline_returns_json_error(self):
        handler = self.handler()
        with patch.object(server, "urlopen", side_effect=URLError("offline")):
            handler._proxy_chat("GET", "/v1/models")
        self.assertEqual(handler.result[0], 502)

    def test_broken_stream_does_not_retry(self):
        handler = self.handler()
        handler._stream_proxy_response = lambda response: (_ for _ in ()).throw(ConnectionResetError())
        with patch.object(server, "urlopen", return_value=io.BytesIO(b'')) as opening:
            with self.assertRaises(ConnectionResetError):
                handler._proxy_chat("GET", "/v1/models")
        self.assertEqual(opening.call_count, 1)


if __name__ == "__main__":
    unittest.main()
