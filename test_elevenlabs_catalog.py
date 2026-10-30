import io
import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch
from urllib.error import HTTPError
import elevenlabs_catalog as catalog
import server

class CatalogTests(unittest.TestCase):
    def setUp(self):
        catalog._catalog = None
        catalog._catalog_at = 0

    def test_account_pagination_and_safe_voice_resolution(self):
        voices = [dict(voice_id='voice1234567890', name='New actor', labels={'accent':'British'})]
        responses = [dict(voices=voices, has_more=True, next_page_token='page2'),
                     dict(voices=[dict(voice_id='second123456789', name='Second')], has_more=False),
                     [dict(model_id='eleven_v4', name='v4', can_do_text_to_speech=True)]]
        with patch.object(catalog, 'api_request', side_effect=lambda *args: io.BytesIO(json.dumps(responses.pop(0)).encode())) as request:
            result = catalog.catalog('test')
            self.assertEqual(len(result['voices']), 2)
            self.assertIn('next_page_token=page2', request.call_args_list[1].args[1])
            self.assertEqual(server.resolve_tts_voice('eleven:voice1234567890', 'elevenlabs'), 'voice1234567890')
            self.assertIsNone(server.resolve_tts_voice('eleven:unknown', 'elevenlabs'))
            self.assertEqual(request.call_count, 3, 'Catalog is reused for voice validation')

    def test_auth_error_does_not_expose_key(self):
        with patch.object(catalog, 'urlopen', side_effect=HTTPError('url', 401, 'bad', {}, io.BytesIO())):
            with self.assertRaisesRegex(ValueError, '401 Unauthorized') as error:
                catalog.api_request('secret', '/v1/models')
        self.assertNotIn('secret', str(error.exception))

    def test_missing_permissions_are_distinguished_from_invalid_key(self):
        body = json.dumps({'detail': {'status': 'missing_permissions', 'message': 'The API key is missing voices_read.'}}).encode()
        with patch.object(catalog, 'urlopen', side_effect=HTTPError('url', 401, 'bad', {}, io.BytesIO(body))):
            with self.assertRaisesRegex(ValueError, 'voices_read') as error:
                catalog.api_request('secret', '/v2/voices')
        self.assertNotIn('Update ELEVENLABS_API_KEY', str(error.exception))

    def test_excerpt_is_short_and_verbatim(self):
        excerpt = catalog.scene(Path('.'))
        self.assertEqual(len(excerpt['turns']), 6)
        self.assertEqual(excerpt['characters'], 514)
        source = json.loads(Path('poems-goethe-faust.json').read_text())[6]['content']
        for turn in excerpt['turns']: self.assertIn(turn['text'], source)

    def test_dialogue_model_and_cast_are_preserved_and_cached(self):
        data = dict(voices=[dict(id='actor1234567890'), dict(id='actor2345678901')], models=[dict(id='eleven_v4')])
        payload = dict(model='eleven_v4', cast=dict(FAUST='actor1234567890', MEPHISTOPHELES='actor2345678901'))
        excerpt = catalog.scene(Path('.'))
        with tempfile.TemporaryDirectory() as directory:
            with patch.object(catalog, 'catalog', return_value=data), patch.object(catalog, 'scene', return_value=excerpt), patch.object(catalog, 'api_request', return_value=io.BytesIO(b'\x01\x00'*240)) as request:
                first = catalog.audition(Path(directory), 'test', payload)
                second = catalog.audition(Path(directory), 'test', payload)
                self.assertFalse(first['reused'])
                self.assertTrue(second['reused'])
                self.assertEqual(first['url'], second['url'])
                request.assert_called_once()
                body = request.call_args.args[2]
                self.assertEqual(body['model_id'], 'eleven_v4')
                self.assertEqual(body['inputs'][0]['voice_id'], payload['cast']['FAUST'])
                self.assertEqual(body['inputs'][1]['voice_id'], payload['cast']['MEPHISTOPHELES'])
                self.assertEqual([i['text'] for i in body['inputs']], [t['text'] for t in excerpt['turns']])

    def test_rejects_unavailable_model_and_unknown_voice_before_generation(self):
        data = dict(voices=[dict(id='actor1234567890')], models=[dict(id='eleven_flash_v2_5')])
        with patch.object(catalog, 'catalog', return_value=data), patch.object(catalog, 'api_request') as request:
            with self.assertRaisesRegex(ValueError, 'not available'):
                catalog.audition(Path('.'), 'test', dict(model='eleven_v4', cast={}))
            with self.assertRaisesRegex(ValueError, 'Select two voices'):
                catalog.audition(Path('.'), 'test', dict(model='eleven_flash_v2_5', cast=dict(FAUST='unknown', MEPHISTOPHELES='unknown')))
            request.assert_not_called()

if __name__ == '__main__': unittest.main()
