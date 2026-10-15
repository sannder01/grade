"""Render the README's explanatory diagram, not a recording of the website.

Requires Python 3 and Pillow (tested with Pillow 10.2).
Run from any directory: python3 docs/render-flow.py
Optional font override: GRADE_DOCS_FONT_DIR=/path/to/dejavu/fonts
"""

from pathlib import Path
import math
import os

from PIL import Image, ImageDraw, ImageFont


ROOT = Path(__file__).resolve().parent
ASSETS = ROOT / "assets"
FONT_DIR = Path(os.environ.get("GRADE_DOCS_FONT_DIR", "/usr/share/fonts/truetype/dejavu"))
WIDTH, HEIGHT = 1120, 400
BG = "#111312"
SURFACE = "#1b201b"
LINE = "#343d31"
TEXT = "#eff2e8"
MUTED = "#9ca892"
LIME = "#d6ec89"
BLUE = "#9dbde7"
BOXES = [(40, 166, 316, 294), (422, 166, 698, 294), (804, 166, 1080, 294)]


def font(size, mono=False, bold=False):
    family = "DejaVuSansMono" if mono else "DejaVuSans"
    filename = family + ("-Bold" if bold else "") + ".ttf"
    return ImageFont.truetype(str(FONT_DIR / filename), size)


def arrow(draw, start, end, y, color):
    draw.line((start, y, end, y), fill=color, width=2)
    sign = 1 if end > start else -1
    draw.line((end - sign * 5, y - 4, end, y, end - sign * 5, y + 4), fill=color, width=2)


def frame_at(progress, static=False):
    image = Image.new("RGB", (WIDTH, HEIGHT), BG)
    draw = ImageDraw.Draw(image)
    draw.rounded_rectangle((1, 1, WIDTH - 2, HEIGHT - 2), 28, outline=LINE, width=2)
    draw.text((39, 20), "grade", font=font(52, bold=True), fill=TEXT)
    center = (235, 57)
    for index in range(8):
        angle = index * math.pi / 4
        draw.line((center[0] + math.cos(angle) * 7, center[1] + math.sin(angle) * 7,
                   center[0] + math.cos(angle) * 18, center[1] + math.sin(angle) * 18), fill=LIME, width=3)
    draw.text((815, 45), "CODE WALKTHROUGH", font=font(16, mono=True), fill=MUTED)
    draw.text((40, 105), "Один запрос. Три слоя.", font=font(28, bold=True), fill=TEXT)
    draw.line((40, 321, 1080, 321), fill=LINE)

    stage = min(int(progress * 6), 5)
    active = [0, 1, 2, 1, 0, 0][stage]
    returning = stage in (3, 4)
    accent = BLUE if returning else LIME
    labels = [
        ("Браузер", "public/app.js", "navigate()  /  render()"),
        ("Express API", "server/app.mjs", "GET /api/catalog"),
        ("PostgreSQL", "server/catalog.mjs", "query()  /  server/db.mjs"),
    ]
    for index, (box, lines) in enumerate(zip(BOXES, labels)):
        x1, y1, x2, y2 = box
        color = LIME if static else accent if index == active else LINE
        draw.rounded_rectangle(box, 23, fill=SURFACE, outline=color, width=2)
        draw.text((x1 + 21, y1 + 18), lines[0], font=font(23, bold=True), fill=TEXT)
        draw.text((x1 + 21, y1 + 61), lines[1], font=font(17, mono=True), fill=LIME)
        draw.text((x1 + 21, y1 + 91), lines[2], font=font(14, mono=True), fill=MUTED)

    for start, end in [(316, 422), (698, 804)]:
        arrow(draw, start + 12, end - 12, 211, LINE)
        arrow(draw, end - 12, start + 12, 253, LINE)
    if stage in (1, 2, 3, 4) and not static:
        pairs = {1: (328, 410, 211), 2: (710, 792, 211), 3: (792, 710, 253), 4: (410, 328, 253)}
        start, end, y = pairs[stage]
        local = progress * 6 - stage
        eased = (1 - math.cos(local * math.pi)) / 2
        x = start + (end - start) * eased
        draw.ellipse((x - 5, y - 5, x + 5, y + 5), fill=accent)

    captions = [
        "01  Переход в каталог",
        "02  Браузер отправляет запрос API",
        "03  Сервер читает данные из базы",
        "04  Результат SQL становится JSON",
        "05  Браузер получает ответ",
        "06  render() обновляет карточки",
    ]
    caption = "Браузер → API → SQL → JSON → карточки" if static else captions[stage]
    draw.text((40, 345), caption, font=font(20), fill=TEXT)
    draw.text((905, 348), "GRADE / CODE", font=font(15, mono=True), fill=MUTED)
    return image


def main():
    ASSETS.mkdir(parents=True, exist_ok=True)
    frame_at(0, static=True).save(ASSETS / "request-flow.png", optimize=True)
    # A shared palette avoids color flicker; only small parts change per frame.
    sample = Image.new("RGB", (WIDTH, HEIGHT * 3))
    for index, progress in enumerate([0, .4, .6]):
        sample.paste(frame_at(progress), (0, HEIGHT * index))
    palette = sample.resize((840, 900)).quantize(colors=128)
    frames = [frame_at(index / 108).resize((840, 300), Image.Resampling.LANCZOS)
              .quantize(palette=palette, dither=Image.Dither.NONE) for index in range(108)]
    frames[0].save(ASSETS / "request-flow.gif", save_all=True, append_images=frames[1:],
                   duration=70, loop=0, optimize=True, disposal=1)
    for name in ["request-flow.gif", "request-flow.png"]:
        path = ASSETS / name
        print(f"{path.relative_to(ROOT.parent)}: {path.stat().st_size:,} bytes")


if __name__ == "__main__":
    main()
