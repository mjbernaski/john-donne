#!/usr/bin/env python3
"""Generate one resumable visual companion for every bundled poem."""

from __future__ import annotations

import argparse
import json
import os
import re
import random
import time
from pathlib import Path
from urllib.parse import quote
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen

ROOT = Path(__file__).resolve().parent
OUTPUT = ROOT / "poem-images"
ASSETS = OUTPUT / "assets"
MANIFEST = OUTPUT / "manifest.json"
STATE = OUTPUT / "batch-state.json"
DELETIONS = OUTPUT / "deleted.json"
BASE_URL = os.environ.get("POETRY_SERVER_URL", "http://127.0.0.1:8888").rstrip("/")

STYLES = [
    ("Fine-art photograph", "Fine-art cinematic photograph with natural skin and material detail, dramatic practical lighting, shallow depth of field, subtle film grain, and historically plausible staging. It must read unmistakably as a photograph, not a painting."),
    ("Oil painting", "Expressive oil painting on linen with visible brushwork, layered glazes, rich chiaroscuro, museum-quality texture, and a restrained seventeenth-century palette broken by luminous highlights."),
    ("Editorial cartoon", "Sophisticated literary editorial cartoon with bold simplified shapes, witty visual exaggeration, crisp ink contours, selective color, and an intelligent graphic composition; elegant rather than childish."),
    ("Charcoal sketch", "Loose charcoal, graphite, and ink sketch on warm textured paper, energetic searching lines, expressive cross-hatching, smudged shadows, and selective unfinished negative space."),
    ("Warhol-style pop art", "1960s Warhol-style pop-art screen print with a repeated iconic motif, flattened high-contrast forms, off-register ink, halftone texture, and audacious blocks of saturated color."),
    ("Watercolor", "Luminous watercolor painting on cold-pressed paper with transparent washes, blooms of pigment, soft lost edges, restrained detail, and generous areas of untouched paper."),
    ("Linocut print", "Hand-carved linocut print with forceful black-and-ivory shapes, visible gouge marks, compressed perspective, and one sparingly applied accent color."),
    ("Cyanotype", "Experimental cyanotype photogram in deep Prussian blue and ghostly white, with botanical silhouettes, antique paper fibers, solar exposure artifacts, and poetic negative space."),
    ("Surrealist collage", "Dreamlike surrealist collage assembled from antique engravings, astronomical diagrams, torn paper, uncanny changes of scale, and seamless impossible juxtapositions."),
    ("Illuminated manuscript", "Lavish illuminated-manuscript miniature on aged vellum with jewel-like pigments, burnished gold leaf, intricate marginal imagery, and medieval visual symbolism, but absolutely no writing or letterforms."),
    ("Stained glass", "Radiant stained-glass composition with hand-cut colored panes, dark lead came, glowing transmitted light, simplified figures, and richly symbolic jewel tones."),
    ("Japanese woodblock", "Elegant ukiyo-e-inspired Japanese woodblock print with flat mineral colors, graceful contour lines, patterned surfaces, asymmetrical framing, and expressive weather or water."),
    ("Art Nouveau poster", "Ornamental Art Nouveau poster image with sinuous botanical curves, poised figures, decorative borders, muted jewel tones, and flat lithographic color, with no typography or lettering."),
    ("Bauhaus abstraction", "Bauhaus-inspired geometric abstraction using circles, planes, grids, primary accents, disciplined negative space, and a precise visual rhythm that translates the poem into shape."),
    ("Film noir", "Black-and-white film-noir still photographed in hard chiaroscuro, rain-slick atmosphere, deep shadows, expressive silhouettes, oblique camera angles, and fine 35mm grain."),
    ("Renaissance fresco", "Monumental Renaissance fresco with balanced figural composition, architectural perspective, mineral pigments embedded in weathered plaster, and quiet symbolic gestures."),
    ("Paper cutout", "Intricate layered paper-cut diorama with tactile deckled edges, cast shadows between layers, limited colors, delicate silhouettes, and theatrical depth."),
    ("Mosaic", "Hand-laid mosaic made from irregular glass and stone tesserae, shimmering gold pieces, fractured contours, iconic frontal forms, and luminous surface variation."),
    ("Graphic novel", "Dramatic graphic-novel panel with expressive brush-ink shadows, cinematic framing, controlled spot color, dynamic anatomy, and sophisticated sequential-art energy without speech balloons."),
    ("Pastel drawing", "Velvety soft-pastel drawing on dark toothed paper with layered color, powdery edges, vigorous hand marks, atmospheric light, and intimate emotional immediacy."),
    ("Ceramic tableau", "Handmade glazed-ceramic tableau with sculpted figures and symbols, crackled surfaces, pooled glaze, kiln variations, and the tactile charm of an art-object photographed in a studio."),
    ("Retro science fiction", "Retro-futurist 1950s science-fiction paperback cover aesthetic with cosmic scale, airbrushed celestial forms, bold dramatic lighting, aged printing texture, and no title or lettering."),
    ("Embroidery", "Elaborate hand-embroidered textile image with visible silk and metallic threads, varied stitches, dimensional knots, fabric grain, and symbolic motifs arranged like a narrative tapestry."),
    ("Minimalist ink wash", "Contemplative monochrome ink-wash painting with fluid tonal gradients, a few decisive brushstrokes, misty spatial depth, and radical, expressive emptiness."),
    ("Scooby Doo", "Classic Scooby-Doo Saturday-morning animation style: hand-drawn 2D animation cels, bold clean outlines, flat cel shading, expressive faces and poses, elongated cartoon proportions, and richly painted backgrounds in eerie teal, violet, and warm orange. Playful spooky mystery atmosphere with theatrical shadows. Depict the specified literary characters in their own period clothing and setting using this cartoon treatment."),
    ('Ansel Adams', 'Black-and-white fine-art photograph in the style of Ansel Adams, with large-format clarity, deep blacks, luminous whites, finely separated gray tones, crisp textures, dramatic skies, and monumental spatial depth. Use sharp focus across the scene and sculptural natural light. Preserve the specified people, action, and setting.'),
    ('Raphael', 'High Renaissance painting in the style of Raphael, with balanced pyramidal groupings, graceful figures, serene expressive faces, harmonious architectural perspective, clear luminous color, and delicately modeled forms. Render the specified literary scene with classical composure and carefully related gestures.'),
    ('Rembrandt', 'Oil painting in the style of Rembrandt, with warm amber light emerging from deep brown shadows, richly textured impasto highlights, softly dissolved edges, expressive hands, and psychologically attentive faces. Preserve the specified scene and give its figures intimate human presence.'),
    ('Johannes Vermeer', 'Oil painting in the style of Johannes Vermeer, with cool daylight entering from one side, luminous ultramarine and ochre, pearly highlights, finely observed fabric, quiet geometric balance, and meticulous spatial depth. Apply this restrained light and material treatment to the specified scene.'),
    ('Caravaggio', 'Baroque oil painting in the style of Caravaggio, with a single forceful beam of light, deep tenebrist shadows, grounded naturalistic figures, sharply modeled hands and faces, rich dark colors, and dramatic diagonal staging. Keep the specified literary action and relationships clear.'),
    ('Claude Monet', 'Impressionist oil painting in the style of Claude Monet, with broken strokes of luminous color, colored shadows, shimmering atmospheric light, soft contours, and reflections or environmental color appropriate to the setting. Preserve the specified figures and action within the light-filled scene.'),
    ('Vincent van Gogh', 'Post-Impressionist oil painting in the style of Vincent van Gogh, with thick directional impasto, rhythmic curling brushstrokes, vivid complementary colors, emphatic contours, and an emotionally charged surface. Preserve the specified people, actions, and setting while carrying their emotion through color and brushwork.'),
    ('J. M. W. Turner', 'Romantic painting in the style of J. M. W. Turner, with glowing veils of gold and cool blue, sweeping atmospheric motion, dissolving edges, radiant backlight, and dramatic contrasts of scale. Keep the specified figures and narrative action legible within the luminous atmosphere.'),
    ('Katsushika Hokusai', 'Edo-period ukiyo-e woodblock print in the style of Katsushika Hokusai, with precise flowing outlines, flat indigo and mineral colors, bold cropping, rhythmic environmental shapes, and inventive spatial layering. Preserve the specified characters, period clothing, and setting in this printmaking treatment.'),
    ('Alphonse Mucha', 'Art Nouveau illustration in the style of Alphonse Mucha, with elegant sinuous outlines, flattened pastel colors, ornamental botanical framing, intricate fabric patterns, graceful figures, and circular decorative motifs. Preserve the specified scene and arrange the ornament around its actual participants.'),
    ('Gustav Klimt', 'Symbolist painting in the style of Gustav Klimt, with luminous gold-leaf surfaces, jewel-toned mosaic patterns, intricate geometric textiles, flattened ornamental space, and delicately modeled faces and hands. Preserve the specified literary action and relationships within the decorative composition.'),
    ('Edward Hopper', 'Oil painting in the style of Edward Hopper, with strong architectural geometry, spare composition, raking sunlight or isolated practical light, crisp shadow shapes, restrained color, and quietly expressive figures. Preserve the specified era and setting while conveying emotional distance through spacing and light.'),
]

