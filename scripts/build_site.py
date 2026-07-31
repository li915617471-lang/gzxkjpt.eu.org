"""Build the minimal static directory uploaded to GitHub Pages."""

from __future__ import annotations

import shutil
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
OUTPUT = ROOT / "_site"
PUBLIC_FILES = (
    ".nojekyll",
    "404.html",
    "CNAME",
    "admin.css",
    "admin.html",
    "admin.js",
    "app.js",
    "auth.html",
    "auth.js",
    "article.css",
    "article.html",
    "article.js",
    "cloud-config.js",
    "cloud.js",
    "content-service.js",
    "feed.json",
    "feed.xml",
    "governance.css",
    "governance.html",
    "governance.js",
    "index.html",
    "manifest.webmanifest",
    "offline.html",
    "opensearch.xml",
    "pwa.js",
    "robots.txt",
    "sitemap.xml",
    "styles.css",
    "sw.js",
)
PUBLIC_DIRECTORIES = ("assets", "data")


def main() -> int:
    if OUTPUT.exists():
        shutil.rmtree(OUTPUT)
    OUTPUT.mkdir()
    missing = [name for name in PUBLIC_FILES if not (ROOT / name).is_file()]
    if missing:
        raise FileNotFoundError("缺少公开文件：" + ", ".join(missing))
    for name in PUBLIC_FILES:
        shutil.copy2(ROOT / name, OUTPUT / name)
    for name in PUBLIC_DIRECTORIES:
        source = ROOT / name
        if not source.is_dir():
            raise FileNotFoundError(f"缺少公开目录：{name}")
        shutil.copytree(source, OUTPUT / name, ignore=shutil.ignore_patterns("__pycache__", "*.pyc", ".gitkeep"))
    print(f"部署包已生成：{OUTPUT}（{sum(1 for path in OUTPUT.rglob('*') if path.is_file())} 个文件）")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
