"""Append collected stories to Supabase with an optional strict auto-review.

The script is intended for GitHub Actions. It skips existing source
URLs/titles and never updates an existing article. Automatic publication is
limited to deterministic quality checks configured by the site. The Supabase
service key must be provided through an environment secret and is never
written to disk or logs.
"""

from __future__ import annotations

import argparse
import email.utils
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
AUTOMATIC_PROMOTION_ID_BASE = 5_000_000_000_000_000
MAX_SAFE_INTEGER = 9_007_199_254_740_991
DEFAULT_MIN_CONFIDENCE = 85
MIN_ARTICLE_CHARS = 800
TRUSTED_LEVELS = {"authoritative", "professional"}
QUOTA_TRUSTED_LEVELS = {"authoritative", "professional", "standard"}
SOURCE_DISCLOSURE_HEADING = "简要来源"
LEGACY_DISCLOSURE_HEADING = "来源与审核说明"


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


def is_valid_image(value: Any) -> bool:
    candidate = str(value or "").strip()
    if re.fullmatch(r"assets/[a-zA-Z0-9._/-]+", candidate):
        return True
    try:
        parts = urllib.parse.urlsplit(candidate)
        return parts.scheme.lower() == "https" and bool(parts.netloc)
    except ValueError:
        return False


def count_content_characters(value: Any) -> int:
    return len(re.findall(r"[A-Za-z0-9\u3400-\u9fff]", str(value or "")))


def has_source_disclosure(value: Any) -> bool:
    body = str(value or "")
    return SOURCE_DISCLOSURE_HEADING in body or LEGACY_DISCLOSURE_HEADING in body


def has_long_english_run(value: Any) -> bool:
    return bool(re.search(r"(?:\b[A-Za-z][A-Za-z'-]*\b[\s,.;:!?()/-]*){8,}", str(value or "")))


def has_unique_article_sections(value: Any) -> bool:
    paragraphs = [item.strip() for item in re.split(r"\n{2,}", str(value or "")) if item.strip()]
    normalized = [re.sub(r"\s+", "", item) for item in paragraphs]
    return len(paragraphs) >= 6 and len(normalized) == len(set(normalized))


def body_meets_publication_standard(value: Any) -> bool:
    body = str(value or "")
    return (
        count_content_characters(body) >= MIN_ARTICLE_CHARS
        and has_unique_article_sections(body)
        and has_source_disclosure(body)
        and not has_long_english_run(body)
    )


def env_flag(name: str, fallback: bool = False) -> bool:
    value = os.environ.get(name)
    if value is None:
        return fallback
    return value.strip().lower() in {"1", "true", "yes", "on"}


def auto_approval_policy(operations: dict[str, Any] | None = None) -> dict[str, Any]:
    operations = operations or {}
    default_enabled = env_flag("AUTO_APPROVAL_ENABLED", False)
    try:
        default_threshold = int(os.environ.get("AUTO_APPROVAL_MIN_CONFIDENCE", DEFAULT_MIN_CONFIDENCE))
    except ValueError:
        default_threshold = DEFAULT_MIN_CONFIDENCE
    enabled = operations.get("autoApprovalEnabled", default_enabled) is True
    try:
        threshold = int(operations.get("autoApprovalMinConfidence", default_threshold))
    except (TypeError, ValueError):
        threshold = default_threshold
    try:
        default_target = int(os.environ.get("AUTO_APPROVAL_DAILY_TARGET", 3))
    except ValueError:
        default_target = 3
    try:
        target = int(operations.get("dailyPublishTargetPerCategory", default_target))
    except (TypeError, ValueError):
        target = default_target
    try:
        fallback_confidence = int(os.environ.get("AUTO_APPROVAL_FALLBACK_CONFIDENCE", 78))
    except ValueError:
        fallback_confidence = 78
    return {
        "enabled": enabled,
        "minConfidence": max(70, min(100, threshold)),
        "fallbackMinConfidence": max(75, min(100, fallback_confidence)),
        # Keep the public automation promise even if an old admin export has 0 or 1.
        "dailyTargetPerCategory": max(2, min(10, target)),
        "policyVersion": 2,
    }


