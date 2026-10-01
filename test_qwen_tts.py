import io
import json
import threading
import unittest
import wave
from concurrent.futures import ThreadPoolExecutor
from unittest.mock import patch
from urllib.error import URLError
import server


class Response(io.BytesIO):
    pass


class QwenTests(unittest.TestCase):
    def handler(self):
        return object.__new__(server.PoetryRequestHandler)

    def test_pcm_is_saved_with_final_wav_header(self):
        pcm = b'\x01\x00' * 2400
        with patch.object(server, 'urlopen', return_value=Response(pcm)) as opened:
            audio = self.handler()._request_local_audio('Hello', 'ryan', 'calm')
        body = json.loads(opened.call_args.args[0].data)
        self.assertEqual(body['response_format'], 'pcm')
        self.assertEqual(body['voice'], 'ryan')
        self.assertEqual(body['instructions'], 'calm')
        self.assertTrue(opened.call_args.args[0].full_url.endswith('/v1/audio/speech'))
        with wave.open(io.BytesIO(audio)) as wav:
            self.assertEqual((wav.getnchannels(), wav.getsampwidth(), wav.getframerate()), (1, 2, 24000))
            self.assertEqual(wav.readframes(wav.getnframes()), pcm)

    def test_connection_failure_uses_lan_fallback(self):
        with patch.object(server, 'urlopen', side_effect=[URLError('DNS'), Response(b'\x00\x00')]) as opened:
            self.handler()._request_local_audio('Hello', 'ryan')
        self.assertEqual(opened.call_args.args[0].full_url, server.TTS_FALLBACK_URL + '/v1/audio/speech')

    def test_four_independent_local_renders_run_together(self):
        barrier = threading.Barrier(4)
        def request(handler, payload):
            return ('', '', '', '', 'local', '', '', {}, f'{payload * 64:08x}', '')
        def render(handler, payload, api_key):
            barrier.wait(timeout=2)
            return payload
        with patch.object(server.PoetryRequestHandler, '_tts_request', request), patch.object(server.PoetryRequestHandler, '_render_tts_locked', render):
            with ThreadPoolExecutor(max_workers=4) as pool:
                futures = [pool.submit(self.handler()._render_tts, i, '') for i in range(4)]
                self.assertEqual([f.result() for f in futures], list(range(4)))

    def test_named_local_voice_and_roles(self):
        with patch.object(server, 'LOCAL_TTS_VOICE_NAMES', {'ryan', 'vivian', 'aiden', 'custom_reader'}):
            self.assertEqual(server.resolve_local_voice('RYAN'), 'ryan')
            self.assertEqual(server.resolve_local_voice('custom_reader'), 'custom_reader')
            self.assertEqual(server.resolve_local_voice('masculine'), 'ryan')
            self.assertIsNone(server.resolve_local_voice('unknown'))
            handler = self.handler()
            self.assertEqual(handler._tts_request(dict(title='Test', text='Hello', voice='custom_reader'))[2], 'custom_reader')
            self.assertNotEqual(server.audio_library_key('Test', 'Hello', 'ryan', 'poem', 'colony-to-province'),
                                server.audio_library_key('Test', 'Hello', 'custom_reader', 'poem', 'colony-to-province'))

    def test_input_and_incomplete_pcm_rejected(self):
        with self.assertRaises(ValueError):
            self.handler()._open_local_speech('x' * 20001, 'ryan')
        with patch.object(server, 'urlopen', return_value=Response(b'\x01')):
            with self.assertRaises(ValueError):
                self.handler()._request_local_audio('Hello', 'ryan')


if __name__ == '__main__':
    unittest.main()
