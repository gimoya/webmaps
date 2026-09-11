#!/usr/bin/env python3
"""
Build Legacy Trails favicons from two sources.

- icon_source.png      → browser favicons (16/32/ico)
- icon_source_pwa.png  → Apple / Android homescreen
- Does not alter source artwork (no stretch/color changes).
- Pads to square on transparent, then resizes.
- PWA outputs get +6% padding (content = 94% of canvas).
"""
from __future__ import annotations

from pathlib import Path

from PIL import Image

OUT = Path(__file__).resolve().parent.parent
SOURCE_USUAL = OUT / "icon_source.png"
SOURCE_PWA = OUT / "icon_source_pwa.png"

# Extra inset on PWA homescreen icons (6% total → content at 94%)
PWA_CONTENT_FRAC = 0.94

USUAL_SIZES = {
	"favicon-16x16.png": 16,
	"favicon-32x32.png": 32,
}

PWA_SIZES = {
	"apple-touch-icon.png": 180,
	"android-chrome-192x192.png": 192,
	"android-chrome-512x512.png": 512,
	"android-chrome-192x192-maskable.png": 192,
	"android-chrome-512x512-maskable.png": 512,
}


def to_square(src: Image.Image) -> Image.Image:
	"""Center artwork on transparent square; no stretch."""
	src = src.convert("RGBA")
	w, h = src.size
	side = max(w, h)
	sq = Image.new("RGBA", (side, side), (0, 0, 0, 0))
	sq.paste(src, ((side - w) // 2, (side - h) // 2), src)
	return sq


def resize_square(square: Image.Image, dim: int) -> Image.Image:
	return square.resize((dim, dim), Image.Resampling.LANCZOS)


def resize_padded(square: Image.Image, dim: int, content_frac: float) -> Image.Image:
	"""Resize with transparent padding so content fills content_frac of the canvas."""
	out = Image.new("RGBA", (dim, dim), (0, 0, 0, 0))
	inner = max(1, int(round(dim * content_frac)))
	scaled = square.resize((inner, inner), Image.Resampling.LANCZOS)
	off = (dim - inner) // 2
	out.paste(scaled, (off, off), scaled)
	return out


def export_from(
	source: Path,
	sizes: dict[str, int],
	*,
	content_frac: float | None = None,
) -> None:
	if not source.is_file():
		raise SystemExit(f"Missing source: {source}")

	src = Image.open(source)
	print("source", source.name, src.mode, src.size)
	square = to_square(src)

	for name, dim in sizes.items():
		if content_frac is None:
			im = resize_square(square, dim)
		else:
			im = resize_padded(square, dim, content_frac)
		path = OUT / name
		im.save(path, format="PNG", optimize=True)
		print("wrote", path.name, im.size)


def main() -> None:
	export_from(SOURCE_USUAL, USUAL_SIZES)
	export_from(SOURCE_PWA, PWA_SIZES, content_frac=PWA_CONTENT_FRAC)

	Image.open(OUT / "favicon-32x32.png").convert("RGBA").save(
		OUT / "favicon.ico",
		format="ICO",
		sizes=[(16, 16), (32, 32)],
	)
	print("wrote favicon.ico")
	print("sources left untouched")


if __name__ == "__main__":
	main()
