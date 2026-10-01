"""Regression checks for browser and server narration boundaries."""
import json
from pathlib import Path
import re
import subprocess
import unittest

import server


class NarrationChunkingTests(unittest.TestCase):
    def test_part_limit_and_legacy_smaller_overrides(self):
        book = server.BOOKS_BY_ID['new-england-mind']
        limit = server.PoetryRequestHandler._narration_part_limit
        self.assertEqual(limit('A new reading', {}, 'gemini'), 5000)
        self.assertEqual(limit('A new reading', {'geminiNarrationPartLimits': {'A new reading': 8000}}, 'gemini'), 5000)
        self.assertEqual(limit('A new reading', {}, 'local'), 5000)
        self.assertEqual(limit('Chapter XIII · The Covenant of Grace', book, 'gemini'), 1800)
        self.assertEqual(limit('Chapter XIV · The Social Covenant · Part 2', book, 'gemini'), 5000)
        self.assertEqual(limit('Chapter XIV · The Social Covenant', book, 'local'), 5000)
        script = r"""
const fs = require('node:fs'), vm = require('node:vm');
const source = fs.readFileSync('app.js', 'utf8');
const book = JSON.parse(fs.readFileSync('books.json', 'utf8')).books.find(b => b.id === 'new-england-mind');
const context = {currentBook: book, GEMINI_NARRATION_PART_LIMIT: 5000, NARRATION_PART_LIMIT: 5000, getReadablePoemText: p => p.content};
vm.createContext(context);
vm.runInContext(source.slice(source.indexOf('function splitNarrationText('), source.indexOf('function selectedNarrationPart(')), context);
const poems = JSON.parse(fs.readFileSync('poems-new-england-mind.json', 'utf8')).filter(p => /^Chapter XIII?V? ·/.test(p.title));
console.log(JSON.stringify(poems.map(p => ({title:p.title, text:p.content, parts:context.getNarrationParts(p, 'gemini'), localParts:context.getNarrationParts(p, 'local')}))));
"""
        chapters = json.loads(subprocess.check_output(['node', '-e', script], cwd=Path(__file__).parent))
        self.assertTrue(chapters)
        for chapter in chapters:
            self.assertEqual(chapter['parts'], server.PoetryRequestHandler._split_tts_text(chapter['text'], limit(chapter['title'], book, 'gemini')))
            self.assertEqual(chapter['localParts'], server.PoetryRequestHandler._split_tts_text(chapter['text'], 5000))

    def test_natural_boundaries_and_hard_limits(self):
        cases = [
            ('First paragraph.\n\nSecond paragraph fits.', 30,
             ['First paragraph.', 'Second paragraph fits.']),
            ('A short sentence. A longer sentence follows here. Last one.', 40,
             ['A short sentence.', 'A longer sentence follows here.', 'Last one.']),
            ('He said, “Go!” Then she left the room.', 25,
             ['He said, “Go!”', 'Then she left the room.']),
            ('First line\nSecond line\nThird line', 23,
             ['First line\nSecond line', 'Third line']),
            ('one two three four five six', 13, ['one two three', 'four five six']),
            ('x' * 31, 12, ['x' * 12, 'x' * 12, 'x' * 7]),
            ('First.\r\n \r\nSecond paragraph.', 20, ['First.', 'Second paragraph.']),
            ('   ', 20, []),
            ('Exactly fits.', 13, ['Exactly fits.']),
            # Do not rebalance a short opening into the following paragraph.
            ('Title.\n\n' + 'word ' * 58 + 'end.', 300,
             ['Title.', ('word ' * 58 + 'end.')]),
        ]
        script = r"""
const fs = require('node:fs');
const vm = require('node:vm');
const source = fs.readFileSync('app.js', 'utf8');
const context = {};
vm.createContext(context);
vm.runInContext(source.slice(source.indexOf('function splitNarrationText('),
    source.indexOf('function selectedNarrationPart(')), context);
const cases = JSON.parse(fs.readFileSync(0, 'utf8'));
console.log(JSON.stringify(cases.map(([text, limit]) => context.splitNarrationText(text, limit))));
"""
        browser = json.loads(subprocess.check_output(
            ['node', '-e', script], input=json.dumps(cases).encode(),
            cwd=Path(__file__).parent))
        for (text, limit, expected), js_parts in zip(cases, browser):
            with self.subTest(text=text, limit=limit):
                parts = server.PoetryRequestHandler._split_tts_text(text, limit)
                self.assertEqual(parts, expected)
                self.assertEqual(js_parts, expected)
                self.assertTrue(all(0 < len(part) <= limit for part in parts))
                self.assertEqual(re.sub(r'\s+', '', ''.join(parts)), re.sub(r'\s+', '', text))



if __name__ == '__main__':
    unittest.main()