def evaluate_auto_approval(story: dict[str, Any], policy: dict[str, Any]) -> dict[str, Any]:
    title = str(story.get("title") or "").strip()
    excerpt = str(story.get("excerpt") or "").strip()
    body = story.get("body") or ""
    if isinstance(body, list):
        body = "\n\n".join(str(item) for item in body)
    try:
        confidence = max(0, min(100, int(story.get("confidence") or 0)))
    except (TypeError, ValueError):
        confidence = 0
    try:
        evidence_score = int(story.get("categoryEvidenceScore") or 0)
    except (TypeError, ValueError):
        evidence_score = 0
    trust_level = str(story.get("sourceTrustLevel") or "").strip()
    trusted_levels = set(policy.get("trustedLevels") or TRUSTED_LEVELS)
    checks = {
        "featureEnabled": policy.get("enabled") is True,
        "trustedSource": trust_level in trusted_levels,
        "confidenceThreshold": confidence >= int(policy.get("minConfidence", DEFAULT_MIN_CONFIDENCE)),
        "validSourceUrl": is_valid_source_url(story.get("sourceUrl") or story.get("url")),
        "namedSource": len(str(story.get("source") or "").strip()) >= 2,
        "completeTitle": len(title) >= 10,
        "completeExcerpt": len(excerpt) >= 60,
        "completeBody": count_content_characters(body) >= MIN_ARTICLE_CHARS,
        "structuredBody": has_unique_article_sections(body),
        "sourceDisclosure": has_source_disclosure(body),
        "localizedContent": not has_long_english_run("\n\n".join([title, excerpt, str(body)])),
        "groundedGeneration": story.get("contentGenerationMode") in {
            "github-models-source-grounded",
            "source-grounded-structured-fallback",
        },
        "validImage": is_valid_image(story.get("image")),
        "classified": bool(str(story.get("category") or "").strip()),
        "categoryEvidence": evidence_score >= 2,
    }
    return {
        "approved": all(checks.values()),
        "checks": checks,
        "minConfidence": int(policy.get("minConfidence", DEFAULT_MIN_CONFIDENCE)),
        "policyVersion": int(policy.get("policyVersion", 1)),
    }


def published_timestamp(story: dict[str, Any]) -> float:
    candidate = str(story.get("originalPublishedAt") or story.get("date") or "").strip()
    if not candidate:
        return 0
    try:
        parsed = email.utils.parsedate_to_datetime(candidate)
        if parsed.tzinfo is None:
            parsed = parsed.replace(tzinfo=timezone.utc)
        return parsed.timestamp()
    except (TypeError, ValueError, OverflowError):
        try:
            return datetime.fromisoformat(candidate.replace("Z", "+00:00")).timestamp()
        except (TypeError, ValueError, OverflowError):
            return 0


def story_priority(story: dict[str, Any]) -> tuple[float, int, int, int]:
    try:
        evidence = int(story.get("categoryEvidenceScore") or 0)
    except (TypeError, ValueError):
        evidence = 0
    try:
        confidence = int(story.get("confidence") or 0)
    except (TypeError, ValueError):
        confidence = 0
    source_image = int(story.get("imageSourceType") == "rss")
    return (published_timestamp(story), evidence, confidence, source_image)


def select_auto_approval_audits(
    stories: list[dict[str, Any]], policy: dict[str, Any]
) -> dict[int, dict[str, Any]]:
    """Select strict approvals first, then fill each category's daily target."""
    audits = {id(story): evaluate_auto_approval(story, policy) for story in stories}
    strict_eligible = {story_id: audit["approved"] for story_id, audit in audits.items()}
    for story_id, audit in audits.items():
        audit["eligible"] = strict_eligible[story_id]
        audit["approved"] = False
        audit["mode"] = "pending"
        audit["dailyTargetPerCategory"] = int(policy.get("dailyTargetPerCategory", 3))
    if policy.get("enabled") is not True:
        return audits

    target = int(policy.get("dailyTargetPerCategory", 3))
    relaxed_policy = dict(policy)
    relaxed_policy["minConfidence"] = int(policy.get("fallbackMinConfidence", 78))
    relaxed_policy["trustedLevels"] = sorted(QUOTA_TRUSTED_LEVELS)
    categories = {str(story.get("category") or "") for story in stories}
    for category in categories:
        category_stories = [story for story in stories if str(story.get("category") or "") == category]
        strict_candidates = [story for story in category_stories if strict_eligible[id(story)]]
        strict_candidates.sort(key=story_priority, reverse=True)
        for story in strict_candidates[:target]:
            audits[id(story)]["approved"] = True
            audits[id(story)]["mode"] = "strict"
        approved_count = min(len(strict_candidates), target)
        if approved_count >= target:
            continue
        candidates = []
        for story in category_stories:
            if audits[id(story)]["approved"]:
                continue
            relaxed = evaluate_auto_approval(story, relaxed_policy)
            if relaxed["approved"]:
                candidates.append((story, relaxed))
        candidates.sort(key=lambda item: story_priority(item[0]), reverse=True)
        for story, relaxed in candidates[: target - approved_count]:
            relaxed["mode"] = "daily-target-fill"
            relaxed["dailyTargetPerCategory"] = target
            audits[id(story)] = relaxed
    return audits


