"""Exercise Gemini recovery without calling or charging a provider."""
import base64
import io
import json
import unittest
from urllib.error import HTTPError, URLError
from unittest.mock import patch

import server


def audio_response():
    return io.BytesIO(json.dumps({'candidates': [{'finishReason': 'STOP', 'content': {
        'parts': [{'inlineData': {'data': base64.b64encode(b'\x01\x00' * 24).decode()}}]
    }}]}).encode())


class RecoveryTests(unittest.TestCase):
    def setUp(self):
        self.handler = object.__new__(server.PoetryRequestHandler)
        pacing = patch.object(self.handler, '_pace_gemini_request')
        pacing.start()
        self.addCleanup(pacing.stop)

    def request(self):
        return self.handler._request_gemini_audio('secret', 'Gacrux', 'Read this.', 'gemini-3.1-flash-tts-preview')

    def test_transient_failures_recover_and_report_backoff(self):
        cases = [TimeoutError(), URLError('offline'),
                 HTTPError('test', 503, 'busy', {}, io.BytesIO()),
                 HTTPError('test', 429, 'limited', {'Retry-After': '7'}, io.BytesIO()),
                 io.BytesIO(b'{broken'), io.BytesIO(b'{"candidates":[]}')]
        for failure in cases:
            with self.subTest(failure=failure), \
                 patch.object(server, 'urlopen', side_effect=[failure, audio_response()]) as request, \
                 patch.object(server.time, 'sleep') as sleep, \
                 patch.object(self.handler, '_tts_progress') as progress:
                self.assertEqual(self.request(), b'\x01\x00' * 24)
                self.assertEqual(request.call_count, 2)
                sleep.assert_called_once()
                if isinstance(failure, HTTPError) and failure.code == 429:
                    sleep.assert_called_with(60)
                stages = [call.kwargs['stage'] for call in progress.call_args_list]
                self.assertEqual(stages, ['generating', 'retrying', 'generating'])
                self.assertEqual(progress.call_args.kwargs['attempt'], 2)

    def test_retries_are_bounded(self):
        with patch.object(server, 'urlopen', side_effect=TimeoutError()) as request, \
             patch.object(server.time, 'sleep') as sleep:
            with self.assertRaises(TimeoutError):
                self.request()
            self.assertEqual(request.call_count, 4)
            self.assertEqual(sleep.call_count, 3)

    def test_rate_limits_get_six_attempts_and_longer_backoff(self):
        errors = [HTTPError('test', 429, 'limited', {}, io.BytesIO()) for _ in range(6)]
        with patch.object(server, 'urlopen', side_effect=errors) as request, \
             patch.object(server.time, 'sleep') as sleep:
            with self.assertRaises(HTTPError):
                self.request()
        self.assertEqual(request.call_count, 6)
        self.assertEqual([call.args[0] for call in sleep.call_args_list], [60, 120, 240, 300, 300])

    def test_retry_after_is_not_shortened(self):
        error = HTTPError('test', 429, 'limited', {'Retry-After': '420'}, io.BytesIO())
        with patch.object(server, 'urlopen', side_effect=[error, audio_response()]), \
             patch.object(server.time, 'sleep') as sleep:
            self.request()
        sleep.assert_called_once_with(420)

    def test_pacing_is_shared_between_handlers(self):
        with patch.object(server, 'GEMINI_TTS_NEXT_REQUEST_AT', 0), \
             patch.object(server.time, 'monotonic', side_effect=[100, 100, 104, 115]), \
             patch.object(server.time, 'sleep') as sleep, \
             patch.object(server.PoetryRequestHandler, '_tts_progress') as progress:
            server.PoetryRequestHandler._pace_gemini_request(self.handler)
            other = object.__new__(server.PoetryRequestHandler)
            other._pace_gemini_request()
            sleep.assert_called_once_with(11)
            self.assertEqual(progress.call_args.kwargs['stage'], 'pacing')
            self.assertEqual(server.GEMINI_TTS_NEXT_REQUEST_AT, 130)

    def test_permanent_errors_are_not_retried(self):
        for status in [400, 401, 403]:
            with patch.object(server, 'urlopen', side_effect=HTTPError('test', status, 'no', {}, io.BytesIO())) as request, \
                 patch.object(server.time, 'sleep') as sleep:
                with self.assertRaises(HTTPError):
                    self.request()
                self.assertEqual(request.call_count, 1)
                sleep.assert_not_called()
        for reason in ['SAFETY', 'MAX_TOKENS']:
            response = io.BytesIO(json.dumps({'candidates': [{'finishReason': reason}]}).encode())
            with patch.object(server, 'urlopen', return_value=response) as request:
                with self.assertRaises(server.TTSGenerationError):
                    self.request()
                self.assertEqual(request.call_count, 1)

    def test_queue_continues_after_timeout_and_resume_reuses_saved_parts(self):
        job_id = 'recovery-test'
        parts = [dict(title=title, text=title, provider='gemini', voice='feminine') for title in ['First', 'Second']]
        saved = set()

        def render(part, key):
            if part['title'] in saved:
                return b'audio', '/saved.wav', True
            self.request()
            saved.add(part['title'])
            return b'audio', '/saved.wav', False

        def run(responses):
            server.TTS_JOBS[job_id] = dict(state='queued', completed=0, reused=0)
            with patch.object(self.handler, '_render_tts', side_effect=render), \
                 patch.object(server, 'urlopen', side_effect=responses) as request, \
                 patch.object(server.time, 'sleep'):
                self.handler._run_tts_job(job_id, parts, 'secret')
            return server.TTS_JOBS[job_id], request.call_count

        try:
            job, calls = run([TimeoutError(), audio_response()] + [TimeoutError()] * 4)
            self.assertEqual((job['state'], job['completed'], calls), ('failed', 1, 6))
            self.assertIn('Stopped at part 2 of 2', job['error'])
            self.assertIn('resume', job['error'])
            job, calls = run([audio_response()])
            self.assertEqual((job['state'], job['completed'], job['reused'], calls), ('done', 2, 1, 1))
        finally:
            del server.TTS_JOBS[job_id]


if __name__ == '__main__':
    unittest.main()
