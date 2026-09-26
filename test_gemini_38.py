import base64
import io
import json
import unittest
import wave
from unittest.mock import patch

import server


class Gemini38Tests(unittest.TestCase):
    def test_transcript_metadata_and_wav_decoding(self):
        wav = io.BytesIO()
        with wave.open(wav, 'wb') as audio:
            audio.setparams((1, 2, 24000, 0, 'NONE', 'not compressed'))
            audio.writeframes(b'\x01\x00' * 24)
        result = {'status': 'completed', 'steps': [{'type': 'model_output', 'content': [
            {'type': 'audio', 'data': base64.b64encode(wav.getvalue()).decode()}
        ]}]}
        handler = object.__new__(server.PoetryRequestHandler)
        for model in ('gemini-3.8-flash-tts', 'gemini-3.8-flash-lite-tts'):
            with patch.object(server, 'urlopen', return_value=io.BytesIO(json.dumps(result).encode())) as request:
                pcm = handler._request_gemini_38_audio('test-key', 'Gacrux', 'Only these words.', 'Measured.', model)
                self.assertEqual(pcm, b'\x01\x00' * 24)
                sent = request.call_args.args[0]
                body = json.loads(sent.data)
                self.assertTrue(sent.full_url.endswith('/interactions'))
                self.assertEqual(body['model'], model)
                self.assertFalse(body['store'])
                content = body['input'][0]['content'][0]
                self.assertEqual(content['text'], 'Only these words.')
                self.assertEqual(content['annotations'][0]['style'], 'Measured.')
        with patch.object(server, 'urlopen', return_value=io.BytesIO(b'{"status":"incomplete"}')) as request:
            with self.assertRaisesRegex(ValueError, 'did not complete'):
                handler._request_gemini_38_audio('key', 'Gacrux', 'text', 'style', model)
            self.assertEqual(request.call_count, 1)


if __name__ == '__main__':
    unittest.main()
