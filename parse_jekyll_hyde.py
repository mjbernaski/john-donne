#!/usr/bin/env python3
"""Import the supplied 1901 Internet Archive edition, including its twenty fables."""
import json
from pathlib import Path
import re

SOURCE = 'https://archive.org/details/strangecaseofdrj00steviala'
TITLES = [
    'Story of the Door', 'Search for Mr. Hyde', 'Dr. Jekyll Was Quite at Ease',
    'The Carew Murder Case', 'Incident of the Letter',
    'Remarkable Incident of Dr. Lanyon', 'Incident at the Window',
    'The Last Night', "Dr. Lanyon's Narrative",
    "Henry Jekyll's Full Statement of the Case", 'The Persons of the Tale',
    'The Sinking Ship', 'The Two Matches', 'The Sick Man and the Fireman',
    'The Devil and the Innkeeper', 'The Penitent', 'The Yellow Paint',
    'The House of Eld', 'The Four Reformers', 'The Man and His Friend',
    'The Reader', 'The Citizen and the Traveller', 'The Distinguished Stranger',
    'The Cart-Horses and the Saddle-Horse', 'The Tadpole and the Frog',
    'Something in It', 'Faith, Half Faith and No Faith at All',
    'The Touchstone', 'The Poor Thing', 'The Song of the Morrow',
]


def parse(text):
    blocks = re.split(r'\n\s*\n', text)
    entries, paragraphs = [], []
    current = None

    def finish():
        if current is None:
            return
        content = '\n\n\n'.join(paragraphs).strip()
        if len(content) < 100:
            raise ValueError('Empty or truncated section: ' + TITLES[current])
        entries.append(dict(title=TITLES[current],
                            section='Strange Case of Dr. Jekyll and Mr. Hyde' if current < 10 else 'Fables',
                            content=content, firstLine=content.split('\n')[0][:100], sourceUrl=SOURCE))
        paragraphs.clear()

    for block in blocks:
        flat = ' '.join(block.split())
        heading = re.sub(r'^[IVXL]+\.?\s+', '', flat).rstrip('.')
        heading = heading.replace('SADDLE- HORSE', 'SADDLE-HORSE')
        expected = len(entries) + (1 if current is not None else 0)
        if expected < len(TITLES) and heading == TITLES[expected].upper():
            finish()
            current = expected
            continue
        if current is None:
            continue
        if flat == 'FABLES.*':
            finish()
            current = None
            continue
        if flat == 'THE END':
            finish()
            break
        if re.fullmatch(r'[IVXL]+\.?', flat) or re.fullmatch(r"['*\dIlioazgsO\s]+", flat):
            continue
        # Running heads carry an OCR page number before or after the title.
        if len(flat) < 110 and (
            re.match(r"^[*\dIlioOg\s]+\s+(?:DR[.-]|FABLES\.)", flat)
            or re.search(r'\.\s+[\dIlJgiO$\s]+$', flat)
            or flat in {'^^^^^^•^^^^••^^^i^^^^1^**""***', '4 nor/Iff"'}
        ):
            continue
        # Remove isolated printer signatures at the ends of text blocks.
        block = re.sub(r'\n\s*\d{1,2}\s*$', '', block)
        block = re.sub(r'(\w)-\s*\n\s*(\w)', r'\1\2', block)
        paragraph = ('\n'.join(' '.join(line.split()) for line in block.strip().splitlines())
                     if paragraphs and paragraphs[-1] == 'MORAL.' else ' '.join(block.split()))
        paragraph = re.sub(r'\s+([;,!?])', r'\1', paragraph)
        if paragraph:
            paragraphs.append(paragraph)
    if len(entries) != 30:
        raise ValueError(f'Expected 10 chapters and 20 fables, found {len(entries)}')
    if not entries[0]['content'].startswith('MR. UTTERSON the lawyer'):
        raise ValueError('Opening missing')
    if not entries[9]['content'].endswith('an end.'):
        raise ValueError('Novella ending missing')
    if not entries[-1]['content'].endswith('after the manner of simple men.'):
        raise ValueError('Final fable ending missing')
    return entries


if __name__ == '__main__':
    entries = parse(Path('source-texts/jekyll-hyde-archive.txt').read_text())
    Path('poems-jekyll-hyde.json').write_text(json.dumps(entries, ensure_ascii=False, indent=2) + '\n')
    print(f'Saved {len(entries)} sections')
