#!/usr/bin/env python3
"""
Build the Shakespeare soliloquies collection from Project Gutenberg's Complete
Works (ebook 100).

Which speeches count as the well-known soliloquies is taken from
shakespeare-soliloquies.json, a list of play, speaker, act and scene, and
opening line. The verse itself is read from the Gutenberg text, which is public
domain, rather than from any modern edition.

In that text a speech begins with a speaker name in capitals on its own line and
runs until the next speaker or stage direction, which is how each one is cut.
Output matches the other parsers: verse lines separated by two newlines.
"""
import argparse
import json
import re
import unicodedata
from difflib import SequenceMatcher
from pathlib import Path

# The complete works uses these headings; the collection covers eight plays.
PLAY_HEADINGS = {
    'Hamlet': 'THE TRAGEDY OF HAMLET, PRINCE OF DENMARK',
    'Macbeth': 'THE TRAGEDY OF MACBETH',
    'King Lear': 'THE TRAGEDY OF KING LEAR',
    'Othello': 'THE TRAGEDY OF OTHELLO, THE MOOR OF VENICE',
    'Romeo and Juliet': 'THE TRAGEDY OF ROMEO AND JULIET',
    'The Tempest': 'THE TEMPEST',
    'The Merchant of Venice': 'THE MERCHANT OF VENICE',
    "A Midsummer Night's Dream": "A MIDSUMMER NIGHT’S DREAM",
}
SPEAKER = re.compile(r'^[A-Z][A-Z’\'. -]{1,30}\.$')
STAGE = re.compile(r'^\s*(?:Enter|Exit|Exeunt|Re-enter|SCENE|ACT|\[)')


def flatten(text):
    """Compare on letters alone: the sources differ in quotes and punctuation."""
    text = unicodedata.normalize('NFKD', text)
    return re.sub(r'[^a-z0-9 ]', '', text.lower()).strip()


def play_ranges(lines):
    """Map each play to the span of lines holding its text."""
    starts = {}
    for play, heading in PLAY_HEADINGS.items():
        wanted = flatten(heading)
        hits = [i for i, line in enumerate(lines) if flatten(line) == wanted]
        if hits:
            starts[play] = hits[-1]   # the contents list mentions it first
    ordered = sorted(starts.items(), key=lambda item: item[1])

    ranges = {}
    for position, (play, start) in enumerate(ordered):
        end = ordered[position + 1][1] if position + 1 < len(ordered) else len(lines)
        ranges[play] = (start, end)
    return ranges


def locate(lines, span, opening):
    """Opening lines are quoted loosely ("Blow, wind" for "Blow, winds"), so the
    best match in the play is taken rather than an exact prefix."""
    start, end = span
    wanted = flatten(opening)
    if not wanted:
        return None

    best, best_score = None, 0.0
    for index in range(start, end):
        candidate = flatten(lines[index])
        if not candidate:
            continue
        if wanted[:40] in candidate:
            return index
        score = SequenceMatcher(None, wanted, candidate[:len(wanted) + 12]).ratio()
        if score > best_score:
            best, best_score = index, score
    return best if best_score >= 0.72 else None


def find_speech(lines, span, opening):
    """Locate the speech that begins with this line and return it whole."""
    start, end = span
    index = locate(lines, span, opening)
    if index is None:
        return None

    speech = []
    for line in lines[index:end]:
        stripped = line.strip()
        if speech and (SPEAKER.match(stripped) or STAGE.match(line)):
            break
        if not stripped and speech and not speech[-1]:
            break                          # a blank pair ends the speech
        speech.append(stripped)
    while speech and not speech[-1]:
        speech.pop()
    return speech if len(speech) >= 3 else None


def parse_poems(text_file, index_file):
    lines = Path(text_file).read_text(encoding='utf-8', errors='replace').split('\n')
    entries = json.loads(Path(index_file).read_text(encoding='utf-8'))
    ranges = play_ranges(lines)

    poems = []
    missing = []
    for entry in entries:
        span = ranges.get(entry['play'])
        speech = find_speech(lines, span, entry['opening']) if span else None
        if not speech:
            missing.append(f"{entry['play']}: {entry['opening'][:48]}")
            continue

        content = '\n\n'.join(speech)
        poems.append({
            'title': entry['opening'],
            'content': content,
            'firstLine': speech[0][:100],
            'section': f"{entry['play']} · {entry['speaker']}, {entry['reference']}",
        })

    return poems, missing


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('input_file', help='Gutenberg plain-text complete works (pg100.txt)')
    parser.add_argument('-i', '--index',
                        default=str(Path(__file__).parent / 'shakespeare-soliloquies.json'),
                        help='list of soliloquies to extract')
    parser.add_argument('-o', '--output',
                        default=str(Path(__file__).parent / 'poems-shakespeare.json'),
                        help='where to write the JSON (default: poems-shakespeare.json)')
    args = parser.parse_args()

    if not Path(args.input_file).is_file():
        parser.error(f'input file not found: {args.input_file}')

    poems, missing = parse_poems(args.input_file, args.index)
    Path(args.output).write_text(
        json.dumps(poems, indent=2, ensure_ascii=False),
        encoding='utf-8',
    )
    print(f'Saved {len(poems)} soliloquies to {args.output}')
    if missing:
        print(f'\nNot found in the Gutenberg text ({len(missing)}):')
        for item in missing:
            print(f'  {item}')

    print('\nFirst 10:')
    for number, poem in enumerate(poems[:10], start=1):
        print(f'{number}. {poem["title"][:52]}  ({poem["section"]})')
