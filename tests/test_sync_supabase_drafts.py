import sys
import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "scripts"))

import sync_supabase_drafts as sync  # noqa: E402


class SupabaseDraftSyncTests(unittest.TestCase):
    def rich_story(self):
        sections = []
        for index, heading in enumerate([
            "Event overview", "Background", "Key progress",
            "Applications", "Limitations", "Verification",
        ]):
            sections.append(
                f"{heading}\n\n" +
                ((f"Verified source context for section {index} explains the evidence and its boundaries. ") * 4)
            )
        return {
            "title": "A major battery storage project reaches commercial operation",
            "excerpt": "A detailed public summary explains the technology, capacity, participants, and expected industry impact.",
            "body": "\n\n".join(sections) + "\n\n来源与审核说明\n\nDetails remain traceable to the named source.",
            "source": "Official Energy Agency",
            "sourceUrl": "https://example.com/energy/story",
            "image": "https://cdn.example.com/energy.jpg",
            "category": "能源",
            "categoryEvidenceScore": 4,
            "confidence": 93,
            "sourceTrustLevel": "authoritative",
            "contentGenerationMode": "github-models-source-grounded",
            "status": "review",
        }

    def test_normalize_url_removes_tracking_parameters(self):
        self.assertEqual(
            sync.normalize_url("HTTPS://Example.com/news/?utm_source=x&id=7#top"),
            "https://example.com/news?id=7",
        )

    def test_published_input_is_forced_to_draft(self):
        row = sync.article_row(
            {"title": "New technology", "sourceUrl": "https://example.com/1", "status": "published"},
            "main",
            3,
            "2026-08-01T00:00:00+00:00",
        )
        self.assertEqual(row["status"], "draft")
        self.assertIsNone(row["scheduled_at"])
        self.assertTrue(row["extra"]["automaticImport"])

    def test_automatic_id_is_stable_and_javascript_safe(self):
        fingerprint = sync.story_fingerprint(
            {"title": "A", "sourceUrl": "https://example.com/article"}
        )
        first = sync.automatic_article_id(fingerprint)
        second = sync.automatic_article_id(fingerprint)
        self.assertEqual(first, second)
        self.assertLessEqual(first, sync.MAX_SAFE_INTEGER)

    def test_prepare_rows_skips_existing_url_and_title(self):
        existing = [
            {
                "id": 1,
                "title": "Existing story",
                "source_url": "https://example.com/old?utm_source=rss",
                "position": 5,
            }
        ]
        stories = [
            {"title": "Different", "sourceUrl": "https://example.com/old"},
            {"title": "Existing story", "sourceUrl": "https://example.com/new"},
            {"title": "Fresh story", "sourceUrl": "https://example.com/fresh", "status": "review"},
        ]
        rows, duplicates, invalid = sync.prepare_rows(
            stories, existing, "main", "2026-08-01T00:00:00+00:00"
        )
        self.assertEqual(len(rows), 1)
        self.assertEqual(rows[0]["title"], "Fresh story")
        self.assertEqual(rows[0]["position"], 6)
        self.assertEqual(rows[0]["status"], "review")
        self.assertEqual(duplicates, 2)
        self.assertEqual(invalid, 0)

    def test_prepare_rows_deduplicates_the_same_batch(self):
        stories = [
            {"title": "Same", "sourceUrl": "https://example.com/a"},
            {"title": "Same", "sourceUrl": "https://example.com/b"},
        ]
        rows, duplicates, invalid = sync.prepare_rows(
            stories, [], "main", "2026-08-01T00:00:00+00:00"
        )
        self.assertEqual(len(rows), 1)
        self.assertEqual(duplicates, 1)
        self.assertEqual(invalid, 0)

    def test_prepare_rows_rejects_missing_source_url(self):
        rows, duplicates, invalid = sync.prepare_rows(
            [{"title": "Draft without a source link", "sourceUrl": ""}],
            [],
            "main",
            "2026-08-02T00:00:00+00:00",
        )
        self.assertEqual(rows, [])
        self.assertEqual(duplicates, 0)
        self.assertEqual(invalid, 1)

    def test_strict_auto_review_publishes_complete_trusted_story(self):
        policy = {"enabled": True, "minConfidence": 85, "policyVersion": 1}
        row = sync.article_row(
            self.rich_story(), "main", 0, "2026-08-02T00:00:00+00:00", policy
        )
        self.assertEqual(row["status"], "published")
        self.assertEqual(row["time_label"], "自动审核通过")
        self.assertTrue(row["extra"]["automaticApproval"]["approved"])

    def test_auto_review_keeps_low_confidence_story_pending(self):
        story = self.rich_story()
        story["confidence"] = 79
        policy = {"enabled": True, "minConfidence": 85, "policyVersion": 1}
        row = sync.article_row(
            story, "main", 0, "2026-08-02T00:00:00+00:00", policy
        )
        self.assertEqual(row["status"], "review")
        self.assertFalse(row["extra"]["automaticApproval"]["approved"])

    def test_auto_review_rejects_body_shorter_than_800_characters(self):
        story = self.rich_story()
        story["body"] = "简短正文。\n\n来源与审核说明\n\n请查看原文。"
        policy = {"enabled": True, "minConfidence": 85, "policyVersion": 2}
        row = sync.article_row(
            story, "main", 0, "2026-08-02T00:00:00+00:00", policy
        )
        self.assertEqual(row["status"], "review")
        self.assertFalse(row["extra"]["automaticApproval"]["checks"]["completeBody"])

    def test_auto_review_can_be_disabled(self):
        policy = {"enabled": False, "minConfidence": 85, "policyVersion": 1}
        row = sync.article_row(
            self.rich_story(), "main", 0, "2026-08-02T00:00:00+00:00", policy
        )
        self.assertEqual(row["status"], "review")

    def test_auto_review_rejects_weak_category_relevance(self):
        story = self.rich_story()
        story["categoryEvidenceScore"] = 0
        policy = {"enabled": True, "minConfidence": 85, "policyVersion": 1}
        row = sync.article_row(
            story, "main", 0, "2026-08-02T00:00:00+00:00", policy
        )
        self.assertEqual(row["status"], "review")
        self.assertFalse(row["extra"]["automaticApproval"]["checks"]["categoryEvidence"])

    def test_daily_target_uses_three_newest_safe_candidates_per_category(self):
        stories = []
        for index, date in enumerate(["2026-07-29", "2026-07-30", "2026-07-31", "2026-08-01"]):
            story = self.rich_story()
            story["title"] = f"Battery storage project update number {index}"
            story["sourceUrl"] = f"https://example.com/energy/{index}"
            story["confidence"] = 80
            story["sourceTrustLevel"] = "standard"
            story["date"] = date
            stories.append(story)
        policy = {
            "enabled": True,
            "minConfidence": 85,
            "fallbackMinConfidence": 78,
            "dailyTargetPerCategory": 3,
            "policyVersion": 1,
        }
        rows, duplicates, invalid = sync.prepare_rows(
            stories, [], "main", "2026-08-02T00:00:00+00:00", policy
        )
        published = [row for row in rows if row["status"] == "published"]
        self.assertEqual(len(published), 3)
        self.assertNotIn("number 0", " ".join(row["title"] for row in published))
        self.assertTrue(all(
            row["extra"]["automaticApproval"]["mode"] == "daily-target-fill"
            for row in published
        ))
        self.assertEqual((duplicates, invalid), (0, 0))

    def test_daily_target_backfills_an_existing_automatic_draft(self):
        story = self.rich_story()
        fingerprint = sync.story_fingerprint(story)
        existing = [{
            "id": sync.automatic_article_id(fingerprint),
            "title": story["title"],
            "source_url": story["sourceUrl"],
            "category": story["category"],
            "status": "review",
            "extra": {"automaticImport": True},
            "position": 2,
        }]
        policy = {
            "enabled": True,
            "minConfidence": 85,
            "fallbackMinConfidence": 78,
            "dailyTargetPerCategory": 3,
            "policyVersion": 1,
        }
        promotions, counts = sync.prepare_promotions(
            [story], existing, [], policy, "2026-08-02T08:00:00+00:00"
        )
        self.assertEqual(len(promotions), 1)
        self.assertEqual(promotions[0]["status"], "published")
        self.assertEqual(
            promotions[0]["extra"]["automaticApproval"]["mode"],
            "daily-target-backfill",
        )
        self.assertEqual(promotions[0]["extra"]["automaticPromotionOf"], existing[0]["id"])
        self.assertGreaterEqual(promotions[0]["id"], sync.AUTOMATIC_PROMOTION_ID_BASE)
        self.assertTrue(promotions[0]["source_url"].endswith("#information-share-2026-08-02"))
        self.assertEqual(counts["能源"], 1)

    def test_daily_counts_ignores_null_automatic_approval_metadata(self):
        existing = [{
            "id": sync.AUTOMATIC_ID_BASE + 1,
            "category": "能源",
            "status": "published",
            "extra": {"automaticApproval": None},
        }]
        self.assertEqual(
            sync.daily_automatic_counts(existing, [], "2026-08-02"), {}
        )

    def test_daily_target_replaces_a_legacy_short_published_article(self):
        story = self.rich_story()
        fingerprint = sync.story_fingerprint(story)
        legacy = {
            "id": sync.automatic_article_id(fingerprint),
            "title": story["title"],
            "source_url": story["sourceUrl"],
            "category": story["category"],
            "status": "published",
            "body": "旧版短正文\n\n来源与审核说明\n\n待补充。",
            "extra": {"automaticImport": True, "automaticApproval": {"approved": True}},
            "position": 2,
        }
        policy = {
            "enabled": True,
            "minConfidence": 85,
            "fallbackMinConfidence": 78,
            "dailyTargetPerCategory": 3,
            "policyVersion": 2,
        }
        promotions, counts = sync.prepare_promotions(
            [story], [legacy], [], policy, "2026-08-02T08:00:00+00:00"
        )
        self.assertEqual(len(promotions), 1)
        self.assertEqual(promotions[0]["status"], "published")
        self.assertEqual(counts["能源"], 1)

    def test_daily_target_can_replace_legacy_row_without_import_metadata(self):
        story = self.rich_story()
        legacy = {
            "id": 42,
            "title": story["title"],
            "source_url": story["sourceUrl"],
            "category": story["category"],
            "status": "published",
            "body": "旧版短正文",
            "extra": {},
            "position": 2,
        }
        policy = {
            "enabled": True,
            "minConfidence": 85,
            "fallbackMinConfidence": 78,
            "dailyTargetPerCategory": 3,
            "policyVersion": 2,
        }
        promotions, counts = sync.prepare_promotions(
            [story], [legacy], [], policy, "2026-08-03T08:00:00+00:00"
        )
        self.assertEqual(len(promotions), 1)
        self.assertEqual(promotions[0]["extra"]["automaticPromotionOf"], 42)
        self.assertEqual(counts["能源"], 1)


if __name__ == "__main__":
    unittest.main()
