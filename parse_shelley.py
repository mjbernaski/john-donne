#!/usr/bin/env python3
"""Parse Gutenberg ebook 4800 into the collection format used by the site.

The plain-text Oxford Shelley is divided into three volumes. Gutenberg uses a
line containing three asterisks for most work boundaries; the parser treats
those as the primary structure, tracks the year/translation/juvenilia groups,
and splits the largest canto- and act-based works into practical reading units.
Editorial introductions and textual notes are intentionally omitted.
"""
import argparse
import json
import re
from collections import Counter
from pathlib import Path


START_MARKER = "*** START OF THE PROJECT GUTENBERG EBOOK"
END_MARKER = "*** END OF THE PROJECT GUTENBERG EBOOK"
DIVIDER_RE = re.compile(r"(?m)^\*\*\*[ \t]*$")
LINE_NUMBER_RE = re.compile(r"[ \t]+_\d+[a-z]?(?:-\d+)?_?[ \t]*$", re.I)
NOTE_HEADING_RE = re.compile(r"^NOTES?:[ \t]*$", re.M | re.I)
RESUME_AFTER_NOTE_RE = re.compile(
    r"\n{2,}(?=(?:SCENE(?: [^\n]+)?|[A-Z][A-Z .’'—-]{2,}:|\d+\.—|"
    r"[A-Z][A-Z .’'—-]{3,}\.)[ \t]*\n)"
)
SPLITTABLE = {
    "THE DAEMON OF THE WORLD.": "PART",
    "THE REVOLT OF ISLAM.": "CANTO",
    "PROMETHEUS UNBOUND.": "ACT",
    "THE CENCI.": "ACT",
}
SKIP_PREFIXES = (
    "CONTENTS", "EDITOR’S PREFACE", "PREFACE BY MRS. SHELLEY",
    "MRS. SHELLEY’S PREFACE", "POSTSCRIPT", "NOTE ON ", "NOTE BY ",
    "NOTES ON ", "A LIST OF THE PRINCIPAL EDITIONS", "INDEX OF FIRST LINES",
)
VOLUME_RE = re.compile(r"THE COMPLETE\s+POETICAL WORKS\s+OF\s+PERCY BYSSHE SHELLEY", re.I)
YEAR_RE = re.compile(r"^POEMS WRITTEN IN (18\d{2})\.?$")
REPEATED_BODY_HEADINGS = {
    "ALASTOR: OR, THE SPIRIT OF SOLITUDE.": "ALASTOR: OR, THE SPIRIT OF SOLITUDE.",
    "HELLAS": "HELLAS.",
    "THE CYCLOPS.": "THE CYCLOPS.",
}


def normalized_lines(text):
    return text.replace("\r\n", "\n").replace("\r", "\n").splitlines()


def clean_body(text):
    """Remove source apparatus while retaining verse layout and headings."""
    text = text.strip()
    # Bibliographical notices are balanced bracketed paragraphs at the start
    # of nearly every work. Count delimiters rather than stopping at the first
    # closing bracket: several notices contain brackets of their own.
    def drop_leading_brackets(value):
        value = value.lstrip()
        if not value.startswith("["):
            return value, False
        depth = 0
        end = None
        for index, char in enumerate(value):
            if char == "[":
                depth += 1
            elif char == "]":
                depth -= 1
                if depth == 0:
                    end = index + 1
                    break
        if end is None:
            return value, False
        return value[end:].lstrip(), True

    while True:
        text, changed = drop_leading_brackets(text)
        if not changed:
            break
    # Short parenthetical editorial notices occur in the same position.
    if re.match(r"^\((?:Composed|Published|This (?:fragment|poem)|Perhaps|The idea)", text, re.I):
        depth = 0
        for index, char in enumerate(text):
            if char == "(":
                depth += 1
            elif char == ")":
                depth -= 1
                if depth == 0:
                    text = text[index + 1:].lstrip()
                    break
    while True:
        text, changed = drop_leading_brackets(text)
        if not changed:
            break
    editorial_note = re.search(r"(?m)^NOTE (?:ON|BY) [^\n]+$", text)
    if editorial_note:
        text = text[:editorial_note.start()]
    # Variant notes sometimes interrupt a drama and sometimes close a poem.
    # Resume at an unmistakable speaker/scene/title; otherwise the note block
    # is trailing apparatus and everything after its heading can be dropped.
    while True:
        note = NOTE_HEADING_RE.search(text)
        if not note:
            break
        resume = RESUME_AFTER_NOTE_RE.search(text, note.end())
        if resume:
            text = text[:note.start()] + text[resume.end():]
        else:
            text = text[:note.start()]
    lines = []
    for line in normalized_lines(text):
        line = LINE_NUMBER_RE.sub("", line).rstrip()
        lines.append(line)
    text = "\n".join(lines).strip()
    return re.sub(r"\n{4,}", "\n\n\n", text)


