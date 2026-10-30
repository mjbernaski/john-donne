#!/usr/bin/env python3
"""Import all 62 chapters of Project Gutenberg ebook 1268."""
import argparse
from collections import Counter
from html.parser import HTMLParser
import json
from pathlib import Path
import re
from urllib.request import urlopen

SOURCE = 'https://www.gutenberg.org/cache/epub/1268/pg1268-images.html'


class BookParser(HTMLParser):
    def __init__(self):
        super().__init__()
        self.block = None
        self.chunks = []
        self.anchor = ''
        self.blocks = []
        self.finished = False

    def handle_starttag(self, tag, attrs):
        attrs = dict(attrs)
        if attrs.get('id') == 'pg-footer':
            self.finished = True
        if self.finished:
            return
        if tag == 'a' and attrs.get('id', '').startswith('link2H'):
            self.anchor = attrs['id']
        if tag in ('h2', 'p'):
            self.block = tag
            self.chunks = []
        elif tag == 'br' and self.block:
            self.chunks.append(' ')

    def handle_data(self, data):
        if self.block and not self.finished:
            self.chunks.append(data)

    def handle_endtag(self, tag):
        if tag == self.block:
            text = ' '.join(''.join(self.chunks).split())
            if text:
                self.blocks.append((tag, text, self.anchor))
            self.block = None


def parse(html):
    parser = BookParser()
    parser.feed(html)
    entries, paragraphs = [], []
    part, current = '', None

    def finish():
        if current is not None:
            content = '\n\n\n'.join(paragraphs)
            if len(content) < 500:
                raise ValueError('Suspiciously short chapter: ' + current['title'])
            entries.append({**current, 'content': content, 'firstLine': paragraphs[0][:100]})
        paragraphs.clear()

    for tag, text, anchor in parser.blocks:
        if tag == 'h2':
            finish()
            current = None
            match = re.fullmatch(r'PART ([123])[—.]\s*(.+)', text)
            if match:
                number, name = match.groups()
                part = f'Part {number} · {name.title()}'
            elif part:
                match = re.fullmatch(r'Chapter (\d+)', text)
                if not match or not anchor.startswith('link2HCH'):
                    raise ValueError('Unexpected heading: ' + text)
                chapter = int(match[1])
                current = {'title': f'{part} · Chapter {chapter}', 'section': part,
                           'chapter': chapter, 'translator': 'Agnes Kinloch Kingston',
                           'sourceUrl': SOURCE + '#' + anchor}
        elif current:
            paragraphs.append(text)
    finish()
    counts = Counter(entry['section'].split(' · ')[0] for entry in entries)
    if counts != {'Part 1': 22, 'Part 2': 20, 'Part 3': 20}:
        raise ValueError(f'Unexpected chapter counts: {counts}')
    if len({entry['sourceUrl'] for entry in entries}) != 62:
        raise ValueError('Duplicate chapter anchors')
    for section in dict.fromkeys(entry['section'] for entry in entries):
        chapters = [entry['chapter'] for entry in entries if entry['section'] == section]
        if chapters != list(range(1, len(chapters) + 1)):
            raise ValueError('Missing or out-of-order chapter in ' + section)
    if not entries[-1]['content'].endswith('the name of Captain Nemo.'):
        raise ValueError('Novel ending is missing')
    return entries


if __name__ == '__main__':
    cli = argparse.ArgumentParser(description=__doc__)
    cli.add_argument('html', nargs='?', type=Path)
    cli.add_argument('-o', '--output', type=Path, default=Path('poems-mysterious-island.json'))
    args = cli.parse_args()
    if args.html:
        html = args.html.read_text(encoding='utf-8')
    else:
        with urlopen(SOURCE, timeout=60) as response:
            html = response.read().decode('utf-8')
    entries = parse(html)
    args.output.write_text(json.dumps(entries, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
    print(f'Saved {len(entries)} complete chapters across three parts.')
