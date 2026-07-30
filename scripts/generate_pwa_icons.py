"""Generate deterministic PNG icons for the platform PWA manifest."""

from pathlib import Path

from PIL import Image, ImageDraw


ROOT = Path(__file__).resolve().parents[1]
ASSETS = ROOT / "assets"


def build_icon(size: int) -> Image.Image:
    image = Image.new("RGB", (size, size), "#090d10")
    draw = ImageDraw.Draw(image)
    margin = round(size * 0.17)
    draw.rounded_rectangle(
        (margin, margin, size - margin, size - margin),
        radius=round(size * 0.035),
        fill="#0d1a15",
        outline="#1c8e5d",
        width=max(2, round(size * 0.008)),
    )
    bar_width = round(size * 0.105)
    gap = round(size * 0.045)
    baseline = round(size * 0.72)
    heights = (round(size * 0.22), round(size * 0.39), round(size * 0.30))
    group_width = bar_width * 3 + gap * 2
    start_x = (size - group_width) // 2
    for index, height in enumerate(heights):
        left = start_x + index * (bar_width + gap)
        draw.rounded_rectangle(
            (left, baseline - height, left + bar_width, baseline),
            radius=max(1, round(size * 0.008)),
            fill="#6ee7a8",
        )
    return image


def main() -> int:
    ASSETS.mkdir(parents=True, exist_ok=True)
    for size in (192, 512):
        build_icon(size).save(ASSETS / f"icon-{size}.png", format="PNG", optimize=True)
    print("已生成 PWA 图标：192px、512px")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
