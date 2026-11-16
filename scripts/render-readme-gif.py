"""Encode actual UI screenshots as a documentation walkthrough; requires Pillow."""
from pathlib import Path
from PIL import Image

media = Path(__file__).resolve().parents[1] / "docs" / "media"
frames = []
for name in ("agents.png", "projects.png", "project.png"):
    image = Image.open(media / name).convert("RGB")
    image.thumbnail((960, 635), Image.Resampling.LANCZOS)
    frame = Image.new("RGB", (960, 635), "white")
    frame.paste(image, (0, 0))
    frames.append(frame)
frames[0].save(
    media / "walkthrough.gif", save_all=True, append_images=frames[1:],
    duration=[2500, 2200, 3300, 3300], loop=0, optimize=True,
)
