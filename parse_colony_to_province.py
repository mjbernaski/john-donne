#!/usr/bin/env python3
"""Import the Internet Archive OCR of Miller's From Colony to Province."""
import argparse
import difflib
import json
import re
from pathlib import Path

TITLES = [
    'The Wrath of Jehovah', 'The Jeremiad', 'The Protestant Ethic',
    'The Expanding Limits of Natural Ability', 'Hypocrisy',
    'Children of the Covenant', 'Half-Way Measures', 'Revivalism',
    'Intolerance', 'Propaganda', 'Profile of a Provincial Mentality',
    'Salvaging the Covenant', 'The Judgment of the Witches',
    'The Dilemma of the Sacraments', 'Contention',
    'The Failure of Centralization', 'The Unresolved Debate',
    "The Poison of Wise’s Cursed Libel", 'A Medium of Trade',
    'Antiministerial Sentiment', 'The Judgment of the Smallpox',
    'A Secular State', 'A Tender Plant', 'Do-Good', 'Reason',
    'The Experimental Philosophy', 'The Death of an Idea',
    'Polity as a Form of Patriotism',
]
SECTIONS = ['Book I · Declension', 'Book II · Confusion',
            'Book III · The Splintering of Society',
            'Book IV · The Socialization of Piety']


def normalized(text):
    return re.sub(r'[^A-Z]', '', text.upper())


def clean(lines, title):
    headers = [normalized(x) for x in
               [title, title.split(' · ')[-1], 'Foreword', 'Prologue',
                'Epilogue', 'Bibliographical Notes']]
    result = []
    for raw in lines:
        line = re.sub(r'\s+', ' ', raw.strip())
        if re.fullmatch(r'\d+|[ivxlcdm]+', line, re.I):
            continue
        letters = ''.join(c for c in line if c.isalpha())
        # Match page headers, including minor OCR corruption, without removing
        # prose containing the same words or chapter headings inside the notes.
        upper = letters and sum(c.isupper() for c in letters) / len(letters) > .8
        if upper and any(difflib.SequenceMatcher(None, normalized(line), h).ratio() > .88
                         for h in headers):
            continue
        result.append(line)
    paragraphs, current = [], ''
    for line in result:
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


def entry(title, section, lines, **kwargs):
    content = clean(lines, title, **kwargs)
    if len(content) < 1000:
        raise ValueError(f'Suspiciously short entry: {title}')
    return dict(title=title, section=section, content=content,
                firstLine=content.split('\n', 1)[0][:100])


def parse(path):
    lines = Path(path).read_text(encoding='utf-8').splitlines()
    chapter_starts = [i for i, line in enumerate(lines)
                      if re.fullmatch(r'CHAPTER (?:[IVX]+|in)', line.strip())]
    if len(chapter_starts) != 28:
        raise ValueError(f'Expected 28 chapters, found {len(chapter_starts)}')
    find = lambda label, start: next(i for i in range(start, len(lines))
                                     if lines[i].strip() == label)
    prologue = find('PROLOGUE', 0)
    epilogue = find('EPILOGUE', chapter_starts[-1])
    notes = find('BIBLIOGRAPHICAL NOTES', epilogue)
    index = find('INDEX', notes)
    foreword = find('FOREWORD', 0)
    contents = find('CONTENTS', foreword)
    book_starts = [i for i, line in enumerate(lines)
                   if re.fullmatch(r'BOOK [IV]+', line.strip())]
    readings = [entry('Foreword', 'Front Matter', lines[foreword+1:contents]),
                entry('Prologue · Richard Mather’s Farewell', 'Prologue',
                      lines[prologue:book_starts[0]])]
    for n, (start, title) in enumerate(zip(chapter_starts, TITLES)):
        end = chapter_starts[n+1] if n < 27 else epilogue
        end = min([end] + [i for i in book_starts if start < i < end])
        # Remove the chapter title, retaining all body text after it.
        first_title = next(i for i in range(start+1, end) if lines[i].strip())
        body = lines[first_title+1:end]
        numeral = lines[start].strip().split()[-1]
        if numeral == 'in':
            numeral = 'III'
        section = SECTIONS[0 if n < 10 else 1 if n < 18 else 2 if n < 23 else 3]
        readings.append(entry(f'Chapter {numeral} · {title}', section, body))
    readings.append(entry('Epilogue · Vale Atque Ave', 'Epilogue', lines[epilogue:notes]))
    readings.append(entry('Bibliographical Notes', 'Reference', lines[notes:index]))
    return readings


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('input')
    parser.add_argument('-o', '--output', default='poems-colony-to-province.json')
    args = parser.parse_args()
    readings = parse(args.input)
    Path(args.output).write_text(json.dumps(readings, ensure_ascii=False, indent=2)+'\n')
    for item in readings:
        print(f"{item['title']}: {len(item['content']):,} characters")
