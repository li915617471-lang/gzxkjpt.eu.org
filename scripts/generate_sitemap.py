"""Generate sitemap.xml from published platform content."""

from __future__ import annotations

import json
from datetime import datetime, timezone
from pathlib import Path
from urllib.parse import quote
from xml.etree import ElementTree as ET


ROOT = Path(__file__).resolve().parents[1]
CONTENT_FILE = ROOT / "data" / "content.json"
OUTPUT_FILE = ROOT / "sitemap.xml"
NAMESPACE = "http://www.sitemaps.org/schemas/sitemap/0.9"


def is_public(story: dict) -> bool:
    status = story.get("status", "published")
    if status == "published":
        return True
    if status != "scheduled" or not story.get("scheduledAt"):
        return False
    try:
        scheduled = datetime.fromisoformat(story["scheduledAt"].replace("Z", "+00:00"))
        return scheduled <= datetime.now(timezone.utc)
    except ValueError:
        return False


def add_url(root: ET.Element, location: str, last_modified: str | None = None) -> None:
    entry = ET.SubElement(root, f"{{{NAMESPACE}}}url")
    ET.SubElement(entry, f"{{{NAMESPACE}}}loc").text = location
    if last_modified:
        ET.SubElement(entry, f"{{{NAMESPACE}}}lastmod").text = last_modified


def main() -> int:
    content = json.loads(CONTENT_FILE.read_text(encoding="utf-8"))
    base_url = str(content.get("operations", {}).get("siteUrl") or "https://gzxkjpt.eu.org").rstrip("/")
    urlset = ET.Element(f"{{{NAMESPACE}}}urlset")
    generated_on = datetime.now(timezone.utc).date().isoformat()
    add_url(urlset, base_url + "/", generated_on)
    add_url(urlset, base_url + "/governance.html", generated_on)
    for story in content.get("stories", []):
        if not is_public(story):
            continue
        story_id = quote(str(story.get("id", "")), safe="")
        add_url(urlset, f"{base_url}/article.html?id={story_id}", story.get("date"))
    ET.register_namespace("", NAMESPACE)
    tree = ET.ElementTree(urlset)
    ET.indent(tree, space="  ")
    tree.write(OUTPUT_FILE, encoding="utf-8", xml_declaration=True)
    print(f"已生成：{OUTPUT_FILE}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
