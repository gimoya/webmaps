#!/usr/bin/env python3
"""Build Legacy Trails favicons: Trade Winds LT, vert-stretched, faux-bold, shadow, transparent."""
from __future__ import annotations

from pathlib import Path

from fontTools.ttLib import TTFont
from fontTools.pens.boundsPen import BoundsPen
from fontTools.pens.svgPathPen import SVGPathPen
from fontTools.pens.transformPen import TransformPen
from PIL import Image, ImageDraw, ImageFont, ImageFilter

ROOT = Path(__file__).resolve().parent
FONT_PATH = ROOT / "TradeWinds-Regular.ttf"
OUT = ROOT.parent
BG = (0, 0, 0, 0)
CYAN = (0, 185, 254, 255)
# Trade Winds has no Bold — light thicken via stroke
STROKE_VIEW = 1.2  # SVG stroke width in viewBox units
STROKE_FRAC = 0.022  # PNG stroke vs canvas


def glyph_bounds(font: TTFont, text: str):
	glyph_set = font.getGlyphSet()
	cmap = font.getBestCmap()
	glyphs = []
	x = 0
	for ch in text:
		name = cmap[ord(ch)]
		g = glyph_set[name]
		bp = BoundsPen(glyph_set)
		g.draw(bp)
		glyphs.append((name, g, bp.bounds, x, g.width))
		x += g.width
	return glyphs, x


def letter_paths(ox: float, oy: float, sx: float, sy: float) -> list[str]:
	font = TTFont(str(FONT_PATH))
	glyph_set = font.getGlyphSet()
	glyphs, _ = glyph_bounds(font, "LT")
	paths = []
	for name, g, bounds, gx, gw in glyphs:
		pen = SVGPathPen(glyph_set)
		tp = TransformPen(pen, (sx, 0, 0, -sy, ox + gx * sx, oy))
		g.draw(tp)
		d = pen.getCommands()
		if d:
			paths.append(d)
	return paths


def build_svg_master() -> str:
	font = TTFont(str(FONT_PATH))
	glyphs, _ = glyph_bounds(font, "LT")

	min_x = min_y = max_x = max_y = None
	for name, g, bounds, gx, gw in glyphs:
		if not bounds:
			continue
		x0, y0, x1, y1 = bounds
		x0 += gx
		x1 += gx
		min_x = x0 if min_x is None else min(min_x, x0)
		min_y = y0 if min_y is None else min(min_y, y0)
		max_x = x1 if max_x is None else max(max_x, x1)
		max_y = y1 if max_y is None else max(max_y, y1)

	# Room for stroke + shadow outside glyph bbox
	pad_ink = STROKE_VIEW / 2 + 2.2
	margin = 100 * 3 / 192
	ink_w = (max_x - min_x) + 2 * pad_ink
	ink_h = (max_y - min_y) + 2 * pad_ink
	usable = 100 - 2 * margin
	sx = usable / ink_w
	sy = usable / ink_h

	ox = margin + pad_ink * sx - min_x * sx
	oy = margin + pad_ink * sy + max_y * sy

	ds = letter_paths(ox, oy, sx, sy)
	sh = 2.0
	shadow_parts = []
	for d in ds:
		shadow_parts.append(
			f'<path fill="#000" stroke="#000" stroke-width="{STROKE_VIEW}" '
			f'stroke-linejoin="round" opacity="0.7" '
			f'transform="translate({sh * 0.9},{sh * 0.9})" d="{d}"/>'
		)
	fill_parts = [
		f'<path fill="#00b9fe" stroke="#00b9fe" stroke-width="{STROKE_VIEW}" '
		f'stroke-linejoin="round" d="{d}"/>'
		for d in ds
	]

	return f'''<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100" width="512" height="512">
  {"".join(shadow_parts)}
  {"".join(fill_parts)}
</svg>
'''


def draw_heavy_text(draw, xy, text, font, fill, stroke_w):
	"""Mild weight bump via stroke only."""
	draw.text(
		xy,
		text,
		font=font,
		fill=fill,
		stroke_width=max(1, stroke_w),
		stroke_fill=fill,
	)


def render_png(size: int, simplified: bool = False) -> Image.Image:
	scale_up = 8
	canvas = size * scale_up
	tmp = Image.new("RGBA", (canvas, canvas), (0, 0, 0, 0))
	draw = ImageDraw.Draw(tmp)

	font_size = int(canvas * 0.85)
	text = "LT"
	stroke_w = max(2, int(round(canvas * STROKE_FRAC)))
	hard = max(2, int(round(canvas * 0.04)))
	font = ImageFont.truetype(str(FONT_PATH), max(font_size, 8))

	bbox = draw.textbbox((0, 0), text, font=font, stroke_width=stroke_w)
	tw, th = bbox[2] - bbox[0], bbox[3] - bbox[1]
	pad = stroke_w + hard + 4
	while (tw + pad > canvas * 0.96 or th + pad > canvas * 0.96) and font_size > 8:
		font_size = int(font_size * 0.96)
		stroke_w = max(2, int(round(font_size * 0.07)))
		font = ImageFont.truetype(str(FONT_PATH), font_size)
		bbox = draw.textbbox((0, 0), text, font=font, stroke_width=stroke_w)
		tw, th = bbox[2] - bbox[0], bbox[3] - bbox[1]

	tx = (canvas - tw - hard) / 2 - bbox[0]
	ty = (canvas - th - hard) / 2 - bbox[1]

	shadow = Image.new("RGBA", (canvas, canvas), (0, 0, 0, 0))
	sd = ImageDraw.Draw(shadow)
	soff = max(2, int(round(canvas * 0.03)))
	draw_heavy_text(sd, (tx + soff, ty + soff), text, font, (0, 0, 0, 220), stroke_w)
	shadow = shadow.filter(ImageFilter.GaussianBlur(radius=max(1, canvas // 100)))
	tmp = Image.alpha_composite(tmp, shadow)

	draw = ImageDraw.Draw(tmp)
	draw_heavy_text(draw, (tx + hard, ty + hard), text, font, (0, 0, 0, 240), stroke_w)
	draw_heavy_text(draw, (tx, ty), text, font, CYAN, stroke_w)

	ink = tmp.split()[-1].point(lambda a: 255 if a > 8 else 0)
	box = ink.getbbox()
	if not box:
		return Image.new("RGBA", (size, size), BG)
	cropped = tmp.crop(box)

	margin = max(1, int(round(size * 3 / 192)))
	fit = size - 2 * margin
	# Vertical stretch: fill square (independent X/Y scale)
	resized = cropped.resize((fit, fit), Image.Resampling.LANCZOS)

	out = Image.new("RGBA", (size, size), BG)
	out.paste(resized, (margin, margin), resized)
	return out


def main():
	svg = build_svg_master()
	(OUT / "icon.svg").write_text(svg, encoding="utf-8")
	print("wrote", OUT / "icon.svg")

	for name, size, simple in [
		("favicon-16x16.png", 16, True),
		("favicon-32x32.png", 32, True),
		("apple-touch-icon.png", 180, False),
		("android-chrome-192x192.png", 192, False),
		("android-chrome-512x512.png", 512, False),
	]:
		im = render_png(size, simplified=simple)
		im.save(OUT / name, format="PNG", optimize=True)
		print("wrote", OUT / name)

	p32 = Image.open(OUT / "favicon-32x32.png").convert("RGBA")
	p32.save(OUT / "favicon.ico", format="ICO", sizes=[(16, 16), (32, 32)])
	print("wrote", OUT / "favicon.ico")


if __name__ == "__main__":
	main()
