#!/usr/bin/env python3
"""
Parse The Flowers of Evil, Cyril Scott's 1909 verse translation, from the
Project Gutenberg plain-text file (ebook 36098).

Plain text carries no markup, so the table of contents is used as the list of
titles and matched against the body in order. That handles the two poems both
called "Autumn Song" without guessing, and keeps front matter out. Output
matches the other parsers: verse lines separated by two newlines and stanzas by
three.
"""
import argparse
import json
import re
from pathlib import Path

START_MARKER = re.compile(r'\*\*\*\s*START OF THE PROJECT GUTENBERG EBOOK.*?\*\*\*', re.I)
# This edition signs off in prose before the boilerplate banner, so both end it.
END_MARKER = re.compile(r'\*\*\*\s*END OF THE PROJECT GUTENBERG EBOOK|^End of (?:the )?Project Gutenberg',
                        re.I | re.M)


def normalise(text):
    return re.sub(r'[^a-z0-9]+', ' ', text.lower()).strip()


def read_body(input_file):
    raw = Path(input_file).read_text(encoding='utf-8', errors='replace')
    start = START_MARKER.search(raw)
    end = END_MARKER.search(raw)
    return raw[start.end() if start else 0:end.start() if end else len(raw)].split('\n')


def read_contents(lines):
    """The contents block runs from the CONTENTS heading to the first gap."""
    try:
        index = next(i for i, line in enumerate(lines) if line.strip() == 'CONTENTS')
    except StopIteration:
        raise SystemExit('No CONTENTS block found; is this ebook 36098?')

    titles = []
    for line in lines[index + 1:]:
        entry = line.strip()
        if not entry:
            if titles:
                break
            continue
        titles.append(entry)
    return index, titles


def dedent_verse(lines):
    indents = [len(line) - len(line.lstrip(' ')) for line in lines if line.strip()]
    margin = min(indents) if indents else 0
    return [line[margin:].rstrip() if line.strip() else '' for line in lines]


def join_verse(lines):
    while lines and not lines[0]:
        lines.pop(0)
    while lines and not lines[-1]:
        lines.pop()

    content = ''
    for line in lines:
        if not content:
            content = line
        elif line:
            content += f'\n\n{line}'
        elif not content.endswith('\n'):
            content += '\n'
    # rstrip only: the opening line's indent is part of the verse layout.
    return content.rstrip()


def parse_poems(input_file):
    lines = read_body(input_file)
    contents_index, titles = read_contents(lines)

    # Walk the body once, opening a new poem each time the next expected title
    # appears on a line of its own.
    starts = []
    pending = 0
    for index in range(contents_index + len(titles) + 1, len(lines)):
        if pending >= len(titles):
            break
        if normalise(lines[index]) == normalise(titles[pending]):
            starts.append((index, titles[pending]))
            pending += 1

    poems = []
    for position, (index, title) in enumerate(starts):
        stop = starts[position + 1][0] if position + 1 < len(starts) else len(lines)
        content = join_verse(dedent_verse(lines[index + 1:stop]))
        if len(content) <= 20:
            continue
        first = next((line for line in content.split('\n') if line.strip()), '')
        poems.append({
            'title': title,
            'content': content,
            'firstLine': first[:100],
        })

    missing = len(titles) - len(starts)
    if missing:
        print(f'warning: {missing} title(s) in the contents were not found in the body')
    return poems


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('input_file', help='Gutenberg plain-text file to parse (pg36098.txt)')
    parser.add_argument('-o', '--output',
                        default=str(Path(__file__).parent / 'poems-baudelaire-scott.json'),
                        help='where to write the JSON (default: poems-baudelaire-scott.json)')
    args = parser.parse_args()

    if not Path(args.input_file).is_file():
        parser.error(f'input file not found: {args.input_file}')

    poems = parse_poems(args.input_file)
    Path(args.output).write_text(
        json.dumps(poems, indent=2, ensure_ascii=False),
        encoding='utf-8',
    )
    print(f'Saved {len(poems)} poems to {args.output}')

    print('\nFirst 10 poems:')
    for index, poem in enumerate(poems[:10], start=1):
        print(f'{index}. {poem["title"]}')
