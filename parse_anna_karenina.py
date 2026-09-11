#!/usr/bin/env python3
"""Import the supplied Pevear/Volokhonsky PDF as 239 chapters (requires PyMuPDF).

The PDF omits all six XXX headings and repeats VI.XVIII mid-chapter. Missing
boundaries were checked against the chapter structure of Gutenberg ebook 1399
(Garnett); only the supplied PDF's wording is included in the output.
"""
import argparse
import json
import re
from collections import Counter
from pathlib import Path

import pymupdf

PARTS = ['One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight']
COUNTS = [34, 35, 32, 23, 33, 32, 31, 19]
# Exact opening lines in this PDF, restoring headings missing in its source.
MISSING_XXX = {
    'One': 'The terrible snowstorm tore and whistled between the wheels',
    'Two': 'As in all places where people gather, so in the small German',
    'Three': 'At the end of September lumber was delivered',
    'Five': 'Meanwhile Vassily Lukich, who did not understand',
    'Six': 'Sviyazhsky took Levin under the arm',
    'Seven': '‘Here it is again! Again I understand everything,’',
}


def roman(number):
    result = ''
    for value, numeral in [(10, 'X'), (9, 'IX'), (5, 'V'), (4, 'IV'), (1, 'I')]:
        while number >= value:
            result += numeral
            number -= value
    return result


def parse(path):
    chapters, paragraphs = [], []
    part = None
    current = None
    done = False
    restored = set()

    def finish():
        if current is None:
            return
        content = '\n\n\n'.join(paragraphs).strip()
        if len(content) < 500:
            raise ValueError(f'Suspiciously short chapter: {current["title"]}')
        chapters.append({**current, 'content': content, 'firstLine': content.split('\n')[0][:100]})
        paragraphs.clear()

    def begin(numeral, page_number):
        nonlocal current
        finish()
        current = {
            'title': f'Part {part} · Chapter {numeral}',
            'section': f'Part {part}',
            'chapter': numeral,
            'sourcePage': page_number,
            'translator': 'Richard Pevear and Larissa Volokhonsky',
        }

    with pymupdf.open(path) as document:
        for page_number, page in enumerate(document, 1):
            for block in page.get_text('dict')['blocks']:
                for line in block.get('lines', []):
                    x, y, _, _ = line['bbox']
                    spans = line['spans']
                    text = ''.join(span['text'] for span in spans).strip()
                    # Running heads/folios lie outside the body; footnotes use
                    # an 8pt font. Remove their superscript references as well.
                    if not text or not 60 < y < 640 or max(s['size'] for s in spans) < 9:
                        continue
                    match = re.fullmatch(r'Part (One|Two|Three|Four|Five|Six|Seven|Eight)', text)
                    if match:
                        finish()
                        current = None
                        part = match[1]
                        continue
                    if part is None:
                        continue
                    if text == 'The End':
                        finish()
                        current = None
                        done = True
                        break
                    heading = re.fullmatch(r'([IVXLCDM]+)(?:: Death)?', text)
                    if heading:
                        numeral = heading[1]
                        if part == 'Six' and numeral == 'XVIII' and current and current['chapter'] == numeral:
                            continue  # Duplicated printed heading on PDF page 417.
                        begin(numeral, page_number)
                        continue
                    if part in MISSING_XXX and text.startswith(MISSING_XXX[part]):
                        if part in restored or not current or current['chapter'] != 'XXIX':
                            raise ValueError(f'Unexpected Chapter XXX boundary in Part {part}')
                        begin('XXX', page_number)
                        restored.add(part)
                    if current is None:
                        continue
                    text = ''.join(s['text'] for s in spans if s['size'] >= 9).strip()
                    text = re.sub(r'[ \t]+', ' ', text).replace('\u00ad', '')
                    if not text:
                        continue
                    # Body paragraphs indent to x=74; continuation lines start
                    # at x=54, including those crossing page boundaries.
                    if x > 65 or not paragraphs:
                        paragraphs.append(text)
                    else:
                        joiner = '' if paragraphs[-1].endswith(('-', '–')) and text[0].islower() else ' '
                        paragraphs[-1] += joiner + text
                if done:
                    break
            if done:
                break
    if not done:
        raise ValueError('End of novel not found')
    expected = [(f'Part {part}', roman(n)) for part, count in zip(PARTS, COUNTS) for n in range(1, count + 1)]
    actual = [(chapter['section'], chapter['chapter']) for chapter in chapters]
    if actual != expected or restored != set(MISSING_XXX):
        raise ValueError('Chapter sequence does not match the eight complete parts')
    return chapters


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('pdf', type=Path)
    parser.add_argument('-o', '--output', type=Path, default=Path('poems-anna-karenina.json'))
    args = parser.parse_args()
    chapters = parse(args.pdf)
    args.output.write_text(json.dumps(chapters, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
    print(f'Saved {len(chapters)} chapters: {dict(Counter(c["section"] for c in chapters))}')
