import io
import json
import unittest
import wave
from unittest.mock import patch
from urllib.error import HTTPError
import server


class ElevenLabsTests(unittest.TestCase):
    def test_provider_pcm_is_saved_as_wav_with_distinct_identity(self):
        handler = object.__new__(server.PoetryRequestHandler)
        payload = dict(title='Test', text='Read this.', voice='masculine', provider='elevenlabs', book=server.DEFAULT_BOOK['id'])
        pcm = b'\x01\x00' * 240
        response = io.BytesIO(pcm)
        with patch.object(handler, '_library_audio', return_value=None), patch.object(server, 'urlopen', return_value=response) as request, patch.object(server, 'cache_audio', return_value='/saved.wav') as cache:
            audio, path, reused = handler._render_tts(payload, '')
        req = request.call_args.args[0]
        self.assertIn('output_format=pcm_24000', req.full_url)
        self.assertEqual(json.loads(req.data)['model_id'], 'eleven_multilingual_v2')
        with wave.open(io.BytesIO(audio)) as wav:
            self.assertEqual((wav.getnchannels(), wav.getsampwidth(), wav.getframerate()), (1, 2, 24000))
            self.assertEqual(wav.readframes(240), pcm)
        self.assertEqual(cache.call_args.args[3]['provider'], 'elevenlabs')
        self.assertNotEqual(handler._tts_request(payload)[-2], handler._tts_request({**payload, 'provider': 'local'})[-2])

    def test_provider_error_redacts_key(self):
        handler = object.__new__(server.PoetryRequestHandler)
        with patch.object(server, 'ELEVENLABS_API_KEY', 'secret-test'), patch.object(server, 'urlopen', side_effect=HTTPError('url', 401, 'bad', {}, io.BytesIO(b'{"detail":{"message":"secret-test rejected"}}'))):
            with self.assertRaisesRegex(server.TTSGenerationError, r'\[redacted\] rejected'):
                handler._request_elevenlabs_audio('Hello', 'voice')

    def test_flash_stream_forwards_upstream_without_buffering(self):
        handler = object.__new__(server.PoetryRequestHandler)
        payload = dict(input='Hello streaming.', voice='masculine', provider='elevenlabs')
        with patch.object(server, 'ELEVENLABS_API_KEY', 'test-key'), patch.object(handler, '_read_json_body', return_value=payload), patch.object(server, 'urlopen', return_value=io.BytesIO(b'\x01\x00')) as request, patch.object(handler, '_stream_proxy_response', side_effect=lambda response: self.assertEqual(response.tell(), 0)) as forward:
            handler._stream_local_tts()
            req = request.call_args.args[0]
            self.assertIn('/stream?output_format=pcm_24000', req.full_url)
            self.assertEqual(json.loads(req.data), {'text': 'Hello streaming.', 'model_id': 'eleven_flash_v2_5'})
            self.assertEqual(req.get_header('Xi-api-key'), 'test-key')
            forward.assert_called_once()

    def test_stream_rejects_unsupported_provider(self):
        handler = object.__new__(server.PoetryRequestHandler)
        with patch.object(handler, '_read_json_body', return_value={'provider': 'gemini'}), patch.object(handler, '_send_json') as send:
            handler._stream_local_tts()
        self.assertEqual(send.call_args.args[0], 400)

    def test_save_stream_preserves_flash_identity_and_audio(self):
        import base64
        handler = object.__new__(server.PoetryRequestHandler)
        pcm = b'\x01\x00' * 240
        payload = dict(title='Test', text='Read this.', voice='masculine', provider='elevenlabs', book=server.DEFAULT_BOOK['id'], pcm=base64.b64encode(pcm).decode())
        with patch.object(handler, '_read_json_body', return_value=payload), patch.object(server, 'cache_audio', return_value='/saved.wav') as cache, patch.object(handler, '_send_json') as send:
            handler._save_streamed_tts()
        self.assertEqual(send.call_args.args[0], 200)
        self.assertEqual(cache.call_args.args[3]['model'], 'eleven_flash_v2_5')
        self.assertNotEqual(cache.call_args.args[2], handler._tts_request(payload)[-2])
        with wave.open(io.BytesIO(cache.call_args.args[1])) as audio:
            self.assertEqual(audio.getframerate(), 24000)
            self.assertEqual(audio.readframes(240), pcm)

    def test_invalid_stream_is_not_saved(self):
        handler = object.__new__(server.PoetryRequestHandler)
        payload = dict(title='Test', text='Read this.', voice='masculine', provider='elevenlabs', book=server.DEFAULT_BOOK['id'], pcm='AQ==')
        with patch.object(handler, '_read_json_body', return_value=payload), patch.object(server, 'cache_audio') as cache, patch.object(handler, '_send_json') as send:
            handler._save_streamed_tts()
        cache.assert_not_called()
        self.assertEqual(send.call_args.args[0], 400)


class CharacterCastTests(unittest.TestCase):
    def test_all_cast_voices_resolve_and_flash_cache_is_separate(self):
        book = next(book for book in server.BOOKS if book['id'] == 'doctor-faustus')
        handler = object.__new__(server.PoetryRequestHandler)
        for voice in set(book['performanceCast'].values()):
            with self.subTest(voice=voice):
                self.assertTrue(server.resolve_tts_voice(voice, 'elevenlabs'))
                payload = dict(title='Doctor Faustus · Performance · Cue 1', text='Speak this exact line.',
                               voice=voice, provider='elevenlabs', model='eleven_flash_v2_5',
                               book=book['id'], speakTitle=False)
                request = handler._tts_request(payload)
                self.assertEqual(request[5], 'eleven_flash_v2_5')
                self.assertEqual(request[7]['id'], book['id'])
                self.assertNotEqual(request[-2], handler._tts_request({**payload, 'model': server.ELEVENLABS_MODEL})[-2])

    def test_character_stream_recording_is_reused_by_availability_identity(self):
        import base64
        handler = object.__new__(server.PoetryRequestHandler)
        payload = dict(title='Doctor Faustus · Performance · Cue 1 · FAUSTUS', text='Settle thy studies, Faustus.',
                       voice='masculine', provider='elevenlabs', model='eleven_flash_v2_5',
                       book='doctor-faustus', speakTitle=False, pcm=base64.b64encode(b'\x01\x00' * 24).decode())
        with patch.object(handler, '_read_json_body', return_value=payload), patch.object(server, 'cache_audio', return_value='/saved.wav') as cache, patch.object(handler, '_send_json') as send:
            handler._save_streamed_tts()
        self.assertEqual(send.call_args.args[0], 200)
        self.assertEqual(cache.call_args.args[2], handler._tts_request(payload)[-2])

    def test_generation_uses_requested_cast_model(self):
        handler = object.__new__(server.PoetryRequestHandler)
        with patch.object(server, 'ELEVENLABS_API_KEY', 'test-key'), patch.object(server, 'urlopen', return_value=io.BytesIO(b'\x01\x00')) as request:
            handler._request_elevenlabs_audio('Hello.', server.ELEVENLABS_VOICES['river'], 'eleven_flash_v2_5')
        self.assertEqual(json.loads(request.call_args.args[0].data)['model_id'], 'eleven_flash_v2_5')
