"""Generate RSS, JSON Feed and OpenSearch files from published content."""

from __future__ import annotations

import json
from datetime import datetime, time, timedelta, timezone
from email.utils import format_datetime
from pathlib import Path
from urllib.parse import quote
from xml.etree import ElementTree as ET


ROOT = Path(__file__).resolve().parents[1]
CONTENT_FILE = ROOT / "data" / "content.json"
RSS_FILE = ROOT / "feed.xml"
JSON_FEED_FILE = ROOT / "feed.json"
OPENSEARCH_FILE = ROOT / "opensearch.xml"
ATOM_NAMESPACE = "http://www.w3.org/2005/Atom"
OPENSEARCH_NAMESPACE = "http://a9.com/-/spec/opensearch/1.1/"
CHINA_TIMEZONE = timezone(timedelta(hours=8))


def is_public(story: dict, now: datetime) -> bool:
    status = story.get("status", "published")
    if status == "published":
        return True
    if status != "scheduled" or not story.get("scheduledAt"):
        return False
    try:
        scheduled = datetime.fromisoformat(str(story["scheduledAt"]).replace("Z", "+00:00"))
        return scheduled.astimezone(timezone.utc) <= now.astimezone(timezone.utc)
    except ValueError:
        return False


def published_at(story: dict) -> datetime:
    value = str(story.get("date") or "").strip()
    try:
        return datetime.combine(datetime.fromisoformat(value).date(), time(8), CHINA_TIMEZONE)
    except ValueError:
        return datetime.now(CHINA_TIMEZONE)


def story_text(story: dict) -> str:
    body = story.get("body")
    if isinstance(body, list):
        return "\n\n".join(str(item).strip() for item in body if str(item).strip())
    if isinstance(body, str) and body.strip():
        return body.strip()
    return str(story.get("excerpt") or "").strip()


def story_link(base_url: str, story: dict) -> str:
    story_id = quote(str(story.get("id", "")), safe="")
    return f"{base_url}/article.html?id={story_id}"


def generate_rss(content: dict, stories: list[dict], base_url: str, generated_at: datetime) -> None:
    site = content.get("site", {})
    operations = content.get("operations", {})
    title = str(site.get("name") or "信息分享平台")
    description = str(site.get("footer") or operations.get("publicNotice") or "公开知识与前沿信息聚合")
    ET.register_namespace("atom", ATOM_NAMESPACE)
    rss = ET.Element("rss", {"version": "2.0"})
    channel = ET.SubElement(rss, "channel")
    ET.SubElement(channel, "title").text = title
    ET.SubElement(channel, "link").text = base_url + "/"
    ET.SubElement(channel, "description").text = description
    ET.SubElement(channel, "language").text = "zh-CN"
    ET.SubElement(channel, "lastBuildDate").text = format_datetime(generated_at)
    ET.SubElement(
        channel,
        f"{{{ATOM_NAMESPACE}}}link",
        {"href": base_url + "/feed.xml", "rel": "self", "type": "application/rss+xml"},
    )
    for story in stories[:50]:
        link = story_link(base_url, story)
        item = ET.SubElement(channel, "item")
        ET.SubElement(item, "title").text = str(story.get("title") or "未命名内容")
        ET.SubElement(item, "link").text = link
        ET.SubElement(item, "guid", {"isPermaLink": "true"}).text = link
        ET.SubElement(item, "description").text = str(story.get("excerpt") or "")
        ET.SubElement(item, "category").text = str(story.get("category") or "未分类")
        ET.SubElement(item, "pubDate").text = format_datetime(published_at(story))
        source_url = str(story.get("sourceUrl") or story.get("url") or "").strip()
        if source_url.startswith(("http://", "https://")):
            ET.SubElement(item, "source", {"url": source_url}).text = str(story.get("source") or "原始来源")
    tree = ET.ElementTree(rss)
    ET.indent(tree, space="  ")
    tree.write(RSS_FILE, encoding="utf-8", xml_declaration=True)


def generate_json_feed(content: dict, stories: list[dict], base_url: str) -> None:
    site = content.get("site", {})
    operations = content.get("operations", {})
    feed = {
        "version": "https://jsonfeed.org/version/1.1",
        "title": str(site.get("name") or "信息分享平台"),
        "home_page_url": base_url + "/",
        "feed_url": base_url + "/feed.json",
        "description": str(site.get("footer") or operations.get("publicNotice") or "公开知识与前沿信息聚合"),
        "language": "zh-CN",
        "items": [],
    }
    for story in stories[:50]:
        link = story_link(base_url, story)
        item = {
            "id": link,
            "url": link,
            "title": str(story.get("title") or "未命名内容"),
            "summary": str(story.get("excerpt") or ""),
            "content_text": story_text(story),
            "date_published": published_at(story).isoformat(),
            "tags": [str(tag) for tag in story.get("tags", []) if str(tag).strip()],
            "_category": str(story.get("category") or "未分类"),
            "_source": str(story.get("source") or "平台内容"),
        }
        feed["items"].append(item)
    JSON_FEED_FILE.write_text(json.dumps(feed, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")


def generate_opensearch(content: dict, base_url: str) -> None:
    site_name = str(content.get("site", {}).get("name") or "信息分享平台")
    ET.register_namespace("", OPENSEARCH_NAMESPACE)
    root = ET.Element(f"{{{OPENSEARCH_NAMESPACE}}}OpenSearchDescription")
    ET.SubElement(root, f"{{{OPENSEARCH_NAMESPACE}}}ShortName").text = site_name[:16]
    ET.SubElement(root, f"{{{OPENSEARCH_NAMESPACE}}}Description").text = f"搜索{site_name}公开内容"
    ET.SubElement(root, f"{{{OPENSEARCH_NAMESPACE}}}InputEncoding").text = "UTF-8"
    ET.SubElement(
        root,
        f"{{{OPENSEARCH_NAMESPACE}}}Url",
        {"type": "text/html", "template": base_url + "/index.html?q={searchTerms}"},
    )
    tree = ET.ElementTree(root)
    ET.indent(tree, space="  ")
    tree.write(OPENSEARCH_FILE, encoding="utf-8", xml_declaration=True)


def main() -> int:
    content = json.loads(CONTENT_FILE.read_text(encoding="utf-8"))
    base_url = str(content.get("operations", {}).get("siteUrl") or "https://gzxkjpt.eu.org").rstrip("/")
    generated_at = datetime.now(CHINA_TIMEZONE)
    stories = [story for story in content.get("stories", []) if is_public(story, generated_at)]
    stories.sort(key=published_at, reverse=True)
    generate_rss(content, stories, base_url, generated_at)
    generate_json_feed(content, stories, base_url)
    generate_opensearch(content, base_url)
    print(f"已生成 RSS、JSON Feed 与 OpenSearch，共 {len(stories)} 条公开内容")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
