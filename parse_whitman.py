#!/usr/bin/env python3
"""
Parse Leaves of Grass from the Project Gutenberg HTML file (ebook 1322).

That edition marks every poem as <div class="chapter"> holding an <h2> and a
<pre> body, so the structure is read directly rather than guessed at. Where a
poem opens a cluster the <h2> carries only the book number and the real title
sits in a <p> above the verse, which is how "Song of Myself" hides under
"BOOK III". Output matches parse_poems.py: verse lines are separated by two
newlines and stanzas by three, which is the spacing the site's renderer expects.
"""
import argparse
import html
import json
import re
from pathlib import Path

CHAPTER_PATTERN = re.compile(
    r'<div class="chapter">(.*?)</div><!--end chapter-->',
    re.S,
)
HEADING_PATTERN = re.compile(r'<h2[^>]*>(.*?)</h2>', re.S)
SUBTITLE_PATTERN = re.compile(r'<p[^>]*>(.*?)</p>', re.S)
BODY_PATTERN = re.compile(r'<pre[^>]*>(.*?)</pre>', re.S)
BOOK_PATTERN = re.compile(r'^BOOK\s*[IVXLC]+\.?\s*(.*)$')
SKIP_TITLES = {'contents', 'by walt whitman'}
SECTION_NUMBER = re.compile(r'\s*\d+\s*')


def strip_tags(markup):
    return html.unescape(re.sub(r'<[^>]+>', '', markup)).strip()


def dedent_verse(lines):
    """Remove the uniform left margin while keeping run-over line indents."""
    indents = [len(line) - len(line.lstrip(' ')) for line in lines if line.strip()]
    margin = min(indents) if indents else 0
    return [line[margin:].rstrip() if line.strip() else '' for line in lines]


def join_wrapped(lines):
    """The source hard-wraps at about seventy columns and indents the run-over.
    Those belong to the line above: Whitman's long line is the whole point, and
    leaving them split turns one line of verse into two."""
    joined = []
    for line in lines:
        is_runover = (
            line.startswith(' ')
            and line.strip()
            and joined and joined[-1].strip()
            and not SECTION_NUMBER.fullmatch(line)
        )
        if is_runover:
            joined[-1] = f'{joined[-1].rstrip()} {line.strip()}'
        else:
            joined.append(line)
    return joined


def parse_poems(input_file):
    markup = Path(input_file).read_text(encoding='utf-8', errors='replace')
    poems = []

    section = ''

    for chapter in CHAPTER_PATTERN.findall(markup):
        heading_match = HEADING_PATTERN.search(chapter)
        # Long poems are split across several <pre> blocks; all of them belong
        # to the same poem, so they are rejoined here.
        body_match = BODY_PATTERN.search(chapter)
        bodies = BODY_PATTERN.findall(chapter)
        if not heading_match or not bodies:
            continue

        heading = re.sub(r'\s+', ' ', strip_tags(heading_match.group(1)))
        if not heading or heading.lower() in SKIP_TITLES:
            continue

        book_match = BOOK_PATTERN.match(heading)
        if book_match:
            # A named book opens a cluster the following poems belong to.
            section = book_match.group(1).title() if book_match.group(1) else ''
            subtitle = SUBTITLE_PATTERN.search(chapter[:body_match.start()])
            if not subtitle:
                continue  # A divider with no verse of its own.
            title = re.sub(r'\s+', ' ', strip_tags(subtitle.group(1)))
        else:
            title = heading

        if not title:
            continue

        lines = join_wrapped(dedent_verse(html.unescape('\n\n'.join(bodies)).split('\n')))
        while lines and not lines[0]:
            lines.pop(0)
        while lines and not lines[-1]:
            lines.pop()
        if not lines:
            continue

        # A blank source line marks a stanza break; the renderer reads that as
        # three newlines and an ordinary line break as two.
        content = ''
        for line in lines:
            if not content:
                content = line
            elif line:
                content += f'\n\n{line}'
            else:
                content += '\n'

        if len(content.strip()) <= 20:
            continue

        poem = {
            'title': title,
            'content': content,
            'firstLine': lines[0][:100],
        }
        if section:
            poem['section'] = section
        poems.append(poem)

    return poems


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('input_file', help='Gutenberg HTML file to parse (1322-h.htm)')
    parser.add_argument('-o', '--output',
                        default=str(Path(__file__).parent / 'poems-whitman.json'),
                        help='where to write the JSON (default: poems-whitman.json)')
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
