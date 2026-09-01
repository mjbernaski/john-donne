#!/usr/bin/env python3
"""
Parse Dante's Inferno from Project Gutenberg into one entry per canto.

Four editions of the same thirty-four cantos are handled here rather than in
four parsers, because the only thing that differs between them is the shape of
the canto heading and whether the text is verse or prose:

    997   La Divina Commedia: Inferno   Dante's Italian
    1001  Longfellow (1867)             blank verse, line for line
    8789  Cary (1814)                   Miltonic blank verse
    1995  Norton (1891)                 prose

Every edition numbers its cantos identically, so canto N of one is canto N of
the others and the four can be read side by side. Output matches the other
parsers: verse lines separated by two newlines and stanzas by three.
"""
import argparse
import json
import re
import unicodedata
from pathlib import Path

START_MARKER = re.compile(r'\*\*\*\s*START OF THE PROJECT GUTENBERG EBOOK.*?\*\*\*', re.I)
END_MARKER = re.compile(r'\*\*\*\s*END OF THE PROJECT GUTENBERG EBOOK', re.I)

CANTOS = 34

ROMAN = [
    'I', 'II', 'III', 'IV', 'V', 'VI', 'VII', 'VIII', 'IX', 'X',
    'XI', 'XII', 'XIII', 'XIV', 'XV', 'XVI', 'XVII', 'XVIII', 'XIX', 'XX',
    'XXI', 'XXII', 'XXIII', 'XXIV', 'XXV', 'XXVI', 'XXVII', 'XXVIII', 'XXIX', 'XXX',
    'XXXI', 'XXXII', 'XXXIII', 'XXXIV',
]

# Where the pilgrim is, canto by canto. Carried on each entry as its cluster so
# the companion knows which region of Hell the passage belongs to.
REGIONS = [
    (1, 2, 'The dark wood'),
    (3, 3, 'The gate of Hell and the vestibule'),
    (4, 4, 'Circle 1 · Limbo'),
    (5, 5, 'Circle 2 · The lustful'),
    (6, 6, 'Circle 3 · The gluttonous'),
    (7, 7, 'Circles 4 and 5 · The avaricious, the prodigal, the wrathful'),
    (8, 9, 'Circle 5 and the walls of Dis'),
    (10, 11, 'Circle 6 · The heretics'),
    (12, 17, 'Circle 7 · The violent'),
    (18, 30, 'Circle 8 · Malebolge, the fraudulent'),
    (31, 31, 'The well of the giants'),
    (32, 34, 'Circle 9 · Cocytus, the traitors'),
]

EDITIONS = {
    'italiano': {
        'ebook': 997,
        'output': 'poems-dante-italiano.json',
        'heading': re.compile(r'^Canto ([IVXL]+)$'),
        # A running "Inferno" header sits above every canto heading, so it falls
        # to the foot of the canto before it.
        'drop': re.compile(r'^Inferno$'),
        'prose': False,
    },
    'longfellow': {
        'ebook': 1001,
        'output': 'poems-dante-longfellow.json',
        'heading': re.compile(r'^Inferno:\s*Canto ([IVXL]+)$'),
        'prose': False,
    },
    'cary': {
        'ebook': 8789,
        'output': 'poems-dante-cary.json',
        'heading': re.compile(r'^CANTO ([IVXL]+)$'),
        'prose': False,
    },
    'norton': {
        'ebook': 1995,
        'output': 'poems-dante-norton.json',
        'heading': re.compile(r'^CANTO ([IVXL]+)\.$'),
        'prose': True,
    },
}


def region(number):
    return next(name for first, last, name in REGIONS if first <= number <= last)


def read_body(input_file):
    raw = Path(input_file).read_text(encoding='utf-8', errors='replace')
    start = START_MARKER.search(raw)
    end = END_MARKER.search(raw)
    return raw[start.end() if start else 0:end.start() if end else len(raw)].split('\n')


