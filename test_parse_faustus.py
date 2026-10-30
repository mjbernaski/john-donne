import json
from pathlib import Path
import unittest
from parse_faustus import parse

class FaustusImportTests(unittest.TestCase):
    def test_speaker_labels_and_footnotes(self):
        html = '''<pre>Wrong preface</pre><pre>FROM THE QUARTO OF 1604.
          Enter CHORUS.
     CHORUS. Not marching now in fields of Thrasymene,<a href="#note-1">1</a>
     Where Mars did mate the Carthaginians;
          [Exit.]
     FAUSTUS. This is my speech.
          [Reads.]
     FOLLOWING. This capitalized contract clause is not a character.
     MEPHIST. I answer Faustus.
     VALDES. A minor character.
          [Exeunt.]
</pre><h2>FOOTNOTES</h2><pre>Do not import these notes</pre>'''
        entry = parse(html)[0]
        self.assertNotIn('Thrasymene,1', entry['content'])
        self.assertNotIn('import these notes', entry['content'])
        turns = entry['performance']
        self.assertEqual([t['speaker'] for t in turns], ['NARRATOR', 'CHORUS', 'NARRATOR', 'FAUSTUS', 'NARRATOR', 'FAUSTUS', 'MEPHISTOPHILIS', 'VALDES', 'NARRATOR'])
        self.assertIn('FOLLOWING.', turns[5]['text'])
        self.assertNotIn('FAUSTUS.', turns[3]['text'])

    def test_complete_play(self):
        entry = json.loads(Path('poems-faustus.json').read_text())[0]
        turns = entry['performance']
        self.assertGreater(len(entry['content']), 70000)
        self.assertGreater(len(turns), 400)
        self.assertTrue(any('I’ll burn my books!' in t['text'] and t['speaker'] == 'FAUSTUS' for t in turns))
        self.assertTrue(any('Cut is the branch' in t['text'] and t['speaker'] == 'CHORUS' for t in turns))
        self.assertFalse(any('Terminat hora diem' in t['text'] for t in turns))
        self.assertTrue(all(t['speaker'] and t['text'] for t in turns))

if __name__ == '__main__': unittest.main()