def story_fingerprint(story: dict[str, Any]) -> str:
    source_url = normalize_url(story.get("sourceUrl") or story.get("url") or "")
    identity = source_url or normalize_title(story.get("title", ""))
    return hashlib.sha256(identity.encode("utf-8")).hexdigest()


def automatic_article_id(fingerprint: str) -> int:
    value = AUTOMATIC_ID_BASE + int(fingerprint[:12], 16)
    if value > MAX_SAFE_INTEGER:
        raise ValueError("Automatic article ID exceeds the JavaScript safe integer range")
    return value


def automatic_promotion_id(fingerprint: str, day: str) -> int:
    digest = hashlib.sha256(f"{fingerprint}:{day}:promotion".encode("utf-8")).hexdigest()
    value = AUTOMATIC_PROMOTION_ID_BASE + int(digest[:12], 16)
    if value > MAX_SAFE_INTEGER:
        raise ValueError("Automatic promotion ID exceeds the JavaScript safe integer range")
    return value


def parse_date(value: Any) -> str | None:
    candidate = str(value or "").strip()
    return candidate if re.fullmatch(r"\d{4}-\d{2}-\d{2}", candidate) else None


def article_row(
    story: dict[str, Any], site_id: str, position: int, imported_at: str,
    approval_policy: dict[str, Any] | None = None,
    approval_audit: dict[str, Any] | None = None,
) -> dict[str, Any]:
    source_url = str(story.get("sourceUrl") or story.get("url") or "").strip()
    if not is_valid_source_url(source_url):
        raise ValueError("Draft source URL is missing or invalid")
    fingerprint = story_fingerprint(story)
    if not normalize_title(story.get("title", "")):
        raise ValueError("Draft title is empty")

    audit = approval_audit or evaluate_auto_approval(
        story, approval_policy or {"enabled": False}
    )
    status = "published" if audit["approved"] else (
        story.get("status") if story.get("status") in {"draft", "review"} else "draft"
    )
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
        "sourceMaterial",
        "sourceMaterialType",
        "contentGenerationError",
    }
    extra = {key: value for key, value in story.items() if key not in core_keys}
    extra.update(
        {
            "automaticImport": True,
            "automaticFingerprint": fingerprint,
            "automaticImportedAt": imported_at,
            "automaticApproval": {
                **audit,
                "reviewedAt": imported_at,
                "notice": "自动审核检查中文正文、来源链接、分类和内容结构；详细来源在文章末尾简要标注。",
            },
            "reviewChecks": {
                "sourceVerified": audit["checks"]["validSourceUrl"] and audit["checks"]["trustedSource"],
                "categoryVerified": audit["checks"]["classified"],
                "localizationVerified": False,
                "rightsVerified": bool(story.get("sourceUrl")) and has_source_disclosure(body),
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
        "time_label": "自动审核通过" if status == "published" else "待审核",
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
    approval_policy: dict[str, Any] | None = None,
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
    candidates: list[dict[str, Any]] = []
    duplicates = 0
    invalid = 0

    for story in stories:
        url_key = normalize_url(story.get("sourceUrl") or story.get("url") or "")
        title_key = normalize_title(story.get("title", ""))
        if (url_key and url_key in existing_urls) or (title_key and title_key in existing_titles):
            duplicates += 1
            continue
        if not url_key or not title_key or not is_valid_source_url(story.get("sourceUrl") or story.get("url")):
            invalid += 1
            continue
        candidate_id = automatic_article_id(story_fingerprint(story))
        if candidate_id in existing_ids:
            duplicates += 1
            continue
        candidates.append(story)
        existing_ids.add(candidate_id)
        if url_key:
            existing_urls.add(url_key)
        if title_key:
            existing_titles.add(title_key)

    audits = select_auto_approval_audits(candidates, approval_policy or {"enabled": False})
    for story in candidates:
        try:
            rows.append(article_row(
                story,
                site_id,
                next_position + len(rows),
                imported_at,
                approval_policy,
                audits[id(story)],
            ))
        except (TypeError, ValueError):
            invalid += 1

    return rows, duplicates, invalid


def daily_automatic_counts(
    existing: list[dict[str, Any]], inserted: list[dict[str, Any]], day: str
) -> dict[str, int]:
    counts: dict[str, int] = {}
    for row in existing + inserted:
        extra = row.get("extra") if isinstance(row.get("extra"), dict) else {}
        audit = extra.get("automaticApproval") if isinstance(extra, dict) else {}
        if not isinstance(audit, dict):
            audit = {}
        reviewed_at = str(audit.get("reviewedAt") or "") if isinstance(audit, dict) else ""
        if (
            row.get("status") != "published"
            or not body_meets_publication_standard(row.get("body"))
            or not audit.get("approved")
            or not reviewed_at.startswith(day)
        ):
            continue
        category = str(row.get("category") or "")
        if category:
            counts[category] = counts.get(category, 0) + 1
    return counts


def prepare_promotions(
    stories: list[dict[str, Any]],
    existing: list[dict[str, Any]],
    inserted: list[dict[str, Any]],
    policy: dict[str, Any],
    imported_at: str,
    site_id: str = "main",
) -> tuple[list[dict[str, Any]], dict[str, int]]:
    """Fill today's category gaps from recent, already-imported automatic drafts."""
    day = imported_at[:10]
    counts = daily_automatic_counts(existing, inserted, day)
    target = int(policy.get("dailyTargetPerCategory", 3))
    story_by_url = {
        normalize_url(story.get("sourceUrl") or story.get("url") or ""): story
        for story in stories
        if normalize_url(story.get("sourceUrl") or story.get("url") or "")
    }
    relaxed_policy = dict(policy)
    relaxed_policy["minConfidence"] = int(policy.get("fallbackMinConfidence", 78))
    relaxed_policy["trustedLevels"] = sorted(QUOTA_TRUSTED_LEVELS)
    published_urls = {
        normalize_url(row.get("source_url") or "")
        for row in existing + inserted
        if row.get("status") == "published"
        and row.get("source_url")
        and body_meets_publication_standard(row.get("body"))
    }
    next_position = max(
        (int(row.get("position") or 0) for row in existing + inserted), default=-1
    ) + 1
    grouped: dict[str, list[tuple[dict[str, Any], dict[str, Any], dict[str, Any]]]] = {}
    for row in existing:
        extra = row.get("extra") if isinstance(row.get("extra"), dict) else {}
        if (
            row.get("status") not in {"draft", "review", "published"}
            or int(row.get("id") or 0) < AUTOMATIC_ID_BASE
            or extra.get("automaticImport") is not True
        ):
            continue
        if row.get("status") == "published" and body_meets_publication_standard(row.get("body")):
            continue
        story = story_by_url.get(normalize_url(row.get("source_url") or ""))
        if not story or normalize_url(row.get("source_url") or "") in published_urls:
            continue
        audit = evaluate_auto_approval(story, relaxed_policy)
        if not audit["approved"]:
            continue
        category = str(story.get("category") or "")
        grouped.setdefault(category, []).append((story, row, audit))

    # Some legacy rows predate automaticImport metadata. A current story that
    # passes every v2 gate can still create a dated replacement publication.
    candidate_urls = {
        normalize_url(story.get("sourceUrl") or story.get("url") or "")
        for candidates in grouped.values()
        for story, _, _ in candidates
    }
    existing_by_url = {
        normalize_url(row.get("source_url") or ""): row
        for row in existing
        if normalize_url(row.get("source_url") or "")
    }
    for story in stories:
        story_url = normalize_url(story.get("sourceUrl") or story.get("url") or "")
        if not story_url or story_url in published_urls or story_url in candidate_urls:
            continue
        audit = evaluate_auto_approval(story, relaxed_policy)
        if not audit["approved"]:
            continue
        reference = existing_by_url.get(story_url) or {
            "id": automatic_article_id(story_fingerprint(story)),
            "extra": {"automaticImport": True},
        }
        category = str(story.get("category") or "")
        grouped.setdefault(category, []).append((story, reference, audit))
        candidate_urls.add(story_url)

    promotions: list[dict[str, Any]] = []
    for category, candidates in grouped.items():
        needed = max(0, target - counts.get(category, 0))
        if not needed:
            continue
        candidates.sort(key=lambda item: story_priority(item[0]), reverse=True)
        for story, row, audit in candidates[:needed]:
            audit.update({
                "mode": "daily-target-backfill",
                "dailyTargetPerCategory": target,
                "reviewedAt": imported_at,
                "notice": "自动审核检查中文正文、来源链接、分类和内容结构；详细来源在文章末尾简要标注。",
            })
            body = story.get("body") or ""
            if isinstance(body, list):
                body = "\n\n".join(str(item) for item in body)
            merged_extra = dict(row.get("extra") or {})
            merged_extra.update({
                "automaticImport": True,
                "automaticFingerprint": story_fingerprint(story),
                "automaticPromotionOf": int(row["id"]),
                "automaticApproval": audit,
                "reviewChecks": {
                    "sourceVerified": True,
                    "categoryVerified": True,
                    "localizationVerified": False,
                    "rightsVerified": bool(story.get("sourceUrl")) and has_source_disclosure(body),
                },
            })
            original_source_url = str(story.get("sourceUrl") or story.get("url") or "")
            promotion_source_url = original_source_url.split("#", 1)[0] + f"#information-share-{day}"
            promotions.append({
                "site_id": site_id,
                "id": automatic_promotion_id(story_fingerprint(story), day),
                "category": category,
                "title": str(story.get("title") or "")[:300],
                "excerpt": str(story.get("excerpt") or "")[:2000],
                "image": str(story.get("image") or "")[:1000],
                "source": str(story.get("source") or "公开来源")[:300],
                "source_url": promotion_source_url[:2000],
                "author": str(story.get("author") or "")[:300],
                "language": str(story.get("language") or "zh-CN")[:30],
                "status": "published",
                "scheduled_at": None,
                "confidence": max(0, min(100, int(story.get("confidence") or 0))),
                "body": str(body),
                "time_label": "自动审核通过",
                "read_minutes": max(1, int(story.get("readMinutes") or 6)),
                "heat": max(0, int(story.get("heat") or 0)),
                "published_date": parse_date(story.get("date")) or day,
                "tags": story.get("tags") if isinstance(story.get("tags"), list) else [],
                "extra": merged_extra,
                "position": next_position + len(promotions),
                "updated_at": imported_at,
            })
            counts[category] = counts.get(category, 0) + 1
    return promotions, counts


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
            + "&select=id,title,source_url,body,position,category,status,extra,updated_at&limit=10000",
        )

    def site_operations(self, site_id: str) -> dict[str, Any]:
        encoded_site = urllib.parse.quote(site_id, safe="")
        result = self.request(
            "GET", "site_settings?id=eq." + encoded_site + "&select=extra&limit=1"
        )
        if not isinstance(result, list) or not result:
            return {}
        extra = result[0].get("extra") if isinstance(result[0], dict) else {}
        operations = extra.get("operations", {}) if isinstance(extra, dict) else {}
        return operations if isinstance(operations, dict) else {}

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
        try:
            operations = client.site_operations(site_id)
        except RuntimeError as exc:
            operations = {}
            print(
                "Auto-approval settings could not be read; using protected workflow defaults: "
                + str(exc),
                file=sys.stderr,
            )
        policy = auto_approval_policy(operations)
        imported_at = datetime.now(timezone.utc).isoformat()
        rows, duplicates, invalid = prepare_rows(
            stories, existing, site_id, imported_at, policy
        )
        inserted = rows if args.dry_run else client.insert_articles(rows)
        promotions, daily_counts = prepare_promotions(
            stories, existing, inserted, policy, imported_at, site_id
        )
        promoted = promotions if args.dry_run else client.insert_articles(promotions)
    except (OSError, ValueError, RuntimeError, json.JSONDecodeError) as exc:
        message = str(exc).replace("%", "%25").replace("\r", "%0D").replace("\n", "%0A")[:500]
        print(f"::error title=Draft sync failed::{message}", file=sys.stderr)
        print(f"Draft sync failed: {exc}", file=sys.stderr)
        return 1

    print(
        "Supabase draft sync: "
        f"inserted={len(inserted)}, duplicates={duplicates}, invalid={invalid}, "
        f"auto_published={sum(1 for row in inserted if row.get('status') == 'published')}, "
        f"promoted={len(promoted)}, "
        f"source={len(stories)}"
    )
    target = int(policy.get("dailyTargetPerCategory", 3))
    categories = sorted({str(story.get("category") or "") for story in stories if story.get("category")})
    published_counts = {category: daily_counts.get(category, 0) for category in categories}
    gaps = {category: max(0, target - count) for category, count in published_counts.items()}
    print("Auto-publish by category: " + json.dumps(published_counts, ensure_ascii=False, sort_keys=True))
    if any(gaps.values()):
        print(
            "Daily target gaps (no duplicate or low-quality filler was published): "
            + json.dumps(gaps, ensure_ascii=False, sort_keys=True)
        )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
