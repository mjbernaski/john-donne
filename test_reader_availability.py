"""Availability is metadata-only and shares the existing recording identities."""
import json
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch
import server


class AvailabilityTests(unittest.TestCase):
    def setUp(self):
        self.handler = object.__new__(server.PoetryRequestHandler)
        self.part = dict(title='Test', text='A reading.', voice='feminine', provider='gemini',
                         model='gemini-3.1-flash-tts-preview', book='sherlock-holmes', speakTitle=False)

    def test_saved_missing_no_audio_reads_or_provider_calls(self):
        with tempfile.TemporaryDirectory() as directory, patch.object(server, 'AUDIO_LIBRARY_PATH', Path(directory)):
            key = self.handler._tts_request(self.part)[-2]
            (Path(directory) / f'{key}.wav').write_bytes(b'existing audio')
            missing = {**self.part, 'voice': 'masculine'}
            with patch.object(self.handler, '_read_json_body', return_value={'parts': [self.part, missing]}), \
                 patch.object(self.handler, '_send_json') as send, \
                 patch.object(Path, 'read_bytes', side_effect=AssertionError('Must not read WAV')), \
                 patch.object(server, 'urlopen', side_effect=AssertionError('Must not call provider')):
                self.handler._tts_availability()
            code, payload = send.call_args.args
            self.assertEqual(code, 200)
            self.assertTrue(payload['parts'][0]['saved'])
            self.assertIn(key, payload['parts'][0]['url'])
            self.assertEqual(payload['parts'][1], {'saved': False, 'url': None})

    def test_invalid_batches(self):
        for payload in [[], {}, {'parts': []}, {'parts': [None]}, {'parts': [{}]}]:
            with self.subTest(payload=payload), patch.object(self.handler, '_read_json_body', return_value=payload), \
                 patch.object(self.handler, '_send_json') as send:
                self.handler._tts_availability()
                self.assertEqual(send.call_args.args[0], 400)


if __name__ == '__main__':
    unittest.main()
