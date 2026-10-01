#!/usr/bin/env python3
"""Import the supplied Colony to Province PDF using its positioned OCR text."""
import argparse
import json
import re
from pathlib import Path
import pymupdf
from parse_colony_to_province import TITLES, SECTIONS

# One-based PDF pages, verified against the scan (printed pagination differs).
STARTS = [34, 42, 55, 68, 83, 97, 108, 120, 134, 145, 164, 188, 206, 224,
          241, 263, 284, 303, 320, 339, 360, 382, 400, 410, 432, 452, 462, 479]
OPENINGS = ['The', 'For', 'When', 'When', 'The', 'Even', 'That', 'Historians',
            'By', 'Before', 'There', 'A', 'The', 'In', 'Fleeing', 'The', '“We',
            'The', 'The', 'That', 'In', 'These', 'The', 'While', 'The', 'Cotton',
            'Ebenezer', 'Benjamin']
DIVIDERS = {32, 33, 162, 163, 318, 319, 408, 409}


def page_lines(page, opening=False):
    lines = []
    for block in page.get_text('dict', flags=pymupdf.TEXTFLAGS_TEXT)['blocks']:
        for line in block.get('lines', []):
            text = re.sub(r'\s+', ' ', ''.join(s['text'] for s in line['spans'])).strip()
            if text:
                lines.append(dict(text=text, box=line['bbox']))
    # Remove chapter headings and the broken decorative opening word. The latter
    # is restored from the image, not guessed from OCR. Locate the first prose line below the decorative word.
    if opening:
        first = next(i for i, l in enumerate(lines) if l['box'][1] > 100 and len(l['text']) > 35)
        lines = lines[first:]
    else:
        # Running heads and page numbers occupy the top band, are short, and
        # precede the main text. Some pages have no head: retain their full lines.
        lines = [l for l in lines if not (l['box'][1] < 47 and
                 (l['box'][2] - l['box'][0] < 235 or len(l['text']) < 55) and
                 sum(c.islower() for c in l['text']) <= 4)]
    # Join OCR fragments on the same printed baseline before paragraph detection.
    merged = []
    for line in lines:
        if merged and abs(line['box'][1] - merged[-1]['box'][1]) < 3:
            merged[-1]['text'] += ' ' + line['text']
            a, b = merged[-1]['box'], line['box']
            merged[-1]['box'] = (min(a[0], b[0]), min(a[1], b[1]), max(a[2], b[2]), max(a[3], b[3]))
        else:
            merged.append(line)
    return merged


def body(doc, start, end, first_word=None):
    paragraphs = []
    current = ''
    for number in range(start, end):
        if number in DIVIDERS:
            continue
        lines = page_lines(doc[number-1], opening=number == start and first_word is not None)
        if not lines:
            continue
        margin = min(l['box'][0] for l in lines)
        previous = None
        for i, line in enumerate(lines):
            text = line['text']
            # Discard isolated scan noise, never an ordinary textual sentence.
            if text in {'|', '_', '~', '.', 'LE pl'}:
                continue
            indented = line['box'][0] > margin + 6
            gap = previous and line['box'][1] - previous['box'][3] > 7
            if current and i > 0 and (indented or gap) and not current.endswith('-'):
                paragraphs.append(current)
                current = ''
            if number == start and i == 0 and first_word:
                text = first_word + ' ' + text
            if current.endswith('-') and text[:1].islower():
                current = current[:-1] + text
            else:
                current = (current + ' ' + text).strip()
            previous = line
    if current:
        paragraphs.append(current)
    return '\n\n\n'.join(paragraphs)


def roman(n):
    result = ''
    for value, symbol in [(10, 'X'), (9, 'IX'), (5, 'V'), (4, 'IV'), (1, 'I')]:
        while n >= value:
            result += symbol
            n -= value
    return result


def parse(source):
    with pymupdf.open(source) as doc:
        if len(doc) != 530 or 'FROM' not in doc[1].get_text():
            raise ValueError('This importer expects the verified 530-page supplied scan.')
        specs = [('Foreword', 'Front Matter', 10, 13, None),
                 ('Prologue · Richard Mather’s Farewell', 'Prologue', 18, 32, 'John')]
        for i, start in enumerate(STARTS):
            section = SECTIONS[0 if i < 10 else 1 if i < 18 else 2 if i < 23 else 3]
            specs.append((f'Chapter {roman(i+1)} · {TITLES[i]}', section, start,
                          STARTS[i+1] if i < 27 else 494, OPENINGS[i]))
        specs.append(('Epilogue · Vale Atque Ave', 'Epilogue', 496, 501, '“This'))
        entries = []
        for title, section, start, end, word in specs:
            content = body(doc, start, end, word)
            if title.startswith('Epilogue'):
                epigraph = '\n'.join(doc[493].get_text().strip().splitlines()[1:])
                content = epigraph + '\n\n\n' + content
            if len(content) < 1000:
                raise ValueError(f'Suspiciously short section: {title}')
            entries.append(dict(title=title, section=section, content=content,
                                firstLine=content.split('\n', 1)[0][:100]))
        return entries


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('source')
    parser.add_argument('-o', '--output', default='poems-colony-to-province.json')
    args = parser.parse_args()
    entries = parse(args.source)
    Path(args.output).write_text(json.dumps(entries, ensure_ascii=False, indent=2)+'\n')
    for item in entries:
        print(f"{item['title']}: {len(item['content']):,} characters")
