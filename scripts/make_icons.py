"""生成托盘图标与应用图标（统一风格的极简时钟）。"""

import os
from PIL import Image, ImageDraw

OUT = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "resources")
os.makedirs(OUT, exist_ok=True)

SS = 8  # 超采样倍数


def rounded_mask(size, radius):
    mask = Image.new("L", (size, size), 0)
    d = ImageDraw.Draw(mask)
    d.rounded_rectangle([0, 0, size - 1, size - 1], radius=radius, fill=255)
    return mask


def draw_clock(size, hands_color, ring_color, bg=None, bg_alpha=255, thickness_ratio=0.085):
    S = size * SS
    img = Image.new("RGBA", (S, S), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    pad = int(S * 0.10)
    ring_w = max(2, int(S * thickness_ratio))
    if bg is not None:
        d.rounded_rectangle(
            [0, 0, S - 1, S - 1],
            radius=int(S * 0.24),
            fill=bg + (bg_alpha,),
        )
    d.ellipse(
        [pad, pad, S - pad, S - pad],
        outline=ring_color,
        width=ring_w,
    )
    cx, cy = S / 2, S / 2
    r = (S - 2 * pad - ring_w) / 2
    # 时针：指向 10 点方向；分针：指向 2 点方向
    d.line([cx, cy, cx - r * 0.44, cy - r * 0.30], fill=hands_color, width=int(ring_w * 1.05))
    d.line([cx, cy, cx + r * 0.30, cy - r * 0.52], fill=hands_color, width=int(ring_w * 0.9))
    d.ellipse([cx - ring_w * 0.85, cy - ring_w * 0.85, cx + ring_w * 0.85, cy + ring_w * 0.85], fill=hands_color)
    return img.resize((size, size), Image.LANCZOS)


# 托盘：浅色线条，深色任务栏上清晰
tray = draw_clock(32, (238, 246, 255, 255), (238, 246, 255, 235))
tray.save(os.path.join(OUT, "tray.png"))

# 应用图标：深色圆角底 + 青绿表盘
app_icon = draw_clock(256, (108, 245, 227, 255), (94, 234, 212, 255), bg=(12, 18, 26))
app_icon.save(os.path.join(OUT, "icon.png"))
app_icon.save(
    os.path.join(OUT, "icon.ico"),
    sizes=[(16, 16), (24, 24), (32, 32), (48, 48), (64, 64), (128, 128), (256, 256)],
)

print("wrote:", sorted(os.listdir(OUT)))
