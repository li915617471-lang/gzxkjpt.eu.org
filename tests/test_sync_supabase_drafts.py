import sys
import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "scripts"))

import sync_supabase_drafts as sync  # noqa: E402


class SupabaseDraftSyncTests(unittest.TestCase):
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


if __name__ == "__main__":
    unittest.main()
