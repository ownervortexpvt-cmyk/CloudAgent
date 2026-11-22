#!/usr/bin/env python3
"""v152 — generate the Vortex favicon.ico (hexagon + V, matches /icon.svg)."""
from PIL import Image, ImageDraw

BG = (10, 14, 20, 255)        # #0a0e14
HEX = (245, 185, 66, 255)     # #f5b942 amber
TEAL = (94, 200, 200, 255)    # #5ec8c8

def draw_icon(size: int) -> Image.Image:
    s = 256  # draw at 256 then downscale
    img = Image.new("RGBA", (s, s), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    # rounded dark square
    d.rounded_rectangle([4, 4, s - 4, s - 4], radius=56, fill=BG)
    # hexagon outline (matches icon.svg geometry)
    cx, cy, r = s // 2, s // 2, int(s * 0.36)
    pts = []
    for i in range(6):
        import math
        ang = math.radians(60 * i - 90)
        pts.append((cx + r * math.cos(ang), cy + r * math.sin(ang)))
    d.polygon(pts, outline=HEX, width=max(10, s // 22))
    # the V
    vw = max(14, s // 14)
    top_y = int(s * 0.30)
    bot_y = int(s * 0.68)
    half = int(s * 0.14)
    d.line([(cx - half, top_y), (cx, bot_y)], fill=TEAL, width=vw)
    d.line([(cx, bot_y), (cx + half, top_y)], fill=TEAL, width=vw)
    d.ellipse([cx - 18, cy - 18, cx + 18, cy + 18], outline=TEAL, width=6)
    return img.resize((size, size), Image.LANCZOS)

imgs = [draw_icon(sz) for sz in (16, 32, 48)]
imgs[-1].save("/home/z/my-project/public/favicon.ico", format="ICO",
              sizes=[(16, 16), (32, 32), (48, 48)], append_images=imgs[:-1])
print("favicon.ico written:", imgs[-1].size)
