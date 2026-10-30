#!/usr/bin/env python3
"""Import Bayard Taylor's Faust: Gutenberg 14591 and Wikisource Part Two.

Download the HTML sources into a directory, then pass that directory to this
script. Part One must be named part-one.html; Part Two files use Act_I-I.html,
etc. The import performs no speech generation.
"""
import argparse
from html.parser import HTMLParser
import json
from pathlib import Path
import re

PART_ONE = 'https://www.gutenberg.org/files/14591/14591-h/14591-h.htm'
PART_TWO = 'https://en.wikisource.org/wiki/Faust_(trans._Bayard_Taylor)/'
ROMANS = ['I', 'II', 'III', 'IV', 'V', 'VI', 'VII']
PATHS = ([f'Act_I/{s}' for s in ROMANS] + ['Act_II/I', 'Act_II/II']
         + [f'Act_II/III/{s}' for s in ROMANS[:5]] + ['Act_III']
         + [f'Act_IV/{s}' for s in ROMANS[:3]] + [f'Act_V/{s}' for s in ROMANS])

class Blocks(HTMLParser):
    def __init__(self, wiki=False):
        super().__init__()
        self.wiki = wiki
        self.stack = []
        self.blocks = []
        self.chunks = []
        self.tag = None
        self.active = False
    def handle_starttag(self, tag, attrs):
        attrs = dict(attrs)
        classes = attrs.get('class', '').split()
        parent_active = self.stack[-1][1] if self.stack else False
        parent_skip = self.stack[-1][2] if self.stack else False
        active = parent_active or 'prp-pages-output' in classes
        skip = parent_skip or tag in ('style', 'script', 'sup') or any(c in classes for c in ('pagenum', 'ws-noexport', 'mw-editsection'))
        if tag not in ('br', 'img', 'hr', 'link', 'meta', 'input', 'wbr'):
            self.stack.append((tag, active, skip))
        if self.wiki:
            if active and not skip and tag in ('br', 'p', 'div', 'h2', 'h3'): self.chunks.append('\n')
        elif tag in ('h2', 'p'):
            self.tag = tag
            self.chunks = []
        elif tag == 'br' and self.tag: self.chunks.append('\n')
    def handle_data(self, data):
        if self.wiki:
            if self.stack and self.stack[-1][1] and not self.stack[-1][2]: self.chunks.append(data)
        elif self.tag: self.chunks.append(re.sub(r'\s+', ' ', data))
    def handle_endtag(self, tag):
        if self.wiki:
            if self.stack and self.stack[-1][1] and not self.stack[-1][2] and tag in ('p', 'div', 'h2', 'h3'): self.chunks.append('\n')
        elif tag == self.tag:
            self.blocks.append((tag, clean(''.join(self.chunks))))
            self.tag = None
        for i in range(len(self.stack)-1, -1, -1):
            if self.stack[i][0] == tag:
                del self.stack[i:]
                break

def clean(text):
    text = text.replace('\u200b', '').replace('\xa0', ' ')
    lines = [re.sub(r'[ \t]+', ' ', line).strip() for line in text.splitlines()]
    return re.sub(r'\n{3,}', '\n\n', '\n'.join(lines)).strip()


