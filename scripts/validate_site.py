"""Validate content, generated indexes, PWA assets and deployment settings."""

from __future__ import annotations

import json
import re
import struct
import sys
from datetime import datetime, timezone
from html.parser import HTMLParser
from pathlib import Path
from urllib.parse import urlparse
from xml.etree import ElementTree as ET


ROOT = Path(__file__).resolve().parents[1]
HTML_FILES = ("index.html", "article.html", "category.html", "governance.html", "admin.html", "auth.html", "offline.html", "404.html")
VALID_STATUSES = {"draft", "review", "scheduled", "published", "archived"}
VALID_VIDEO_TYPES = {"none", "file", "bilibili", "external"}


class ReferenceParser(HTMLParser):
    def __init__(self) -> None:
        super().__init__()
        self.references: list[str] = []

    def handle_starttag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        values = dict(attrs)
        for name in ("href", "src"):
            if values.get(name):
                self.references.append(str(values[name]))


class Validator:
    def __init__(self) -> None:
        self.errors: list[str] = []
        self.warnings: list[str] = []

    def require(self, condition: bool, message: str) -> None:
        if not condition:
            self.errors.append(message)

    def warn(self, condition: bool, message: str) -> None:
        if not condition:
            self.warnings.append(message)


def load_json(path: Path) -> dict:
    return json.loads(path.read_text(encoding="utf-8"))


def public_story(story: dict) -> bool:
    status = story.get("status", "published")
    if status == "published":
        return True
    if status != "scheduled" or not story.get("scheduledAt"):
        return False
    try:
        scheduled = datetime.fromisoformat(str(story["scheduledAt"]).replace("Z", "+00:00"))
        return scheduled <= datetime.now(timezone.utc)
    except (ValueError, TypeError):
        return False


def local_target(reference: str) -> str | None:
    value = reference.strip()
    if not value or value.startswith(("#", "mailto:", "tel:", "data:", "javascript:")):
        return None
    parsed = urlparse(value)
    if parsed.scheme or parsed.netloc:
        return None
    path = parsed.path.lstrip("/")
    return path or None


def png_size(path: Path) -> tuple[int, int] | None:
    data = path.read_bytes()[:24]
    if len(data) < 24 or data[:8] != b"\x89PNG\r\n\x1a\n":
        return None
    return struct.unpack(">II", data[16:24])


