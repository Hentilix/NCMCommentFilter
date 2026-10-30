"""Package runtime files and the store preview, excluding development files."""
from pathlib import Path
from zipfile import ZipFile, ZIP_DEFLATED

root = Path(__file__).resolve().parent.parent
target = root / "dist" / "ncm-comment-filter.plugin"
target.parent.mkdir(exist_ok=True)
with ZipFile(target, "w", ZIP_DEFLATED) as archive:
    for name in ("manifest.json", "main.js", "preview.jpg"):
        archive.write(root / name, name)
print(target)
