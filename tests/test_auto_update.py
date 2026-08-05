import os
import sys
import unittest
from pathlib import Path
from unittest import mock


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

    def test_category_scores_keep_source_hint_but_title_has_more_weight(self):
        scores = auto_update.category_score_map(
            "量子计算纠错取得新进展",
            "研究团队公布芯片和量子比特测试结果。",
            "人文",
            self.rules,
        )
        self.assertGreater(scores["科技"], scores["人文"])


class RichDraftTests(unittest.TestCase):
    def test_source_date_is_normalized_and_used_as_public_date(self):
        story = auto_update.make_story(
            {
                "title": "储能系统发布最新测试结果",
                "summary": "该项目公开了电网储能系统的测试条件、运行数据和后续部署安排。",
                "link": "https://example.com/storage",
                "published": "Tue, 04 Aug 2026 09:30:00 GMT",
            },
            {
                "name": "能源研究机构", "categoryHint": "能源", "language": "zh-CN",
                "confidence": 95, "trustLevel": "authoritative", "type": "official",
            },
            0,
            auto_update.CATEGORY_RULES,
        )
        self.assertEqual(story["date"], "2026-08-04")
        self.assertTrue(story["sourcePublishedAt"].startswith("2026-08-04T09:30:00"))
        self.assertIn("能源", story["categoryScores"])

    def test_stale_source_entry_is_rejected(self):
        now = auto_update.datetime(2026, 8, 5, tzinfo=auto_update.timezone.utc)
        self.assertFalse(auto_update.story_is_recent(
            {"originalPublishedAt": "2026-05-01"}, now=now, max_age_days=45,
        ))
        self.assertTrue(auto_update.story_is_recent(
            {"originalPublishedAt": "2026-08-01"}, now=now, max_age_days=45,
        ))

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

    def test_source_material_removes_embedded_styles_and_footer(self):
        value = (
            ".trs_import_a1{text-align:justify;font-size:10px} "
            "国家统计机构公布了工业生产资料价格变化，并说明了调查范围和统计方法。"
            " 网站识别码bm00000000 京ICP备00000000号"
        )
        cleaned = auto_update.clean_source_material(value)
        self.assertNotIn("text-align", cleaned)
        self.assertNotIn("网站识别码", cleaned)
        self.assertTrue(cleaned.startswith("国家统计机构"))

    def test_retained_category_uses_original_source_fields_not_generated_prefix(self):
        story = {
            "title": "科技前沿观察：通用标题",
            "originalTitle": "Battery storage expands grid capacity",
            "sourceMaterial": "The energy project adds battery storage to the electricity grid.",
            "excerpt": "科技领域通用背景",
            "category": "科技",
            "collectionSourceId": "energy-source",
        }
        updated = auto_update.refresh_retained_categories(
            [story], [{"id": "energy-source", "categoryHint": "能源"}], auto_update.CATEGORY_RULES,
        )
        self.assertEqual(updated[0]["category"], "能源")

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
            "originalTitle": "半导体研究项目公布新的测量结果",
            "title": "半导体研究项目公布新的测量结果",
            "excerpt": "公开摘要介绍了半导体研究项目的实验方法、测量结果与适用范围。",
            "sourceMaterial": "来源页面详细介绍了半导体实验的研究背景、测量方法、阶段性结果、适用范围和当前限制。",
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
            "originalTitle": "金融监管机构公布新的执法行动",
            "title": "金融监管机构公布新的执法行动",
            "sourceMaterial": "金融监管机构公布新的执法行动",
        })
        self.assertTrue(auto_update.body_meets_publication_standard(article["body"]))

    def test_structured_fallback_rejects_untranslated_foreign_material(self):
        with self.assertRaisesRegex(ValueError, "外文来源必须由模型生成忠实中文译文"):
            auto_update.build_structured_article({
                "category": "能源",
                "source": "U.S. Energy Information Administration",
                "sourceUrl": "https://example.com/oil",
                "originalTitle": "China's crude oil imports fell in the second quarter",
                "title": "China's crude oil imports fell in the second quarter",
                "sourceMaterial": "China's crude oil imports fell in the second quarter",
            })

    def test_free_translation_preserves_original_and_adds_chinese_fields(self):
        story = {
            "originalTitle": "Artificial intelligence improves industrial inspection",
            "sourceMaterial": "The study evaluates computer vision systems in factories and reports the tested conditions.",
        }
        with mock.patch.object(
            auto_update,
            "free_translate_text",
            side_effect=["人工智能提升工业检测能力", "这项研究评估了工厂中的计算机视觉系统，并说明了测试条件。"],
        ):
            changed = auto_update.add_free_source_translation(story)
        self.assertTrue(changed)
        self.assertEqual(story["originalTitle"], "Artificial intelligence improves industrial inspection")
        self.assertEqual(story["translatedSourceTitle"], "人工智能提升工业检测能力")
        self.assertIn("测试条件", story["translatedSourceMaterial"])
        self.assertEqual(story["translationMode"], "machine-translation")

    def test_structured_fallback_accepts_translated_foreign_material(self):
        article = auto_update.build_structured_article({
            "category": "工业",
            "source": "MIT Technology Review",
            "sourceUrl": "https://example.com/inspection",
            "originalTitle": "Artificial intelligence improves industrial inspection",
            "sourceMaterial": "The study evaluates computer vision systems in factories.",
            "translatedSourceTitle": "人工智能提升工业检测能力",
            "translatedSourceMaterial": "这项研究评估了工厂中的计算机视觉系统、测试条件、应用范围和当前结果。",
        })
        self.assertTrue(article["title"].startswith("工业前沿观察：人工智能提升工业检测能力"))
        self.assertEqual(article["translatedSourceTitle"], "人工智能提升工业检测能力")
        self.assertTrue(auto_update.body_meets_publication_standard(article["body"]))

    def test_force_structured_fallback_keeps_foreign_material_pending(self):
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
            self.assertEqual(stats["generated"], 0)
            self.assertEqual(stats["failed"], 1)
            self.assertEqual(story["contentGenerationMode"], "pending-editorial-expansion")
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
