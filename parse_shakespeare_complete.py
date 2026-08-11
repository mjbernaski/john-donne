#!/usr/bin/env python3
"""Build an app collection from the Project Gutenberg Complete Shakespeare JSON.

The source JSON is produced by the companion ``mjbernaski/shakespeare`` repo.
Plays are divided at scene boundaries, the 154 sonnets remain individual
entries, and each remaining poem is kept whole. Together the entries preserve
the complete body of every work without forcing a reader to open an entire
play in one modal.
"""
import argparse
import json
import re
from pathlib import Path


START_MARKER = "*** START OF THE PROJECT GUTENBERG EBOOK"
END_MARKER = "*** END OF THE PROJECT GUTENBERG EBOOK"
ACT_RE = re.compile(r"(?m)^ACT ([IVXLC]+)\.?[ \t]*\r?$")
SCENE_RE = re.compile(r"(?m)^SCENE ([IVXLC]+)\.?(?:[ \t]+[^\r\n]*)?[ \t]*\r?$")
SONNET_RE = re.compile(r"(?m)^ {10,}(\d{1,3})[ \t]*\r?$")


def line_end_after(text, position):
    end = text.find("\n", position)
    return len(text) if end == -1 else end + 1


def contents_titles(text):
    match = re.search(r"(?m)^[ \t]+Contents[ \t]*\r?$", text)
    if not match:
        raise ValueError("Could not find the contents heading")
    titles = []
    cursor = line_end_after(text, match.end())
    while cursor < len(text):
        end = line_end_after(text, cursor)
        line = text[cursor:end].strip()
        if line:
            titles.append(line)
        elif titles:
            while cursor < len(text) and not text[cursor:line_end_after(text, cursor)].strip():
                cursor = line_end_after(text, cursor)
            return titles, cursor
        cursor = end
    raise ValueError("Contents list did not terminate")


def work_ranges(text, titles, search_from, body_end):
    starts = []
    cursor = search_from
    for title in titles:
        match = re.search(rf"(?m)^{re.escape(title)}[ \t]*\r?$", text[cursor:body_end])
        if not match:
            raise ValueError(f"Could not locate work: {title}")
        start = cursor + match.start()
        starts.append(start)
        cursor = line_end_after(text, start)
    return [(title, start, starts[i + 1] if i + 1 < len(starts) else body_end)
            for i, (title, start) in enumerate(zip(titles, starts))]


def clean(text):
    return text.replace("\r\n", "\n").strip()


def entry(title, content, section):
    content = clean(content)
    first_line = next((line.strip() for line in content.splitlines() if line.strip()), "")
    return {"title": title, "content": content, "firstLine": first_line[:100], "section": section}


def parse(source):
    text = source["text"]
    body_start = line_end_after(text, text.index(START_MARKER))
    body_end = text.index(END_MARKER, body_start)
    titles, after_contents = contents_titles(text[body_start:body_end])
    works = work_ranges(text, titles, body_start + after_contents, body_end)
    poems = []

    for work, start, end in works:
        work_text = text[start:end]
        if work == "THE SONNETS":
            sonnets = list(SONNET_RE.finditer(text, start, end))
            if len(sonnets) != 154:
                raise ValueError(f"Expected 154 sonnets, found {len(sonnets)}")
            for index, match in enumerate(sonnets):
                finish = sonnets[index + 1].start() if index + 1 < len(sonnets) else end
                number = int(match.group(1))
                poems.append(entry(f"Sonnet {number}", text[match.start():finish], "The Sonnets"))
            continue

        scenes = list(SCENE_RE.finditer(text, start, end))
        if not scenes:
            poems.append(entry(work.title(), work_text, "Poems"))
            continue

        if start < scenes[0].start():
            poems.append(entry(f"{work.title()} · Dramatis Personae", text[start:scenes[0].start()], work.title()))
        acts = list(ACT_RE.finditer(text, start, end))
        for index, scene in enumerate(scenes):
            finish = scenes[index + 1].start() if index + 1 < len(scenes) else end
            prior_acts = [act for act in acts if act.start() <= scene.start()]
            act = prior_acts[-1].group(1) if prior_acts else "?"
            scene_number = scene.group(1)
            poems.append(entry(
                f"{work.title()} · Act {act}, Scene {scene_number}",
                text[scene.start():finish],
                work.title(),
            ))
    return poems


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("input_file", help="shakespeare_complete.json from mjbernaski/shakespeare")
    parser.add_argument("-o", "--output", default=str(Path(__file__).parent / "poems-shakespeare-complete.json"))
    args = parser.parse_args()
    source = json.loads(Path(args.input_file).read_text(encoding="utf-8"))
    poems = parse(source)
    Path(args.output).write_text(json.dumps(poems, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    print(f"Saved {len(poems)} entries to {args.output}")
