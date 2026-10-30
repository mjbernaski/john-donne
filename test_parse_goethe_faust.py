import json
from collections import Counter
from pathlib import Path
import unittest
from parse_goethe_faust import Blocks, clean, performance_cues

class GoetheFaustTests(unittest.TestCase):
    def test_complete_library_text(self):
        books = json.loads(Path('books.json').read_text())['books']
        book = next(b for b in books if b['id'] == 'goethe-faust')
        entries = json.loads(Path(book['poems']).read_text())
        self.assertEqual(len(entries), 53)
        self.assertEqual(Counter(e['section'] for e in entries), {
            'Opening': 3, 'Part One': 25, 'Part Two · Act I': 7,
            'Part Two · Act II': 7, 'Part Two · Act III': 1,
            'Part Two · Act IV': 3, 'Part Two · Act V': 7})
        self.assertEqual(len({e['title'] for e in entries}), 53)
        self.assertIn('I’ve studied now Philosophy', entries[3]['content'])
        self.assertTrue(entries[27]['content'].endswith('Henry! Henry!'))
        self.assertTrue(entries[-1]['content'].endswith('Upward and on!'))
        self.assertGreater(sum(len(e['content']) for e in entries), 500000)
        for e in entries:
            self.assertTrue(e['firstLine'] and e['sourceUrl'])
            for boilerplate in ('Jump to content', 'Retrieved from', 'GUTENBERG', 'mw-parser-output'):
                self.assertNotIn(boilerplate, e['content'])

    def test_performance_matches_import(self):
        for scene in json.loads(Path('poems-goethe-faust.json').read_text()):
            self.assertEqual(scene['performance'], performance_cues(scene['content']))
            self.assertTrue(all(t['speaker'] and t['text'] for t in scene['performance']))
        scenes = json.loads(Path('poems-goethe-faust.json').read_text())
        for index in (3, 9, 10, 14, 37, 40, 44, 45):
            self.assertIn({3: 'FAUST', 40: 'HOMUNCULUS', 45: 'EMPEROR'}.get(index, 'MEPHISTOPHELES'),
                          {t['speaker'] for t in scenes[index]['performance']})

    def test_cues_separate_directions_and_resume_speaker(self):
        self.assertEqual(performance_cues(
            'Faust. A word.\n(He turns\nto the door.)\nAnother word.\n\n'
            '[Exit.\n\nMephistopheles (aside).\nAn answer.'), [
                {'speaker': 'FAUST', 'text': 'A word.'},
                {'speaker': 'NARRATOR', 'text': '(He turns\nto the door.)'},
                {'speaker': 'FAUST', 'text': 'Another word.'},
                {'speaker': 'NARRATOR', 'text': '[Exit.\n(aside)'},
                {'speaker': 'MEPHISTOPHELES', 'text': 'An answer.'}])

    def test_wiki_markup_preserves_verse_and_removes_notes(self):
        p = Blocks(wiki=True)
        p.feed('<p>Navigation</p><div class="prp-pages-output"><p>Faust.</p>'
               '<div>First line<sup>23</sup><br>Second line</div>'
               '<span class="pagenum">99</span><div>Third line</div></div>'
               '<p>Footer</p>')
        self.assertEqual(clean(''.join(p.chunks)), 'Faust.\n\nFirst line\nSecond line\n\nThird line')

if __name__ == '__main__': unittest.main()
