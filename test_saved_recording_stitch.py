"""Saved-version assembly uses recorded identities, without a provider request."""
import io
import json
import tempfile
import unittest
import wave
from pathlib import Path
from unittest.mock import patch
import server


class SavedStitchTests(unittest.TestCase):
    def test_join_and_reuse_without_current_text_or_generation(self):
        with tempfile.TemporaryDirectory() as directory, patch.object(server, 'AUDIO_LIBRARY_PATH', Path(directory)):
            keys = [f'{i:064x}' for i in [1, 2]]
            for i, key in enumerate(keys):
                buffer = io.BytesIO()
                with wave.open(buffer, 'wb') as audio:
                    audio.setparams((1, 2, 24000, 0, 'NONE', 'not compressed'))
                    audio.writeframes(bytes([i + 1, 0]) * 10)
                (Path(directory) / f'{key}.wav').write_bytes(buffer.getvalue())
                (Path(directory) / f'{key}.json').write_text(json.dumps(dict(book='colony-to-province',
                    entryTitle='Chapter I', kind='poem', provider='local', model=server.LOCAL_TTS_MODEL,
                    voice='masculine', filename=f'Perry Miller - Chapter I - Part {i+1} - Ryan.wav')))
            handler = object.__new__(server.PoetryRequestHandler)
            payload = dict(book='colony-to-province', title='Chapter I', savedKeys=keys, filename='Saved chapter.wav')
            with patch.object(handler, '_send_tts_audio') as send, \
                 patch.object(server, 'urlopen', side_effect=AssertionError('Must not generate')):
                handler._stitch_saved_recordings(payload)
                audio = send.call_args.args[0]
                with wave.open(io.BytesIO(audio)) as wav:
                    self.assertEqual(wav.readframes(20), b'\x01\x00' * 10 + b'\x02\x00' * 10)
                self.assertFalse(send.call_args.kwargs['reused'])
                handler._stitch_saved_recordings(payload)
                self.assertTrue(send.call_args.kwargs['reused'])
                for invalid in [keys[::-1], [keys[0], keys[0]], ['../secrets']]:
                    with self.assertRaises(ValueError):
                        handler._stitch_saved_recordings({**payload, 'savedKeys': invalid})
                metadata = Path(directory) / f'{keys[1]}.json'
                record = json.loads(metadata.read_text())
                for field, value in [('voice', 'feminine'), ('book', 'new-england-mind'), ('entryTitle', 'Chapter II')]:
                    metadata.write_text(json.dumps({**record, field: value}))
                    with self.assertRaises(ValueError):
                        handler._stitch_saved_recordings(payload)


if __name__ == '__main__':
    unittest.main()