def find_cantos(lines, heading):
    """Locate the thirty-four canto headings that open the text itself.

    Three of these editions print a table of contents in a form the body
    heading does not share, but Norton's contents repeats the body heading
    exactly. Taking the last thirty-four matches skips the contents in that
    case and is harmless in the others.
    """
    found = [(index, match.group(1))
             for index, line in enumerate(lines)
             if (match := heading.match(line.strip()))]
    if len(found) < CANTOS:
        raise SystemExit(f'found {len(found)} canto headings, expected at least {CANTOS}')

    found = found[-CANTOS:]
    # Cantos are titled by position, so the numerals are only a check that the
    # right thirty-four headings were caught. Cary's text misprints one of them
    # ("CANTO XVII" where XXVII belongs); a single stray numeral is a typo in
    # the source, while a real parsing failure throws the whole run out.
    wrong = [(ROMAN[position], numeral)
             for position, (_, numeral) in enumerate(found) if numeral != ROMAN[position]]
    if len(wrong) > 1:
        raise SystemExit(f'canto headings are out of order: {[n for _, n in found]}')
    for expected, printed in wrong:
        print(f'note: canto {expected} is headed "CANTO {printed}" in the source; '
              f'numbering by position instead')
    return [index for index, _ in found]


def dedent_verse(lines):
    indents = [len(line) - len(line.lstrip(' ')) for line in lines if line.strip()]
    margin = min(indents) if indents else 0
    return [line[margin:].rstrip() if line.strip() else '' for line in lines]


def trim(lines):
    lines = list(lines)
    while lines and not lines[0].strip():
        lines.pop(0)
    while lines and not lines[-1].strip():
        lines.pop()
    return lines


def join_verse(lines):
    """Two newlines between verse lines, three between stanzas."""
    content = ''
    for line in trim(lines):
        if not content:
            content = line
        elif line:
            content += f'\n\n{line}'
        elif not content.endswith('\n'):
            content += '\n'
    # rstrip only: the opening line's indent is part of the verse layout.
    return content.rstrip()


def paragraphs(lines):
    """Group hard-wrapped prose back into whole paragraphs."""
    blocks, current = [], []
    for line in lines:
        if line.strip():
            current.append(line.strip())
        elif current:
            blocks.append(' '.join(current))
            current = []
    if current:
        blocks.append(' '.join(current))
    return blocks


def strip_norton_notes(lines):
    """Drop Norton's footnotes, which sit between the paragraphs they annotate.

    A note opens with a bracketed number at the start of a line and runs to the
    next blank line. The matching markers inside the prose go with them, since a
    stray "[1]" mid-sentence reads badly and narrates worse.
    """
    kept, in_note = [], False
    for line in lines:
        if re.match(r'^\[\d+\]', line.strip()):
            in_note = True
        elif not line.strip():
            in_note = False
        if not in_note:
            # Some markers are printed with a space before them, so take that
            # too rather than leave a gap mid-sentence.
            kept.append(re.sub(r'[ \t]*\[\d+\]', '', line))
    return kept


def join_prose(lines):
    """Norton's argument summary heads each canto; his text is what follows."""
    blocks = paragraphs(trim(strip_norton_notes(lines)))
    return '\n\n\n'.join(blocks[1:]) if len(blocks) > 1 else '\n\n\n'.join(blocks)


def parse_edition(input_file, edition):
    lines = read_body(input_file)
    starts = find_cantos(lines, edition['heading'])

    poems = []
    for position, start in enumerate(starts):
        stop = starts[position + 1] if position + 1 < len(starts) else len(lines)
        body = lines[start + 1:stop]
        if edition.get('drop'):
            body = [line for line in body if not edition['drop'].match(line.strip())]
        content = join_prose(body) if edition['prose'] else join_verse(dedent_verse(body))
        if len(content) <= 200:
            raise SystemExit(f'canto {ROMAN[position]} came out empty; check the heading pattern')

        first = next((line for line in content.split('\n') if line.strip()), '')
        poems.append({
            'title': f'Inferno · Canto {ROMAN[position]}',
            'content': content,
            'firstLine': first.strip()[:100],
            'section': region(position + 1),
        })
    return poems


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__,
                                     formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument('edition', choices=sorted(EDITIONS),
                        help='which translation to parse')
    parser.add_argument('input_file', help='Gutenberg plain-text file for that edition')
    parser.add_argument('-o', '--output', help='where to write the JSON')
    args = parser.parse_args()

    edition = EDITIONS[args.edition]
    if not Path(args.input_file).is_file():
        parser.error(f'input file not found: {args.input_file}')

    poems = parse_edition(args.input_file, edition)
    output = Path(args.output) if args.output else Path(__file__).parent / edition['output']
    output.write_text(json.dumps(poems, indent=2, ensure_ascii=False), encoding='utf-8')

    lines = sum(len(poem['content'].split('\n\n')) for poem in poems)
    print(f'Saved {len(poems)} cantos ({lines} lines) to {output}')
    for poem in poems[:3]:
        print(f'  {poem["title"]}: {poem["firstLine"]}')
