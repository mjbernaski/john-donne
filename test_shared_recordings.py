"""Shared discovery must not depend on generation settings or read audio bodies."""
import json
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

import server


class SharedRecordingsTests(unittest.TestCase):
    def setUp(self):
        self.handler = object.__new__(server.PoetryRequestHandler)

    def discover(self, payload):
        with patch.object(self.handler, '_read_json_body', return_value=payload), \
             patch.object(self.handler, '_send_json') as send, \
             patch.object(Path, 'read_bytes', side_effect=AssertionError('No WAV reads')), \
             patch.object(server, 'urlopen', side_effect=AssertionError('No generation')):
            self.handler._tts_recordings()
        return send.call_args.args

    def test_all_variants_legacy_names_and_isolation(self):
        with tempfile.TemporaryDirectory() as directory, patch.object(server, 'AUDIO_LIBRARY_PATH', Path(directory)):
            def record(number, filename, metadata=None, audio=True):
                key = f'{number:064x}'
                (Path(directory) / f'{key}.json').write_text(json.dumps({'filename': filename, **(metadata or {})}))
                if audio:
                    (Path(directory) / f'{key}.wav').touch()
            title = 'Chapter I · A Beginning'
            prefix = 'Arthur Conan Doyle - Chapter I A Beginning'
            record(1, prefix + ' - Part 10 - Gacrux.wav')
            record(2, prefix + ' - Part 2 - Local voice 1.wav')
            record(3, 'Truncated filename.wav', {'book': 'sherlock-holmes', 'entryTitle': title, 'kind': 'poem', 'model': 'another-model'})
            record(4, prefix + ' - Part 3.wav', {'book': 'anna-karenina', 'entryTitle': title, 'kind': 'poem'})
            record(5, prefix + ' - Part 4.wav', {'book': 'sherlock-holmes', 'entryTitle': title, 'kind': 'response'})
            record(6, prefix + ' - Part 5.wav', audio=False)
            record(7, prefix + ' continued - Part 1.wav')
            (Path(directory) / ('f' * 64 + '.json')).write_text('{')
            code, payload = self.discover({'book': 'sherlock-holmes', 'title': title})
            self.assertEqual(code, 200)
            self.assertEqual(len(payload['recordings']), 3)
            self.assertIn('Part 2', payload['recordings'][0]['filename'])
            self.assertIn('Part 10', payload['recordings'][1]['filename'])
            self.assertEqual(payload['recordings'][2]['model'], 'another-model')
            record(8, prefix + ' - Complete chapter.wav')
            self.assertEqual(len(self.discover({'book': 'sherlock-holmes', 'title': title})[1]['recordings']), 4)

    def test_metadata_survives_cached_audio_reuse(self):
        with tempfile.TemporaryDirectory() as directory, patch.object(server, 'AUDIO_LIBRARY_PATH', Path(directory)):
            key = 'a' * 64
            server.cache_audio('Reading.wav', b'audio', key, {'book': 'sherlock-holmes', 'entryTitle': 'Test'})
            server.cache_audio('Renamed.wav', b'audio', key)
            record = json.loads((Path(directory) / f'{key}.json').read_text())
            self.assertEqual(record['entryTitle'], 'Test')
            self.assertEqual(record['filename'], 'Renamed.wav')

    def test_invalid_requests(self):
        for payload in [[], {}, {'book': '../secrets', 'title': 'X'}, {'book': 'sherlock-holmes', 'title': []}]:
            self.assertEqual(self.discover(payload)[0], 400)


if __name__ == '__main__':
    unittest.main()
