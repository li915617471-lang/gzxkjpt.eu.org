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
            "事件概览", "背景与原理", "关键进展",
            "应用与影响", "局限与待观察", "读者如何核验",
        ]):
            sections.append(
                f"{heading}\n\n" +
                ((f"第{index}节用中文说明公开来源中的证据、边界、适用范围和后续需要观察的问题。") * 5)
            )
        return {
            "title": "大型储能项目进入商业运行阶段并带来系统调度观察样本",
            "excerpt": "公开资料说明了项目技术路线、建设状态、参与主体、系统调度价值和可能的行业影响，适合作为能源板块的前沿科普样本，也便于读者理解后续观察重点。",
            "body": "\n\n".join(sections) + "\n\n简要来源\n\n来源信息保留在原始链接中，正文为平台中文整理。",
            "source": "能源官方机构",
            "sourceUrl": "https://example.com/energy/story",
            "image": "https://cdn.example.com/energy.jpg",
            "category": "能源",
            "categoryEvidenceScore": 4,
            "confidence": 93,
            "sourceTrustLevel": "authoritative",
            "contentGenerationMode": "github-models-source-grounded",
            "sourceMaterial": "官方公开资料详细说明了项目技术路线、建设状态、参与主体、调度价值、适用范围和后续需要持续观察的运行指标。",
            "status": "review",
        }

    def test_normalize_url_removes_tracking_parameters(self):
        self.assertEqual(
            sync.normalize_url("HTTPS://Example.com/news/?utm_source=x&id=7#top"),
            "https://example.com/news?id=7",
        )

    def test_daily_publish_target_cannot_drop_below_two(self):
        policy = sync.auto_approval_policy({"dailyPublishTargetPerCategory": 1})
        self.assertEqual(policy["dailyTargetPerCategory"], 2)

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
        story["body"] = "简短正文。\n\n简要来源\n\n请查看原文。"
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

    def test_auto_review_rejects_navigation_as_source_material(self):
        story = self.rich_story()
        story["sourceMaterial"] = "地区 安徽省 广西壮族自治区 河南省 吉林省 江西省 山东省 云南省 浙江省 重庆市"
        policy = {"enabled": True, "minConfidence": 85, "policyVersion": 3}
        row = sync.article_row(story, "main", 0, "2026-08-04T00:00:00+00:00", policy)
        self.assertEqual(row["status"], "review")
        self.assertFalse(row["extra"]["automaticApproval"]["checks"]["usableSourceMaterial"])

    def test_auto_review_rejects_entertainment_outside_platform_scope(self):
        story = self.rich_story()
        story["title"] = "科技前沿观察：《平行时空找到你之我爸是顶流》"
        story["originalTitle"] = "《平行时空找到你之我爸是顶流》"
        policy = {"enabled": True, "minConfidence": 85, "policyVersion": 3}
        row = sync.article_row(story, "main", 0, "2026-08-05T00:00:00+00:00", policy)
        self.assertEqual(row["status"], "review")
        self.assertFalse(row["extra"]["automaticApproval"]["checks"]["editorialScope"])

    def test_auto_review_rejects_generic_generated_title(self):
        story = self.rich_story()
        story["title"] = "人文前沿观察：人文公开资料提供新的观察线索"
        policy = {"enabled": True, "minConfidence": 85, "policyVersion": 3}
        row = sync.article_row(story, "main", 0, "2026-08-05T00:00:00+00:00", policy)
        self.assertEqual(row["status"], "review")
        self.assertFalse(row["extra"]["automaticApproval"]["checks"]["editorialScope"])

    def test_existing_article_source_metadata_can_be_backfilled(self):
        story = self.rich_story()
        story["translatedSourceTitle"] = "储能项目进入商业运行阶段"
        story["translatedSourceMaterial"] = "这是一段忠实的中文机器翻译，保留来源事实、适用范围和限定条件。"
        story["translationProvider"] = "MyMemory 公共翻译服务"
        story["translationMode"] = "machine-translation"
        existing = [{
            "id": 7,
            "source_url": story["sourceUrl"],
            "extra": {"automaticImport": True},
        }]
        updates = sync.prepare_source_metadata_updates(
            [story], existing, "main", "2026-08-04T00:00:00+00:00"
        )
        self.assertEqual(len(updates), 1)
        self.assertEqual(updates[0]["extra"]["sourceMaterial"], story["sourceMaterial"])
        self.assertEqual(updates[0]["extra"]["translatedSourceTitle"], story["translatedSourceTitle"])
        self.assertEqual(updates[0]["extra"]["translationMode"], "machine-translation")

    def test_automatic_article_content_is_repaired_from_current_story(self):
        story = self.rich_story()
        story["category"] = "能源"
        existing = [{
            "id": sync.AUTOMATIC_ID_BASE + 7,
            "category": "工业",
            "title": "工业前沿观察：旧标题",
            "excerpt": "旧摘要",
            "body": "旧正文",
            "source_url": story["sourceUrl"],
            "extra": {"automaticImport": True},
        }]
        updates = sync.prepare_source_metadata_updates(
            [story], existing, "main", "2026-08-05T00:00:00+00:00"
        )
        self.assertEqual(updates[0]["category"], "能源")
        self.assertEqual(updates[0]["title"], story["title"])
        self.assertEqual(updates[0]["excerpt"], story["excerpt"])
        self.assertEqual(updates[0]["body"], story["body"])

    def test_invalid_published_automatic_articles_are_demoted_not_deleted(self):
        existing = [{
            "id": sync.AUTOMATIC_ID_BASE + 9,
            "status": "published",
            "title": "科技前沿观察：《幸福中国年》旅游短片",
            "body": "有效正文",
            "extra": {"automaticImport": True, "originalTitle": "《幸福中国年》旅游短片"},
        }]
        updates = sync.prepare_quality_demotions(existing, "main", "2026-08-05T00:00:00+00:00")
        self.assertEqual(len(updates), 1)
        self.assertEqual(updates[0]["status"], "review")
        self.assertIn("超出平台前沿知识范围", updates[0]["extra"]["qualityDemotionReasons"])

    def test_published_article_with_source_footer_noise_is_demoted(self):
        existing = [{
            "id": sync.AUTOMATIC_ID_BASE + 10,
            "status": "published",
            "title": "农业前沿观察：农业防灾减灾资金下达",
            "body": "核心进展\n\n网站识别码bm21000007 京ICP备05039419号-2 正文内容",
            "extra": {"automaticImport": True},
        }]
        updates = sync.prepare_quality_demotions(existing, "main", "2026-08-05T00:00:00+00:00")
        self.assertEqual(len(updates), 1)
        self.assertEqual(updates[0]["status"], "review")
        self.assertIn("正文包含网页样式或页脚代码", updates[0]["extra"]["qualityDemotionReasons"])

    def test_astronomy_article_misclassified_as_energy_is_demoted(self):
        existing = [{
            "id": sync.AUTOMATIC_ID_BASE + 11,
            "status": "published",
            "category": "能源",
            "title": "能源前沿观察：太阳风暴预测方法完成首次测试",
            "body": "有效正文",
            "extra": {"automaticImport": True},
        }]
        updates = sync.prepare_quality_demotions(existing, "main", "2026-08-05T00:00:00+00:00")
        self.assertEqual(len(updates), 1)
        self.assertEqual(updates[0]["status"], "review")
        self.assertIn("天文航天内容误入能源板块", updates[0]["extra"]["qualityDemotionReasons"])

    def test_source_metadata_backfill_patches_existing_rows(self):
        client = sync.SupabaseRest("https://example.supabase.co", "service-key")
        calls = []

        def fake_request(method, path, payload=None, prefer=""):
            calls.append((method, path, payload, prefer))
            return [{"id": 7}]

        client.request = fake_request
        updated = client.upsert_article_metadata([{
            "site_id": "main",
            "id": 7,
            "extra": {"sourceMaterial": "可靠的公开来源摘要内容，长度足够用于回填测试。"},
            "updated_at": "2026-08-04T00:00:00+00:00",
        }])

        self.assertEqual(updated, [{"id": 7}])
        self.assertEqual(calls[0][0], "PATCH")
        self.assertEqual(calls[0][1], "articles?site_id=eq.main&id=eq.7")
        self.assertEqual(set(calls[0][2]), {"extra", "updated_at"})
        self.assertEqual(calls[0][3], "return=representation")

    def test_auto_review_accepts_official_external_video_link(self):
        story = self.rich_story()
        video_url = "https://tv.cctv.com/2026/08/03/VIDE123.shtml"
        story.update({
            "contentKind": "video",
            "videoType": "external",
            "sourceUrl": video_url,
            "videoUrl": video_url,
            "videoExternalId": "0123456789abcdef0123456789abcdef",
            "videoPoster": story["image"],
            "videoLinkOnly": True,
            "videoRightsConfirmed": True,
            "homeVideoFeatured": True,
        })
        policy = {"enabled": True, "minConfidence": 85, "policyVersion": 2}
        row = sync.article_row(story, "main", 0, "2026-08-03T00:00:00+00:00", policy)
        self.assertEqual(row["status"], "published")
        self.assertTrue(row["extra"]["automaticApproval"]["checks"]["videoSafety"])
        self.assertEqual(row["extra"]["videoType"], "external")

    def test_auto_review_rejects_video_without_link_only_permission(self):
        story = self.rich_story()
        story.update({
            "contentKind": "video",
            "videoType": "external",
            "videoUrl": story["sourceUrl"],
            "videoPoster": story["image"],
            "videoLinkOnly": False,
            "videoRightsConfirmed": False,
        })
        policy = {"enabled": True, "minConfidence": 85, "policyVersion": 2}
        row = sync.article_row(story, "main", 0, "2026-08-03T00:00:00+00:00", policy)
        self.assertEqual(row["status"], "review")
        self.assertFalse(row["extra"]["automaticApproval"]["checks"]["videoSafety"])
        self.assertFalse(row["extra"]["reviewChecks"]["rightsVerified"])

    def test_daily_target_uses_three_newest_safe_candidates_per_category(self):
        stories = []
        for index, date in enumerate(["2026-07-29", "2026-07-30", "2026-07-31", "2026-08-01"]):
            story = self.rich_story()
            story["title"] = f"大型储能项目运行进展编号{index}"
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
        self.assertNotIn("编号0", " ".join(row["title"] for row in published))
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

    def test_video_backfill_is_independent_from_full_daily_category_target(self):
        story = self.rich_story()
        video_url = "https://tv.cctv.com/2026/08/03/VIDE789.shtml"
        story.update({
            "contentKind": "video", "videoType": "external",
            "sourceUrl": video_url, "videoUrl": video_url, "videoPoster": story["image"],
            "videoExternalId": "00112233445566778899aabbccddeeff",
            "videoLinkOnly": True, "videoRightsConfirmed": True,
            "homeVideoFeatured": True, "videoDuration": "00:18:52",
        })
        original = {
            "id": sync.automatic_article_id(sync.story_fingerprint(story)),
            "title": story["title"], "source_url": story["sourceUrl"],
            "category": story["category"], "status": "review",
            "extra": {"automaticImport": True, "contentKind": "video"}, "position": 2,
        }
        existing = [original]
        for index in range(3):
            existing.append({
                "id": sync.AUTOMATIC_ID_BASE + 100 + index,
                "title": f"Already published {index}",
                "source_url": f"https://example.com/published/{index}",
                "category": story["category"], "status": "published",
                "body": story["body"], "position": 3 + index,
                "extra": {"automaticApproval": {
                    "approved": True, "reviewedAt": "2026-08-03T01:00:00+00:00",
                }},
            })
        policy = {
            "enabled": True, "minConfidence": 85, "fallbackMinConfidence": 78,
            "dailyTargetPerCategory": 3, "policyVersion": 2,
        }
        promotions, counts = sync.prepare_promotions(
            [story], existing, [], policy, "2026-08-03T08:00:00+00:00"
        )
        self.assertEqual(len(promotions), 1)
        self.assertEqual(promotions[0]["extra"]["automaticApproval"]["mode"], "video-backfill")
        self.assertEqual(counts[story["category"]], 4)

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

    def test_beijing_publication_day_crosses_utc_midnight(self):
        self.assertEqual(sync.publication_day("2026-08-05T20:30:00+00:00"), "2026-08-06")
        story = self.rich_story()
        row = sync.article_row(
            story, "main", 0, "2026-08-05T20:30:00+00:00",
            {"enabled": True, "minConfidence": 85, "policyVersion": 3},
        )
        self.assertEqual(row["published_date"], "2026-08-06")

    def test_same_day_remaining_quota_prevents_repeat_publication(self):
        story = self.rich_story()
        story.update({"sourceLanguage": "zh-CN", "sourceRegion": "中国"})
        policy = {
            "enabled": True, "minConfidence": 85, "fallbackMinConfidence": 78,
            "dailyTargetPerCategory": 2, "dailyForeignArticleTarget": 0,
            "dailyChineseArticleTarget": 2, "dailyVideoTarget": 4,
            "sourceMixEnforced": True, "policyVersion": 3,
        }
        first_rows, _, _ = sync.prepare_rows(
            [story], [], "main", "2026-08-06T01:00:00+00:00", policy
        )
        self.assertEqual(sum(row["status"] == "published" for row in first_rows), 1)
        second_story = self.rich_story()
        second_story.update({
            "title": "大型储能项目第二份中文前沿进展资料",
            "sourceUrl": "https://example.cn/energy/second",
            "sourceLanguage": "zh-CN", "sourceRegion": "中国",
        })
        second_rows, _, _ = sync.prepare_rows(
            [second_story], first_rows, "main", "2026-08-06T03:00:00+00:00", policy
        )
        self.assertEqual(sum(row["status"] == "published" for row in second_rows), 1)
        third_story = self.rich_story()
        third_story.update({
            "title": "大型储能项目第三份中文前沿进展资料",
            "sourceUrl": "https://example.cn/energy/third",
            "sourceLanguage": "zh-CN", "sourceRegion": "中国",
        })
        third_rows, _, _ = sync.prepare_rows(
            [third_story], first_rows + second_rows, "main", "2026-08-06T05:00:00+00:00", policy
        )
        self.assertEqual(sum(row["status"] == "published" for row in third_rows), 0)

    def test_source_mix_selects_ten_chinese_and_two_foreign_articles(self):
        categories = ["金融", "科技", "工业", "能源", "农业", "人文"]
        stories = []
        for category_index, category in enumerate(categories):
            for index in range(2):
                story = self.rich_story()
                story.update({
                    "category": category,
                    "title": f"{category}领域中文前沿进展资料编号{index}",
                    "sourceUrl": f"https://source-{category_index}-{index}.gov.cn/article",
                    "sourceLanguage": "zh-CN",
                    "sourceRegion": "中国",
                })
                stories.append(story)
        for index, category in enumerate(categories[:2]):
            story = self.rich_story()
            story.update({
                "category": category,
                "title": f"{category}领域国际前沿进展中文译文编号{index}",
                "sourceUrl": f"https://example.com/foreign/{index}",
                "sourceLanguage": "en",
                "sourceRegion": "全球",
            })
            stories.append(story)
        policy = {
            "enabled": True, "minConfidence": 85, "fallbackMinConfidence": 78,
            "dailyTargetPerCategory": 2, "dailyForeignArticleTarget": 2,
            "dailyChineseArticleTarget": 10, "dailyVideoTarget": 4,
            "sourceMixEnforced": True, "policyVersion": 3,
        }
        audits = sync.select_auto_approval_audits(stories, policy)
        selected = [story for story in stories if audits[id(story)]["approved"]]
        self.assertEqual(len(selected), 12)
        self.assertEqual(sum(sync.is_chinese_source(story) for story in selected), 10)
        self.assertEqual(sum(not sync.is_chinese_source(story) for story in selected), 2)
        self.assertTrue(all(sum(story["category"] == category for story in selected) == 2 for category in categories))

    def test_video_quota_is_four_and_does_not_consume_article_quota(self):
        stories = []
        for index in range(5):
            story = self.rich_story()
            url = f"https://tv.cctv.com/video/{index}.shtml"
            story.update({
                "title": f"前沿科学技术科普视频资料第{index}期",
                "excerpt": "官方科普节目介绍前沿科学技术的基本原理、试验过程、应用场景和发展方向。",
                "sourceMaterial": "官方科普节目介绍前沿科学技术的基本原理、试验过程、应用场景和发展方向。",
                "sourceUrl": url, "contentKind": "video", "videoType": "external",
                "videoUrl": url, "videoPoster": story["image"], "videoLinkOnly": True,
                "videoRightsConfirmed": True, "contentGenerationMode": "official-video-metadata",
                "videoExternalId": f"{index:032x}",
            })
            stories.append(story)
        policy = {
            "enabled": True, "minConfidence": 85, "fallbackMinConfidence": 78,
            "dailyTargetPerCategory": 2, "dailyForeignArticleTarget": 2,
            "dailyVideoTarget": 4, "sourceMixEnforced": True, "policyVersion": 3,
        }
        audits = sync.select_auto_approval_audits(stories, policy)
        self.assertEqual(sum(audits[id(story)]["approved"] for story in stories), 4)

    def test_daily_target_replaces_a_legacy_short_published_article(self):
        story = self.rich_story()
        fingerprint = sync.story_fingerprint(story)
        legacy = {
            "id": sync.automatic_article_id(fingerprint),
            "title": story["title"],
            "source_url": story["sourceUrl"],
            "category": story["category"],
            "status": "published",
            "body": "旧版短正文\n\n简要来源\n\n待补充。",
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

    def test_auto_review_rejects_long_english_content(self):
        story = self.rich_story()
        story["body"] += "\n\nThis English paragraph contains enough consecutive words to fail the Chinese publication check."
        policy = {"enabled": True, "minConfidence": 85, "policyVersion": 2}
        row = sync.article_row(
            story, "main", 0, "2026-08-03T08:00:00+00:00", policy
        )
        self.assertEqual(row["status"], "review")

    def test_auto_review_rejects_foreign_source_without_chinese_translation(self):
        story = self.rich_story()
        story.update({
            "originalTitle": "A complete foreign source headline",
            "sourceMaterial": "This source material contains a complete foreign language summary without a Chinese translation.",
        })
        policy = {"enabled": True, "minConfidence": 85, "policyVersion": 2}
        row = sync.article_row(
            story, "main", 0, "2026-08-03T08:00:00+00:00", policy
        )
        self.assertEqual(row["status"], "review")
        self.assertFalse(row["extra"]["automaticApproval"]["checks"]["sourceChinesePresentation"])


if __name__ == "__main__":
    unittest.main()
