import io
import json
import unittest
from urllib.error import HTTPError
from unittest.mock import patch
import server


class ProviderErrorTests(unittest.TestCase):
    def test_error_detail_redaction_and_queue_stops(self):
        body = json.dumps({'error': {'message': 'Invalid speech style; key=secret-key AIzaAnotherKey123'}, 'debug': 'not public'}).encode()
        error = HTTPError('https://example.invalid', 400, 'Bad Request', {}, io.BytesIO(body))
        handler = object.__new__(server.PoetryRequestHandler)
        job_id = 'provider-error-test'
        server.TTS_JOBS[job_id] = {'state': 'queued', 'completed': 0, 'reused': 0}
        try:
            with patch.object(handler, '_render_tts', side_effect=error) as render:
                handler._run_tts_job(job_id, [{}, {}], 'secret-key')
            self.assertEqual(render.call_count, 1)
            job = server.TTS_JOBS[job_id]
            self.assertEqual(job['state'], 'failed')
            self.assertIn('Invalid speech style', job['error'])
            self.assertNotIn('secret-key', job['error'])
            self.assertNotIn('AIzaAnotherKey123', job['error'])
            self.assertNotIn('not public', job['error'])
        finally:
            del server.TTS_JOBS[job_id]

    def test_non_json_body_stays_private(self):
        error = HTTPError('https://example.invalid', 502, 'Bad Gateway', {}, io.BytesIO(b'<html>private</html>'))
        self.assertEqual(server.tts_provider_error(error), 'Provider returned HTTP 502.')


if __name__ == '__main__':
    unittest.main()