# Explicit source labels prevent short verse lines from being mistaken for roles.
SPEAKERS = {name.upper() for name in """
Manager|Poet|Merry-Andrew|Merry Andrew|Raphael|Gabriel|Michael|The Three|The Lord|
Mephistopheles|Faust|Wagner|Spirit|Chorus|Chorus of Angels|Chorus of Women|
Chorus of Disciples|Chorus of Spirits|Several Apprentices|Others|The First|
An Apprentice|Second Apprentice|The Others|A Third|A Fourth|A Fifth|Servant-Girl|
Another|The Other|A Student|Citizen’s Daughter|Second Student|Citizen|Beggar|
Another Citizen|Third Citizen|Soldiers|Old Peasant|Peasants, under the Linden-Tree|
Spirits|Will-o’-the Wisps|Proteus-Dolphin|All Together|Student|Frosch|Brander|Siebel|Altmayer|The Animals|The He-Ape|He-Ape and She-Ape|
The Witch|Margaret|Martha|Lisbeth|Valentine|Evil Spirit|Will-o’-the-Wisp|
Chorus of Witches|Witches|Wizards|Half-Witch|Huckster-Witch|Young Witch|Old Witch|
General|Minister|Parvenu|Author|Leader of the Band|Inquisitive Traveller|
Proktophantasmist|The Fair One|The Young One|The Old One|Crane|Oberon|Titania|
Puck|Ariel|Orchestra|Solo|Spirit, just growing into form|A Little Couple|
Northern Artist|Purist|Weathercock|Hennings|Musagetes|Ci-devant Genius of the Age|
Inquisitive Traveller|Orthodox|Servibilis|The Adroit|The Awkward|The Heavy Fellows|
Good Fellow|Dancer|Dancing-Master|Fiddler|Dogmatist|Idealist|Realist|
Supernaturalist|Sceptic|Worldling|Matron|Old Woman|Both Choruses|Other Semichorus|
Xenies|Shooting-Star|Voice|A Voice|All|
Emperor|The Emperor|Squire|Second Squire|Murmurs of the Crowd|Chancellor|
General-in-Chief|Treasurer|Lord High Steward|Murmurs|Astrologer|Herald|
Garden-Girls|Olive Branch, with Fruit|Wreath of Ears|Fancy Wreath|Fancy Nosegay|
Challenge|Rosebuds|Gardeners|Mother and Daughter|Mother|Wood-Cutters|Pulcinelli|
Parasites|Drunken Man|Satirist|The Graces|Aglaia|Hegemone|Euphrosyne|The Parcæ|
Atropos|Clotho|Lachesis|Alecto|Megæra|Tisiphone|Fear|Hope|Prudence|Zoïlo-Thersites|
Boy Charioteer|Plutus|Chatter of Women|The Starveling|Leader of the Women|
Crowd of Women|Alternate Cries of the Crowd|Cries and Crowding|Avarice|
Tumult and Song|Savage Song|Fauns|Satyr|Gnomes|Giants|Nymphs in Chorus|
Deputation of Gnomes|Page|A Second|Chamberlain|Knight Banneret|Fool|A Blonde|
A Brunette|The Brunette|Lady|The Lady|Architect|A Third|A Fourth|A Fifth|A Sixth|
Knight|Young Lady|Older Lady|Oldest Lady|Younger Lady|Diplomatist|Courtier|
Duenna|A Learned Man|Chorus of Insects|Famulus|Baccalaureus|Homunculus|Erichtho|
Griffin|Ants|The Griffins|The Arimaspeans|Sphinx|First Griffin|Second Griffin|
Both|Sirens|Sphinxes|Peneus|Nymphs|Chiron|Manto|Seismos|Chorus of Emmets|
Griffins|Pygmies|Dactyls|Pygmy-Elders|Generalissimo|Emmets and Dactyls|
The Cranes of Ibycus|Lamiæ|Empusa|Oread|Anaxagoras|Thales|Dryad|The Phorkyads|
Nereus|Tritons|Nereids and Tritons|Telchines|Telchines of Rhodes|Proteus|Galatea|
Dorides|The Youths|Psylli and Marsi|Helena|Panthalis|Leader of the Chorus|
Phorkyas|Choterid I|Choterid II|Choterid III|Choterid IV|Choterid V|Choretid VI|
Lynceus, the Warder of the Tower|Lynceus|Euphorion|Helena and Faust|Maiden|
Helena, Faust, and Chorus|The Above|A Part of the Chorus|A Second Part|
A Third Part|A Fourth Part|Bully|Havequick|Holdfast|First Spy|Second Spy|Heralds|
Speedbooty|Guardsmen|First Guardsman|Second|Third|Fourth|Arch-Marshal|
Arch-Chamberlain|Arch-High-Steward|Arch Cup-Bearer|Archbishop|Arch-Chancellor|
Wanderer|Baucis|Philemon|Lynceus, the Warder|Warder|The Three Mighty Men|
The Mighty Men|Mephistopheles and the Three|First|Three Together|Want|Guilt|
Necessity|Care|Lemures|Lemur|The Heavenly Host|Angels|Chorus and Echo|
Pater Ectatiscus|Pater Profundis|Pater Seraphicus|Chorus of Blessed Boys|
The Younger Angels|The More Perfect Angels|The Blessed Boys|Doctor Marianus|
Chorus of Women Penitentes|Magna Peccatrix|Mulier Samaritana|Maria Ægyptiaca|
Una Pœnitentium|Blessed Boys|The Peninent|Mater Gloriosa|Chorus Mysticus
""".replace('\n', '').split('|')}
ALIASES = {'MERRY ANDREW': 'MERRY-ANDREW', 'THE EMPEROR': 'EMPEROR',
           'LYNCEUS, THE WARDER': 'LYNCEUS', 'LYNCEUS, THE WARDER OF THE TOWER': 'LYNCEUS',
           'UNA PŒNITENTIUM': 'MARGARET', 'THE PENINENT': 'MARGARET'}

