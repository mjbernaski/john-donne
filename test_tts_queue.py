"""Exercise background narration through real HTTP, with no provider calls."""
import json
import threading
import time
import unittest
from http.server import ThreadingHTTPServer
from urllib.request import Request, build_opener, ProxyHandler
from unittest.mock import patch

import server


class QueueTests(unittest.TestCase):
    def test_local_batch_runs_concurrently_and_tracks_out_of_order_parts(self):
        handler = object.__new__(server.PoetryRequestHandler)
        job_id = 'parallel-test'
        barrier = threading.Barrier(4)
        last_done = threading.Event()
        def render(worker, payload, key):
            barrier.wait(timeout=3)
            if payload['text'] != '3':
                self.assertTrue(last_done.wait(3))
            else:
                last_done.set()
            return b'wav', '/saved.wav', payload['text'] == '2'
        parts = [dict(title='Parallel test', text=str(i), voice='feminine', provider='local') for i in range(4)]
        server.TTS_JOBS[job_id] = dict(state='queued', completed=0, reused=0)
        try:
            with patch.object(server.PoetryRequestHandler, '_render_tts', render):
                handler._run_tts_job(job_id, parts, '')
            job = server.TTS_JOBS[job_id]
            self.assertEqual((job['state'], job['completed'], job['reused']), ('done', 4, 1))
            self.assertEqual([p['stage'] for p in job['partProgress']], ['done'] * 4)
        finally:
            del server.TTS_JOBS[job_id]

    def test_disconnected_client_duplicate_submission_and_failure(self):
        entered, release = threading.Event(), threading.Event()
        calls = []
        def render(handler, payload, key):
            calls.append(payload['text'])
            entered.set()
            self.assertTrue(release.wait(3))
            if payload['text'] == 'fail':
                raise ValueError('secret-provider-detail')
            return b'wav', '/saved.wav', payload['text'] == 'cached'

        # HTTPServer resolves its display name during bind; keep this local
        # integration test independent of the machine's DNS configuration.
        with patch('socket.getfqdn', return_value='localhost'):
            httpd = ThreadingHTTPServer(('127.0.0.1', 0), server.PoetryRequestHandler)
        thread = threading.Thread(target=httpd.serve_forever, daemon=True)
        thread.start()
        base = f'http://127.0.0.1:{httpd.server_port}'
        urlopen = lambda request: build_opener(ProxyHandler({})).open(request, timeout=5)
        def submit(texts):
            data = {'parts': [dict(title='Queue test', text=text, voice='feminine', provider='local') for text in texts]}
            with urlopen(Request(base + '/api/tts/jobs', json.dumps(data).encode(), {'Content-Type': 'application/json'})) as response:
                self.assertEqual(response.status, 202)
                return json.load(response)
        def status(job):
            with urlopen(base + '/api/tts/jobs/' + job['id']) as response:
                return json.load(response)
        def finished(job):
            deadline = time.monotonic() + 3
            while time.monotonic() < deadline:
                result = status(job)
                if result['state'] in {'done', 'failed'}:
                    return result
                time.sleep(.01)
            self.fail('Queue did not finish')
        try:
            with patch.object(server, 'LOCAL_TTS_BATCH_WORKERS', 1), patch.object(server.PoetryRequestHandler, '_render_tts', render):
                job = submit(['first', 'cached', 'last'])
                self.assertTrue(entered.wait(1))
                self.assertEqual(submit(['first', 'cached', 'last'])['id'], job['id'])
                # Both submission connections are closed before work can finish.
                release.set()
                result = finished(job)
                self.assertEqual((result['state'], result['completed'], result['reused']), ('done', 3, 1))
                self.assertEqual(calls, ['first', 'cached', 'last'])
                failed = finished(submit(['fail', 'must-not-run']))
                self.assertEqual(failed['state'], 'failed')
                self.assertNotIn('must-not-run', calls)
                self.assertNotIn('secret-provider-detail', json.dumps(failed))
                entered.clear()
                release.clear()
                stopped = submit(['finish-current', 'never-generate'])
                self.assertTrue(entered.wait(1))
                with urlopen(Request(base + '/api/tts/jobs/' + stopped['id'] + '/cancel', data=b'', method='POST')) as response:
                    self.assertTrue(json.load(response)['stopRequested'])
                release.set()
                result = finished(stopped)
                self.assertEqual(result['state'], 'failed')
                self.assertEqual(result['completed'], 1)
                self.assertNotIn('never-generate', calls)
                self.assertIn('Saved parts are kept', result['error'])
        finally:
            release.set()
            httpd.shutdown()
            httpd.server_close()


if __name__ == '__main__':
    unittest.main()
