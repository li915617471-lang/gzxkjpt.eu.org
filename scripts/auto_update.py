"""
信息分享平台智能更新草稿脚本

作用：
1. 读取 data/update-sources.json 里的公开 RSS 来源；
2. 抓取最新标题、链接、摘要；
3. 按关键词自动分类；
4. 生成 data/intelligence-draft.json；
5. 后台 admin.html 可以导入这个草稿，再由你审核发布。

运行：
    python scripts/auto_update.py

说明：
这个脚本只生成“待审核草稿”，不会自动覆盖正式 data/content.json。
正式上线后可放到 GitHub Actions / Cloudflare Worker / 服务器定时任务中每天运行。
"""

from __future__ import annotations

import html
import json
import re
import sys
import time
import urllib.error
import urllib.request
import urllib.parse
import xml.etree.ElementTree as ET
from datetime import datetime, timezone
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
SOURCE_FILE = ROOT / "data" / "update-sources.json"
OUTPUT_FILE = ROOT / "data" / "intelligence-draft.json"
CONTENT_FILE = ROOT / "data" / "content.json"
LOG_FILE = ROOT / "data" / "collection-logs.json"


CATEGORY_RULES = {
    "金融": ["finance", "fintech", "bank", "payment", "insurance", "fund", "digital currency", "monetary", "inflation", "interest rate", "economy", "euro", "金融", "银行", "证券", "支付", "保险", "基金", "数字货币", "利率", "通胀", "货币政策"],
    "农业": ["agriculture", "farming", "farm", "crop", "food", "food tech", "agritech", "livestock", "irrigation", "农业", "农机", "育种", "粮食", "种植", "养殖", "农田", "农业科技"],
    "能源": ["battery", "energy", "solar", "storage", "geothermal", "renewable", "grid", "electricity", "oil", "crude", "natural gas", "lng", "电池", "储能", "光伏", "新能源", "电力", "地热", "石油", "天然气"],
    "工业": ["robot", "factory", "manufacturing", "automation", "industrial", "production", "supply chain", "logistics", "plant", "机器人", "工厂", "制造", "自动化", "产线", "工业互联网", "供应链", "生产"],
    "人文": ["humanities", "culture", "education", "history", "museum", "society", "art", "literature", "philosophy", "人文", "文化", "教育", "历史", "博物馆", "社会", "艺术", "文学"],
    "科技": ["ai", "llm", "artificial intelligence", "technology", "model", "compute", "robot", "chip", "semiconductor", "wafer", "packaging", "chiplet", "quantum", "biotech", "人工智能", "大模型", "算力", "模型", "芯片", "半导体", "封装", "晶圆", "量子", "生物技术"]
}

CATEGORY_COVERS = {
    "金融": "assets/network.jpg",
    "科技": "assets/datacenter.jpg",
    "工业": "assets/factory.jpg",
    "能源": "assets/energy.jpg",
    "农业": "assets/solar.jpg",
    "人文": "assets/semiconductor.jpg",
}
DEFAULT_COVER = "assets/factory.jpg"
TRACKING_IMAGE_MARKERS = ("pixel", "tracking", "tracker", "spacer", "1x1", "clear.gif", "beacon")


def load_category_rules() -> dict[str, list[str]]:
    if not CONTENT_FILE.exists():
        return CATEGORY_RULES
    try:
        content = json.loads(CONTENT_FILE.read_text(encoding="utf-8"))
        settings = content.get("categorySettings", [])
        dynamic = {
            str(item["name"]).strip(): [
                str(word).strip()
                for word in item.get("keywords", [])
                if str(word).strip()
            ] or [str(item["name"]).strip()]
            for item in settings
            if item.get("name") and item.get("enabled", True)
        }
        return dynamic or CATEGORY_RULES
    except (OSError, ValueError, TypeError):
        return CATEGORY_RULES


def clean_text(value: str) -> str:
    value = re.sub(r"<[^>]+>", " ", value or "")
    value = html.unescape(value)
    value = re.sub(r"\\s+", " ", value).strip()
    return value


def truncate_text(value: str, limit: int) -> str:
    """Trim text without leaving a dangling word when practical."""
    value = clean_text(value)
    if len(value) <= limit:
        return value
    clipped = value[:limit + 1]
    boundary = max(clipped.rfind(" "), clipped.rfind("。"), clipped.rfind("，"), clipped.rfind("；"))
    if boundary >= int(limit * 0.65):
        clipped = clipped[:boundary]
    else:
        clipped = clipped[:limit]
    return clipped.rstrip(" ,，。;；:-") + "…"