def make_entry(title, content, section):
    content = clean_body(content)
    if not content:
        return None
    first_line = next((line.strip() for line in content.splitlines() if line.strip()), "")
    display_title = title.title().replace("’S", "’s")
    entry = {"title": display_title, "content": content, "firstLine": first_line[:100]}
    if section:
        entry["section"] = section
    return entry


def split_long_work(title, body, label, section):
    marker = re.compile(rf"(?m)^{label} (\d+)\.[ \t]*$")
    matches = list(marker.finditer(body))
    if len(matches) < 2:
        return [make_entry(title, body, section)]
    entries = []
    for index, match in enumerate(matches):
        end = matches[index + 1].start() if index + 1 < len(matches) else len(body)
        number = match.group(1)
        entries.append(make_entry(
            f"{title.rstrip('.')} · {label.title()} {number}",
            body[match.end():end],
            title.title(),
        ))
    return entries


def parse(source_text):
    start = source_text.index(START_MARKER)
    start = source_text.index("\n", start) + 1
    end = source_text.index(END_MARKER, start)
    chunks = DIVIDER_RE.split(source_text[start:end])
    poems = []
    section = "Major Works"

    for chunk in chunks:
        chunk = chunk.strip()
        if not chunk or VOLUME_RE.search(chunk[:300]):
            continue
        lines = normalized_lines(chunk)
        while lines and not lines[0].strip():
            lines.pop(0)
        if not lines:
            continue
        heading = lines[0].strip()

        year = YEAR_RE.match(heading)
        if year:
            section = f"Poems of {year.group(1)}"
            lines.pop(0)
            while lines and not lines[0].strip():
                lines.pop(0)
            if not lines:
                continue
            heading = lines[0].strip()
        elif heading == "EARLY POEMS [1814, 1815].":
            section = "Early Poems, 1814–1815"
            continue
        elif heading == "TRANSLATIONS.":
            section = "Translations"
            continue
        elif heading == "JUVENILIA.":
            section = "Juvenilia"
            lines.pop(0)
            while lines and not lines[0].strip():
                lines.pop(0)
            if not lines:
                continue
            heading = lines[0].strip()

        if heading.startswith("[") or heading.startswith(SKIP_PREFIXES):
            continue

        lines.pop(0)
        body = "\n".join(lines).strip()
        repeated = REPEATED_BODY_HEADINGS.get(heading)
        if repeated:
            match = re.search(rf"(?m)^{re.escape(repeated)}[ \t]*$", body)
            if match:
                body = body[match.end():].lstrip()
        # The first Adonais chunk is its preface; the following chunk contains
        # the elegy itself and receives the actual collection entry.
        if heading == "ADONAIS." and re.search(r"(?m)^PREFACE\.[ \t]*$", body):
            continue
        if heading in SPLITTABLE:
            poems.extend(split_long_work(heading, body, SPLITTABLE[heading], section))
        else:
            poems.append(make_entry(heading, body, section))

    poems = [poem for poem in poems if poem and len(poem["content"]) >= 10]

    # Several intentionally anonymous lyrics share a printed title. Stable,
    # visible suffixes keep cards and saved-session identities unambiguous.
    totals = Counter(poem["title"] for poem in poems)
    seen = Counter()
    for poem in poems:
        title = poem["title"]
        if totals[title] > 1:
            seen[title] += 1
            poem["title"] = f"{title} ({seen[title]})"
    return poems


def validate(poems):
    titles = [poem["title"] for poem in poems]
    if len(poems) < 200:
        raise ValueError(f"Expected at least 200 reading entries, found {len(poems)}")
    if len(titles) != len(set(titles)):
        raise ValueError("Generated titles are not unique")
    required = ("Ozymandias.", "Ode To The West Wind.", "To A Skylark.")
    missing = [title for title in required if title not in titles]
    if missing:
        raise ValueError(f"Missing representative poems: {', '.join(missing)}")
    forbidden = ("PROJECT GUTENBERG", "INDEX OF FIRST LINES", "EDITOR’S PREFACE")
    corpus = "\n".join(poem["content"] for poem in poems)
    found = [text for text in forbidden if text in corpus]
    if found:
        raise ValueError(f"Editorial/source material leaked into poems: {', '.join(found)}")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("input_file", help="Gutenberg plain text for ebook 4800")
    parser.add_argument("-o", "--output", default=str(Path(__file__).parent / "poems-shelley.json"))
    args = parser.parse_args()
    source = Path(args.input_file).read_text(encoding="utf-8-sig", errors="replace")
    poems = parse(source)
    validate(poems)
    Path(args.output).write_text(json.dumps(poems, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    print(f"Saved {len(poems)} Shelley entries to {args.output}")