def performance_cues(content):
    """Split source-labelled turns, keeping directions in their source order."""
    turns = []
    speaker = 'NARRATOR'
    depth = 0
    def append(role, text):
        text = text.strip()
        if not text or not re.search(r"\w", text): return
        if turns and turns[-1]['speaker'] == role:
            turns[-1]['text'] += '\n' + text
        else:
            turns.append(dict(speaker=role, text=text))
    for raw in content.splitlines():
        line = raw.strip()
        if not line:
            # Taylor often leaves square-bracket directions unclosed. Their
            # paragraph boundary still ends the stage business.
            depth = 0
            continue
        # Cast entrances and bare scene business are narration, not dialogue.
        cast_line = line.rstrip('.')
        if (re.fullmatch(r'(?:FAUST|MEPHISTOPHELES|WAGNER|MARGARET)(?:[ ,]+(?:AND |and )?(?:FAUST|MEPHISTOPHELES|WAGNER|MARGARET|WILL-O’-THE-WISP))+', cast_line)
                or line in {'Faust. Mephistopheles.', 'Havequick. Speedbooty.',
                            'Mephistopheles. The Three Mighty Men.',
                            'Emperor. General-in-Chief. Life-Guardsman.',
                            'Pause.', 'Complete pause. The music ceases.', 'Trumpets.',
                            'The Three enter.', 'Sepulture'}):
            append('NARRATOR', line)
            continue
        # Labels may be followed by a period, direction, or dialogue on the same line.
        match = re.match(r'^([^.(\[]+)(.*)$', line)
        name = match[1].strip().upper() if match else ''
        if not depth and name in SPEAKERS:
            speaker = ALIASES.get(name, name)
            line = match[2].lstrip('. ').strip()
            if not line: continue
        # Parenthetical and bracketed stage business interrupts, but does not
        # change, the current character. A direction can span several lines.
        start = 0
        for i, char in enumerate(line):
            if char in '([':
                if not depth:
                    append(speaker, line[start:i])
                    start = i
                depth += 1
            elif char in ')]' and depth:
                depth -= 1
                if not depth:
                    append('NARRATOR', line[start:i+1])
                    start = i+1
        append('NARRATOR' if depth else speaker, line[start:])
    return turns

def entry(title, section, content, url):
    if len(content) < 100: raise ValueError('Missing scene: ' + title)
    return dict(title=title, section=section, content=content,
                firstLine=next(line for line in content.splitlines() if line.strip())[:100], sourceUrl=url, performance=performance_cues(content))

def parse_one(html):
    parser = Blocks(); parser.feed(html)
    entries = []; title = None; paragraphs = []; started = False
    def finish():
        if title and paragraphs:
            entries.append(entry(title, 'Part One' if title.startswith('Scene ') else 'Opening', '\n\n'.join(paragraphs), PART_ONE))
        paragraphs.clear()
    for tag, value in parser.blocks:
        if tag == 'h2':
            value = ' '.join(value.split())
            finish()
            title = None
            if value == 'DEDICATION': started = True
            if not started: continue
            if value in ('DEDICATION', 'PRELUDE AT THE THEATRE', 'PROLOGUE IN HEAVEN'):
                title = value.title()
            elif re.fullmatch(r'[IVX]+', value): title = 'Scene ' + value
        elif title and value:
            if title.startswith('Scene ') and not paragraphs:
                heading = value.splitlines()[0]
                title += ' · ' + heading.title()
            paragraphs.append(value)
    finish()
    if len(entries) != 28: raise ValueError(f'Expected 3 openings and 25 scenes; got {len(entries)}')
    if 'Margaret' not in entries[-1]['content'] and 'MARGARET' not in entries[-1]['content']: raise ValueError('Missing dungeon ending')
    return entries

def parse_two(directory):
    entries = []
    for path in PATHS:
        parser = Blocks(wiki=True)
        parser.feed((directory / (path.replace('/', '-') + '.html')).read_text())
        text = clean(''.join(parser.chunks))
        act = path.split('/')[0].replace('_', ' ')
        lines = text.splitlines()
        heading = next((line for line in lines if line and not re.fullmatch(r'[IVX]+\.', line)), 'Helena')
        title = ('Helena' if path == 'Act_III' else heading.rstrip('.').title().replace('’S', '’s'))
        title = {'Act_V/III': 'Palace', 'Act_V/VII': 'Mountain-Gorges, Forest, Rock, Desert'}.get(path, title)
        entries.append(entry(title, 'Part Two · ' + act, text, PART_TWO + path))
    if 'Eternal' not in entries[-1]['content']: raise ValueError('Missing final chorus')
    return entries

if __name__ == '__main__':
    cli = argparse.ArgumentParser(description=__doc__)
    cli.add_argument('sources', type=Path)
    cli.add_argument('-o', '--output', type=Path, default=Path('poems-goethe-faust.json'))
    args = cli.parse_args()
    entries = parse_one((args.sources / 'part-one.html').read_text()) + parse_two(args.sources)
    args.output.write_text(json.dumps(entries, ensure_ascii=False, indent=2) + '\n')
    print(f'Imported {len(entries)} sections, {sum(len(e["content"]) for e in entries):,} characters.')