def category_cover(category: str) -> str:
    return CATEGORY_COVERS.get(category, DEFAULT_COVER)


def safe_image_url(value: str, base_url: str = "") -> str:
    value = html.unescape((value or "").strip())
    if not value:
        return ""
    try:
        resolved = urllib.parse.urljoin(base_url, value)
        parts = urllib.parse.urlsplit(resolved)
    except ValueError:
        return ""
    if parts.scheme.lower() not in {"http", "https"} or not parts.netloc:
        return ""
    lowered = resolved.lower()
    if any(marker in lowered for marker in TRACKING_IMAGE_MARKERS):
        return ""
    return resolved


def normalize_url(value: str) -> str:
    value = (value or "").strip()
    if not value:
        return ""
    try:
        parts = urllib.parse.urlsplit(value)
        filtered_query = [
            (key, val)
            for key, val in urllib.parse.parse_qsl(parts.query, keep_blank_values=True)
            if key.lower() not in {
                "utm_source", "utm_medium", "utm_campaign", "utm_term",
                "utm_content", "fbclid", "gclid"
            }
        ]
        path = parts.path.rstrip("/") or "/"
        return urllib.parse.urlunsplit((
            parts.scheme.lower(),
            parts.netloc.lower(),
            path,
            urllib.parse.urlencode(filtered_query),
            "",
        ))
    except ValueError:
        return value.lower()


def normalize_title(value: str) -> str:
    return re.sub(r"[^\w\u4e00-\u9fff]+", "", (value or "").lower())


def near_duplicate_title(value: str, candidates: set[str], threshold: float = 0.82) -> bool:
    normalized = normalize_title(value)
    if not normalized:
        return False
    if normalized in candidates:
        return True
    if len(normalized) < 8:
        return False
    grams = {normalized[index:index + 3] for index in range(len(normalized) - 2)}
    for candidate in candidates:
        if len(candidate) < 8 or not 0.65 <= len(normalized) / len(candidate) <= 1.35:
            continue
        other = {candidate[index:index + 3] for index in range(len(candidate) - 2)}
        union = grams | other
        if union and len(grams & other) / len(union) >= threshold:
            return True
    return False


def load_json(path: Path, fallback: dict) -> dict:
    try:
        return json.loads(path.read_text(encoding="utf-8")) if path.exists() else fallback
    except (OSError, ValueError, TypeError):
        return fallback


def load_sources() -> list[dict]:
    content = load_json(CONTENT_FILE, {})
    managed = content.get("sourceSettings", [])
    if isinstance(managed, list) and managed:
        return managed
    return load_json(SOURCE_FILE, {}).get("sources", [])


def existing_fingerprints() -> tuple[set[str], set[str]]:
    content = load_json(CONTENT_FILE, {})
    previous = load_json(OUTPUT_FILE, {})
    stories = list(content.get("stories", [])) + list(previous.get("stories", []))
    urls = {
        normalize_url(story.get("sourceUrl") or story.get("url") or "")
        for story in stories
    }
    titles = {normalize_title(story.get("title", "")) for story in stories}
    return {item for item in urls if item}, {item for item in titles if item}


def pending_drafts() -> list[dict]:
    content_stories = load_json(CONTENT_FILE, {}).get("stories", [])
    previous_stories = load_json(OUTPUT_FILE, {}).get("stories", [])
    content_urls = {
        normalize_url(story.get("sourceUrl") or story.get("url") or "")
        for story in content_stories
    }
    content_titles = {normalize_title(story.get("title", "")) for story in content_stories}
    retained = []
    retained_urls: set[str] = set()
    retained_titles: set[str] = set()
    for story in previous_stories:
        url_key = normalize_url(story.get("sourceUrl") or story.get("url") or "")
        title_key = normalize_title(story.get("title", ""))
        if not url_key:
            continue
        if ((url_key and (url_key in content_urls or url_key in retained_urls))
                or (title_key and (title_key in content_titles or title_key in retained_titles))):
            continue
        retained.append(story)
        if url_key:
            retained_urls.add(url_key)
        if title_key:
            retained_titles.add(title_key)
    return retained


def balanced_queue(new_stories: list[dict], retained_stories: list[dict], categories: list[str], limit: int = 30) -> list[dict]:
    """Round-robin categories so early sources cannot crowd out later sections."""
    buckets = {category: [] for category in categories}
    overflow = []
    for story in new_stories + retained_stories:
        category = story.get("category")
        if category in buckets:
            buckets[category].append(story)
        else:
            overflow.append(story)
    queue = []
    while len(queue) < limit and any(buckets.values()):
        for category in categories:
            if buckets[category] and len(queue) < limit:
                queue.append(buckets[category].pop(0))
    if len(queue) < limit:
        queue.extend(overflow[:limit - len(queue)])
    return queue


