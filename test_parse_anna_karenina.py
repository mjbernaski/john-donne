"""Regression checks against the supplied PDF's missing/duplicate headings."""
import json
import unittest
from pathlib import Path

from parse_anna_karenina import COUNTS, MISSING_XXX, PARTS, parse, roman

ROOT = Path(__file__).resolve().parent


class AnnaKareninaImportTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.chapters = parse(ROOT / 'Anna_Karenina_Leo_Tolstoy_Z_Library_d5fb2c5f65.pdf')

    def test_complete_ordered_chapter_sequence(self):
        expected = [(f'Part {part}', roman(n)) for part, count in zip(PARTS, COUNTS)
                    for n in range(1, count + 1)]
        self.assertEqual([(c['section'], c['chapter']) for c in self.chapters], expected)
        self.assertEqual(len(self.chapters), 239)

    def test_missing_headings_restored_without_changing_text(self):
        for part, opening in MISSING_XXX.items():
            chapter = next(c for c in self.chapters if c['section'] == f'Part {part}' and c['chapter'] == 'XXX')
            self.assertTrue(chapter['content'].startswith(opening), part)

    def test_reading_boundaries_and_paragraphs(self):
        first = self.chapters[0]['content']
        self.assertTrue(first.startswith('All happy families are alike; each unhappy family is unhappy in its own way.\n\n\nAll was confusion'))
        self.assertNotIn('Romans 12:19', first)
        self.assertNotIn('Giovanni.', first)  # The opening chapter's musical footnote.
        self.assertTrue(self.chapters[-1]['content'].endswith('my power to put into it!’'))
        for chapter in self.chapters:
            self.assertNotIn('\n\n\nAnna Karenina\n', chapter['content'])
            self.assertNotIn('\n\n\nThe End', chapter['content'])
            self.assertGreater(len(chapter['content']), 500)

    def test_saved_collection_matches_parser_and_manifest(self):
        saved = json.loads((ROOT / 'poems-anna-karenina.json').read_text())
        self.assertEqual(saved, self.chapters)
        manifest = json.loads((ROOT / 'books.json').read_text())
        book = next(b for b in manifest['books'] if b['id'] == 'anna-karenina')
        self.assertTrue(book['chapterCollection'])
        self.assertEqual(book['poems'], 'poems-anna-karenina.json')
        self.assertFalse(any(b['id'] == 'anna-karenina' for b in manifest.get('externalBooks', [])))


if __name__ == '__main__':
    unittest.main()
