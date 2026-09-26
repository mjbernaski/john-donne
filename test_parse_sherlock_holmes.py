"""Offline integrity checks for the imported canon and its text conversion."""
from collections import Counter
import json
from pathlib import Path
import unittest
import xml.etree.ElementTree as ET

from parse_sherlock_holmes import COLLECTIONS, NOVELS, NS, blocks, parse

ROOT = Path(__file__).resolve().parent


class SherlockHolmesTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.entries = json.loads((ROOT / 'poems-sherlock-holmes.json').read_text())

    def test_complete_canon_without_duplicates(self):
        self.assertEqual(len(self.entries), 112)
        self.assertEqual(len({e['work'] for e in self.entries}), 60)
        self.assertEqual(len({e['title'] for e in self.entries}), 112)
        self.assertEqual(Counter(e['section'] for e in self.entries), {**NOVELS, **COLLECTIONS})
        self.assertEqual(sum('chapter' not in e for e in self.entries), 56)

    def test_reading_boundaries_and_source_links(self):
        self.assertTrue(self.entries[0]['content'].startswith('In the year 1878 I took my degree'))
        self.assertTrue(self.entries[-1]['content'].endswith('Some day the true story may be told.”'))
        for entry in self.entries:
            self.assertGreater(len(entry['content']), 500)
            self.assertIn('\n\n\n', entry['content'])
            self.assertIn('cano.html#', entry['sourceUrl'])
            self.assertNotIn('This text was formatted', entry['content'])
        dancing = next(e for e in self.entries if e['work'] == 'The Adventure of the Dancing Men')
        self.assertEqual(dancing['content'].count('[Illustration:'), 9)

    def test_nested_letters_and_inline_words_preserved(self):
        element = ET.fromstring(f'<div xmlns="{NS[1:-1]}">'
                               '<div>Dear <i>Watson</i>,</div><p>Meet me.<br/>Tonight.</p>'
                               '<div>Holmes</div><p><img alt="A clue"/></p></div>')
        self.assertEqual(list(blocks(element)), ['Dear Watson,', 'Meet me. Tonight.',
                                                'Holmes', '[Illustration: A clue]'])

    def test_incomplete_source_rejected(self):
        with self.assertRaises(ValueError):
            parse(f'<html xmlns="{NS[1:-1]}"><body/></html>')

    def test_manifest(self):
        books = json.loads((ROOT / 'books.json').read_text())['books']
        book = next(b for b in books if b['id'] == 'sherlock-holmes')
        self.assertEqual(book['poems'], 'poems-sherlock-holmes.json')
        self.assertTrue(book['chapterCollection'])
        self.assertEqual(book['poet'], 'Arthur Conan Doyle')
        self.assertEqual(book['entryLabel'], 'stories and chapters')


if __name__ == '__main__':
    unittest.main()