def fetch(url: str, max_attempts: int = 3) -> tuple[bytes, int, int]:
    started = time.perf_counter()
    last_error: Exception | None = None
    for attempt in range(1, max_attempts + 1):
        try:
            request = urllib.request.Request(
                url,
                headers={
                    "User-Agent": "Information-Share-RSS/1.0 (+https://gzxkjpt.eu.org)",
                    "Accept": "application/rss+xml, application/atom+xml, application/xml, text/xml;q=0.9, */*;q=0.5",
                },
            )
            with urllib.request.urlopen(request, timeout=20) as response:
                raw = response.read(5 * 1024 * 1024 + 1)
                if len(raw) > 5 * 1024 * 1024:
                    raise ValueError("订阅内容超过 5MB 安全限制")
                duration_ms = round((time.perf_counter() - started) * 1000)
                return raw, attempt, duration_ms
        except (urllib.error.URLError, TimeoutError, OSError) as exc:
            last_error = exc
            if attempt < max_attempts:
                time.sleep(0.8 * attempt)
    duration_ms = round((time.perf_counter() - started) * 1000)
    raise RuntimeError(f"连续 {max_attempts} 次请求失败（{duration_ms}ms）：{last_error}")


def find_text(item: ET.Element, names: list[str]) -> str:
    for name in names:
        found = item.find(name)
        if found is not None and found.text:
            return clean_text(found.text)
    for child in item:
        tag = child.tag.split("}")[-1].lower()
        if tag in names and child.text:
            return clean_text(child.text)
    return ""


def find_image(item: ET.Element, base_url: str = "") -> str:
    """Extract a useful RSS/Atom image without fetching the article body."""
    candidates = []
    html_fields = []
    for child in item.iter():
        tag = child.tag.split("}")[-1].lower()
        attrs = {key.split("}")[-1].lower(): value for key, value in child.attrib.items()}
        if tag in {"content", "thumbnail"}:
            candidates.append(attrs.get("url") or attrs.get("href") or attrs.get("src") or "")
        elif tag == "enclosure" and str(attrs.get("type", "")).lower().startswith("image/"):
            candidates.append(attrs.get("url") or attrs.get("href") or "")
        if tag in {"description", "summary", "content", "encoded"} and child.text:
            html_fields.append(child.text)
    for markup in html_fields:
        candidates.extend(re.findall(r"<img\b[^>]*?\bsrc\s*=\s*['\"]([^'\"]+)['\"]", markup, flags=re.I))
    for candidate in candidates:
        image = safe_image_url(candidate, base_url)
        if image:
            return image
    return ""


def parse_feed(raw: bytes) -> list[dict]:
    root = ET.fromstring(raw)
    items = root.findall(".//item")
    if not items:
        items = root.findall(".//{http://www.w3.org/2005/Atom}entry")

    parsed = []
    for item in items[:12]:
        title = find_text(item, ["title"])
        summary = find_text(item, ["description", "summary", "content"])
        published = find_text(item, ["pubDate", "published", "updated", "date"])
        link = find_text(item, ["link"])
        if not link:
            for child in item:
                if child.tag.split("}")[-1] == "link":
                    link = child.attrib.get("href", "")
                    break
        image = find_image(item, link)
        if title:
            parsed.append({"title": title, "summary": summary, "link": link, "published": published, "image": image})
    return parsed


def keyword_hits(text: str, words: list[str]) -> int:
    lower = (text or "").lower()
    hits = 0
    for word in words:
        keyword = str(word).strip().lower()
        if not keyword:
            continue
        if re.fullmatch(r"[a-z0-9][a-z0-9 .+#/-]*", keyword):
            pattern = rf"(?<![a-z0-9]){re.escape(keyword)}(?![a-z0-9])"
            hits += int(bool(re.search(pattern, lower)))
        else:
            hits += int(keyword in lower)
    return hits


def categorize(title: str, summary: str, fallback: str, rules: dict[str, list[str]]) -> str:
    scores = {
        category: keyword_hits(title, words) * 3 + keyword_hits(summary, words)
        for category, words in rules.items()
    }
    if fallback in scores:
        scores[fallback] += 2
    category, score = max(scores.items(), key=lambda item: item[1])
    return category if score > 0 else (fallback or "科技")


def category_evidence_score(
    title: str, summary: str, category: str, rules: dict[str, list[str]]
) -> int:
    words = rules.get(category, [])
    return keyword_hits(title, words) * 3 + keyword_hits(summary, words)


