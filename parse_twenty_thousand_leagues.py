#!/usr/bin/env python3
"""Import Gutenberg ebook 164 as chapters (Python standard library only)."""
import argparse
from collections import Counter
from html.parser import HTMLParser
import json
from pathlib import Path
import re
import urllib.request

SOURCE = 'https://www.gutenberg.org/cache/epub/164/pg164-images.html'


class BookParser(HTMLParser):
    def __init__(self):
        super().__init__()
        self.depth = 0
        self.chapter_depth = None
        self.block = None
        self.chunks = []
        self.anchor = ''
        self.blocks = []

    def handle_starttag(self, tag, attrs):
        attrs = dict(attrs)
        if tag == 'div':
            self.depth += 1
            if 'chapter' in attrs.get('class', '').split():
                self.chapter_depth = self.depth
        if self.chapter_depth is None:
            return
        if tag in ('h2', 'p'):
            self.block = tag
            self.chunks = []
            self.anchor = ''
            self.caption = 'caption' in attrs.get('class', '').split()
        if tag == 'a' and self.block == 'h2':
            self.anchor = attrs.get('id', self.anchor)
        if tag == 'br' and self.block:
            self.chunks.append(' ')

    def handle_data(self, data):
        if self.block:
            self.chunks.append(data)

    def handle_endtag(self, tag):
        if tag == self.block:
            value = ' '.join(''.join(self.chunks).split())
            if value and not self.caption:
                self.blocks.append((tag, value, self.anchor))
            self.block = None
        if tag == 'div':
            if self.depth == self.chapter_depth:
                self.chapter_depth = None
            self.depth -= 1


def parse(html):
    parser = BookParser()
    parser.feed(html)
    entries, paragraphs = [], []
    current = None
    part = ''

    def finish():
        if current is not None:
            content = '\n\n\n'.join(paragraphs)
            if len(content) < 500:
                raise ValueError('Suspiciously short chapter: ' + current['title'])
            entries.append({**current, 'content': content,
                            'firstLine': content.split('\n')[0][:100]})
        paragraphs.clear()

    for tag, value, anchor in parser.blocks:
        if tag == 'h2':
            finish()
            current = None
            if value in ('PART ONE', 'PART TWO'):
                part = value.title()
                continue
            match = re.fullmatch(r'CHAPTER ([IVX]+) (.+)', value)
            if not match or not part or not anchor:
                raise ValueError('Unexpected chapter heading: ' + value)
            numeral, title = match.groups()
            current = {'title': f'{part} · Chapter {numeral} · {title}',
                       'section': part, 'chapter': numeral,
                       'sourceUrl': SOURCE + '#' + anchor}
        elif current is not None:
            paragraphs.append(value)
    finish()
    if Counter(e['section'] for e in entries) != {'Part One': 23, 'Part Two': 23}:
        raise ValueError('Expected 23 chapters in each of two parts')
    if len({e['sourceUrl'] for e in entries}) != 46:
        raise ValueError('Duplicate chapter anchors')
    return entries


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('html', nargs='?', type=Path)
    parser.add_argument('-o', '--output', type=Path,
                        default=Path('poems-twenty-thousand-leagues.json'))
    args = parser.parse_args()
    if args.html:
        html = args.html.read_text(encoding='utf-8')
    else:
        with urllib.request.urlopen(SOURCE, timeout=60) as response:
            html = response.read().decode('utf-8')
    entries = parse(html)
    args.output.write_text(json.dumps(entries, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
    print(f'Saved {len(entries)} chapters across two parts.')
