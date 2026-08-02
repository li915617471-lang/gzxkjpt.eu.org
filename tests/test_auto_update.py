import sys
import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "scripts"))

import auto_update  # noqa: E402


class CategoryTests(unittest.TestCase):
    def setUp(self):
        self.rules = auto_update.CATEGORY_RULES

    def test_short_ascii_keyword_does_not_match_inside_word(self):
        category = auto_update.categorize(
            "A remote community built a fast fiber network",
            "The service remains available around the bay.",
            "科技",
            self.rules,
        )
        self.assertEqual(category, "科技")

    def test_title_keyword_overrides_source_hint(self):
        category = auto_update.categorize(
            "An overlooked geothermal plant gets a second chance",
            "A new project is under development.",
            "科技",
            self.rules,
        )
        self.assertEqual(category, "能源")

    def test_source_hint_wins_without_domain_keywords(self):
        category = auto_update.categorize(
            "Commercial inventories increased this week",
            "The official agency published its latest report.",
            "能源",
            self.rules,
        )
        self.assertEqual(category, "能源")

    def test_exact_ai_keyword_is_still_detected(self):
        category = auto_update.categorize(
            "AI is changing software development",
            "New tools are being tested.",
            "人文",
            self.rules,
        )
        self.assertEqual(category, "科技")

    def test_retained_automatic_story_is_reclassified(self):
        stories = [{
            "title": "A remote community built a fast fiber network",
            "excerpt": "The service remains available around the bay.",
            "category": "金融",
            "collectionSourceId": "ieee",
        }]
        sources = [{"id": "ieee", "categoryHint": "科技"}]
        updated = auto_update.refresh_retained_categories(stories, sources, self.rules)
        self.assertEqual(updated[0]["category"], "科技")


class RichDraftTests(unittest.TestCase):
    def test_source_page_parser_extracts_leading_text_and_image(self):
        parser = auto_update.PageMetadataParser()
        parser.feed("""
          <html><head><meta property="og:image" content="https://cdn.example.com/page.jpg"></head>
          <body><nav><p>Navigation text must be ignored.</p></nav><main>
            <p>Published today</p>
            <ul><li>This official update explains the first important development in enough detail.</li></ul>
            <p>The opening paragraph provides useful context for a concise educational summary.</p>
          </main></body></html>
        """)
        self.assertEqual(parser.image, "https://cdn.example.com/page.jpg")
        self.assertEqual(len(parser.blocks), 2)
        self.assertIn("official update", parser.blocks[0])

    def test_media_content_image_is_parsed(self):
        raw = b"""<?xml version='1.0'?>
        <rss xmlns:media='http://search.yahoo.com/mrss/'><channel><item>
          <title>New industrial robot</title>
          <link>https://example.com/story</link>
          <description>Useful public summary</description>
          <media:content url='https://cdn.example.com/robot.jpg' type='image/jpeg'/>
        </item></channel></rss>"""
        parsed = auto_update.parse_feed(raw)
        self.assertEqual(parsed[0]["image"], "https://cdn.example.com/robot.jpg")

    def test_namespaced_rss_item_is_parsed(self):
        raw = b"""<?xml version='1.0'?>
        <rdf:RDF xmlns:rdf='http://www.w3.org/1999/02/22-rdf-syntax-ns#'
          xmlns='http://purl.org/rss/1.0/'><item>
          <title>Central bank research update</title>
          <link>https://example.com/research</link>
          <description>Official research summary</description>
        </item></rdf:RDF>"""
        parsed = auto_update.parse_feed(raw)
        self.assertEqual(parsed[0]["title"], "Central bank research update")

    def test_html_image_and_relative_url_are_parsed(self):
        raw = b"""<?xml version='1.0'?>
        <rss><channel><item>
          <title>Energy storage update</title>
          <link>https://example.com/news/item</link>
          <description><![CDATA[<p>Summary</p><img src='/images/storage.webp'>]]></description>
        </item></channel></rss>"""
        parsed = auto_update.parse_feed(raw)
        self.assertEqual(parsed[0]["image"], "https://example.com/images/storage.webp")

    def test_tracking_image_is_rejected(self):
        self.assertEqual(
            auto_update.safe_image_url("https://example.com/tracking-pixel.gif"),
            "",
        )

    def test_story_uses_category_cover_without_feed_image(self):
        source = {
            "name": "Test Source", "categoryHint": "能源", "confidence": 85,
            "trustLevel": "professional", "language": "en",
        }
        entry = {
            "title": "Battery storage reaches a new milestone",
            "summary": "A sufficiently detailed public summary about a new storage project.",
            "link": "https://example.com/storage", "published": "", "image": "",
        }
        story = auto_update.make_story(entry, source, 0, auto_update.CATEGORY_RULES)
        self.assertEqual(story["image"], "assets/energy.jpg")
        self.assertEqual(story["imageFallback"], "assets/energy.jpg")
        self.assertIn("来源与审核说明", story["body"])
        self.assertIn("Test Source", story["body"])

    def test_long_summary_is_safely_truncated(self):
        text = "renewable energy storage " * 30
        shortened = auto_update.truncate_text(text, 80)
        self.assertLessEqual(len(shortened), 81)
        self.assertTrue(shortened.endswith("…"))

    def test_publication_standard_requires_800_characters_and_unique_sections(self):
        body = "\n\n".join(
            f"第{index}节\n\n" + (f"这是第{index}节基于来源材料整理的独立内容。" * 12)
            for index in range(6)
        ) + "\n\n来源与审核说明\n\n请以原始来源为准。"
        self.assertTrue(auto_update.body_meets_publication_standard(body))
        self.assertFalse(auto_update.body_meets_publication_standard("短文\n\n来源与审核说明"))


if __name__ == "__main__":
    unittest.main()
