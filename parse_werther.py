#!/usr/bin/env python3
"""Import the English text of Project Gutenberg ebook 2527."""
import argparse
from html.parser import HTMLParser
import json
from pathlib import Path
import re
import urllib.request

SOURCE = 'https://www.gutenberg.org/cache/epub/2527/pg2527-images.html'

class Parser(HTMLParser):
    def __init__(self):
        super().__init__()
        self.blocks = []
        self.tag = None
        self.chunks = []
        self.done = False
    def handle_starttag(self, tag, attrs):
        if tag == 'footer':
            self.done = True
        if not self.done and tag in ('h2', 'h3', 'p'):
            self.tag, self.chunks = tag, []
        if tag == 'br' and self.tag:
            self.chunks.append(' ')
    def handle_data(self, data):
        if self.tag:
            self.chunks.append(data)
    def handle_endtag(self, tag):
        if tag == self.tag:
            text = ' '.join(''.join(self.chunks).split())
            if text:
                self.blocks.append((tag, text))
            self.tag = None

def parse(html):
    parser = Parser()
    parser.feed(html)
    entries, paragraphs = [], []
    section = title = None
    editor = False
    def finish():
        if title and paragraphs:
            content = '\n\n\n'.join(paragraphs)
            entries.append(dict(title=title, section=section, content=content,
                                firstLine=paragraphs[0][:100], sourceUrl=SOURCE))
        paragraphs.clear()
    for tag, value in parser.blocks:
        if tag == 'h2' and value in ('PREFACE', 'BOOK I', 'BOOK II.'):
            finish()
            section = {'PREFACE': 'Preface', 'BOOK I': 'Book I', 'BOOK II.': 'Book II'}[value]
            title = 'Preface' if section == 'Preface' else None
            continue
        if section is None:
            continue
        if value == 'THE EDITOR TO THE READER.':
            finish()
            title, editor = 'Book II · The Editor to the Reader', True
        elif not editor and re.fullmatch(r'(?:JANUARY|FEBRUARY|MARCH|APRIL|MAY|JUNE|JULY|AUGUST|SEPTEMBER|OCTOBER|NOVEMBER|DECEMBER) \d{1,2}\.?', value):
            finish()
            title = section + ' · ' + value.rstrip('.').title()
        elif title:
            paragraphs.append(value)
    finish()
    assert entries[0]['title'] == 'Preface'
    assert entries[1]['title'] == 'Book I · May 4'
    assert entries[-1]['content'].endswith('No priest attended.')
    assert len(entries) > 70
    assert not any('GUTENBERG' in e['content'] for e in entries)
    return entries

if __name__ == '__main__':
    cli = argparse.ArgumentParser(description=__doc__)
    cli.add_argument('html', nargs='?', type=Path)
    cli.add_argument('-o', '--output', type=Path, default=Path('poems-werther.json'))
    args = cli.parse_args()
    html = args.html.read_text(encoding='utf-8') if args.html else urllib.request.urlopen(SOURCE, timeout=60).read().decode('utf-8')
    entries = parse(html)
    args.output.write_text(json.dumps(entries, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
    print(f'Saved {len(entries)} entries.')