def validate_content(validator: Validator, content: dict) -> list[dict]:
    site = content.get("site", {})
    operations = content.get("operations", {})
    categories = content.get("categories", [])
    category_settings = content.get("categorySettings", [])
    stories = content.get("stories", [])
    validator.require(bool(site.get("name")), "site.name 不能为空")
    site_url = str(operations.get("siteUrl") or "")
    validator.require(site_url.startswith("https://"), "operations.siteUrl 必须使用 HTTPS")
    validator.require(len(categories) == len(set(categories)) and bool(categories), "板块名称必须存在且不能重复")
    configured_names = [str(item.get("name") or "") for item in category_settings]
    validator.require(configured_names == categories, "categories 与 categorySettings 顺序或名称不一致")
    ids = [str(story.get("id")) for story in stories]
    validator.require(len(ids) == len(set(ids)), "文章 ID 不能重复")
    for story in stories:
        story_id = story.get("id", "?")
        status = story.get("status", "published")
        validator.require(status in VALID_STATUSES, f"文章 {story_id} 状态无效：{status}")
        validator.require(story.get("category") in categories, f"文章 {story_id} 使用了不存在的板块")
        validator.require(bool(str(story.get("title") or "").strip()), f"文章 {story_id} 缺少标题")
        image = str(story.get("image") or "")
        if image and local_target(image):
            validator.require((ROOT / local_target(image)).is_file(), f"文章 {story_id} 图片不存在：{image}")
        source_url = str(story.get("sourceUrl") or story.get("url") or "").strip()
        if source_url:
            validator.require(source_url.startswith(("http://", "https://")), f"文章 {story_id} 来源链接无效")
        video_type = str(story.get("videoType") or "none")
        video_url = str(story.get("videoUrl") or "").strip()
        validator.require(video_type in VALID_VIDEO_TYPES, f"文章 {story_id} 视频类型无效")
        if video_type != "none":
            validator.require(video_url.startswith("https://"), f"文章 {story_id} 视频必须使用 HTTPS")
            validator.require(story.get("videoRightsConfirmed") is True, f"文章 {story_id} 尚未确认视频传播权限")
            if video_type == "file":
                validator.require(bool(re.search(r"\.(?:mp4|webm|ogg)(?:\?.*)?$", video_url, re.I)), f"文章 {story_id} 直连视频格式无效")
            if video_type == "bilibili":
                validator.require(bool(re.search(r"\bBV[0-9A-Za-z]{10}\b", video_url)), f"文章 {story_id} 哔哩哔哩地址缺少 BV 号")
                video_host = urlparse(video_url).hostname or ""
                validator.require(video_host == "bilibili.com" or video_host.endswith(".bilibili.com"), f"文章 {story_id} 哔哩哔哩视频域名无效")
        if public_story(story):
            validator.require(len(str(story.get("excerpt") or "").strip()) >= 20, f"公开文章 {story_id} 摘要过短")
            validator.warn(bool(source_url), f"公开文章 {story_id} 尚未设置原始来源链接")
            validator.warn(len(str(story.get("body") or "").strip()) >= 80, f"公开文章 {story_id} 正文不足 80 字")
            validator.warn(int(story.get("confidence", 80)) >= 70, f"公开文章 {story_id} 可信度低于 70")
    contact_email = str(operations.get("contactEmail") or "").strip()
    if contact_email:
        validator.require(
            bool(re.fullmatch(r"[^\s@]+@[^\s@]+\.[^\s@]+", contact_email)),
            "operations.contactEmail 格式无效",
        )
    return [story for story in stories if public_story(story)]


def validate_contact_channel(validator: Validator) -> None:
    governance = (ROOT / "governance.html").read_text(encoding="utf-8")
    governance_script = (ROOT / "governance.js").read_text(encoding="utf-8")
    cloud_adapter = (ROOT / "cloud.js").read_text(encoding="utf-8")
    schema = (ROOT / "supabase-schema.sql").read_text(encoding="utf-8")
    validator.require('id="correctionForm"' in governance, "治理页缺少公开联系表单")
    validator.require("submitReport" in governance_script, "治理页联系表单缺少提交逻辑")
    validator.require("submitReport" in cloud_adapter, "云端适配器缺少反馈提交接口")
    validator.require("public.content_reports" in schema, "数据库缺少公开反馈队列")


def validate_references(validator: Validator) -> None:
    for filename in HTML_FILES:
        path = ROOT / filename
        validator.require(path.is_file(), f"缺少页面：{filename}")
        if not path.is_file():
            continue
        parser = ReferenceParser()
        parser.feed(path.read_text(encoding="utf-8"))
        for reference in parser.references:
            target = local_target(reference)
            if target:
                validator.require((ROOT / target).is_file(), f"{filename} 引用了不存在的文件：{target}")


def validate_generated_files(validator: Validator, public_count: int) -> None:
    try:
        rss = ET.parse(ROOT / "feed.xml")
        rss_items = rss.findall("./channel/item")
        validator.require(len(rss_items) == public_count, "RSS 条目数量与公开文章数量不一致")
    except (ET.ParseError, OSError) as error:
        validator.errors.append(f"feed.xml 无法解析：{error}")
    try:
        feed = load_json(ROOT / "feed.json")
        validator.require(len(feed.get("items", [])) == public_count, "JSON Feed 条目数量与公开文章数量不一致")
    except (json.JSONDecodeError, OSError) as error:
        validator.errors.append(f"feed.json 无法解析：{error}")
    for filename in ("sitemap.xml", "opensearch.xml"):
        try:
            ET.parse(ROOT / filename)
        except (ET.ParseError, OSError) as error:
            validator.errors.append(f"{filename} 无法解析：{error}")


