#!/usr/bin/env python3
"""
Parse The Poems and Prose Poems of Charles Baudelaire from Project Gutenberg
HTML (ebook 36287), an English translation edited by James Huneker.

That edition has no <pre> blocks. Each poem is an <h3> title followed by <p>
blocks: verse paragraphs separate their lines with <br/>, while the prose poems
are ordinary paragraphs. Only the two poetry sections are read, so Huneker's
long critical introduction is left out. Output matches the other parsers: verse
lines separated by two newlines and stanzas by three.
"""
import argparse
import html
import json
import re
from pathlib import Path

SECTION_PATTERN = re.compile(r'<h2[^>]*>(.*?)</h2>', re.S)
BLOCK_PATTERN = re.compile(r'<(h2|h3|h4|p)\b[^>]*>(.*?)</\1>', re.S)
POETRY_SECTIONS = ('THE FLOWERS OF EVIL', 'LITTLE POEMS IN PROSE')
END_MARKER = re.compile(r'\*\*\*\s*END OF THE PROJECT GUTENBERG EBOOK', re.I)


def strip_tags(markup):
    return html.unescape(re.sub(r'<[^>]+>', '', markup))


def block_lines(markup):
    """Turn one <p> into its lines; <br/> separates verse, prose stays whole."""
    # Each <br/> is already followed by a newline in the source; absorb it, or
    # every line would be read as its own stanza.
    text = re.sub(r'<br\s*/?>[ \t]*\r?\n?', '\n', markup)
    text = strip_tags(text)
    if '\n' in text:
        return [re.sub(r'[ \t]+', ' ', line).strip() for line in text.split('\n')]
    return [re.sub(r'\s+', ' ', text).strip()]


def join_verse(lines):
    """Two newlines between lines, three at a stanza break, as the site renders."""
    content = ''
    for line in lines:
        if not content:
            content = line
        elif line:
            content += f'\n\n{line}'
        elif not content.endswith('\n'):
            content += '\n'
    return content.strip()


def parse_poems(input_file):
    markup = Path(input_file).read_text(encoding='utf-8', errors='replace')

    starts = [m.start() for m in SECTION_PATTERN.finditer(markup)
              if strip_tags(m.group(1)).strip().upper().rstrip('.') in POETRY_SECTIONS]
    if not starts:
        raise SystemExit('No poetry sections found; is this ebook 36287?')
    end = END_MARKER.search(markup)
    body = markup[min(starts):end.start() if end else len(markup)]

    poems = []
    section = ''
    title = None
    lines = []

    def flush():
        content = join_verse(lines)
        if title and len(content) > 20:
            first = next((line for line in content.split('\n') if line.strip()), '')
            poem = {'title': title, 'content': content, 'firstLine': first[:100]}
            if section:
                poem['section'] = section
            poems.append(poem)

    for tag, inner in BLOCK_PATTERN.findall(body):
        text = re.sub(r'\s+', ' ', strip_tags(inner)).strip()
        if tag == 'h2':
            flush()
            title, lines = None, []
            section = text.title().rstrip('.') if text else ''
        elif tag == 'h3':
            flush()
            title, lines = text.rstrip('.') or None, []
        elif tag == 'h4':
            # Numerals divide a long poem; keep them as part of the text.
            if title:
                lines.extend(['', text, ''])
        elif tag == 'p' and title:
            lines.extend(block_lines(inner))
            lines.append('')

    flush()
    return poems


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('input_file', help='Gutenberg HTML file to parse (36287-h.htm)')
    parser.add_argument('-o', '--output',
                        default=str(Path(__file__).parent / 'poems-baudelaire.json'),
                        help='where to write the JSON (default: poems-baudelaire.json)')
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
