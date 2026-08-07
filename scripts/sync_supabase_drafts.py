"""Append collected stories to Supabase with an optional strict auto-review.

The script is intended for GitHub Actions. It skips existing source
URLs/titles and only repairs existing automatically imported articles. Automatic
publication is limited to deterministic quality checks configured by the site. The Supabase
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
from zoneinfo import ZoneInfo


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
LOW_VALUE_TITLE_TERMS = ("我爸是顶流", "幸福中国年", "旅游强国里的中式浪漫")
ASTRONOMY_TITLE_TERMS = (
    "日全食", "暗能量", "太空望远镜", "小行星", "太阳风暴", "空间天气",
    "solar eclipse", "dark energy", "space telescope", "asteroid", "solar storm", "space weather",
)
GENERIC_AUTOMATIC_TITLE = re.compile(r"公开资料提供新的观察线索|公开资料显示的[^。]{0,20}动态")
BEIJING_TZ = ZoneInfo("Asia/Shanghai")
VIDEO_ONLY_FIELDS = {
    "videoType", "videoUrl", "videoPoster", "videoRightsConfirmed", "videoLinkOnly",
    "homeVideoFeatured", "homeVideoPriority", "videoDuration", "videoExternalId",
}
WEB_STYLE_NOISE = re.compile(
    r"\.[a-z0-9_-]+\s*\{[^{}]{0,2000}\}|网站识别码|京ICP备|京公网安备|中央农业干部教育培训中心",
    re.I,
)


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


def is_valid_automatic_video(story: dict[str, Any]) -> bool:
    """Only publish official CCTV items that the home player can resolve."""
    if story.get("contentKind") != "video":
        return True
    video_url = str(story.get("videoUrl") or "").strip()
    source_url = str(story.get("sourceUrl") or story.get("url") or "").strip()
    try:
        hostname = (urllib.parse.urlsplit(video_url).hostname or "").lower()
    except ValueError:
        hostname = ""
    external_id = str(story.get("videoExternalId") or "").strip()
    return (
        story.get("videoType") == "external"
        and story.get("videoLinkOnly") is True
        and story.get("videoRightsConfirmed") is True
        and is_valid_source_url(video_url)
        and urllib.parse.urlsplit(video_url).scheme.lower() == "https"
        and normalize_url(video_url) == normalize_url(source_url)
        and is_valid_image(story.get("videoPoster") or story.get("image"))
        and hostname == "tv.cctv.com"
        and bool(re.fullmatch(r"[a-f0-9]{32}", external_id, re.I))
    )


def rights_are_verified(story: dict[str, Any], body: Any) -> bool:
    return (
        bool(story.get("sourceUrl") or story.get("url"))
        and has_source_disclosure(body)
        and is_valid_automatic_video(story)
    )


def count_content_characters(value: Any) -> int:
    return len(re.findall(r"[A-Za-z0-9\u3400-\u9fff]", str(value or "")))


SOURCE_NAVIGATION_NAMES = (
    "安徽省", "广西壮族自治区", "河南省", "吉林省", "江西省", "山东省",
    "云南省", "浙江省", "重庆市", "山西省", "内蒙古自治区", "黑龙江省",
    "江苏省", "湖北省", "湖南省", "广东省", "海南省", "宁夏回族自治区",
    "新疆维吾尔自治区", "青海省", "西藏自治区", "河北省",
)


def source_material_is_usable(value: Any) -> bool:
    text = WEB_STYLE_NOISE.sub(" ", str(value or ""))
    text = re.sub(r"\s+", " ", text).strip()
    if len(text) < 24:
        return False
    if sum(name in text for name in SOURCE_NAVIGATION_NAMES) >= 6:
        return False
    repeated = re.search(r"(.{24,200}?)\s*\1", text)
    return repeated is None


def automatic_quality_reasons(article: dict[str, Any]) -> list[str]:
    extra = article.get("extra") if isinstance(article.get("extra"), dict) else {}
    if int(article.get("id") or 0) < AUTOMATIC_ID_BASE and extra.get("automaticImport") is not True:
        return []
    combined_title = f"{article.get('title') or ''} {extra.get('originalTitle') or ''}"
    reasons = []
    if any(term in combined_title for term in LOW_VALUE_TITLE_TERMS):
        reasons.append("超出平台前沿知识范围")
    if GENERIC_AUTOMATIC_TITLE.search(combined_title):
        reasons.append("标题缺少可识别主题")
    if article.get("category") == "能源" and any(
            term.lower() in combined_title.lower() for term in ASTRONOMY_TITLE_TERMS):
        reasons.append("天文航天内容误入能源板块")
    if WEB_STYLE_NOISE.search(str(article.get("body") or "")):
        reasons.append("正文包含网页样式或页脚代码")
    return reasons


def prepare_quality_demotions(
    existing: list[dict[str, Any]], site_id: str, reviewed_at: str,
) -> list[dict[str, Any]]:
    updates = []
    for article in existing:
        if article.get("status") != "published":
            continue
        reasons = automatic_quality_reasons(article)
        if not reasons:
            continue
        current_extra = article.get("extra") if isinstance(article.get("extra"), dict) else {}
        merged_extra = dict(current_extra)
        approval = merged_extra.get("automaticApproval")
        approval = dict(approval) if isinstance(approval, dict) else {}
        approval.update({"approved": False, "reviewedAt": reviewed_at, "qualityDemotionReasons": reasons})
        merged_extra.update({
            "automaticApproval": approval,
            "qualityReviewStatus": "needs-review",
            "qualityDemotionReasons": reasons,
        })
        updates.append({
            "site_id": site_id,
            "id": int(article["id"]),
            "status": "review",
            "time_label": "自动质量复核",
            "extra": merged_extra,
            "updated_at": reviewed_at,
        })
    return updates


def has_source_disclosure(value: Any) -> bool:
    body = str(value or "")
    return SOURCE_DISCLOSURE_HEADING in body or LEGACY_DISCLOSURE_HEADING in body


def has_long_english_run(value: Any) -> bool:
    return bool(re.search(r"(?:\b[A-Za-z][A-Za-z'-]*\b[\s,.;:!?()/-]*){8,}", str(value or "")))


def has_cjk_text(value: Any) -> bool:
    return bool(re.search(r"[\u3400-\u9fff]", str(value or "")))


def source_has_chinese_presentation(story: dict[str, Any]) -> bool:
    source_title = str(story.get("originalTitle") or story.get("title") or "").strip()
    source_material = str(story.get("sourceMaterial") or story.get("originalExcerpt") or "").strip()
    title_needs_translation = (bool(re.search(r"[A-Za-z]", source_title)) and not has_cjk_text(source_title)) \
        or has_long_english_run(source_title)
    material_needs_translation = (bool(re.search(r"[A-Za-z]", source_material)) and not has_cjk_text(source_material)) \
        or has_long_english_run(source_material)
    translated_title_ready = has_cjk_text(story.get("translatedSourceTitle"))
    translated_material_ready = source_material_is_usable(story.get("translatedSourceMaterial")) \
        and has_cjk_text(story.get("translatedSourceMaterial"))
    return (not title_needs_translation or translated_title_ready) \
        and (not material_needs_translation or translated_material_ready)


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


def is_video_story(story: dict[str, Any]) -> bool:
    return story.get("contentKind") == "video"


def is_chinese_source(story: dict[str, Any]) -> bool:
    language = str(story.get("sourceLanguage") or story.get("language") or "").lower()
    region = str(story.get("sourceRegion") or story.get("region") or "")
    source_id = str(story.get("collectionSourceId") or "").lower()
    source_url = str(story.get("sourceUrl") or story.get("url") or story.get("source_url") or "")
    try:
        hostname = (urllib.parse.urlsplit(source_url).hostname or "").lower()
    except ValueError:
        hostname = ""
    return (
        language.startswith("zh")
        or region == "中国"
        or source_id.startswith("china-")
        or hostname.endswith(".gov.cn")
        or hostname.endswith(".cn")
    )


def publication_day(value: Any) -> str:
    candidate = str(value or "").strip()
    if not candidate:
        return ""
    try:
        parsed = datetime.fromisoformat(candidate.replace("Z", "+00:00"))
    except ValueError:
        return parse_date(candidate) or ""
    if parsed.tzinfo is None:
        parsed = parsed.replace(tzinfo=timezone.utc)
    return parsed.astimezone(BEIJING_TZ).date().isoformat()


def auto_approval_policy(operations: dict[str, Any] | None = None) -> dict[str, Any]:
    operations = operations or {}
    default_enabled = env_flag("AUTO_APPROVAL_ENABLED", False)
    try:
        default_threshold = int(os.environ.get("AUTO_APPROVAL_MIN_CONFIDENCE", DEFAULT_MIN_CONFIDENCE))
    except ValueError:
        default_threshold = DEFAULT_MIN_CONFIDENCE
    enabled = default_enabled if "AUTO_APPROVAL_ENABLED" in os.environ else operations.get("autoApprovalEnabled", default_enabled) is True
    try:
        threshold = int(operations.get("autoApprovalMinConfidence", default_threshold))
    except (TypeError, ValueError):
        threshold = default_threshold
    try:
        default_target = int(os.environ.get("AUTO_APPROVAL_DAILY_TARGET", 3))
    except ValueError:
        default_target = 3
    try:
        target = int(default_target if "AUTO_APPROVAL_DAILY_TARGET" in os.environ else operations.get("dailyPublishTargetPerCategory", default_target))
    except (TypeError, ValueError):
        target = default_target
    try:
        fallback_confidence = int(os.environ.get("AUTO_APPROVAL_FALLBACK_CONFIDENCE", 78))
    except ValueError:
        fallback_confidence = 78
    try:
        video_target = int(os.environ.get("AUTO_APPROVAL_VIDEO_TARGET", 4))
    except ValueError:
        video_target = 4
    try:
        chinese_target = int(os.environ.get("AUTO_APPROVAL_CHINESE_ARTICLE_TARGET", 10))
    except ValueError:
        chinese_target = 10
    try:
        foreign_target = int(os.environ.get("AUTO_APPROVAL_FOREIGN_ARTICLE_TARGET", 2))
    except ValueError:
        foreign_target = 2
    return {
        "enabled": enabled,
        "minConfidence": max(70, min(100, threshold)),
        "fallbackMinConfidence": max(75, min(100, fallback_confidence)),
        # Keep the public automation promise even if an old admin export has 0 or 1.
        "dailyTargetPerCategory": max(2, min(10, target)),
        "dailyChineseArticleTarget": max(1, min(60, chinese_target)),
        "dailyForeignArticleTarget": max(0, min(12, foreign_target)),
        "dailyVideoTarget": max(4, min(12, video_target)),
        "sourceMixEnforced": env_flag("AUTO_APPROVAL_SOURCE_MIX_ENFORCED", True),
        "policyVersion": 3,
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
    video = is_video_story(story)
    common_checks = {
        "featureEnabled": policy.get("enabled") is True,
        "trustedSource": trust_level in trusted_levels,
        "confidenceThreshold": confidence >= int(policy.get("minConfidence", DEFAULT_MIN_CONFIDENCE)),
        "validSourceUrl": is_valid_source_url(story.get("sourceUrl") or story.get("url")),
        "namedSource": len(str(story.get("source") or "").strip()) >= 2,
        "completeTitle": len(title) >= 10,
        "editorialScope": not any(term in f"{title} {story.get('originalTitle') or ''}" for term in LOW_VALUE_TITLE_TERMS)
        and not bool(GENERIC_AUTOMATIC_TITLE.search(title)),
        "completeExcerpt": len(excerpt) >= (30 if video else 60),
        "localizedContent": not has_long_english_run("\n\n".join([title, excerpt, str(body)])),
        "usableSourceMaterial": source_material_is_usable(
            story.get("sourceMaterial") or story.get("originalExcerpt")
        ),
        "sourceChinesePresentation": source_has_chinese_presentation(story),
        "validImage": is_valid_image(story.get("image")),
        "classified": bool(str(story.get("category") or "").strip()),
        "categoryEvidence": video or evidence_score >= 2,
        "videoSafety": is_valid_automatic_video(story),
    }
    if video:
        checks = {
            **common_checks,
            "completeBody": True,
            "structuredBody": True,
            "sourceDisclosure": True,
            "groundedGeneration": story.get("contentGenerationMode") in {
                "official-video-metadata",
                "github-models-source-grounded",
                "source-grounded-structured-fallback",
            },
        }
    else:
        checks = {
            **common_checks,
            "completeBody": count_content_characters(body) >= MIN_ARTICLE_CHARS,
            "structuredBody": has_unique_article_sections(body),
            "sourceDisclosure": has_source_disclosure(body),
            "groundedGeneration": story.get("contentGenerationMode") in {
                "github-models-source-grounded",
                "source-grounded-structured-fallback",
            },
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
    """Select daily article/source quotas and a separate video quota."""
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

    eligible: dict[int, dict[str, Any]] = {}
    for story in stories:
        if strict_eligible[id(story)]:
            audit = audits[id(story)]
            audit["mode"] = "strict"
            eligible[id(story)] = audit
            continue
        relaxed = evaluate_auto_approval(story, relaxed_policy)
        if relaxed["approved"]:
            relaxed["mode"] = "daily-target-fill"
            relaxed["dailyTargetPerCategory"] = target
            eligible[id(story)] = relaxed

    if policy.get("sourceMixEnforced") is True:
        selected: list[dict[str, Any]] = []
        selected_ids: set[int] = set()
        article_stories = [story for story in stories if not is_video_story(story) and id(story) in eligible]
        video_stories = [story for story in stories if is_video_story(story) and id(story) in eligible]
        article_stories.sort(key=story_priority, reverse=True)
        video_stories.sort(key=story_priority, reverse=True)

        categories = {str(story.get("category") or "") for story in article_stories}
        category_targets = {
            category: int((policy.get("remainingCategoryTargets") or {}).get(category, target))
            for category in categories
        }
        foreign_target = int(policy.get(
            "remainingForeignArticleTarget", policy.get("dailyForeignArticleTarget", 2)
        ))
        foreign_candidates = [story for story in article_stories if not is_chinese_source(story)]
        for story in foreign_candidates:
            category = str(story.get("category") or "")
            category_count = sum(
                str(item.get("category") or "") == category for item in selected
            )
            if len(selected) >= sum(category_targets.values()) or foreign_target <= 0:
                break
            if category_count >= category_targets.get(category, target):
                continue
            selected.append(story)
            selected_ids.add(id(story))
            foreign_target -= 1

        for category in categories:
            category_selected = [story for story in selected if str(story.get("category") or "") == category]
            category_target = category_targets[category]
            needed = max(0, category_target - len(category_selected))
            candidates = [
                story for story in article_stories
                if str(story.get("category") or "") == category and id(story) not in selected_ids
            ]
            candidates.sort(key=lambda story: (not is_chinese_source(story),) + tuple(-value for value in story_priority(story)))
            for story in candidates[:needed]:
                selected.append(story)
                selected_ids.add(id(story))

        video_target = int(policy.get("remainingVideoTarget", policy.get("dailyVideoTarget", 4)))
        for story in video_stories[:video_target]:
            selected.append(story)
            selected_ids.add(id(story))

        for story in selected:
            audit = eligible[id(story)]
            audit["approved"] = True
            audit["mode"] = "video-quota" if is_video_story(story) else (
                "foreign-source-quota" if not is_chinese_source(story) else audit.get("mode", "strict")
            )
            audits[id(story)] = audit
        return audits

    categories = {str(story.get("category") or "") for story in stories}
    for category in categories:
        category_stories = [
            story for story in stories
            if str(story.get("category") or "") == category and not is_video_story(story)
        ]
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
            relaxed = eligible.get(id(story))
            if relaxed:
                candidates.append((story, relaxed))
        candidates.sort(key=lambda item: story_priority(item[0]), reverse=True)
        for story, relaxed in candidates[: target - approved_count]:
            relaxed["mode"] = "daily-target-fill"
            relaxed["dailyTargetPerCategory"] = target
            audits[id(story)] = relaxed
    video_candidates = [story for story in stories if is_video_story(story) and id(story) in eligible]
    video_candidates.sort(key=story_priority, reverse=True)
    for story in video_candidates[:int(policy.get("dailyVideoTarget", 4))]:
        audit = eligible[id(story)]
        audit["approved"] = True
        audit["mode"] = "video-quota"
        audits[id(story)] = audit
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
        "contentGenerationError",
    }
    extra = {key: value for key, value in story.items() if key not in core_keys}
    if not is_video_story(story):
        for field in VIDEO_ONLY_FIELDS:
            extra.pop(field, None)
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
                "rightsVerified": rights_are_verified(story, body),
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
        "published_date": publication_day(imported_at) if status == "published" else parse_date(story.get("date")),
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

    effective_policy = dict(approval_policy or {"enabled": False})
    if effective_policy.get("sourceMixEnforced") is True:
        day = publication_day(imported_at)
        summary = daily_automatic_summary(existing, [], day)
        target = int(effective_policy.get("dailyTargetPerCategory", 2))
        effective_policy["remainingCategoryTargets"] = {
            category: max(0, target - summary["categories"].get(category, 0))
            for category in {str(story.get("category") or "") for story in candidates}
        }
        effective_policy["remainingForeignArticleTarget"] = max(
            0, int(effective_policy.get("dailyForeignArticleTarget", 2)) - summary["foreignArticles"]
        )
        effective_policy["remainingVideoTarget"] = max(
            0, int(effective_policy.get("dailyVideoTarget", 4)) - summary["videos"]
        )
    audits = select_auto_approval_audits(candidates, effective_policy)
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


def prepare_source_metadata_updates(
    stories: list[dict[str, Any]], existing: list[dict[str, Any]],
    site_id: str, imported_at: str,
) -> list[dict[str, Any]]:
    story_by_url = {
        normalize_url(story.get("sourceUrl") or story.get("url") or ""): story
        for story in stories
        if source_material_is_usable(story.get("sourceMaterial") or story.get("originalExcerpt"))
    }
    updates = []
    for article in existing:
        story = story_by_url.get(normalize_url(article.get("source_url", "")))
        if not story:
            continue
        current_extra = article.get("extra") if isinstance(article.get("extra"), dict) else {}
        merged_extra = dict(current_extra)
        merged_extra.update({
            "originalTitle": story.get("originalTitle") or story.get("title", ""),
            "originalExcerpt": story.get("originalExcerpt", ""),
            "sourceMaterial": story.get("sourceMaterial") or story.get("originalExcerpt", ""),
            "sourceMaterialType": story.get("sourceMaterialType", "source-metadata"),
            "translatedSourceTitle": story.get("translatedSourceTitle", ""),
            "translatedSourceMaterial": story.get("translatedSourceMaterial", ""),
            "translationProvider": story.get("translationProvider", ""),
            "translationMode": story.get("translationMode", ""),
        })
        automatic = int(article.get("id") or 0) >= AUTOMATIC_ID_BASE \
            or current_extra.get("automaticImport") is True
        body = story.get("body") or ""
        if isinstance(body, list):
            body = "\n\n".join(str(item) for item in body)
        repaired = {
            "category": story.get("category", article.get("category", "")),
            "title": story.get("title", article.get("title", "")),
            "excerpt": story.get("excerpt", article.get("excerpt", "")),
            "body": body or article.get("body", ""),
        } if automatic else {}
        unchanged_content = all(article.get(key) == value for key, value in repaired.items())
        if merged_extra == current_extra and unchanged_content:
            continue
        update = {
            "site_id": site_id,
            "id": int(article["id"]),
            "extra": merged_extra,
            "updated_at": imported_at,
        }
        update.update(repaired)
        updates.append(update)
    return updates


def daily_automatic_counts(
    existing: list[dict[str, Any]], inserted: list[dict[str, Any]], day: str
) -> dict[str, int]:
    return daily_automatic_summary(existing, inserted, day)["categories"]


def daily_automatic_summary(
    existing: list[dict[str, Any]], inserted: list[dict[str, Any]], day: str
) -> dict[str, Any]:
    counts: dict[str, int] = {}
    chinese_articles = 0
    foreign_articles = 0
    videos = 0
    for row in existing + inserted:
        extra = row.get("extra") if isinstance(row.get("extra"), dict) else {}
        audit = extra.get("automaticApproval") if isinstance(extra, dict) else {}
        if not isinstance(audit, dict):
            audit = {}
        reviewed_at = str(audit.get("reviewedAt") or "") if isinstance(audit, dict) else ""
        try:
            policy_version = int(audit.get("policyVersion") or 1)
        except (TypeError, ValueError):
            policy_version = 1
        reviewed_day = publication_day(reviewed_at) if policy_version >= 3 else (
            parse_date(row.get("published_date")) or reviewed_at[:10]
        )
        if (
            row.get("status") != "published"
            or not audit.get("approved")
            or reviewed_day != day
        ):
            continue
        story_view = {**extra, **{
            "sourceUrl": row.get("source_url") or extra.get("sourceUrl"),
            "language": row.get("language") or extra.get("language"),
        }}
        if is_video_story(story_view):
            videos += 1
            continue
        if not body_meets_publication_standard(row.get("body")):
            continue
        category = str(row.get("category") or "")
        if category:
            counts[category] = counts.get(category, 0) + 1
        if is_chinese_source(story_view):
            chinese_articles += 1
        else:
            foreign_articles += 1
    return {
        "categories": counts,
        "chineseArticles": chinese_articles,
        "foreignArticles": foreign_articles,
        "videos": videos,
    }


def prepare_promotions(
    stories: list[dict[str, Any]],
    existing: list[dict[str, Any]],
    inserted: list[dict[str, Any]],
    policy: dict[str, Any],
    imported_at: str,
    site_id: str = "main",
) -> tuple[list[dict[str, Any]], dict[str, int]]:
    """Fill today's category gaps from recent, already-imported automatic drafts."""
    day = publication_day(imported_at)
    counts = daily_automatic_counts(existing, inserted, day)
    target = int(policy.get("dailyTargetPerCategory", 3))
    try:
        video_target = int(os.environ.get("AUTO_APPROVAL_VIDEO_TARGET", 3))
    except ValueError:
        video_target = 3
    video_target = max(1, min(6, video_target))
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
        and (
            is_video_story(row.get("extra") if isinstance(row.get("extra"), dict) else {})
            or body_meets_publication_standard(row.get("body"))
        )
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

    video_candidates = [
        item
        for candidates in grouped.values()
        for item in candidates
        if item[0].get("contentKind") == "video"
    ]
    video_candidates.sort(key=lambda item: story_priority(item[0]), reverse=True)
    source_mix_enforced = policy.get("sourceMixEnforced") is True
    priority_video_ids: set[int] = set()
    strict_selected_ids: set[int] = set()
    if source_mix_enforced:
        summary = daily_automatic_summary(existing, inserted, day)
        gaps = {
            category: max(0, target - summary["categories"].get(category, 0))
            for category in grouped
        }
        article_candidates = [
            item for candidates in grouped.values() for item in candidates
            if not is_video_story(item[0])
        ]
        article_candidates.sort(key=lambda item: story_priority(item[0]), reverse=True)
        foreign_needed = max(
            0, int(policy.get("dailyForeignArticleTarget", 2)) - summary["foreignArticles"]
        )
        for item in [candidate for candidate in article_candidates if not is_chinese_source(candidate[0])]:
            category = str(item[0].get("category") or "")
            if foreign_needed <= 0 or gaps.get(category, 0) <= 0:
                continue
            strict_selected_ids.add(id(item[0]))
            gaps[category] -= 1
            foreign_needed -= 1
        for category, needed in gaps.items():
            if needed <= 0:
                continue
            candidates = [
                item for item in article_candidates
                if str(item[0].get("category") or "") == category
                and id(item[0]) not in strict_selected_ids
            ]
            candidates.sort(
                key=lambda item: (is_chinese_source(item[0]),) + story_priority(item[0]),
                reverse=True,
            )
            for item in candidates[:needed]:
                strict_selected_ids.add(id(item[0]))
        video_needed = max(0, int(policy.get("dailyVideoTarget", 4)) - summary["videos"])
        priority_video_ids = {id(story) for story, _, _ in video_candidates[:video_needed]}
        strict_selected_ids.update(priority_video_ids)
    else:
        priority_video_ids = {id(story) for story, _, _ in video_candidates[:video_target]}

    promotions: list[dict[str, Any]] = []
    for category, candidates in grouped.items():
        needed = max(0, target - counts.get(category, 0))
        candidates.sort(key=lambda item: story_priority(item[0]), reverse=True)
        if source_mix_enforced:
            selected = [item for item in candidates if id(item[0]) in strict_selected_ids]
        else:
            selected = [item for item in candidates if id(item[0]) in priority_video_ids]
            remaining_needed = max(0, needed - len(selected))
            selected.extend([
                item for item in candidates if id(item[0]) not in priority_video_ids
            ][:remaining_needed])
        for story, row, audit in selected:
            promotion_mode = "video-backfill" if id(story) in priority_video_ids else "daily-target-backfill"
            audit.update({
                "mode": promotion_mode,
                "dailyTargetPerCategory": target,
                "reviewedAt": imported_at,
                "notice": "自动审核检查中文正文、来源链接、分类和内容结构；详细来源在文章末尾简要标注。",
            })
            body = story.get("body") or ""
            if isinstance(body, list):
                body = "\n\n".join(str(item) for item in body)
            merged_extra = dict(row.get("extra") or {})
            row_fields = {
                "id", "category", "title", "excerpt", "image", "source", "sourceUrl", "url",
                "author", "language", "status", "scheduledAt", "confidence", "body", "time",
                "readMinutes", "heat", "date", "tags", "reviewChecks", "contentGenerationError",
            }
            merged_extra.update({key: value for key, value in story.items() if key not in row_fields})
            if not is_video_story(story):
                for field in VIDEO_ONLY_FIELDS:
                    merged_extra.pop(field, None)
            merged_extra.update({
                "automaticImport": True,
                "automaticFingerprint": story_fingerprint(story),
                "automaticPromotionOf": int(row["id"]),
                "originalTitle": story.get("originalTitle") or story.get("title", ""),
                "sourceMaterial": story.get("sourceMaterial") or story.get("originalExcerpt", ""),
                "translatedSourceTitle": story.get("translatedSourceTitle", ""),
                "translatedSourceMaterial": story.get("translatedSourceMaterial", ""),
                "translationProvider": story.get("translationProvider", ""),
                "translationMode": story.get("translationMode", ""),
                "automaticApproval": audit,
                "reviewChecks": {
                    "sourceVerified": True,
                    "categoryVerified": True,
                    "localizationVerified": False,
                    "rightsVerified": rights_are_verified(story, body),
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
            if not source_mix_enforced or not is_video_story(story):
                counts[category] = counts.get(category, 0) + 1
    return promotions, counts


class SupabaseRest:
    def __init__(self, base_url: str, service_key: str) -> None:
        self.base_url = base_url.rstrip("/")
        self.service_key = service_key

    def request(
        self, method: str, path: str, payload: Any = None,
        prefer: str = "resolution=ignore-duplicates,return=representation",
    ) -> Any:
        data = None if payload is None else json.dumps(payload).encode("utf-8")
        request = urllib.request.Request(
            f"{self.base_url}/rest/v1/{path}",
            data=data,
            method=method,
            headers={
                "apikey": self.service_key,
                "Content-Type": "application/json",
                "Prefer": prefer,
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
            + "&select=id,title,excerpt,source_url,body,position,category,status,time_label,language,published_date,extra,updated_at&limit=10000",
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

    def upsert_article_metadata(self, rows: list[dict[str, Any]]) -> list[dict[str, Any]]:
        if not rows:
            return []
        updated = []
        for row in rows:
            encoded_site = urllib.parse.quote(str(row["site_id"]), safe="")
            article_id = int(row["id"])
            allowed = {"category", "title", "excerpt", "body", "status", "time_label", "extra", "updated_at"}
            payload = {key: value for key, value in row.items() if key in allowed}
            result = self.request(
                "PATCH",
                f"articles?site_id=eq.{encoded_site}&id=eq.{article_id}",
                payload,
                "return=representation",
            )
            if isinstance(result, list):
                updated.extend(result)
        return updated

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
        metadata_rows = prepare_source_metadata_updates(
            stories, existing, site_id, imported_at
        )
        metadata_updated = metadata_rows if args.dry_run else client.upsert_article_metadata(metadata_rows)
        promotions, daily_counts = prepare_promotions(
            stories, existing, inserted, policy, imported_at, site_id
        )
        promoted = promotions if args.dry_run else client.insert_articles(promotions)
        demotion_rows = prepare_quality_demotions(
            existing + inserted + promoted, site_id, imported_at
        )
        quality_demoted = demotion_rows if args.dry_run else client.upsert_article_metadata(demotion_rows)
    except (OSError, ValueError, RuntimeError, json.JSONDecodeError) as exc:
        message = str(exc).replace("%", "%25").replace("\r", "%0D").replace("\n", "%0A")[:500]
        print(f"::error title=Draft sync failed::{message}", file=sys.stderr)
        print(f"Draft sync failed: {exc}", file=sys.stderr)
        return 1

    print(
        "Supabase draft sync: "
        f"inserted={len(inserted)}, duplicates={duplicates}, invalid={invalid}, "
        f"auto_published={sum(1 for row in inserted if row.get('status') == 'published')}, "
        f"source_metadata_updated={len(metadata_updated)}, "
        f"quality_demoted={len(quality_demoted)}, "
        f"promoted={len(promoted)}, "
        f"source={len(stories)}"
    )
    target = int(policy.get("dailyTargetPerCategory", 2))
    categories = sorted({
        str(story.get("category") or "") for story in stories
        if story.get("category") and not is_video_story(story)
    })
    day = publication_day(imported_at)
    summary = daily_automatic_summary(existing, inserted + promoted, day)
    published_counts = {category: summary["categories"].get(category, 0) for category in categories}
    gaps = {category: max(0, target - count) for category, count in published_counts.items()}
    print("Auto-publish by category: " + json.dumps(published_counts, ensure_ascii=False, sort_keys=True))
    print(
        "Daily source/video mix: " + json.dumps({
            "chineseArticles": summary["chineseArticles"],
            "foreignArticles": summary["foreignArticles"],
            "videos": summary["videos"],
            "publicationDay": day,
        }, ensure_ascii=False, sort_keys=True)
    )
    strict_gaps = {
        "categories": gaps,
        "chineseArticles": max(0, int(policy.get("dailyChineseArticleTarget", 10)) - summary["chineseArticles"]),
        "foreignArticles": max(0, int(policy.get("dailyForeignArticleTarget", 2)) - summary["foreignArticles"]),
        "videos": max(0, int(policy.get("dailyVideoTarget", 4)) - summary["videos"]),
        "actualSourceMix": f"{summary['chineseArticles']}:{summary['foreignArticles']}",
    }
    if any(gaps.values()):
        print(
            "Daily target gaps (no duplicate or low-quality filler was published): "
            + json.dumps(gaps, ensure_ascii=False, sort_keys=True)
        )
    target_gap_detected = policy.get("sourceMixEnforced") is True and (
        any(gaps.values())
        or summary["chineseArticles"] != int(policy.get("dailyChineseArticleTarget", 10))
        or summary["foreignArticles"] != int(policy.get("dailyForeignArticleTarget", 2))
        or strict_gaps["videos"]
    )
    if target_gap_detected:
        gap_message = json.dumps(strict_gaps, ensure_ascii=False, sort_keys=True)
        # Keep valid rows when sources are temporarily insufficient; the next
        # scheduled run can backfill the exact deficit without low-quality filler.
        if env_flag("AUTO_APPROVAL_FAIL_ON_DAILY_GAP", False):
            print(
                "::error title=Daily publication target not met::" + gap_message,
                file=sys.stderr,
            )
            return 1
        print(
            "::warning title=Daily publication target pending::" + gap_message,
            file=sys.stderr,
        )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
