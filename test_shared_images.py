import io
import json
import tempfile
import subprocess
import unittest
from pathlib import Path
from unittest.mock import patch

import server


class SharedImagesTests(unittest.TestCase):
    def test_browser_retains_every_job_output(self):
        subprocess.run(['node', '-e', r'''
const fs = require('node:fs'), vm = require('node:vm'), assert = require('node:assert/strict');
const source = fs.readFileSync('app.js', 'utf8'), context = {};
vm.createContext(context);
vm.runInContext(source.slice(source.indexOf('function imageIdentity('), source.indexOf('let sharedImagesRefreshing')), context);
vm.runInContext(source.slice(source.indexOf('function completeImageJob('), source.indexOf('async function pollPoemImageJobs(')), context);
const first = {jobId:'job', prompt:'A scene', status:'generating'}, session = {images:[first]};
const job = {images:[{filename:'one.png'},{filename:'two.png'},{filename:'three.png'}]};
context.completeImageJob(session, first, job);
context.completeImageJob(session, first, job);
assert.deepEqual(session.images.map(image=>image.filename), ['one.png','two.png','three.png']);
assert.equal(context.imageIdentity({filename:'poem-images/assets/copy.png',originalFilename:'one.png'}),'one.png');
'''], cwd=Path(__file__).parent, check=True)

    def test_archive_deduplicate_and_respect_deletion(self):
        h = object.__new__(server.PoetryRequestHandler)
        image = dict(poemId='abc123', filename='generated.png', prompt='A ship', style='Ink', poemTitle='A voyage')
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            with patch.multiple(server, BASE_DIR=root, IMAGE_ASSETS_PATH=root/'poem-images/assets',
                                IMAGE_LIBRARY_PATH=root/'poem-images/manifest.json',
                                IMAGE_DELETIONS_PATH=root/'poem-images/deleted.json'):
                response = io.BytesIO(b'example-image')
                response.headers = {'Content-Type':'image/png'}
                with patch.object(h, '_read_json_body', return_value=image), patch.object(h, '_send_json') as send, patch.object(server, 'urlopen', return_value=response) as remote:
                    h._save_library_image()
                    self.assertEqual(send.call_args.args[0], 200)
                    record = send.call_args.args[1]['image']
                    self.assertEqual((root/record['filename']).read_bytes(), b'example-image')
                    h._save_library_image()
                    self.assertEqual(remote.call_count, 1)
                manifest = h._image_manifest()
                self.assertEqual(len(manifest['abc123']), 1)
                with patch.object(h, '_read_json_body', return_value={'images':[{'poemId':'abc123','filename':record['filename']}]}), patch.object(h, '_send_json'):
                    h._delete_library_images()
                with patch.object(h, '_read_json_body', return_value=image), patch.object(h, '_send_json') as send, patch.object(server, 'urlopen', side_effect=AssertionError('Deleted images must not return')):
                    h._save_library_image()
                    self.assertEqual(send.call_args.args, (200, {'deleted':True}))

    def test_reject_paths_and_urls(self):
        h = object.__new__(server.PoetryRequestHandler)
        for payload in [[], {'poemId':'abc','filename':'../secret.png'}, {'poemId':'abc','filename':'http://host/image.png'}, {'poemId':'../abc','filename':'a.png'}]:
            with patch.object(h, '_read_json_body', return_value=payload), patch.object(h, '_send_json') as send, patch.object(server, 'urlopen', side_effect=AssertionError('Must not fetch')):
                h._save_library_image()
                self.assertEqual(send.call_args.args[0], 400)


if __name__ == '__main__':
    unittest.main()