DIRECTIONS = [
    "Center the poem's strongest symbolic image in an intimate, dramatic composition.",
    "Interpret its governing figure of speech as a surprising visual relationship between human figures and the natural world.",
    "Place the emotional argument in a historically plausible setting appropriate to the poet and poem.",
    "Create a more abstract, dreamlike interpretation using light, shadow, scale, and celestial imagery.",
    "Compose a wide, cinematic culmination that unites the poem's major images without becoming a literal collage.",
]


def request_json(path: str, payload: dict | None = None, timeout: int = 300) -> dict:
    data = json.dumps(payload).encode() if payload is not None else None
    req = Request(BASE_URL + path, data=data, headers={"Content-Type": "application/json"} if data else {})
    with urlopen(req, timeout=timeout) as response:
        return json.load(response)


def stable_hash(value: str) -> str:
    value = value.encode("utf-16-le")
    h = 2166136261
    for offset in range(0, len(value), 2):
        code_unit = value[offset] | (value[offset + 1] << 8)
        h = ((h ^ code_unit) * 16777619) & 0xFFFFFFFF
    return format(h, "x")


def atomic_json(path: Path, value: object) -> None:
    temporary = path.with_suffix(path.suffix + ".tmp")
    temporary.write_text(json.dumps(value, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    temporary.replace(path)


def describe(poem: dict, poet: str) -> str:
    text = re.sub(r"\s+", " ", poem["content"]).strip()[:1400]
    payload = request_json("/api/chat/v1/chat/completions", {
        "model": "qwen3-vl-235b",
        "messages": [
            # The figures are dressed and paired here rather than in the trailing
            # rules of the image prompt: the scene text is what the generator
            # actually renders, and it outweighs anything stated after it.
            {"role": "system", "content": "Turn poems into concrete visual scenes. Reply with 40 to 70 words describing only setting, figures, objects, light, weather, and mood. Never quote the poem or mention writing, books, paper, or letters. Use no quotation marks. Name the clothing every figure wears, in period dress that covers shoulders, arms, and legs. Where two figures appear together, make them one man and one woman. Reply with the description only."},
            {"role": "user", "content": f"A poem by {poet} titled {poem['title']}.\n\n{text}"},
        ],
        "temperature": 0.6, "max_tokens": 200, "stream": False,
    })
    return payload["choices"][0]["message"]["content"].replace('"', "").strip()


def make_prompt(scene: str, index: int) -> tuple[str, str]:
    label, style = random.choice(STYLES)
    # The wardrobe and pairing are stated affirmatively and while the figures are
    # still the active subject. FLUX reads the prompt through T5, which has no
    # operator for "no", so a prohibition tends to summon what it forbids; the
    # exclusions themselves reach SDXL as a negative prompt from the proxy instead.
    prompt = (f"{style} The medium above governs the entire image. Subject: {scene} "
              "Every figure wears complete period dress, layered fabric covering shoulders, arms, torso, and legs. "
              "Any couple is one man and one woman. "
              f"{DIRECTIONS[index % len(DIRECTIONS)]} Emotionally intelligent and visually coherent. "
              "Sensuality is carried by gesture, gaze, longing, and atmosphere rather than by skin. "
              "Entirely pictorial composition with clean, unmarked corners and edges. Printed surfaces are blank or face away. "
              "No text, letters, numbers, labels, captions, logos, signatures, watermarks, or interface overlays anywhere. "
              f" Render every part of it as {label}, not as a generic digital illustration or photograph.")
    # The FLUX host writes prompt metadata through a legacy single-byte path.
    # Replace the few unsupported glyphs rather than losing an otherwise valid job.
    prompt = prompt.encode("cp1252", errors="replace").decode("cp1252")
    return label, prompt


def transient(error: Exception) -> bool:
    return isinstance(error, URLError) or (isinstance(error, HTTPError) and error.code >= 500)


def submit(prompt: str) -> str:
    # negative_prompt is left to the proxy, which supplies the shared exclusions
    # when the image host runs SDXL and strips the field when it does not.
    payload = request_json("/api/flux/generate", {"prompt": prompt, "negative_prompt": None, "orientation": "landscape", "size": "0.5mp", "steps": 25, "seed": None, "guidance": None, "batch": 1, "spectrum_grid": False, "spectrum_same_seed": True, "show_preview": False, "save_previews": False, "selected_cells": []})
    if not payload.get("success") or not payload.get("job_id"):
        raise RuntimeError(payload.get("error") or "Image service returned no job ID")
    return payload["job_id"]


def wait_for(job_id: str) -> str:
    while True:
        status = request_json("/api/flux/status", timeout=20)
        done = next((job for job in status.get("recent_done", []) if job.get("id") == job_id), None)
        if done:
            if done.get("state") != "done" or not done.get("images"):
                raise RuntimeError(done.get("error") or f"Job ended as {done.get('state')}")
            return done["images"][0]["filename"]
        time.sleep(2)


def download(filename: str, target: Path) -> None:
    with urlopen(f"{BASE_URL}/api/flux/images/{quote(filename)}", timeout=120) as response:
        target.write_bytes(response.read())


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--collection", action="append", help="Collection id; repeat to select several (default: all bundled collections)")
    parser.add_argument("--limit", type=int, help="Stop after this many newly generated images")
    args = parser.parse_args()
    OUTPUT.mkdir(exist_ok=True); ASSETS.mkdir(exist_ok=True)
    manifest = json.loads(MANIFEST.read_text()) if MANIFEST.exists() else {}
    state = json.loads(STATE.read_text()) if STATE.exists() else {"completed": 0, "failures": {}}
    books = json.loads((ROOT / "books.json").read_text())["books"]
    books = [b for b in books if b.get("poems") and (not args.collection or b["id"] in args.collection)]
    entries = [(book, poem) for book in books for poem in json.loads((ROOT / book["poems"]).read_text())]
    generated = 0
    print(f"Batch contains {len(entries)} poem entries; {len(manifest)} identities already complete.", flush=True)
    for index, (book, poem) in enumerate(entries):
        poem_id = stable_hash(f"{poem['title']}\n{poem['content']}")
        try:
            deleted_poems = set(json.loads(DELETIONS.read_text()))
        except (FileNotFoundError, json.JSONDecodeError, TypeError):
            deleted_poems = set()
        if poem_id in deleted_poems:
            continue
        if manifest.get(poem_id):
            continue
        if args.limit is not None and generated >= args.limit:
            break
        delay = 15
        while True:
            try:
                scene = describe(poem, poem.get("author") or book["poet"])
                label, prompt = make_prompt(scene, index)
                job_id = submit(prompt)
                filename = wait_for(job_id)
                local_name = f"{poem_id}.png"
                download(filename, ASSETS / local_name)
                # Reload before each checkpoint so library deletions made while
                # this long-running batch is active are never written back.
                manifest = json.loads(MANIFEST.read_text()) if MANIFEST.exists() else {}
                manifest[poem_id] = [{"prompt": prompt, "style": label, "status": "done", "filename": f"poem-images/assets/{local_name}"}]
                state["completed"] = state.get("completed", 0) + 1
                state.get("failures", {}).pop(poem_id, None)
                generated += 1
                atomic_json(MANIFEST, manifest); atomic_json(STATE, state)
                print(f"[{index + 1}/{len(entries)}] {book['id']} · {poem['title']}", flush=True)
                break
            except Exception as error:
                state.setdefault("failures", {})[poem_id] = str(error)
                atomic_json(STATE, state)
                if transient(error):
                    print(f"PAUSED {book['id']} · {poem['title']}: {error}; retrying in {delay}s", flush=True)
                    time.sleep(delay)
                    delay = min(delay * 2, 300)
                    continue
                print(f"ERROR {book['id']} · {poem['title']}: {error}", flush=True)
                break


if __name__ == "__main__":
    main()
