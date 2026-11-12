"""生成用于文档截图的干净背景（不含任何个人桌面内容）。"""

import os
import numpy as np
from PIL import Image, ImageFilter

OUT = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "docs")
os.makedirs(OUT, exist_ok=True)

W, H = 1600, 900
yy, xx = np.mgrid[0:H, 0:W].astype(np.float32)
nx, ny = xx / W, yy / H

# 基础渐变：深紫蓝
base_top = np.array([24, 20, 42], dtype=np.float32)
base_bottom = np.array([52, 32, 66], dtype=np.float32)
img = base_top[None, None, :] * (1 - ny[..., None]) + base_bottom[None, None, :] * ny[..., None]


def blob(cx, cy, radius, color, strength):
    d = np.sqrt((nx - cx) ** 2 + (ny - cy) ** 2)
    falloff = np.clip(1 - d / radius, 0, 1) ** 2 * strength
    return falloff[..., None] * np.array(color, dtype=np.float32)[None, None, :]


# 几团柔和光斑，模拟壁纸的氛围光
img += blob(0.18, 0.22, 0.55, (86, 70, 150), 0.85)
img += blob(0.82, 0.30, 0.45, (40, 120, 130), 0.55)
img += blob(0.62, 0.88, 0.60, (150, 60, 110), 0.45)
img += blob(0.95, 0.95, 0.40, (190, 90, 70), 0.35)

# 轻微暗角
d = np.sqrt((nx - 0.5) ** 2 + (ny - 0.5) ** 2)
img *= (1 - np.clip((d - 0.35) / 0.7, 0, 1) ** 2 * 0.35)[..., None]

img = np.clip(img, 0, 255).astype(np.uint8)
image = Image.fromarray(img, mode="RGB").filter(ImageFilter.GaussianBlur(1.2))

# 加一点颗粒感，避免大面积渐变出现色带
rng = np.random.default_rng(7)
noise = rng.normal(0, 1.6, (H, W, 1)).repeat(3, axis=2)
image = Image.fromarray(np.clip(np.asarray(image, dtype=np.float32) + noise, 0, 255).astype(np.uint8))

image.save(os.path.join(OUT, "backdrop.png"))
print("wrote", os.path.join(OUT, "backdrop.png"))