def validate_pwa(validator: Validator) -> None:
    try:
        manifest = load_json(ROOT / "manifest.webmanifest")
    except (json.JSONDecodeError, OSError) as error:
        validator.errors.append(f"manifest.webmanifest 无法解析：{error}")
        return
    validator.require(manifest.get("display") == "standalone", "PWA display 必须为 standalone")
    for icon in manifest.get("icons", []):
        path = ROOT / str(icon.get("src") or "")
        validator.require(path.is_file(), f"PWA 图标不存在：{path.name}")
        expected = str(icon.get("sizes") or "")
        if path.is_file() and "x" in expected:
            width, height = (int(value) for value in expected.split("x", 1))
            validator.require(png_size(path) == (width, height), f"PWA 图标尺寸错误：{path.name}")
    service_worker = (ROOT / "sw.js").read_text(encoding="utf-8")
    core_match = re.search(r"const CORE_ASSETS = \[(.*?)\];", service_worker, re.DOTALL)
    validator.require(bool(core_match), "sw.js 缺少 CORE_ASSETS")
    if core_match:
        for reference in re.findall(r'"([^"]+)"', core_match.group(1)):
            target = reference.split("?", 1)[0].removeprefix("./")
            if target:
                validator.require((ROOT / target).exists(), f"Service Worker 缓存文件不存在：{target}")
    validator.require("admin.html" not in (core_match.group(1) if core_match else ""), "后台页面不得进入离线核心缓存")


def validate_automation(validator: Validator, categories: list[str]) -> None:
    settings = load_json(ROOT / "data" / "update-sources.json")
    sources = [source for source in settings.get("sources", []) if source.get("enabled", True)]
    covered = {str(source.get("categoryHint") or "") for source in sources}
    missing = [category for category in categories if category not in covered]
    validator.require(not missing, "自动采集缺少板块来源：" + "、".join(missing))
    urls = [str(source.get("url") or "") for source in sources]
    validator.require(len(urls) == len(set(urls)), "自动采集来源 URL 不能重复")
    for source in sources:
        validator.require(str(source.get("url") or "").startswith("https://"), f"采集来源必须使用 HTTPS：{source.get('name')}")
    draft_payload = load_json(ROOT / "data" / "intelligence-draft.json")
    queued_categories = {str(story.get("category") or "") for story in draft_payload.get("stories", [])}
    missing_queue = [category for category in categories if category not in queued_categories]
    validator.warn(not missing_queue, "当前审核队列暂缺板块：" + "、".join(missing_queue))


def validate_domain(validator: Validator, content: dict) -> None:
    site_url = str(content.get("operations", {}).get("siteUrl") or "")
    expected_host = urlparse(site_url).hostname or ""
    cname = (ROOT / "CNAME").read_text(encoding="utf-8").strip()
    validator.require(cname == expected_host, "CNAME 必须与 operations.siteUrl 域名一致")


def main() -> int:
    validator = Validator()
    try:
        content = load_json(ROOT / "data" / "content.json")
    except (json.JSONDecodeError, OSError) as error:
        print(f"[ERROR] data/content.json 无法解析：{error}")
        return 1
    public_stories = validate_content(validator, content)
    validate_references(validator)
    validate_contact_channel(validator)
    validate_generated_files(validator, len(public_stories))
    validate_pwa(validator)
    validate_automation(validator, content.get("categories", []))
    validate_domain(validator, content)
    for warning in validator.warnings:
        print(f"[WARN] {warning}")
    for error in validator.errors:
        print(f"[ERROR] {error}")
    print(f"检查完成：{len(validator.errors)} 个错误，{len(validator.warnings)} 个警告，{len(public_stories)} 条公开内容")
    return 1 if validator.errors else 0


if __name__ == "__main__":
    raise SystemExit(main())
