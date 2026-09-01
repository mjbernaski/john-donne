#!/usr/bin/env python3
"""Parse Perry Miller's The New England Mind from Internet Archive OCR.

The reading collection contains the foreword, sixteen chapters, and two
appendices.  The printed index and the book's standalone endnotes are omitted:
the former is not useful in this interface, while OCR has detached the latter
from the passages they annotate.
"""
import argparse
import json
import re
from pathlib import Path


CHAPTERS = [
    ("I", "The Augustinian Strain of Piety", "Book I · Religion and Learning"),
    ("II", "The Practice of Piety", "Book I · Religion and Learning"),
    ("III", "The Intellectual Character", "Book I · Religion and Learning"),
    ("IV", "The Intellectual Heritage", "Book I · Religion and Learning"),
    ("V", "The Instrument of Reason", "Book II · Cosmology"),
    ("VI", "Knowledge", "Book II · Cosmology"),
    ("VII", "The Uses of Reason", "Book II · Cosmology"),
    ("VIII", "Nature", "Book II · Cosmology"),
    ("IX", "The Nature of Man", "Book III · Anthropology"),
    ("X", "The Means of Conversion", "Book III · Anthropology"),
    ("XI", "Rhetoric", "Book III · Anthropology"),
    ("XII", "The Plain Style", "Book III · Anthropology"),
    ("XIII", "The Covenant of Grace", "Book IV · Sociology"),
    ("XIV", "The Social Covenant", "Book IV · Sociology"),
    ("XV", "The Church Covenant", "Book IV · Sociology"),
    ("XVI", "God's Controversy with New England", "Book IV · Sociology"),
]

RUNNING_HEADERS = {
    "THE NEW ENGLAND MIND",
    *(title.upper() for _, title, _ in CHAPTERS),
    "FOREWORD",
    "APPENDIX",
    "NOTES",
}


def compact(line):
    """Normalize the wide word spacing produced by the page OCR."""
    return re.sub(r"[ \t]+", " ", line.strip()).replace("^", "")


def locate(lines, pattern, start=0):
    for index in range(start, len(lines)):
        if re.fullmatch(pattern, compact(lines[index]), re.I):
            return index
    raise SystemExit(f"could not find heading after line {start}: {pattern}")


def clean_body(lines):
    cleaned = []
    for raw in lines:
        line = compact(raw)
        if re.fullmatch(r"[ivxlcdm]+|\d+", line, re.I):
            continue
        header = re.sub(r"\s+\d+[iI]?\Z", "", line).strip().upper()
        if header in RUNNING_HEADERS:
            continue
        cleaned.append(line)

    paragraphs, current = [], ""
    for line in cleaned:
        if not line:
            if current:
                paragraphs.append(current.strip())
                current = ""
            continue
        if current.endswith("-") and line[:1].islower():
            current = current[:-1] + line
        else:
            current = f"{current} {line}".strip()
    if current:
        paragraphs.append(current.strip())

    # Three newlines is the collection's paragraph separator; two newlines are
    # reserved elsewhere for individual verse lines.
    return "\n\n\n".join(paragraphs)


def entry(title, section, lines):
    content = clean_body(lines)
    if len(content) < 500:
        raise SystemExit(f"{title} parsed suspiciously short ({len(content)} characters)")
    return {
        "title": title,
        "content": content,
        "firstLine": content.split("\n", 1)[0][:100],
        "section": section,
    }


def parse(input_file):
    lines = Path(input_file).read_text(encoding="utf-8", errors="replace").splitlines()

    # The contents repeats every chapter heading. Start only after the first
    # full-page BOOK I heading, which opens the body of the book.
    body_start = locate(lines, r"BOOK I", 300)
    foreword_start = locate(lines, r"FOREWORD", 0)
    chapter_starts = []
    cursor = body_start
    for numeral, _, _ in CHAPTERS:
        cursor = locate(lines, rf"CHAPTER {numeral}", cursor)
        chapter_starts.append(cursor)
        cursor += 1

    appendix_a = locate(lines, r"APPENDIX A", chapter_starts[-1])
    appendix_b = locate(lines, r"APPENDIX B", appendix_a + 1)
    notes = locate(lines, r"NOTES", appendix_b + 1)

    poems = [entry("Foreword", "Front Matter", lines[foreword_start + 1:body_start])]
    stops = chapter_starts[1:] + [appendix_a]
    for (numeral, title, section), start, stop in zip(CHAPTERS, chapter_starts, stops):
        # Skip the chapter heading and its separate title line.
        title_pattern = re.escape(title).replace("'", "['’]")
        title_line = locate(lines, title_pattern, start + 1)
        poems.append(entry(f"Chapter {numeral} · {title}", section, lines[title_line + 1:stop]))

    appendix_a_title = locate(lines, r"THE LITERATURE OF RAMUS.? LOGIC IN EUROPE", appendix_a + 1)
    appendix_b_title = locate(lines, r"THE FEDERAL SCHOOL OF THEOLOGY", appendix_b + 1)
    poems.append(entry("Appendix A · The Literature of Ramus' Logic in Europe",
                       "Appendices", lines[appendix_a_title + 1:appendix_b]))
    poems.append(entry("Appendix B · The Federal School of Theology",
                       "Appendices", lines[appendix_b_title + 1:notes]))
    return poems


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("input_file", help="Internet Archive djvu.txt OCR file")
    parser.add_argument("-o", "--output", default="poems-new-england-mind.json")
    args = parser.parse_args()

    poems = parse(args.input_file)
    Path(args.output).write_text(
        json.dumps(poems, indent=2, ensure_ascii=False) + "\n", encoding="utf-8"
    )
    print(f"Saved {len(poems)} reading entries to {args.output}")
    for poem in poems:
        print(f"  {poem['title']}: {len(poem['content']):,} characters")
