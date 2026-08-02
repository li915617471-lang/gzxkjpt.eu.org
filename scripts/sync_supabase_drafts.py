"""Append collected stories to the Supabase review queue.

The script is intended for GitHub Actions. It only accepts ``draft`` and
``review`` states, skips existing source URLs/titles, and never updates an
existing article. The Supabase service key must be provided through an
environment secret and is never written to disk or logs.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import os
import re
import sys
import urllib.error
import urllib.parse
import urllib.request
from datetime import datetime, timezone
from pathlib import Path
from typing import Any


ROOT = Path(__file__).resolve().parents[1]
DEFAULT_DRAFT_FILE = ROOT / "data" / "intelligence-draft.json"
AUTOMATIC_ID_BASE = 4_000_000_000_000_000
MAX_SAFE_INTEGER = 9_007_199_254_740_991


def normalize_url(value: str) -> str:
    value = str(value or "").strip()
    if not value:
        return ""
    try:
        parts = urllib.parse.urlsplit(value)
        filtered_query = [
            (key, val)
            for key, val in urllib.parse.parse_qsl(parts.query, keep_blank_values=True)
            if key.lower()
            not in {
                "utm_source",
                "utm_medium",
                "utm_campaign",
                "utm_term",
                "utm_content",
                "fbclid",
                "gclid",
            }
        ]
        path = parts.path.rstrip("/") or "/"
        return urllib.parse.urlunsplit(
            (
                parts.scheme.lower(),
                parts.netloc.lower(),
                path,
                urllib.parse.urlencode(filtered_query),
                "",
            )
        )
    except ValueError:
        return value.lower()


def normalize_title(value: str) -> str:
    return re.sub(r"[^\w\u4e00-\u9fff]+", "", str(value or "").lower())


def is_valid_source_url(value: Any) -> bool:
    try:
        parts = urllib.parse.urlsplit(str(value or "").strip())
        return parts.scheme.lower() in {"http", "https"} and bool(parts.netloc)
    except ValueError:
        return False


def story_fingerprint(story: dict[str, Any]) -> str:
    source_url = normalize_url(story.get("sourceUrl") or story.get("url") or "")
    identity = source_url or normalize_title(story.get("title", ""))
    return hashlib.sha256(identity.encode("utf-8")).hexdigest()


def automatic_article_id(fingerprint: str) -> int:
    value = AUTOMATIC_ID_BASE + int(fingerprint[:12], 16)
    if value > MAX_SAFE_INTEGER:
        raise ValueError("Automatic article ID exceeds the JavaScript safe integer range")
    return value


def parse_date(value: Any) -> str | None:
    candidate = str(value or "").strip()
    return candidate if re.fullmatch(r"\d{4}-\d{2}-\d{2}", candidate) else None


def article_row(
    story: dict[str, Any], site_id: str, position: int, imported_at: str
) -> dict[str, Any]:
    source_url = str(story.get("sourceUrl") or story.get("url") or "").strip()
    if not is_valid_source_url(source_url):
        raise ValueError("Draft source URL is missing or invalid")
    fingerprint = story_fingerprint(story)
    if not normalize_title(story.get("title", "")):
        raise ValueError("Draft title is empty")

    status = story.get("status") if story.get("status") in {"draft", "review"} else "draft"
    body = story.get("body", "")
    if isinstance(body, list):
        body = "\n\n".join(str(item) for item in body)

    core_keys = {
        "id",
        "category",
        "title",
        "excerpt",
        "image",
        "source",
        "sourceUrl",
        "url",
        "author",
        "language",
        "status",
        "scheduledAt",
        "confidence",
        "body",
        "time",
        "readMinutes",
        "heat",
        "date",
        "tags",
        "reviewChecks",
    }
    extra = {key: value for key, value in story.items() if key not in core_keys}
    extra.update(
        {
            "automaticImport": True,
            "automaticFingerprint": fingerprint,
            "automaticImportedAt": imported_at,
            "reviewChecks": {
                "sourceVerified": False,
                "categoryVerified": False,
                "localizationVerified": False,
                "rightsVerified": False,
            },
        }
    )

    return {
        "site_id": site_id,
        "id": automatic_article_id(fingerprint),
        "category": str(story.get("category") or "科技")[:80],
        "title": str(story.get("title") or "")[:300],
        "excerpt": str(story.get("excerpt") or "")[:2000],
        "image": str(story.get("image") or "")[:1000],
        "source": str(story.get("source") or "公开来源")[:300],
        "source_url": source_url[:2000],
        "author": str(story.get("author") or "")[:300],
        "language": str(story.get("language") or "zh-CN")[:30],
        "status": status,
        "scheduled_at": None,
        "confidence": max(0, min(100, int(story.get("confidence") or 0))),
        "body": str(body or ""),
        "time_label": "待审核",
        "read_minutes": max(1, int(story.get("readMinutes") or 6)),
        "heat": max(0, int(story.get("heat") or 0)),
        "published_date": parse_date(story.get("date")),
        "tags": story.get("tags") if isinstance(story.get("tags"), list) else [],
        "extra": extra,
        "position": position,
        "updated_at": imported_at,
    }


def prepare_rows(
    stories: list[dict[str, Any]],
    existing: list[dict[str, Any]],
    site_id: str,
    imported_at: str,
) -> tuple[list[dict[str, Any]], int, int]:
    existing_urls = {
        normalize_url(item.get("source_url", "")) for item in existing if item.get("source_url")
    }
    existing_titles = {
        normalize_title(item.get("title", "")) for item in existing if item.get("title")
    }
    existing_ids = {int(item["id"]) for item in existing if item.get("id") is not None}
    next_position = max((int(item.get("position") or 0) for item in existing), default=-1) + 1
    rows: list[dict[str, Any]] = []
    duplicates = 0
    invalid = 0

    for story in stories:
        url_key = normalize_url(story.get("sourceUrl") or story.get("url") or "")
        title_key = normalize_title(story.get("title", ""))
        if (url_key and url_key in existing_urls) or (title_key and title_key in existing_titles):
            duplicates += 1
            continue
        try:
            row = article_row(story, site_id, next_position + len(rows), imported_at)
        except (TypeError, ValueError):
            invalid += 1
            continue
        if row["id"] in existing_ids:
            duplicates += 1
            continue
        rows.append(row)
        existing_ids.add(row["id"])
        if url_key:
            existing_urls.add(url_key)
        if title_key:
            existing_titles.add(title_key)

    return rows, duplicates, invalid


class SupabaseRest:
    def __init__(self, base_url: str, service_key: str) -> None:
        self.base_url = base_url.rstrip("/")
        self.service_key = service_key

    def request(self, method: str, path: str, payload: Any = None) -> Any:
        data = None if payload is None else json.dumps(payload).encode("utf-8")
        request = urllib.request.Request(
            f"{self.base_url}/rest/v1/{path}",
            data=data,
            method=method,
            headers={
                "apikey": self.service_key,
                "Content-Type": "application/json",
                "Prefer": "resolution=ignore-duplicates,return=representation",
                "User-Agent": "information-share-draft-sync/1.0",
            },
        )
        try:
            with urllib.request.urlopen(request, timeout=30) as response:
                raw = response.read()
        except urllib.error.HTTPError as exc:
            message = exc.read().decode("utf-8", errors="replace")[:500]
            raise RuntimeError(f"Supabase returned HTTP {exc.code}: {message}") from exc
        except urllib.error.URLError as exc:
            raise RuntimeError(f"Supabase request failed: {exc.reason}") from exc
        return json.loads(raw.decode("utf-8")) if raw else None

    def existing_articles(self, site_id: str) -> list[dict[str, Any]]:
        encoded_site = urllib.parse.quote(site_id, safe="")
        return self.request(
            "GET",
            "articles?site_id=eq."
            + encoded_site
            + "&select=id,title,source_url,position&limit=10000",
        )

    def insert_articles(self, rows: list[dict[str, Any]]) -> list[dict[str, Any]]:
        if not rows:
            return []
        result = self.request("POST", "articles?on_conflict=site_id,id", rows)
        return result if isinstance(result, list) else []


def load_stories(path: Path) -> list[dict[str, Any]]:
    payload = json.loads(path.read_text(encoding="utf-8"))
    stories = payload.get("stories", [])
    if not isinstance(stories, list):
        raise ValueError("Draft file stories must be a JSON array")
    return [item for item in stories if isinstance(item, dict)]


def main() -> int:
    parser = argparse.ArgumentParser(description="Append automatic drafts to Supabase")
    parser.add_argument("--file", type=Path, default=DEFAULT_DRAFT_FILE)
    parser.add_argument("--dry-run", action="store_true")
    args = parser.parse_args()

    supabase_url = os.environ.get("SUPABASE_URL", "").strip()
    service_key = os.environ.get("SUPABASE_SERVICE_ROLE_KEY", "").strip()
    site_id = os.environ.get("SUPABASE_SITE_ID", "main").strip() or "main"
    if not supabase_url or not service_key:
        print(
            "SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required",
            file=sys.stderr,
        )
        return 2

    try:
        stories = load_stories(args.file)
        client = SupabaseRest(supabase_url, service_key)
        existing = client.existing_articles(site_id)
        imported_at = datetime.now(timezone.utc).isoformat()
        rows, duplicates, invalid = prepare_rows(stories, existing, site_id, imported_at)
        inserted = rows if args.dry_run else client.insert_articles(rows)
    except (OSError, ValueError, RuntimeError, json.JSONDecodeError) as exc:
        print(f"Draft sync failed: {exc}", file=sys.stderr)
        return 1

    print(
        "Supabase draft sync: "
        f"inserted={len(inserted)}, duplicates={duplicates}, invalid={invalid}, "
        f"source={len(stories)}"
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
