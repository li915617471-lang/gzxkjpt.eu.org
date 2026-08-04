import os
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

    def test_source_material_rejects_navigation_noise(self):
        navigation = "地区 安徽省 广西壮族自治区 河南省 吉林省 江西省 山东省 云南省 浙江省 重庆市"
        self.assertFalse(auto_update.source_material_is_usable(navigation))
        repeated_with_filler = (
            "这是一个长度足够的重复导航内容片段，用于模拟错误页面正文。" * 2
            + "后面即使继续拼接大段通用背景文字，也不能把它当作原始公开内容。"
        )
        self.assertFalse(auto_update.source_material_is_usable(repeated_with_filler))
        self.assertTrue(auto_update.source_material_is_usable(
            "氦气是一种重要的战略资源，公开资料介绍了供应来源、提取过程和实际应用。"
        ))

    def test_retained_story_cleans_legacy_navigation_body(self):
        material = "氦气是一种重要的战略资源，公开资料介绍了供应来源、提取过程和实际应用。"
        story = {
            "collectionSourceId": "official-source",
            "source": "中国数字科技馆",
            "category": "科技",
            "sourceMaterial": material,
            "excerpt": "地区 安徽省 广西壮族自治区 河南省 吉林省 江西省 山东省 云南省 浙江省 重庆市",
            "body": "地区 安徽省 广西壮族自治区 河南省 吉林省 江西省 山东省 云南省 浙江省 重庆市",
            "status": "published",
        }
        cleaned = auto_update.refresh_retained_source_material([story])[0]
        self.assertEqual(cleaned["excerpt"], material)
        self.assertEqual(cleaned["status"], "review")
        self.assertNotIn("安徽省", cleaned["body"])
        self.assertEqual(cleaned["contentGenerationMode"], "pending-editorial-expansion")

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

    def test_chinese_official_html_list_is_parsed_with_path_filter(self):
        raw = """
        <html><body><nav><a href='/index.html'>网站首页入口</a></nav>
        <a href='/news/202608/t20260803_1001.html'>中国官方机构发布新一轮科技项目进展</a>
        <a href='/other/202608/t20260803_1002.html'>不属于目标栏目的内容</a></body></html>
        """.encode("utf-8")
        source = {
            "url": "https://example.cn/news/",
            "format": "html",
            "linkPattern": r"^/news/\d{6}/t\d+_\d+\.html$",
        }
        parsed = auto_update.parse_source(raw, source)
        self.assertEqual(len(parsed), 1)
        self.assertEqual(parsed[0]["published"], "2026-08-03")
        self.assertEqual(parsed[0]["link"], "https://example.cn/news/202608/t20260803_1001.html")

    def test_html_image_alt_and_cover_are_parsed_inside_link(self):
        raw = b"""<html><body>
        <a href='http://www.cdstm.cn/videos/Tops/v600/art/2026/art_abcdef123456.html'>
          <img src='/covers/science.jpg' title='A useful Chinese science video title'>
        </a>
        </body></html>"""
        source = {
            "url": "https://www.cdstm.cn/",
            "format": "html",
            "linkPattern": r"^/videos/.+/art/[0-9]{4}/art_[a-f0-9]+\.html$",
        }
        parsed = auto_update.parse_source(raw, source)
        self.assertEqual(len(parsed), 1)
        self.assertEqual(parsed[0]["title"], "A useful Chinese science video title")
        self.assertEqual(parsed[0]["image"], "https://www.cdstm.cn/covers/science.jpg")
        self.assertTrue(parsed[0]["link"].startswith("https://www.cdstm.cn/"))

    def test_kepuchina_parser_only_returns_video_slides(self):
        raw = b"""<html><body>
        <div class='swiper-slide'>
          <a href='/article/articleinfo?business_type=100&amp;classify=2&amp;ar_id=724733'>
            <img class='block-img' src='/covers/ai.jpg'>
          </a>
          <img class='play-video' movie-url='https://cdn.example.com/video.mp4'>
          <a href='/article/articleinfo?business_type=100&amp;classify=2&amp;ar_id=724733'>
            Understanding modern artificial intelligence reasoning
          </a>
        </div>
        <div class='swiper-slide'>
          <a href='/article/articleinfo?business_type=100&amp;classify=1&amp;ar_id=999999'>
            This ordinary article is not a video
          </a>
        </div>
        </body></html>"""
        source = {"url": "https://www.kepuchina.cn/", "format": "kepuchina-video"}
        parsed = auto_update.parse_source(raw, source)
        self.assertEqual(len(parsed), 1)
        self.assertEqual(parsed[0]["externalId"], "724733")
        self.assertEqual(parsed[0]["image"], "https://www.kepuchina.cn/covers/ai.jpg")
        self.assertEqual(
            parsed[0]["link"],
            "https://www.kepuchina.cn/article/articleinfo?business_type=100&classify=2&ar_id=724733",
        )

    def test_chinese_official_json_list_is_parsed(self):
        raw = """{"datasource":[{"showTitle":"国家能源领域发布新的政策信息","publishUrl":"/news/202608/item.html","publishTime":"2026-08-03 09:00:00","titleImages":[{"imageUrl":"/images/energy.jpg"}]}]}""".encode("utf-8")
        parsed = auto_update.parse_source(raw, {"url": "https://energy.example.cn/list.json", "format": "json"})
        self.assertEqual(parsed[0]["title"], "国家能源领域发布新的政策信息")
        self.assertEqual(parsed[0]["link"], "https://energy.example.cn/news/202608/item.html")
        self.assertEqual(parsed[0]["image"], "https://energy.example.cn/images/energy.jpg")

    def test_cctv_video_json_list_is_parsed(self):
        raw = """{"data":{"list":[{"guid":"video-guid","id":"VIDE123","time":"2026-08-03 09:00:00","title":"《创新进行时》 海中机器鱼","length":"00:18:52","image":"https://p3.img.cctvpic.com/video.jpg","brief":"本期节目介绍机器鱼的结构、控制方法和海洋应用。","url":"https://tv.cctv.com/2026/08/03/VIDE123.shtml"}]}}""".encode("utf-8")
        source = {"url": "https://api.cntv.cn/video/list", "format": "json"}
        parsed = auto_update.parse_source(raw, source)
        self.assertEqual(parsed[0]["title"], "《创新进行时》 海中机器鱼")
        self.assertEqual(parsed[0]["duration"], "00:18:52")
        self.assertEqual(parsed[0]["externalId"], "video-guid")
        self.assertEqual(parsed[0]["link"], "https://tv.cctv.com/2026/08/03/VIDE123.shtml")

    def test_video_source_adds_safe_home_video_fields(self):
        source = {
            "id": "cctv-video", "name": "中央广播电视总台", "categoryHint": "科技",
            "confidence": 97, "trustLevel": "authoritative", "language": "zh-CN",
            "contentKind": "video", "videoType": "external", "videoLinkOnly": True,
            "videoRightsConfirmed": True, "homeVideoFeatured": True, "homeVideoPriority": 80,
        }
        entry = {
            "title": "机器鱼水下控制技术取得新进展",
            "summary": "节目介绍机器鱼的结构设计、运动控制、测试过程和海洋应用方向。",
            "link": "https://tv.cctv.com/video.shtml", "published": "2026-08-03",
            "image": "https://p3.img.cctvpic.com/video.jpg", "duration": "00:18:52",
            "externalId": "video-guid",
        }
        story = auto_update.make_story(entry, source, 0, auto_update.CATEGORY_RULES)
        self.assertEqual(story["contentKind"], "video")
        self.assertEqual(story["videoType"], "external")
        self.assertEqual(story["videoUrl"], entry["link"])
        self.assertTrue(story["videoLinkOnly"])
        self.assertEqual(story["videoPoster"], entry["image"])
        self.assertTrue(story["videoRightsConfirmed"])
        self.assertTrue(story["homeVideoFeatured"])
        self.assertEqual(story["homeVideoPriority"], 80)
        self.assertEqual(story["videoDuration"], "00:18:52")
        self.assertGreaterEqual(story["categoryEvidenceScore"], 2)

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
        self.assertIn("简要来源", story["body"])
        self.assertIn("公开来源机构", story["body"])

    def test_long_summary_is_safely_truncated(self):
        text = "renewable energy storage " * 30
        shortened = auto_update.truncate_text(text, 80)
        self.assertLessEqual(len(shortened), 81)
        self.assertTrue(shortened.endswith("…"))

    def test_publication_standard_requires_800_characters_and_unique_sections(self):
        body = "\n\n".join(
            f"第{index}节\n\n" + (f"这是第{index}节基于来源材料整理的独立内容。" * 12)
            for index in range(6)
        ) + "\n\n简要来源\n\n请以原始来源为准。"
        self.assertTrue(auto_update.body_meets_publication_standard(body))
        self.assertFalse(auto_update.body_meets_publication_standard("短文\n\n简要来源"))

    def test_publication_standard_rejects_long_english_body(self):
        body = "\n\n".join(
            f"第{index}节\n\n" + (f"这是第{index}节基于来源材料整理的独立内容。" * 12)
            for index in range(6)
        )
        body += "\n\nThis paragraph keeps a long English sentence that should not be published as Chinese content.\n\n简要来源\n\n请以原始来源为准。"
        self.assertFalse(auto_update.body_meets_publication_standard(body))

    def test_structured_fallback_is_long_and_source_transparent(self):
        story = {
            "category": "科技",
            "source": "NIST",
            "sourceUrl": "https://example.com/research",
            "originalTitle": "A semiconductor research update",
            "title": "A semiconductor research update",
            "excerpt": "A public summary describes a semiconductor research project and its measurements.",
            "sourceMaterial": "The source page provides context about the experiment, measurements, and limitations.",
        }
        article = auto_update.build_structured_article(story)
        self.assertEqual(article["title"].startswith("科技前沿观察："), True)
        self.assertGreaterEqual(auto_update.count_content_characters(article["body"]), 800)
        self.assertTrue(auto_update.body_meets_publication_standard(article["body"]))
        self.assertNotIn("NIST", article["body"])
        self.assertEqual(article["body"].count("简要来源"), 1)
        self.assertNotIn("这段材料只用于", article["body"])
        self.assertNotIn("平台整理时", article["body"])
        self.assertNotIn("读者如何核验", article["body"])
        self.assertNotIn("局限与待观察", article["body"])

    def test_structured_fallback_handles_title_only_source_material(self):
        article = auto_update.build_structured_article({
            "category": "金融",
            "source": "Federal Reserve",
            "sourceUrl": "https://example.com/enforcement",
            "originalTitle": "Federal Reserve Board enforcement action",
            "title": "Federal Reserve Board enforcement action",
            "sourceMaterial": "Federal Reserve Board enforcement action",
        })
        self.assertTrue(auto_update.body_meets_publication_standard(article["body"]))

    def test_structured_fallback_uses_specific_chinese_topic(self):
        article = auto_update.build_structured_article({
            "category": "能源",
            "source": "U.S. Energy Information Administration",
            "sourceUrl": "https://example.com/oil",
            "originalTitle": "China's crude oil imports fell in the second quarter",
            "title": "China's crude oil imports fell in the second quarter",
            "sourceMaterial": "China's crude oil imports fell in the second quarter",
        })
        self.assertIn("中国原油进口变化", article["title"])
        self.assertNotIn("crude oil", article["body"].lower())

    def test_force_structured_fallback_enhances_queue_without_model_token(self):
        previous_force = os.environ.get("ARTICLE_FORCE_STRUCTURED_FALLBACK")
        previous_token = os.environ.get("GITHUB_MODELS_TOKEN")
        os.environ["ARTICLE_FORCE_STRUCTURED_FALLBACK"] = "true"
        os.environ.pop("GITHUB_MODELS_TOKEN", None)
        try:
            story = {
                "category": "能源",
                "source": "U.S. Energy Information Administration",
                "sourceUrl": "https://example.com/oil",
                "originalTitle": "China's crude oil imports fell in the second quarter",
                "title": "China's crude oil imports fell in the second quarter",
                "excerpt": "China's crude oil imports fell in the second quarter",
                "sourceMaterial": "China's crude oil imports fell in the second quarter",
                "image": "assets/energy.jpg",
            }
            stats = auto_update.enhance_queue_bodies([story], ["能源"])
            self.assertEqual(stats["generated"], 1)
            self.assertIn("中国原油进口变化", story["title"])
            self.assertTrue(auto_update.body_meets_publication_standard(story["body"]))
        finally:
            if previous_force is None:
                os.environ.pop("ARTICLE_FORCE_STRUCTURED_FALLBACK", None)
            else:
                os.environ["ARTICLE_FORCE_STRUCTURED_FALLBACK"] = previous_force
            if previous_token is None:
                os.environ.pop("GITHUB_MODELS_TOKEN", None)
            else:
                os.environ["GITHUB_MODELS_TOKEN"] = previous_token

    def test_generation_target_keeps_two_article_daily_minimum(self):
        previous_target = os.environ.get("ARTICLE_GENERATION_TARGET_PER_CATEGORY")
        previous_force = os.environ.get("ARTICLE_FORCE_STRUCTURED_FALLBACK")
        os.environ["ARTICLE_GENERATION_TARGET_PER_CATEGORY"] = "1"
        os.environ["ARTICLE_FORCE_STRUCTURED_FALLBACK"] = "true"
        try:
            queue = []
            for index in range(2):
                queue.append({
                    "category": "能源",
                    "source": "公开机构",
                    "sourceUrl": f"https://example.com/energy/{index}",
                    "originalTitle": f"能源进展 {index}",
                    "title": f"能源进展 {index}",
                    "excerpt": "公开材料说明一项能源系统进展。",
                    "sourceMaterial": "公开材料说明一项能源系统进展。",
                    "image": "assets/energy.jpg",
                })
            stats = auto_update.enhance_queue_bodies(queue, ["能源"])
            self.assertEqual(stats["generated"], 2)
        finally:
            if previous_target is None:
                os.environ.pop("ARTICLE_GENERATION_TARGET_PER_CATEGORY", None)
            else:
                os.environ["ARTICLE_GENERATION_TARGET_PER_CATEGORY"] = previous_target
            if previous_force is None:
                os.environ.pop("ARTICLE_FORCE_STRUCTURED_FALLBACK", None)
            else:
                os.environ["ARTICLE_FORCE_STRUCTURED_FALLBACK"] = previous_force

    def test_video_has_separate_generation_quota(self):
        previous_article_target = os.environ.get("ARTICLE_GENERATION_TARGET_PER_CATEGORY")
        previous_video_target = os.environ.get("VIDEO_GENERATION_TARGET")
        previous_force = os.environ.get("ARTICLE_FORCE_STRUCTURED_FALLBACK")
        os.environ["ARTICLE_GENERATION_TARGET_PER_CATEGORY"] = "2"
        os.environ["VIDEO_GENERATION_TARGET"] = "1"
        os.environ["ARTICLE_FORCE_STRUCTURED_FALLBACK"] = "true"
        try:
            queue = []
            for index in range(3):
                queue.append({
                    "category": "科技", "title": f"人工智能最新进展 {index}",
                    "originalTitle": f"人工智能最新进展 {index}",
                    "excerpt": "公开资料介绍人工智能研究、测试方法、应用方向与限制条件。",
                    "sourceMaterial": "公开资料介绍人工智能研究、测试方法、应用方向与限制条件。",
                    "source": "官方科技机构", "sourceUrl": f"https://example.com/ai/{index}",
                    "originalPublishedAt": f"2026-08-0{index + 1}", "image": "assets/datacenter.jpg",
                })
            video = {
                "category": "科技", "contentKind": "video", "title": "仿生机器鱼科普视频",
                "originalTitle": "仿生机器鱼科普视频",
                "excerpt": "官方节目介绍仿生机器鱼的结构、控制方法、试验过程和海洋应用。",
                "sourceMaterial": "官方节目介绍仿生机器鱼的结构、控制方法、试验过程和海洋应用。",
                "source": "中央广播电视总台", "sourceUrl": "https://tv.cctv.com/video.shtml",
                "originalPublishedAt": "2026-07-01", "image": "https://p3.img.cctvpic.com/video.jpg",
            }
            queue.append(video)
            stats = auto_update.enhance_queue_bodies(queue, ["科技"])
            self.assertEqual(stats["generated"], 3)
            self.assertTrue(auto_update.body_meets_publication_standard(video["body"]))
        finally:
            if previous_article_target is None:
                os.environ.pop("ARTICLE_GENERATION_TARGET_PER_CATEGORY", None)
            else:
                os.environ["ARTICLE_GENERATION_TARGET_PER_CATEGORY"] = previous_article_target
            if previous_video_target is None:
                os.environ.pop("VIDEO_GENERATION_TARGET", None)
            else:
                os.environ["VIDEO_GENERATION_TARGET"] = previous_video_target
            if previous_force is None:
                os.environ.pop("ARTICLE_FORCE_STRUCTURED_FALLBACK", None)
            else:
                os.environ["ARTICLE_FORCE_STRUCTURED_FALLBACK"] = previous_force


if __name__ == "__main__":
    unittest.main()
