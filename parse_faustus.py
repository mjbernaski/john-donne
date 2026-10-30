#!/usr/bin/env python3
"""Import Gutenberg 779's unnumbered 1604 Doctor Faustus, with exact speaker cues."""
import argparse
from html.parser import HTMLParser
import json
from pathlib import Path
import re
from urllib.request import urlopen

SOURCE = 'https://www.gutenberg.org/files/779/779-h/779-h.htm'
SPEAKERS = set('CHORUS|FAUSTUS|MEPHIST|WAGNER|CLOWN|ROBIN|RALPH|HORSE-COURSER|FIRST SCHOLAR|SECOND SCHOLAR|THIRD SCHOLAR|LUCIFER|EMPEROR|GOOD ANGEL|EVIL ANGEL|KNIGHT|POPE|VINTNER|DUKE|OLD MAN|VALDES|DUCHESS|ALL|CORNELIUS|PRIDE|COVETOUSNESS|WRATH|ENVY|GLUTTONY|SLOTH|LECHERY|FIRST FRIAR|SECOND FRIAR'.split('|'))

class SourceParser(HTMLParser):
    def __init__(self):
        super().__init__(); self.blocks = []; self.inside = False; self.skip = 0; self.text = ''
    def handle_starttag(self, tag, attrs):
        if tag == 'pre': self.inside = True; self.text = ''
        if self.inside and tag == 'a': self.skip += 1
    def handle_endtag(self, tag):
        if tag == 'a' and self.skip: self.skip -= 1
        if tag == 'pre': self.blocks.append(self.text); self.inside = False
    def handle_data(self, data):
        if self.inside and not self.skip: self.text += data

def parse(html):
    source = SourceParser(); source.feed(html)
    text = next(block for block in source.blocks if 'CHORUS. Not marching' in block)
    text = text.removeprefix('FROM THE QUARTO OF 1604.').strip()
    turns, display = [], []
    speaker = 'NARRATOR'; direction_open = False
    for raw in text.splitlines():
        line = raw.strip()
        if not line: continue
        match = re.match(r'^([A-Z][A-Z -]+)\.\s*(.*)$', line)
        if match and match[1] in SPEAKERS:
            speaker = 'MEPHISTOPHILIS' if match[1] == 'MEPHIST' else match[1]
            line = match[2]
            display.append(f'{speaker}. {line}')
        else:
            display.append(line)
        direction = direction_open or bool(re.match(r'^(?:\[|Enter\b|Re-enter\b|Exit\b|Exeunt\b|FAUSTUS discovered)', line))
        role = 'NARRATOR' if direction else speaker
        direction_open = (direction_open or line.startswith('[')) and ']' not in line
        spoken = line.strip('[] ').strip()
        if not spoken: continue
        if turns and turns[-1]['speaker'] == role: turns[-1]['text'] += '\n' + spoken
        else: turns.append(dict(speaker=role, text=spoken))
    # The concluding Latin colophon is editorial, not a character's speech.
    if turns[-1]['text'].endswith('Terminat hora diem; terminat auctor opus.'):
        turns[-1]['text'] = turns[-1]['text'].replace('Terminat hora diem; terminat auctor opus.', '').strip()
    turns = [turn for turn in turns if turn['text']]
    return [dict(title='Doctor Faustus · Complete Play', section='The 1604 Text', content='\n\n'.join(display),
                 firstLine='Not marching now in fields of Thrasymene,', sourceUrl=SOURCE, performance=turns)]

if __name__ == '__main__':
    cli = argparse.ArgumentParser(description=__doc__); cli.add_argument('html', nargs='?', type=Path)
    cli.add_argument('-o', '--output', type=Path, default=Path('poems-faustus.json')); args = cli.parse_args()
    html = args.html.read_text() if args.html else urlopen(SOURCE, timeout=30).read().decode('utf-8')
    entries = parse(html); args.output.write_text(json.dumps(entries, ensure_ascii=False, indent=2) + '\n')
    print(f"Imported {len(entries[0]['performance'])} performance cues.")
