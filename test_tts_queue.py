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
            with patch.object(server.PoetryRequestHandler, '_render_tts', render):
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
        finally:
            release.set()
            httpd.shutdown()
            httpd.server_close()


if __name__ == '__main__':
    unittest.main()
