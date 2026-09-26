#!/usr/bin/env python3
"""Import the complete canon from sherlock-holm.es (Python standard library only).

Use the site's XHTML edition to avoid the reversed print order of its PDFs.
Accepts a downloaded cano.html, or downloads it when no path is supplied.
"""
import argparse
from collections import Counter
import json
from pathlib import Path
import urllib.request
import xml.etree.ElementTree as ET

SOURCE = 'https://sherlock-holm.es/stories/html/cano.html'
NS = '{http://www.w3.org/1999/xhtml}'
NOVELS = {'A Study In Scarlet': 14, 'The Sign of the Four': 12,
          'The Hound of the Baskervilles': 15, 'The Valley Of Fear': 15}
COLLECTIONS = {'The Adventures of Sherlock Holmes': 12,
               'The Memoirs of Sherlock Holmes': 11,
               'The Return of Sherlock Holmes': 13, 'His Last Bow': 8,
               'The Case-Book of Sherlock Holmes': 12}


def text(element):
    """Keep inline words adjacent; retain image descriptions and line breaks."""
    if element.tag == NS + 'img':
        return '[Illustration: ' + element.get('alt', '') + ']'
    if element.tag == NS + 'br':
        return '\n'
    return (element.text or '') + ''.join(text(c) + (c.tail or '') for c in element)


def blocks(element):
    block_tags = {'div', 'p', 'blockquote', 'table', 'tbody', 'tr', 'td', 'ul', 'ol', 'li'}
    if any(c.tag.removeprefix(NS) in block_tags for c in element):
        if element.text and element.text.strip():
            yield ' '.join(element.text.split())
        for child in element:
            yield from blocks(child)
            if child.tail and child.tail.strip():
                yield ' '.join(child.tail.split())
    else:
        value = ' '.join(text(element).split())
        if value:
            yield value


def parse(html):
    body = ET.fromstring(html).find(NS + 'body')
    entries, paragraphs = [], []
    current = None
    collection = story = part = ''
    novel = False
    story_count = 0

    def finish():
        if current is not None:
            content = '\n\n\n'.join(paragraphs).strip()
            if len(content) < 500:
                raise ValueError(f'Suspiciously short entry: {current["title"]}')
            entries.append({**current, 'content': content,
                            'firstLine': content.split('\n')[0][:100]})
        paragraphs.clear()

    for element in body:
        tag, kind = element.tag.removeprefix(NS), element.get('class', '')
        heading = ' '.join(text(element).split())
        if kind == 'small-print':
            break
        if tag == 'h2' or (tag == 'h3' and kind == 'preface'):
            finish()
            current = None
            if tag == 'h2':
                collection = heading
            continue
        if tag == 'h3' and kind == 'story':
            finish()
            story_count += 1
            story, part = heading, ''
            novel = story in NOVELS
            anchor = element.find(NS + 'a').get('name')
            story_url = SOURCE + '#' + anchor
            current = None if novel else {'title': story, 'section': collection,
                                          'work': story, 'sourceUrl': story_url}
            continue
        if novel and tag == 'h4':
            if kind == 'part-header':
                finish()
                current = None
                part = heading.rstrip('.').title()
            elif kind == 'chapter-header':
                finish()
                chapter = heading.rstrip('.')
                anchor = element.find(NS + 'a').get('name')
                current = {'title': ' · '.join(filter(None, [story, part, chapter])),
                           'section': story, 'work': story, 'chapter': chapter,
                           'sourceUrl': SOURCE + '#' + anchor}
            elif kind == 'chapter-subheader' and current:
                current['title'] += ' · ' + heading
            continue
        if current is not None:
            paragraphs.extend(blocks(element))
    finish()
    expected = {**NOVELS, **COLLECTIONS}
    if story_count != 60 or Counter(e['section'] for e in entries) != expected:
        raise ValueError('Source does not match the complete 60-work canon')
    if len({e['title'] for e in entries}) != len(entries):
        raise ValueError('Duplicate entry titles')
    return entries


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('html', nargs='?', type=Path)
    parser.add_argument('-o', '--output', type=Path, default=Path('poems-sherlock-holmes.json'))
    args = parser.parse_args()
    if args.html:
        html = args.html.read_bytes()
    else:
        with urllib.request.urlopen(SOURCE, timeout=60) as response:
            html = response.read()
    entries = parse(html)
    args.output.write_text(json.dumps(entries, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
    print(f'Saved {len(entries)} entries across {len(NOVELS) + len(COLLECTIONS)} books.')
