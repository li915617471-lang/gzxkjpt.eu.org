import sys
import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "scripts"))

import sync_supabase_drafts as sync  # noqa: E402


class SupabaseDraftSyncTests(unittest.TestCase):
    def rich_story(self):
        return {
            "title": "A major battery storage project reaches commercial operation",
            "excerpt": "A detailed public summary explains the technology, capacity, participants, and expected industry impact.",
            "body": "Automatic collection summary\n\n" + ("Detailed verified source context. " * 8),
            "source": "Official Energy Agency",
            "sourceUrl": "https://example.com/energy/story",
            "image": "https://cdn.example.com/energy.jpg",
            "category": "能源",
            "categoryEvidenceScore": 4,
            "confidence": 93,
            "sourceTrustLevel": "authoritative",
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


if __name__ == "__main__":
    unittest.main()
