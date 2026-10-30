#!/usr/bin/env python3
"""Import Zipf's 1949 book from the supplied Internet Archive OCR text/page.

Preserves preface, twelve chapters, and chapter-specific references. The
printed index and title/contents pages are omitted. OCR figures and formulas
are retained as text, not reconstructed.
"""
import argparse
from html import unescape
import json
from pathlib import Path
import re

NUMBERS = 'ONE TWO THREE FOUR FIVE SIX SEVEN EIGHT NINE TEN ELEVEN TWELVE'.split()
TITLES = [
    'Introduction and Orientation',
    'On the Economy of Words',
    'Formal-Semantic Balance and the Economy of Evolutionary Process',
    'Children’s Verbalizations and the “Origin” of Speech',
    'Language as Sensation and Mentation',
    'The Ego as the “Origin” of a Frame of Reference',
    'Mind and the Economy of Symbolic Process: Sex, Culture, and Schizophrenia',
    'The Language of Dreams and of Art',
    'The Economy of Geography',
    'Intranational and International Cooperation and Conflict',
    'The Distribution of Economic Power and Social Status',
    'Prestige Symbols and Cultural Vogues',
]
PARTS = ['Part One · Language and the Structure of the Personality',
         'Part Two · Human Relations: A Case of Intraspecies Balance']
HEADERS = {
    'PREFACE', 'REFERENCES', 'THE PRINCIPLE OF LEAST EFFORT',
    'FORMAL SEMANTIC BALANCE', 'MIND AND THE ECONOMY OF SYMBOLIC PROCESS',
    *(t.upper() for t in TITLES),
}


def clean(lines):
    paragraphs, current = [], ''
    for raw in lines:
        line = ' '.join(raw.split())
        if line in HEADERS or re.fullmatch(r'\d{1,3}|[ivxlcdm]+', line, re.I):
            continue
        # Folios sometimes share a line with a running head.
        header = re.sub(r'^\d+\s+|\s+\d+$', '', line)
        if header in HEADERS:
            continue
        if not line:
            if current:
                paragraphs.append(current)
                current = ''
        elif current.endswith('-') and line[0].islower():
            current = current[:-1] + line
        else:
            current = (current + ' ' + line).strip()
    if current:
        paragraphs.append(current)
    return '\n\n\n'.join(paragraphs)


def parse(text):
    if '<pre' in text:
        match = re.search(r'<pre[^>]*>(.*?)</pre>', text, re.S)
        if not match:
            raise ValueError('Missing full-text block')
        text = unescape(match[1])
    lines = text.splitlines()
    def locate(value, start=0):
        return next(i for i in range(start, len(lines)) if lines[i].strip() == value)

    starts, cursor = [], 0
    for number in NUMBERS:
        cursor = locate('CHAPTER ' + number, cursor)
        starts.append(cursor)
        cursor += 1
    references = locate('REFERENCES', starts[-1])
    index = locate('INDEX', references)
    refs, cursor = [], references
    for number in NUMBERS:
        cursor = locate('CHAPTER ' + number, cursor)
        refs.append(cursor)
        cursor += 1
    entries = []
    def add(title, section, body):
        content = clean(body)
        if len(content) < 500:
            raise ValueError('Suspiciously short entry: ' + title)
        entries.append(dict(title=title, section=section, content=content,
                            firstLine=content.split('\n', 1)[0][:100]))

    add('Preface', 'Front Matter', lines[locate('PREFACE')+1:locate('CONTENT S')])
    for n, (title, start, stop) in enumerate(zip(TITLES, starts, starts[1:]+[references])):
        # Opening titles occupy uppercase lines, sometimes separated by blanks.
        body = start + 1
        while not lines[body].strip() or lines[body].strip().isupper():
            body += 1
        if n == 7:
            stop = locate('Part Two', body)
        add(f'Chapter {n+1} · {title}', PARTS[n >= 8], lines[body:stop])
    for n, (start, stop) in enumerate(zip(refs, refs[1:]+[index])):
        add(f'References · Chapter {n+1}', 'References', lines[start+1:stop])
    if len(entries) != 25:
        raise ValueError('Expected preface, twelve chapters, and twelve reference entries')
    return entries


if __name__ == '__main__':
    cli = argparse.ArgumentParser(description=__doc__)
    cli.add_argument('source', type=Path)
    cli.add_argument('-o', '--output', type=Path, default=Path('poems-least-effort.json'))
    args = cli.parse_args()
    entries = parse(args.source.read_text(encoding='utf-8'))
    args.output.write_text(json.dumps(entries, ensure_ascii=False, indent=2)+'\n', encoding='utf-8')
    print(f'Saved {len(entries)} reading entries to {args.output}')