def refresh_retained_categories(
    stories: list[dict], sources: list[dict], rules: dict[str, list[str]]
) -> list[dict]:
    source_by_id = {source.get("id"): source for source in sources if source.get("id")}
    for story in stories:
        story["sourceUrl"] = story.get("sourceUrl") or story.get("url") or ""
        story.pop("url", None)
        source = source_by_id.get(story.get("collectionSourceId"))
        if source:
            story["category"] = categorize(
                story.get("title", ""),
                story.get("excerpt", ""),
                source.get("categoryHint", ""),
                rules,
            )
            story["tags"] = tags_for(
                f"{story.get('title', '')} {story.get('excerpt', '')}",
                story["category"],
            )
        story["categoryEvidenceScore"] = category_evidence_score(
            story.get("title", ""), story.get("excerpt", ""), story["category"], rules
        )
        fallback = category_cover(story["category"])
        story["imageFallback"] = fallback
        if not story.get("image") or story.get("image") == DEFAULT_COVER:
            story["image"] = fallback
            story["imageSourceType"] = "category-cover"
            story["imageAttribution"] = "平台板块封面"
        if not story.get("body"):
            story["body"] = build_review_body(
                story.get("excerpt", ""), story.get("source", "公开来源")
            )
    return stories


def tags_for(text: str, category: str) -> list[str]:
    candidates = [
        "工业大模型", "人形机器人", "先进封装", "Chiplet", "固态电池",
        "数字孪生", "储能", "算力", "边缘智能", "工业互联网",
        "半导体", "新能源", "智能制造", "金融科技", "数字支付",
        "精准农业", "农业机器人", "数字人文", "文化遗产"
    ]
    lower = text.lower()
    tags = [category]
    tags.extend(word for word in candidates if word.lower() in lower)
    return list(dict.fromkeys(tags))[:5]


def build_review_body(summary: str, source_name: str) -> str:
    summary = truncate_text(summary, 900) or "该条目来自公开订阅源，尚待编辑补充中文摘要。"
    return (
        "自动采集摘要\n\n"
        f"{summary}\n\n"
        "来源与审核说明\n\n"
        f"本资料由“{source_name or '公开来源'}”的公开 RSS/Atom 摘要自动整理，仅用于线索发现和后台审核。"
        "平台未复制来源全文；正式发布前请编辑核对标题、事实、分类、图片使用边界及原始链接，详情以来源页面为准。"
    )


def make_story(entry: dict, source: dict, index: int, rules: dict[str, list[str]]) -> dict:
    combined = f"{entry.get('title', '')} {entry.get('summary', '')}"
    fallback = source.get("categoryHint", "")
    if fallback not in rules:
        fallback = next(iter(rules), "科技")
    category = categorize(entry.get("title", ""), entry.get("summary", ""), fallback, rules)
    evidence_score = category_evidence_score(
        entry.get("title", ""), entry.get("summary", ""), category, rules
    )
    excerpt = truncate_text(entry.get("summary", ""), 280) or "来自公开来源的前沿信息，等待后台进一步编辑摘要。"
    confidence = max(0, min(100, int(source.get("confidence", 75))))
    trust_level = source.get("trustLevel", "standard")
    status = "review" if confidence >= 80 and trust_level in {"authoritative", "professional"} else "draft"
    review_note = "来源可信度较高，仍需核对标题、摘要和原始链接" if status == "review" else "需要编辑核验来源、摘要与分类后再发布"
    fallback_image = category_cover(category)
    source_image = safe_image_url(entry.get("image", ""), entry.get("link", ""))
    image = source_image or fallback_image
    source_name = source.get("name", "公开来源")
    return {
        "id": index + 1,
        "category": category,
        "categoryEvidenceScore": evidence_score,
        "title": truncate_text(entry["title"], 160),
        "excerpt": excerpt,
        "body": build_review_body(excerpt, source_name),
        "image": image,
        "imageFallback": fallback_image,
        "imageSourceType": "rss" if source_image else "category-cover",
        "imageAttribution": source_name if source_image else "平台板块封面",
        "originalTitle": clean_text(entry["title"]),
        "source": source_name,
        "sourceUrl": entry.get("link", ""),
        "author": "",
        "language": source.get("language", "en"),
        "confidence": confidence,
        "time": "待审核",
        "readMinutes": 6,
        "heat": 78,
        "date": datetime.now(timezone.utc).date().isoformat(),
        "tags": tags_for(combined, category),
        "status": status,
        "collectionSourceId": source.get("id", ""),
        "sourceType": source.get("type", "professional"),
        "sourceRegion": source.get("region", "全球"),
        "sourceTrustLevel": trust_level,
        "originalPublishedAt": entry.get("published", ""),
        "collectedAt": datetime.now(timezone.utc).isoformat(),
        "reviewNote": review_note,
    }


def save_collection_log(log: dict) -> None:
    payload = load_json(LOG_FILE, {"logs": []})
    logs = [item for item in payload.get("logs", []) if item.get("id") != log.get("id")]
    logs.insert(0, log)
    LOG_FILE.write_text(
        json.dumps({"logs": logs[:50]}, ensure_ascii=False, indent=2),
        encoding="utf-8",
    )


def main() -> int:
    if not SOURCE_FILE.exists():
        print(f"缺少来源配置：{SOURCE_FILE}", file=sys.stderr)
        return 1

    started_at = datetime.now(timezone.utc).isoformat()
    sources = [source for source in load_sources() if source.get("enabled", True)]
    if not sources:
        print("没有启用的采集来源，已停止更新", file=sys.stderr)
        return 1
    rules = load_category_rules()
    retained_drafts = refresh_retained_categories(pending_drafts(), sources, rules)
    stories = []
    errors = []
    source_results = []
    seen_urls, seen_titles = existing_fingerprints()
    fetched = 0
    duplicates = 0
    invalid_entries = 0

    for source in sources:
        source_added = 0
        source_duplicates = 0
        attempts = 0
        duration_ms = 0
        try:
            raw, attempts, duration_ms = fetch(source["url"])
            entries = parse_feed(raw)
            if not entries:
                raise ValueError("订阅未返回可解析条目")
            max_items = max(1, min(20, int(source.get("maxItems", 5))))
            for entry in entries[:max_items]:
                fetched += 1
                url_key = normalize_url(entry.get("link", ""))
                title_key = normalize_title(entry.get("title", ""))
                if not url_key:
                    invalid_entries += 1
                    continue
                if (url_key and url_key in seen_urls) or near_duplicate_title(title_key, seen_titles):
                    duplicates += 1
                    source_duplicates += 1
                    continue
                stories.append(make_story(entry, source, len(stories), rules))
                source_added += 1
                if url_key:
                    seen_urls.add(url_key)
                if title_key:
                    seen_titles.add(title_key)
            source_results.append({
                "sourceId": source.get("id", ""),
                "source": source.get("name", source.get("url")),
                "status": "success",
                "attempts": attempts,
                "durationMs": duration_ms,
                "fetched": min(len(entries), max_items),
                "added": source_added,
                "duplicates": source_duplicates,
            })
        except Exception as exc:  # noqa: BLE001
            error = {"source": source.get("name", source.get("url")), "error": str(exc)}
            errors.append(error)
            source_results.append({
                "sourceId": source.get("id", ""),
                "source": error["source"],
                "status": "failed",
                "attempts": attempts or 3,
                "durationMs": duration_ms,
                "fetched": 0,
                "added": 0,
                "duplicates": 0,
                "error": error["error"],
            })

    finished_at = datetime.now(timezone.utc).isoformat()
    collection = {
        "id": finished_at,
        "startedAt": started_at,
        "finishedAt": finished_at,
        "status": "failed" if sources and len(errors) == len(sources) else ("partial" if errors else "success"),
        "sourcesTotal": len(sources),
        "sourcesSucceeded": len(sources) - len(errors),
        "sourcesFailed": len(errors),
        "fetched": fetched,
        "added": min(len(stories), 30),
        "duplicates": duplicates,
        "invalid": invalid_entries,
        "errors": errors,
        "sourceResults": source_results,
    }

    save_collection_log(collection)
    if len(errors) == len(sources):
        print("全部采集来源失败，已保留原有草稿队列", file=sys.stderr)
        return 1

    queue = balanced_queue(stories, retained_drafts, list(rules), 30)
    new_story_objects = {id(story) for story in stories}
    new_in_queue = sum(1 for story in queue if id(story) in new_story_objects)
    collection["queueCount"] = len(queue)
    collection["categoryCounts"] = {
        category: sum(1 for story in queue if story.get("category") == category)
        for category in rules
    }
    payload = {
        "generatedAt": finished_at,
        "stories": queue,
        "errors": errors,
        "collection": collection,
    }
    OUTPUT_FILE.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"已生成：{OUTPUT_FILE}")
    print(
        f"新增入队：{new_in_queue}，保留待审：{len(queue) - new_in_queue}，重复跳过：{duplicates}，"
        f"无效条目：{invalid_entries}，成功来源：{collection['sourcesSucceeded']}，失败来源：{len(errors)}"
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
