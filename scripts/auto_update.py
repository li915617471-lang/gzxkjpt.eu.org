"""
信息分享平台智能更新草稿脚本

作用：
1. 读取 data/update-sources.json 里的公开 RSS、官方网页栏目和 JSON 来源；
2. 抓取最新标题、链接、摘要；
3. 按关键词自动分类；
4. 生成 data/intelligence-draft.json；
5. 后台 admin.html 可以导入这个草稿，再由你审核发布。

运行：
    python scripts/auto_update.py

说明：
这个脚本只生成“待审核草稿”，不会自动覆盖正式 data/content.json。
正式上线后可放到 GitHub Actions / Cloudflare Worker / 服务器定时任务中每天运行。
"""

from __future__ import annotations

import html
import email.utils
import json
import os
import re
import sys
import time
import urllib.error
import urllib.request
import urllib.parse
import xml.etree.ElementTree as ET
from datetime import datetime, timezone
from html.parser import HTMLParser
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
SOURCE_FILE = ROOT / "data" / "update-sources.json"
OUTPUT_FILE = ROOT / "data" / "intelligence-draft.json"
CONTENT_FILE = ROOT / "data" / "content.json"
LOG_FILE = ROOT / "data" / "collection-logs.json"


CATEGORY_RULES = {
    "金融": ["finance", "fintech", "bank", "central bank", "ecb", "payment", "insurance", "fund", "digital currency", "monetary", "inflation", "interest rate", "economy", "euro", "wage", "collateral", "governing council", "金融", "银行", "证券", "支付", "保险", "基金", "数字货币", "利率", "通胀", "货币政策"],
    "农业": ["agriculture", "farming", "farm", "crop", "food", "food tech", "agritech", "livestock", "irrigation", "农业", "农机", "育种", "粮食", "种植", "养殖", "农田", "农业科技"],
    "能源": ["battery", "energy", "solar", "storage", "geothermal", "renewable", "grid", "electricity", "oil", "crude", "natural gas", "lng", "电池", "储能", "光伏", "新能源", "电力", "地热", "石油", "天然气"],
    "工业": ["robot", "factory", "manufacturing", "automation", "industrial", "production", "output", "supply chain", "logistics", "plant", "opening", "expansion", "industrial company", "tariff", "revenue", "机器人", "工厂", "制造", "自动化", "产线", "工业互联网", "供应链", "生产", "制造企业"],
    "人文": ["humanities", "culture", "education", "history", "museum", "society", "art", "literature", "philosophy", "film", "music", "book", "manuscript", "ancient", "poetry", "map", "mythology", "人文", "文化", "教育", "历史", "博物馆", "社会", "艺术", "文学"],
    "科技": ["ai", "llm", "llms", "artificial intelligence", "technology", "engineering", "science", "research", "network", "fiber", "dark matter", "model", "compute", "robot", "chip", "semiconductor", "wafer", "packaging", "chiplet", "quantum", "biotech", "人工智能", "大模型", "算力", "模型", "芯片", "半导体", "封装", "晶圆", "量子", "生物技术"]
}

CATEGORY_COVERS = {
    "金融": "assets/network.jpg",
    "科技": "assets/datacenter.jpg",
    "工业": "assets/factory.jpg",
    "能源": "assets/energy.jpg",
    "农业": "assets/solar.jpg",
    "人文": "assets/semiconductor.jpg",
}
DEFAULT_COVER = "assets/factory.jpg"
QUEUE_PER_CATEGORY = 10
TRACKING_IMAGE_MARKERS = ("pixel", "tracking", "tracker", "spacer", "1x1", "clear.gif", "beacon")
MIN_ARTICLE_CHARS = 800
GITHUB_MODELS_ENDPOINT = "https://models.github.ai/inference/chat/completions"
DEFAULT_ARTICLE_MODEL = "openai/gpt-4.1-mini"
FREE_TRANSLATION_ENDPOINT = "https://api.mymemory.translated.net/get"
SOURCE_DISCLOSURE_HEADING = "简要来源"
LEGACY_DISCLOSURE_HEADING = "来源与审核说明"

SOURCE_NAME_ALIASES = {
    "MIT Technology Review": "麻省理工科技评论",
    "IEEE Spectrum": "电气电子工程师学会科技观察",
    "Manufacturing Dive": "制造业行业资讯",
    "Semiconductor Engineering": "半导体工程资讯",
    "Global Ag Tech Initiative": "全球农业科技资讯",
    "Open Culture": "开放文化资讯",
    "European Central Bank": "欧洲中央银行",
    "U.S. Energy Information Administration": "美国能源信息署",
    "U.S. Federal Reserve": "美国联邦储备委员会",
    "Bank for International Settlements": "国际清算银行",
    "U.S. National Science Foundation": "美国国家科学基金会",
    "U.S. National Institute of Standards and Technology": "美国国家标准与技术研究院",
    "U.S. Department of Energy": "美国能源部",
    "USDA Agricultural Research Service": "美国农业部农业研究局",
    "National Association of Manufacturers": "美国制造商协会",
    "Harvard Gazette Arts & Humanities": "哈佛大学人文艺术资讯",
    "NASA Breaking News": "美国国家航空航天局",
    "European Space Agency Science & Exploration": "欧洲空间局科学探索",
    "CGIAR": "国际农业研究磋商组织",
    "Intergovernmental Panel on Climate Change": "联合国政府间气候变化专门委员会",
    "Smithsonian Magazine": "史密森学会杂志",
}

FALLBACK_TOPIC_RULES = {
    "金融": [
        (("federal reserve", "insiders", "credit"), "美联储拟更新银行内部人授信规则", "来源线索指向银行高管、董事和主要股东等内部关联人员的授信规则调整，核心问题是如何减少潜在利益冲突，并让银行信贷决策保持透明、审慎和可追溯。"),
        (("federal reserve", "enforcement"), "美联储执法行动提示银行合规风险", "来源线索涉及金融监管机构发布的执法行动，通常用于提示银行治理、员工行为、内部控制和合规责任等问题。"),
        (("central bank", "liquidity"), "央行流动性工具调整受到市场关注", "来源线索涉及央行流动性安排，理解重点在于工具目标、适用对象、抵押品要求、期限安排和对金融体系稳定性的影响。"),
    ],
    "科技": [
        (("rtl", "isa", "verification"), "处理器验证方法关注硬件与软件边界", "来源线索涉及处理器设计验证，重点是如何用更模块化的方法检查硬件实现、软件接口和安全边界是否一致。"),
        (("tape recorder", "radio"), "高保真录音设备改变广播制作方式", "来源线索关注音频设备与广播传播技术的历史影响，说明硬件工具也会改变内容生产流程和公共传播方式。"),
        (("semiconductor", "workforce"), "半导体人才与研发合作成为产业建设重点", "来源线索涉及高校、企业和制造项目之间的合作，反映半导体产业不仅需要设备和资本，也需要长期人才培养与工程训练。"),
        (("llm",), "大模型安全与部署边界继续受到关注", "来源线索涉及人工智能模型的安全、能力边界或应用条件，阅读时需要区分演示结果、测试环境和真实部署要求。"),
    ],
    "工业": [
        (("lilly", "medicine", "output"), "药品产能扩建显示先进制造投资升温", "来源线索涉及药品生产能力扩建，核心看点包括产线规模、质量控制、供应链稳定性和特殊剂型制造能力。"),
        (("ford", "tactical trucks"), "战术车辆订单带动制造供应链观察", "来源线索涉及车辆制造和国防装备订单，适合观察整车生产、零部件配套、交付周期和工厂产能安排。"),
        (("boeing", "revenue"), "航空制造复苏进程仍需观察交付与现金流", "来源线索涉及航空制造企业经营数据，不能只看收入，还要结合交付数量、供应链恢复、质量控制和现金流变化。"),
        (("manufacturing", "engineering", "workforce"), "制造工程教育与企业研发合作加深", "来源线索涉及制造业人才培养和企业研发合作，说明先进制造越来越依赖工程教育、实验平台和真实项目训练。"),
    ],
    "能源": [
        (("crude oil imports",), "中国原油进口变化引发能源需求观察", "来源线索涉及原油进口变化，理解时要区分价格、数量、库存、炼厂开工、季节需求和宏观经济活动。"),
        (("emergency grid order", "heat"), "高温天气下电网应急调度压力上升", "来源线索涉及高温期间的电网应急命令，重点在于峰值负荷、备用电源、跨区输电和电力系统韧性。"),
        (("hybrid sales", "battery electric"), "混合动力销量上升与电动车政策变化相关", "来源线索涉及汽车能源消费结构变化，需要同时观察税收优惠、购车成本、充电条件和消费者使用场景。"),
        (("lng",), "液化天然气贸易变化影响全球能源供应格局", "来源线索涉及液化天然气贸易，阅读时要关注出口能力、运输通道、价格周期和进口地区需求。"),
    ],
    "农业": [
        (("crop protection",), "数字农业推动作物保护走向数据决策", "来源线索涉及作物保护和农业数据应用，重点是如何把传感器、遥感、田间记录和农艺知识转化为可执行建议。"),
        (("driverless", "farm"), "无人化田间装备推动农业移动作业升级", "来源线索涉及自动驾驶农机、田间机器人或无人作业平台，核心看点是劳动力、作业窗口、精度和维护成本。"),
        (("ai-ready data",), "农业数据治理成为智能化应用前提", "来源线索提示农业智能化不只需要算法，更需要干净、统一、可追溯并能被机器读取的数据基础。"),
        (("ammonia", "poultry"), "禽舍空气治理技术关注养殖环境安全", "来源线索涉及禽舍氨气治理，阅读重点包括动物福利、工人健康、粪污管理和设备长期运行成本。"),
    ],
    "人文": [
        (("odyssey", "film"), "《奥德赛》改编史展现古典叙事的现代传播", "来源线索涉及古典文学在电影等媒介中的再创作，适合观察经典文本如何在不同时代被重新解释和传播。"),
        (("manuscript", "archimedes"), "古抄本重写与保存揭示文献流传复杂性", "来源线索涉及手稿重写、文献保存和古代知识传承，说明文化遗产常常经历遮蔽、损毁、再发现和再解释。"),
        (("homer", "ancient greek"), "古希腊吟唱传统帮助理解《奥德赛》传播", "来源线索涉及古典文本的声音、语言和表演传统，提醒读者文学作品并不只存在于纸面文字中。"),
        (("criterion", "films"), "导演片单折射电影史中的审美谱系", "来源线索涉及电影作者、经典片单和公共文化传播，适合观察艺术偏好如何影响观众理解电影史。"),
    ],
}

CATEGORY_EDITORIAL_CONTEXT = {
    "金融": {
        "background": "金融新闻需要同时看政策目标、传导渠道和受影响主体。利率、支付、资本充足率、流动性和风险管理并不是孤立指标，任何单一数字都不能直接等同于市场结果。阅读这类材料时，应先区分监管公告、机构研究和媒体解释，再确认统计口径、时间窗口与适用地区。",
        "principle": "分析金融进展可以沿着政策工具、机构行为和实体经济三个层次展开：政策改变规则或价格，机构根据成本与风险调整业务，企业和居民再通过融资、支付、储蓄和投资感受到变化。这个框架有助于避免把相关关系误读成因果关系。",
        "impact": "对普通读者而言，重点不是预测涨跌，而是识别谁会受到影响、影响通过什么渠道传递、是否存在新的合规要求，以及公开材料是否给出了可复核的时间表、样本和定义。",
    },
    "科技": {
        "background": "科技报道通常把研究成果、工程样机、产品发布和商业化结果放在同一条新闻流中，但它们的证据强度不同。实验室指标不等于规模化性能，演示系统也不等于稳定产品，阅读时应分辨论文、测试、专利、项目公告和企业宣传的边界。",
        "principle": "理解技术进展可以从输入、处理过程、输出指标和限制条件四步拆解。芯片看制程、封装、功耗和良率，人工智能看数据、模型、算力、评测和部署成本，科研项目还要关注可重复性、同行评议和实验条件。",
        "impact": "技术是否产生行业影响，取决于可靠性、成本、供应链、标准、人才和监管等共同条件。把这些条件列出来，比只引用一个刷新纪录的指标更能帮助读者判断技术成熟度。",
    },
    "工业": {
        "background": "工业信息既包含订单、产量和投资，也包含设备、工艺、质量和供应链。单一工厂的扩产消息不能代表整个行业，单月产量也不能直接说明长期趋势，因此需要把企业公告、行业统计和现场条件放在同一时间尺度上比较。",
        "principle": "分析制造业进展时，可按原料、设备、工艺、人员、质量和交付六个环节追踪。自动化或数字化项目只有在停机时间、良率、能耗、维护和安全等指标上形成可重复改善，才可能从展示项目变成可复制的生产能力。",
        "impact": "工业技术的价值常常体现为流程稳定、资源利用率提升和风险下降，而不是一个醒目的发布会数字。读者还应留意项目处于试点、建设、投产还是持续运营阶段，以及数据是否由独立机构验证。",
    },
    "能源": {
        "background": "能源信息同时受到资源禀赋、基础设施、政策、气候、价格和国际贸易影响。装机容量、发电量、储能时长、利用率和碳排放是不同概念，不能直接互换。报道中的同比、环比和预测值也必须确认各自的基期。",
        "principle": "理解能源项目可以拆成资源端、转换端、网络端和消费端：资源决定可获得性，设备决定转换效率，电网或管网决定可调度性，终端需求决定商业价值。储能、氢能和可再生能源还要考虑材料、寿命、回收和安全。",
        "impact": "能源技术能否扩大应用，往往取决于系统成本、峰谷匹配、并网条件、备用能力和当地规则。关注这些约束，可以避免把一次性项目成功误认为所有地区都能复制。",
    },
    "农业": {
        "background": "农业科技的效果受土壤、气候、品种、灌溉、劳动力和市场共同影响。同一套设备在不同地区的结果可能差异很大，短期试验也不一定代表完整生长季。阅读时应确认样本地块、作物种类、季节和对照组。",
        "principle": "分析精准农业或生物育种，可以从数据采集、决策模型、田间执行和产后环节追踪。传感器与卫星数据只有转化为可操作的播种、施肥、灌溉或病虫害管理建议，才会真正改变生产流程。",
        "impact": "农业创新的评价除了产量，还包括水肥使用、风险、劳动投入、食品安全、农户负担和生态影响。任何宣传性的增产数字，都应与成本、适用范围和连续多年结果一起核验。",
    },
    "人文": {
        "background": "人文研究关注文本、物件、记忆、制度和社会经验，证据往往来自档案、考古、访谈、图像或多种版本的比较。不同研究者可能采用不同解释框架，读者应把来源事实、研究观点和个人评论分开阅读。",
        "principle": "理解人文材料可以追问对象是什么、由谁保存、在什么语境中产生、后来如何流传，以及哪些群体的声音被记录或遗漏。数字化工具能扩大访问范围，但不能自动解决出处、语境和代表性问题。",
        "impact": "人文成果的公共价值常体现在教育、博物馆、社区记忆、文化遗产保护和跨文化理解。评价一项新发现时，除了新颖性，还要关注版权、隐私、原住民或社区权益以及展示方式。",
    },
}


def load_category_rules() -> dict[str, list[str]]:
    if not CONTENT_FILE.exists():
        return CATEGORY_RULES
    try:
        content = json.loads(CONTENT_FILE.read_text(encoding="utf-8"))
        settings = content.get("categorySettings", [])
        dynamic = {
            str(item["name"]).strip(): [
                str(word).strip()
                for word in item.get("keywords", [])
                if str(word).strip()
            ] or [str(item["name"]).strip()]
            for item in settings
            if item.get("name") and item.get("enabled", True)
        }
        return dynamic or CATEGORY_RULES
    except (OSError, ValueError, TypeError):
        return CATEGORY_RULES


def clean_text(value: str) -> str:
    value = re.sub(r"<[^>]+>", " ", value or "")
    value = html.unescape(value)
    value = re.sub(r"\s+", " ", value).strip()
    return value


def truncate_text(value: str, limit: int) -> str:
    """Trim text without leaving a dangling word when practical."""
    value = clean_text(value)
    if len(value) <= limit:
        return value
    clipped = value[:limit + 1]
    boundary = max(clipped.rfind(" "), clipped.rfind("。"), clipped.rfind("，"), clipped.rfind("；"))
    if boundary >= int(limit * 0.65):
        clipped = clipped[:boundary]
    else:
        clipped = clipped[:limit]
    return clipped.rstrip(" ,，。;；:-") + "…"


def category_cover(category: str) -> str:
    return CATEGORY_COVERS.get(category, DEFAULT_COVER)


def safe_image_url(value: str, base_url: str = "") -> str:
    value = html.unescape((value or "").strip())
    if not value:
        return ""
    try:
        resolved = urllib.parse.urljoin(base_url, value)
        parts = urllib.parse.urlsplit(resolved)
    except ValueError:
        return ""
    if parts.scheme.lower() not in {"http", "https"} or not parts.netloc:
        return ""
    lowered = resolved.lower()
    if any(marker in lowered for marker in TRACKING_IMAGE_MARKERS):
        return ""
    return resolved


def normalize_url(value: str) -> str:
    value = (value or "").strip()
    if not value:
        return ""
    try:
        parts = urllib.parse.urlsplit(value)
        filtered_query = [
            (key, val)
            for key, val in urllib.parse.parse_qsl(parts.query, keep_blank_values=True)
            if key.lower() not in {
                "utm_source", "utm_medium", "utm_campaign", "utm_term",
                "utm_content", "fbclid", "gclid"
            }
        ]
        path = parts.path.rstrip("/") or "/"
        return urllib.parse.urlunsplit((
            parts.scheme.lower(),
            parts.netloc.lower(),
            path,
            urllib.parse.urlencode(filtered_query),
            "",
        ))
    except ValueError:
        return value.lower()


def normalize_title(value: str) -> str:
    return re.sub(r"[^\w\u4e00-\u9fff]+", "", (value or "").lower())


def near_duplicate_title(value: str, candidates: set[str], threshold: float = 0.82) -> bool:
    normalized = normalize_title(value)
    if not normalized:
        return False
    if normalized in candidates:
        return True
    if len(normalized) < 8:
        return False
    grams = {normalized[index:index + 3] for index in range(len(normalized) - 2)}
    for candidate in candidates:
        if len(candidate) < 8 or not 0.65 <= len(normalized) / len(candidate) <= 1.35:
            continue
        other = {candidate[index:index + 3] for index in range(len(candidate) - 2)}
        union = grams | other
        if union and len(grams & other) / len(union) >= threshold:
            return True
    return False


def load_json(path: Path, fallback: dict) -> dict:
    try:
        return json.loads(path.read_text(encoding="utf-8")) if path.exists() else fallback
    except (OSError, ValueError, TypeError):
        return fallback


def load_sources() -> list[dict]:
    content = load_json(CONTENT_FILE, {})
    managed = content.get("sourceSettings", [])
    if isinstance(managed, list) and managed:
        return managed
    return load_json(SOURCE_FILE, {}).get("sources", [])


def existing_fingerprints() -> tuple[set[str], set[str]]:
    content = load_json(CONTENT_FILE, {})
    previous = load_json(OUTPUT_FILE, {})
    stories = list(content.get("stories", [])) + list(previous.get("stories", []))
    urls = {
        normalize_url(story.get("sourceUrl") or story.get("url") or "")
        for story in stories
    }
    titles = {normalize_title(story.get("title", "")) for story in stories}
    return {item for item in urls if item}, {item for item in titles if item}


def pending_drafts() -> list[dict]:
    content_stories = load_json(CONTENT_FILE, {}).get("stories", [])
    previous_stories = load_json(OUTPUT_FILE, {}).get("stories", [])
    content_urls = {
        normalize_url(story.get("sourceUrl") or story.get("url") or "")
        for story in content_stories
    }
    content_titles = {normalize_title(story.get("title", "")) for story in content_stories}
    retained = []
    retained_urls: set[str] = set()
    retained_titles: set[str] = set()
    for story in previous_stories:
        url_key = normalize_url(story.get("sourceUrl") or story.get("url") or "")
        title_key = normalize_title(story.get("title", ""))
        if not url_key:
            continue
        if ((url_key and (url_key in content_urls or url_key in retained_urls))
                or (title_key and (title_key in content_titles or title_key in retained_titles))):
            continue
        retained.append(story)
        if url_key:
            retained_urls.add(url_key)
        if title_key:
            retained_titles.add(title_key)
    return retained


def balanced_queue(new_stories: list[dict], retained_stories: list[dict], categories: list[str], limit: int = 30) -> list[dict]:
    """Round-robin categories so early sources cannot crowd out later sections."""
    buckets = {category: [] for category in categories}
    overflow = []
    for story in new_stories + retained_stories:
        category = story.get("category")
        if category in buckets:
            buckets[category].append(story)
        else:
            overflow.append(story)
    for bucket in buckets.values():
        bucket.sort(key=story_queue_priority, reverse=True)
    queue = []
    while len(queue) < limit and any(buckets.values()):
        for category in categories:
            if buckets[category] and len(queue) < limit:
                queue.append(buckets[category].pop(0))
    if len(queue) < limit:
        queue.extend(overflow[:limit - len(queue)])
    return queue


def story_queue_priority(story: dict) -> tuple[int, float, int, int]:
    try:
        evidence = int(story.get("categoryEvidenceScore") or 0)
    except (TypeError, ValueError):
        evidence = 0
    published = str(story.get("originalPublishedAt") or story.get("date") or "").strip()
    timestamp = 0.0
    if published:
        try:
            parsed = email.utils.parsedate_to_datetime(published)
            if parsed.tzinfo is None:
                parsed = parsed.replace(tzinfo=timezone.utc)
            timestamp = parsed.timestamp()
        except (TypeError, ValueError, OverflowError):
            try:
                timestamp = datetime.fromisoformat(published.replace("Z", "+00:00")).timestamp()
            except (TypeError, ValueError, OverflowError):
                timestamp = 0.0
    try:
        confidence = int(story.get("confidence") or 0)
    except (TypeError, ValueError):
        confidence = 0
    return (int(evidence >= 2), timestamp, evidence, confidence)


def fetch(url: str, max_attempts: int = 3) -> tuple[bytes, int, int]:
    started = time.perf_counter()
    last_error: Exception | None = None
    for attempt in range(1, max_attempts + 1):
        try:
            request = urllib.request.Request(
                url,
                headers={
                    "User-Agent": "Information-Share-RSS/1.0 (+https://gzxkjpt.eu.org)",
                    "Accept": "application/rss+xml, application/atom+xml, application/json, text/html, application/xml, text/xml;q=0.9, */*;q=0.5",
                },
            )
            with urllib.request.urlopen(request, timeout=20) as response:
                raw = response.read(5 * 1024 * 1024 + 1)
                if len(raw) > 5 * 1024 * 1024:
                    raise ValueError("订阅内容超过 5MB 安全限制")
                duration_ms = round((time.perf_counter() - started) * 1000)
                return raw, attempt, duration_ms
        except (urllib.error.URLError, TimeoutError, OSError) as exc:
            last_error = exc
            if attempt < max_attempts:
                time.sleep(0.8 * attempt)
    duration_ms = round((time.perf_counter() - started) * 1000)
    raise RuntimeError(f"连续 {max_attempts} 次请求失败（{duration_ms}ms）：{last_error}")


def find_text(item: ET.Element, names: list[str]) -> str:
    for name in names:
        found = item.find(name)
        if found is not None and found.text:
            return clean_text(found.text)
    for child in item:
        tag = child.tag.split("}")[-1].lower()
        if tag in names and child.text:
            return clean_text(child.text)
    return ""


def find_image(item: ET.Element, base_url: str = "") -> str:
    """Extract a useful RSS/Atom image without fetching the article body."""
    candidates = []
    html_fields = []
    for child in item.iter():
        tag = child.tag.split("}")[-1].lower()
        attrs = {key.split("}")[-1].lower(): value for key, value in child.attrib.items()}
        if tag in {"content", "thumbnail"}:
            candidates.append(attrs.get("url") or attrs.get("href") or attrs.get("src") or "")
        elif tag == "enclosure" and str(attrs.get("type", "")).lower().startswith("image/"):
            candidates.append(attrs.get("url") or attrs.get("href") or "")
        if tag in {"description", "summary", "content", "encoded"} and child.text:
            html_fields.append(child.text)
    for markup in html_fields:
        candidates.extend(re.findall(r"<img\b[^>]*?\bsrc\s*=\s*['\"]([^'\"]+)['\"]", markup, flags=re.I))
    for candidate in candidates:
        image = safe_image_url(candidate, base_url)
        if image:
            return image
    return ""


def parse_feed(raw: bytes) -> list[dict]:
    root = ET.fromstring(raw)
    items = root.findall(".//item")
    if not items:
        items = root.findall(".//{http://www.w3.org/2005/Atom}entry")
    if not items:
        items = [element for element in root.iter() if element.tag.split("}")[-1].lower() in {"item", "entry"}]

    parsed = []
    for item in items[:12]:
        title = find_text(item, ["title"])
        summary = find_text(item, ["description", "summary", "content"])
        published = find_text(item, ["pubDate", "published", "updated", "date"])
        link = find_text(item, ["link"])
        if not link:
            for child in item:
                if child.tag.split("}")[-1] == "link":
                    link = child.attrib.get("href", "")
                    break
        image = find_image(item, link)
        if title:
            parsed.append({"title": title, "summary": summary, "link": link, "published": published, "image": image})
    return parsed


def decode_web_text(raw: bytes) -> str:
    """Decode Chinese government pages that may omit an HTTP charset."""
    head = raw[:12000]
    match = re.search(br"charset\s*=\s*['\"]?([a-zA-Z0-9._-]+)", head, flags=re.I)
    candidates = [match.group(1).decode("ascii", errors="ignore") if match else "", "utf-8", "gb18030"]
    for encoding in candidates:
        if not encoding:
            continue
        try:
            return raw.decode(encoding)
        except (LookupError, UnicodeDecodeError):
            continue
    return raw.decode("utf-8", errors="replace")


def prefer_same_host_https(link: str, base_url: str) -> str:
    try:
        parsed_link = urllib.parse.urlsplit(link)
        parsed_base = urllib.parse.urlsplit(base_url)
        if (
            parsed_base.scheme == "https"
            and parsed_link.scheme == "http"
            and parsed_link.hostname == parsed_base.hostname
        ):
            return urllib.parse.urlunsplit(parsed_link._replace(scheme="https"))
    except (TypeError, ValueError):
        pass
    return link


class HtmlListParser(HTMLParser):
    def __init__(self, base_url: str, link_pattern: str = "") -> None:
        super().__init__(convert_charrefs=True)
        self.base_url = base_url
        self.link_pattern = re.compile(link_pattern) if link_pattern else None
        self.href = ""
        self.parts: list[str] = []
        self.image = ""
        self.image_alt = ""
        self.entries: list[dict] = []
        self.seen: set[str] = set()

    def handle_starttag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        tag = tag.lower()
        attrs_map = {str(key).lower(): str(value or "") for key, value in attrs}
        if tag == "img" and self.href:
            image_class = attrs_map.get("class", "").lower()
            image_src = attrs_map.get("src") or attrs_map.get("data-src") or ""
            image_alt = clean_text(attrs_map.get("alt") or attrs_map.get("title") or "")
            looks_like_control = (
                "play" in image_class
                or "icon" in image_class
                or re.search(r"(?:play|icon|logo|arrow|btn)", image_src, flags=re.I)
            )
            if image_src and not looks_like_control and not self.image:
                self.image = urllib.parse.urljoin(self.base_url, image_src)
                if len(image_alt) >= 8:
                    self.image_alt = image_alt
            return
        if tag != "a":
            return
        self.href = attrs_map.get("href") or ""
        self.parts = []
        self.image = ""
        self.image_alt = ""

    def handle_data(self, data: str) -> None:
        if self.href:
            self.parts.append(data)

    def handle_endtag(self, tag: str) -> None:
        if tag.lower() != "a" or not self.href:
            return
        title = clean_text(" ".join(self.parts)) or self.image_alt
        link = prefer_same_host_https(urllib.parse.urljoin(self.base_url, self.href), self.base_url)
        normalized = normalize_url(link)
        allowed = not self.link_pattern or bool(self.link_pattern.search(urllib.parse.urlsplit(link).path))
        if allowed and normalized and normalized not in self.seen and len(title) >= 8:
            date_match = re.search(r"(20\d{2})(\d{2})(\d{2})", link)
            published = "-".join(date_match.groups()) if date_match else ""
            self.entries.append({
                "title": title,
                "summary": "",
                "link": link,
                "published": published,
                "image": safe_image_url(self.image, link),
            })
            self.seen.add(normalized)
        self.href = ""
        self.parts = []
        self.image = ""
        self.image_alt = ""


def parse_html_list(raw: bytes, source: dict) -> list[dict]:
    parser = HtmlListParser(str(source.get("url") or ""), str(source.get("linkPattern") or ""))
    parser.feed(decode_web_text(raw))
    return parser.entries[:20]


class KepuChinaVideoParser(HTMLParser):
    def __init__(self, base_url: str) -> None:
        super().__init__(convert_charrefs=True)
        self.base_url = base_url
        self.slide_depth = 0
        self.anchor_href = ""
        self.anchor_parts: list[str] = []
        self.anchor_candidates: list[tuple[str, str]] = []
        self.image = ""
        self.image_alt = ""
        self.is_video = False
        self.entries: list[dict] = []

    def handle_starttag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        tag = tag.lower()
        attrs_map = {str(key).lower(): str(value or "") for key, value in attrs}
        classes = set(attrs_map.get("class", "").split())
        if tag == "div":
            if self.slide_depth:
                self.slide_depth += 1
            elif "swiper-slide" in classes:
                self.slide_depth = 1
                self.anchor_candidates = []
                self.image = ""
                self.image_alt = ""
                self.is_video = False
            return
        if not self.slide_depth:
            return
        if tag == "a":
            self.anchor_href = attrs_map.get("href", "")
            self.anchor_parts = []
        elif tag == "img":
            image_src = attrs_map.get("src") or attrs_map.get("data-src") or ""
            image_alt = clean_text(attrs_map.get("alt", ""))
            if "play-video" in classes and attrs_map.get("movie-url"):
                self.is_video = True
            elif image_src and not self.image:
                self.image = urllib.parse.urljoin(self.base_url, image_src)
                if len(image_alt) >= 8:
                    self.image_alt = image_alt

    def handle_data(self, data: str) -> None:
        if self.slide_depth and self.anchor_href:
            self.anchor_parts.append(data)

    def handle_endtag(self, tag: str) -> None:
        tag = tag.lower()
        if tag == "a" and self.slide_depth and self.anchor_href:
            self.anchor_candidates.append((self.anchor_href, clean_text(" ".join(self.anchor_parts))))
            self.anchor_href = ""
            self.anchor_parts = []
            return
        if tag != "div" or not self.slide_depth:
            return
        self.slide_depth -= 1
        if self.slide_depth:
            return
        if not self.is_video:
            return
        for href, anchor_title in self.anchor_candidates:
            parsed_href = urllib.parse.urlsplit(urllib.parse.urljoin(self.base_url, href))
            query = urllib.parse.parse_qs(parsed_href.query)
            if query.get("classify", [""])[0] != "2" or not query.get("ar_id", [""])[0]:
                continue
            title = anchor_title or self.image_alt
            link = urllib.parse.urljoin(self.base_url, href)
            if len(title) >= 8 and normalize_url(link):
                self.entries.append({
                    "title": title,
                    "summary": "",
                    "link": link,
                    "published": "",
                    "image": safe_image_url(self.image, link),
                    "externalId": clean_text(query["ar_id"][0]),
                })
                break


def parse_kepuchina_video_list(raw: bytes, source: dict) -> list[dict]:
    parser = KepuChinaVideoParser(str(source.get("url") or ""))
    parser.feed(decode_web_text(raw))
    return parser.entries[:20]


def parse_json_list(raw: bytes, source: dict) -> list[dict]:
    payload = json.loads(decode_web_text(raw))
    items = []
    if isinstance(payload, dict):
        if isinstance(payload.get("datasource"), list):
            items = payload["datasource"]
        elif isinstance(payload.get("data"), dict) and isinstance(payload["data"].get("list"), list):
            items = payload["data"]["list"]
    parsed = []
    for item in items[:20]:
        if not isinstance(item, dict):
            continue
        title = clean_text(item.get("showTitle") or item.get("title") or "")
        link = urllib.parse.urljoin(str(source.get("url") or ""), str(item.get("publishUrl") or item.get("url") or ""))
        images = item.get("titleImages") if isinstance(item.get("titleImages"), list) else []
        image = images[0].get("imageUrl", "") if images and isinstance(images[0], dict) else item.get("image", "")
        if title and normalize_url(link):
            parsed.append({
                "title": title,
                "summary": clean_text(item.get("description") or item.get("summary") or item.get("brief") or ""),
                "link": link,
                "published": clean_text(item.get("publishTime") or item.get("date") or item.get("time") or ""),
                "image": safe_image_url(image, link),
                "duration": clean_text(item.get("length") or item.get("duration") or ""),
                "externalId": clean_text(item.get("guid") or item.get("id") or ""),
            })
    return parsed


def parse_source(raw: bytes, source: dict) -> list[dict]:
    source_format = str(source.get("format") or "rss").lower()
    if source_format == "kepuchina-video":
        return parse_kepuchina_video_list(raw, source)
    if source_format == "html":
        return parse_html_list(raw, source)
    if source_format == "json":
        return parse_json_list(raw, source)
    return parse_feed(raw)


class PageMetadataParser(HTMLParser):
    def __init__(self) -> None:
        super().__init__(convert_charrefs=True)
        self.in_main = 0
        self.in_excluded = 0
        self.capture_tag = ""
        self.capture_parts: list[str] = []
        self.blocks: list[str] = []
        self.description = ""
        self.image = ""

    def handle_starttag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        attrs_map = {str(key).lower(): str(value or "") for key, value in attrs}
        tag = tag.lower()
        if tag == "main":
            self.in_main += 1
        if tag in {"header", "nav", "footer", "script", "style"}:
            self.in_excluded += 1
        if tag == "meta":
            key = (attrs_map.get("property") or attrs_map.get("name") or "").lower()
            content = attrs_map.get("content", "")
            if key in {"description", "og:description", "twitter:description"} and not self.description:
                self.description = clean_text(content)
            if key in {"og:image", "og:image:secure_url", "twitter:image"} and not self.image:
                self.image = content.strip()
        if not self.in_excluded and tag in {"p", "li"} and not self.capture_tag:
            self.capture_tag = tag
            self.capture_parts = []

    def handle_data(self, data: str) -> None:
        if self.capture_tag:
            self.capture_parts.append(data)

    def handle_endtag(self, tag: str) -> None:
        tag = tag.lower()
        if self.capture_tag == tag:
            block = clean_text(" ".join(self.capture_parts))
            if len(block) >= 35:
                self.blocks.append(block)
            self.capture_tag = ""
            self.capture_parts = []
        if tag == "main" and self.in_main:
            self.in_main -= 1
        if tag in {"header", "nav", "footer", "script", "style"} and self.in_excluded:
            self.in_excluded -= 1


SOURCE_NAVIGATION_NAMES = (
    "安徽省", "广西壮族自治区", "河南省", "吉林省", "江西省", "山东省",
    "云南省", "浙江省", "重庆市", "山西省", "内蒙古自治区", "黑龙江省",
    "江苏省", "湖北省", "湖南省", "广东省", "海南省", "宁夏回族自治区",
    "新疆维吾尔自治区", "青海省", "西藏自治区", "河北省",
)


def source_material_is_usable(value: str) -> bool:
    text = clean_text(value)
    if len(text) < 24:
        return False
    if sum(name in text for name in SOURCE_NAVIGATION_NAMES) >= 6:
        return False
    repeated = re.search(r"(.{24,200}?)\s*\1", text)
    if repeated:
        return False
    return True


def enrich_entry_from_page(entry: dict) -> dict:
    """Collect limited source-page evidence for summarization and fill missing metadata."""
    link = str(entry.get("link") or "").strip()
    if not normalize_url(link):
        return entry
    try:
        raw, _, _ = fetch(link, max_attempts=1)
        parser = PageMetadataParser()
        parser.feed(decode_web_text(raw))
    except (RuntimeError, ValueError, UnicodeError):
        return entry
    enriched = dict(entry)
    summary = clean_text(enriched.get("summary", ""))
    metadata_summary = clean_text(parser.description)
    leading = clean_text(" ".join(parser.blocks[:10]))
    material_parts = []
    for candidate in (summary, metadata_summary):
        if source_material_is_usable(candidate) and candidate not in material_parts:
            material_parts.append(candidate)
    if not material_parts and source_material_is_usable(leading):
        material_parts.append(leading)
    source_material = clean_text(" ".join(material_parts))
    if source_material:
        enriched["sourceMaterial"] = truncate_text(source_material, 6000)
        enriched["sourceMaterialType"] = "source-metadata" if metadata_summary else "rss-and-source-page"
    if len(summary) < 60:
        replacement_summary = metadata_summary if source_material_is_usable(metadata_summary) else ""
        if not replacement_summary:
            leading_summary = clean_text(" ".join(parser.blocks[:4]))
            replacement_summary = leading_summary if source_material_is_usable(leading_summary) else ""
        enriched["summary"] = truncate_text(replacement_summary, 900)
        if enriched["summary"]:
            enriched["summarySourceType"] = "source-page"
    if not str(enriched.get("image") or "").startswith(("http://", "https://")):
        enriched["image"] = safe_image_url(parser.image, link)
    return enriched


def refresh_retained_source_material(stories: list[dict]) -> list[dict]:
    for story in stories:
        if not story.get("collectionSourceId"):
            continue
        material = clean_text(story.get("sourceMaterial", ""))
        if not source_material_is_usable(material):
            enriched = enrich_entry_from_page({
                "link": story.get("sourceUrl", ""),
                "summary": "",
                "image": story.get("image", ""),
            })
            material = clean_text(enriched.get("sourceMaterial", ""))
            if source_material_is_usable(material):
                story["sourceMaterial"] = truncate_text(material, 6000)
                story["sourceMaterialType"] = enriched.get("sourceMaterialType", "source-metadata")
        if not source_material_is_usable(material):
            continue
        if not source_material_is_usable(story.get("excerpt", "")):
            story["excerpt"] = truncate_text(material, 280)
        if not source_material_is_usable(story.get("body", "")):
            story["body"] = build_review_body(
                material, story.get("source", "公开来源"), story.get("category", "")
            )
            story["status"] = "review"
            story["reviewNote"] = "历史正文含导航或重复片段，已清理并转为待编辑资料"
            story["contentGenerationMode"] = "pending-editorial-expansion"
    return stories


def keyword_hits(text: str, words: list[str]) -> int:
    lower = (text or "").lower()
    hits = 0
    for word in words:
        keyword = str(word).strip().lower()
        if not keyword:
            continue
        if re.fullmatch(r"[a-z0-9][a-z0-9 .+#/-]*", keyword):
            pattern = rf"(?<![a-z0-9]){re.escape(keyword)}(?![a-z0-9])"
            hits += int(bool(re.search(pattern, lower)))
        else:
            hits += int(keyword in lower)
    return hits


def categorize(title: str, summary: str, fallback: str, rules: dict[str, list[str]]) -> str:
    scores = {
        category: keyword_hits(title, words) * 3 + keyword_hits(summary, words)
        for category, words in rules.items()
    }
    if fallback in scores:
        scores[fallback] += 2
    category, score = max(scores.items(), key=lambda item: item[1])
    return category if score > 0 else (fallback or "科技")


def category_evidence_score(
    title: str, summary: str, category: str, rules: dict[str, list[str]]
) -> int:
    words = rules.get(category, [])
    return keyword_hits(title, words) * 3 + keyword_hits(summary, words)


def refresh_retained_categories(
    stories: list[dict], sources: list[dict], rules: dict[str, list[str]]
) -> list[dict]:
    source_by_id = {source.get("id"): source for source in sources if source.get("id")}
    for story in stories:
        story["sourceUrl"] = story.get("sourceUrl") or story.get("url") or ""
        story.pop("url", None)
        source = source_by_id.get(story.get("collectionSourceId"))
        if source:
            story["category"] = categorize(
                story.get("title", ""),
                story.get("excerpt", ""),
                source.get("categoryHint", ""),
                rules,
            )
            story["tags"] = tags_for(
                f"{story.get('title', '')} {story.get('excerpt', '')}",
                story["category"],
            )
            story["sourceTrustLevel"] = source.get("trustLevel", story.get("sourceTrustLevel", "standard"))
            story["sourceType"] = source.get("type", story.get("sourceType", "professional"))
            if not story.get("confidence"):
                story["confidence"] = max(0, min(100, int(source.get("confidence", 75))))
        if len(clean_text(story.get("excerpt", ""))) < 60 and story.get("sourceUrl"):
            enriched = enrich_entry_from_page({
                "link": story["sourceUrl"],
                "summary": story.get("excerpt", ""),
                "image": story.get("image", ""),
            })
            if len(clean_text(enriched.get("summary", ""))) >= 60:
                story["excerpt"] = truncate_text(enriched["summary"], 280)
                story["body"] = build_review_body(
                    story["excerpt"], story.get("source", "公开来源")
                )
                story["summarySourceType"] = enriched.get("summarySourceType", "source-page")
            remote_image = safe_image_url(enriched.get("image", ""), story["sourceUrl"])
            if remote_image and not str(story.get("image", "")).startswith("http"):
                story["image"] = remote_image
                story["imageSourceType"] = "source-page"
                story["imageAttribution"] = story.get("source", "来源页面")
        story["categoryEvidenceScore"] = category_evidence_score(
            story.get("title", ""), story.get("excerpt", ""), story["category"], rules
        )
        fallback = category_cover(story["category"])
        story["imageFallback"] = fallback
        if not story.get("image") or story.get("image") == DEFAULT_COVER:
            story["image"] = fallback
            story["imageSourceType"] = "category-cover"
            story["imageAttribution"] = "平台板块封面"
        if not story.get("body"):
            story["body"] = build_review_body(
                story.get("excerpt", ""), story.get("source", "公开来源")
            )
    return stories


def tags_for(text: str, category: str) -> list[str]:
    candidates = [
        "工业大模型", "人形机器人", "先进封装", "Chiplet", "固态电池",
        "数字孪生", "储能", "算力", "边缘智能", "工业互联网",
        "半导体", "新能源", "智能制造", "金融科技", "数字支付",
        "精准农业", "农业机器人", "数字人文", "文化遗产"
    ]
    lower = text.lower()
    tags = [category]
    tags.extend(word for word in candidates if word.lower() in lower)
    return list(dict.fromkeys(tags))[:5]


def count_content_characters(value: str) -> int:
    return len(re.findall(r"[A-Za-z0-9\u3400-\u9fff]", str(value or "")))


def has_cjk_text(value: str) -> bool:
    return bool(re.search(r"[\u3400-\u9fff]", str(value or "")))


def localized_source_name(value: str) -> str:
    name = str(value or "").strip()
    if not name:
        return "公开来源"
    if name in SOURCE_NAME_ALIASES:
        return SOURCE_NAME_ALIASES[name]
    return "公开来源机构" if re.fullmatch(r"[\x00-\x7f\s.,&'()/-]+", name) else name


def has_source_disclosure(value: str) -> bool:
    return SOURCE_DISCLOSURE_HEADING in str(value or "") or LEGACY_DISCLOSURE_HEADING in str(value or "")


def has_long_english_run(value: str) -> bool:
    return bool(re.search(r"(?:\b[A-Za-z][A-Za-z'-]*\b[\s,.;:!?()/-]*){8,}", str(value or "")))


def env_flag(name: str, fallback: bool = False) -> bool:
    value = os.environ.get(name)
    if value is None:
        return fallback
    return value.strip().lower() in {"1", "true", "yes", "on"}


def fallback_topic(category: str, title: str, material: str) -> tuple[str, str]:
    combined = f"{title} {material}".lower()
    for keywords, topic_title, topic_summary in FALLBACK_TOPIC_RULES.get(category, []):
        if all(keyword in combined for keyword in keywords):
            return topic_title, topic_summary
    return (
        f"{category}公开资料提供新的观察线索",
        f"这项公开信息与{category}领域近期的研究、技术、制度或应用变化有关，具体主题由来源标题和摘要共同呈现。",
    )


def body_meets_publication_standard(value: str) -> bool:
    body = str(value or "").strip()
    paragraphs = [item.strip() for item in re.split(r"\n{2,}", body) if item.strip()]
    normalized = [re.sub(r"\s+", "", item) for item in paragraphs]
    return (
        count_content_characters(body) >= MIN_ARTICLE_CHARS
        and len(paragraphs) >= 6
        and len(normalized) == len(set(normalized))
        and has_source_disclosure(body)
        and not has_long_english_run(body)
    )


def build_review_body(summary: str, source_name: str, category: str = "") -> str:
    summary = truncate_text(summary, 900) if has_cjk_text(summary) else ""
    summary = summary or "该条目来自公开订阅源，尚待编辑补充中文摘要。"
    display_source = localized_source_name(source_name)
    return (
        "核心信息\n\n"
        f"{summary}\n\n"
        "编辑状态\n\n"
        f"这是一条属于“{category or '待分类'}”板块的采集线索，正文尚未达到 800 字公开标准，当前只进入后台待审核区。\n\n"
        f"{SOURCE_DISCLOSURE_HEADING}\n\n"
        f"本资料来自“{display_source}”公开订阅摘要，仅用于线索发现和后台审核。"
        "正式发布前请编辑核对标题、事实、分类、图片使用边界及原始链接。"
    )


def parse_model_json(value: str) -> dict:
    candidate = str(value or "").strip()
    candidate = re.sub(r"^```(?:json)?\s*", "", candidate, flags=re.I)
    candidate = re.sub(r"\s*```$", "", candidate)
    start, end = candidate.find("{"), candidate.rfind("}")
    if start < 0 or end <= start:
        raise ValueError("模型没有返回 JSON 对象")
    payload = json.loads(candidate[start:end + 1])
    if not isinstance(payload, dict):
        raise ValueError("模型返回格式错误")
    return payload


def text_needs_translation(value: str) -> bool:
    text = clean_text(value)
    return bool(re.search(r"[A-Za-z]", text)) and (not has_cjk_text(text) or has_long_english_run(text))


def translation_chunks(value: str, limit: int = 420) -> list[str]:
    text = clean_text(value)
    chunks = []
    while text:
        if len(text) <= limit:
            chunks.append(text)
            break
        split_at = max(text.rfind(marker, 0, limit) for marker in (". ", "? ", "! ", "; ", "。", "；"))
        if split_at < limit // 2:
            split_at = limit
        else:
            split_at += 1
        chunks.append(text[:split_at].strip())
        text = text[split_at:].strip()
    return chunks


def free_translate_text(value: str) -> str:
    translated_parts = []
    for chunk in translation_chunks(value):
        params = urllib.parse.urlencode({"q": chunk, "langpair": "en|zh-CN"})
        request = urllib.request.Request(
            f"{FREE_TRANSLATION_ENDPOINT}?{params}",
            headers={"Accept": "application/json", "User-Agent": "information-share-platform/1.0"},
        )
        result = None
        for attempt in range(1, 3):
            try:
                with urllib.request.urlopen(request, timeout=30) as response:
                    result = json.loads(response.read().decode("utf-8"))
                break
            except (urllib.error.HTTPError, urllib.error.URLError, TimeoutError) as exc:
                if attempt == 2:
                    raise RuntimeError(f"公开翻译服务不可用：{exc}") from exc
                time.sleep(attempt * 2)
        translated = clean_text((result or {}).get("responseData", {}).get("translatedText", ""))
        if int((result or {}).get("responseStatus") or 0) != 200 or not has_cjk_text(translated):
            raise ValueError("公开翻译服务没有返回可靠中文译文")
        translated_parts.append(translated)
    return clean_text(" ".join(translated_parts))


def add_free_source_translation(story: dict) -> bool:
    original_title = clean_text(story.get("originalTitle") or story.get("title") or "")
    original_material = truncate_text(story.get("sourceMaterial") or story.get("excerpt") or "", 1500)
    title_needs_translation = text_needs_translation(original_title)
    material_needs_translation = text_needs_translation(original_material)
    if not title_needs_translation and not material_needs_translation:
        return False
    translated_title = clean_text(story.get("translatedSourceTitle", ""))
    translated_material = clean_text(story.get("translatedSourceMaterial", ""))
    if not title_needs_translation:
        translated_title = original_title
    if not material_needs_translation:
        translated_material = original_material
    if title_needs_translation and not has_cjk_text(translated_title):
        translated_title = free_translate_text(original_title)
    if material_needs_translation and not source_material_is_usable(translated_material):
        translated_material = free_translate_text(original_material)
    if not has_cjk_text(translated_title) or not source_material_is_usable(translated_material):
        raise ValueError("外文来源未取得完整中文译文")
    story["translatedSourceTitle"] = translated_title
    story["translatedSourceMaterial"] = truncate_text(translated_material, 1600)
    story["translationProvider"] = "MyMemory 公共翻译服务"
    story["translationMode"] = "machine-translation"
    return True


def generate_ai_article(story: dict) -> dict:
    token = os.environ.get("GITHUB_MODELS_TOKEN", "").strip()
    if not token:
        raise RuntimeError("未配置 GitHub Models 免费推理令牌")
    material = truncate_text(story.get("sourceMaterial") or story.get("excerpt", ""), 4000)
    if len(clean_text(material)) < 120:
        raise ValueError("来源材料不足 120 字符，不能可靠扩写")
    source_name = str(story.get("source") or "公开来源")
    display_source = localized_source_name(source_name)
    source_url = str(story.get("sourceUrl") or "")
    original_title = clean_text(story.get("originalTitle") or story.get("title") or "")
    prompt = f"""请把下面的公开来源材料整理成内容完整、通俗易懂的中文科普文章，并为来源标题和公开摘要提供忠实中文译文。只使用材料中明确出现的事实，不补造数字、人物、结论或因果关系。

输出必须是一个 JSON 对象，字段只有 title、excerpt、body、sourceTitleZh、sourceMaterialZh：
- title：准确的中文标题，10-60字；
- excerpt：中文导语，80-160字；
- body：1100-1600个中文字符，分为“核心进展、背景与原理、关键内容、应用与影响”四个内容章节，每节用“节标题\\n\\n正文”表示，各节之间空一行；不要使用 Markdown 符号；
- sourceTitleZh：来源原始标题的忠实中文翻译，不添加“前沿观察”等平台措辞；原始标题已是中文时原样保留；
- sourceMaterialZh：来源公开摘要或片段的忠实中文翻译，保留原有事实、数字和限定语，不扩写、不评论，长度不超过1200个中文字符；原材料已是中文时尽量原样保留；
- 开头直接讲事件或知识本身，不写审核、可信度、核验方法、编辑流程、阅读建议或免责声明；
- 全文必须使用中文表达；不要出现英文段落、英文标题、英文来源名或网页地址；外文机构名请译成中文，无法确认译名时写“来源机构”；
- 不要复制长句，专业名词和短引用除外；材料没说的内容明确写“来源材料未说明”；
- 不写宣传语，不使用“平台整理”“仍待核验”“读者如何核验”“局限与待观察”等提示型表述；
- body 不要写“来源与审核说明”或“简要来源”，来源尾注由系统另行添加。

板块：{story.get('category', '')}
来源机构中文名：{display_source}
来源原始标题：{original_title}
原文地址：{source_url}
来源材料：
{material}"""
    request_body = {
        "model": os.environ.get("GITHUB_MODELS_MODEL", DEFAULT_ARTICLE_MODEL),
        "messages": [
            {
                "role": "system",
                "content": "你是严谨的中文科技编辑。你的首要规则是忠于来源、区分事实与分析、绝不编造。",
            },
            {"role": "user", "content": prompt},
        ],
        "temperature": 0.2,
        "top_p": 0.9,
        "max_tokens": 3000,
        "response_format": {"type": "json_object"},
    }
    request = urllib.request.Request(
        GITHUB_MODELS_ENDPOINT,
        data=json.dumps(request_body, ensure_ascii=False).encode("utf-8"),
        headers={
            "Authorization": f"Bearer {token}",
            "Content-Type": "application/json",
            "Accept": "application/json",
            "User-Agent": "information-share-editor/1.0",
        },
        method="POST",
    )
    result = None
    for attempt in range(1, 4):
        try:
            with urllib.request.urlopen(request, timeout=90) as response:
                result = json.loads(response.read().decode("utf-8"))
            break
        except urllib.error.HTTPError as exc:
            detail = exc.read().decode("utf-8", errors="replace")[:300]
            if exc.code not in {429, 500, 502, 503, 504} or attempt == 3:
                raise RuntimeError(f"GitHub Models HTTP {exc.code}: {detail}") from exc
            retry_after = exc.headers.get("Retry-After", "")
            delay = int(retry_after) if str(retry_after).isdigit() else attempt * 5
            time.sleep(min(30, max(1, delay)))
    if not isinstance(result, dict):
        raise RuntimeError("GitHub Models 未返回有效响应")
    content = result.get("choices", [{}])[0].get("message", {}).get("content", "")
    article = parse_model_json(content)
    title = clean_text(article.get("title", ""))
    excerpt = clean_text(article.get("excerpt", ""))
    body = str(article.get("body") or "").strip()
    source_title_zh = clean_text(article.get("sourceTitleZh", ""))
    source_material_zh = truncate_text(article.get("sourceMaterialZh", ""), 1600)
    if not (10 <= count_content_characters(title) <= 80):
        raise ValueError("生成标题长度不合格")
    if count_content_characters(excerpt) < 60:
        raise ValueError("生成导语长度不合格")
    if count_content_characters(body) < MIN_ARTICLE_CHARS:
        raise ValueError("生成正文不足 800 字")
    if has_long_english_run("\n\n".join([title, excerpt, body])):
        raise ValueError("生成内容包含过多英文，未达到中文科普标准")
    if not has_cjk_text(source_title_zh):
        raise ValueError("来源标题没有生成可靠的中文译文")
    if not source_material_is_usable(source_material_zh) or not has_cjk_text(source_material_zh):
        raise ValueError("来源摘要没有生成可靠的中文译文")
    if source_url and source_url in body:
        raise ValueError("生成正文不应直接展示网页地址")
    body += (
        f"\n\n{SOURCE_DISCLOSURE_HEADING}\n\n"
        f"来源：{display_source}公开资料。版权归原作者或发布机构所有，请以原文为准。"
    )
    if not body_meets_publication_standard(body):
        raise ValueError("生成正文未通过结构、长度或重复检查")
    return {
        "title": title,
        "excerpt": excerpt,
        "body": body,
        "translatedSourceTitle": source_title_zh,
        "translatedSourceMaterial": source_material_zh,
    }


def build_structured_article(story: dict) -> dict:
    """Create a transparent, non-generative fallback when model inference is unavailable."""
    category = str(story.get("category") or "科技")
    context = CATEGORY_EDITORIAL_CONTEXT.get(category, CATEGORY_EDITORIAL_CONTEXT["科技"])
    source_name = str(story.get("source") or "公开来源")
    display_source = localized_source_name(source_name)
    raw_title = clean_text(story.get("originalTitle") or story.get("title") or "")
    raw_summary = clean_text(story.get("sourceMaterial") or story.get("excerpt") or "")
    title_source = clean_text(story.get("translatedSourceTitle") or raw_title)
    summary = clean_text(story.get("translatedSourceMaterial") or raw_summary)
    if not has_cjk_text(title_source) or not has_cjk_text(summary):
        raise ValueError("外文来源必须由模型生成忠实中文译文，不能使用通用结构兜底")
    topic_title, topic_summary = fallback_topic(category, title_source, summary)
    summary = truncate_text(summary, 560) if has_cjk_text(summary) else ""
    summary = summary or topic_summary
    display_title = title_source if has_cjk_text(title_source) else topic_title
    title = f"{category}前沿观察：{display_title}" if display_title else f"{category}板块前沿观察"
    excerpt = truncate_text(f"{summary}{context['impact']}", 180)
    sections = [
        ("核心进展", f"{summary}。这一进展属于{category}领域近期公开信息的一部分，核心内容集中在上述主题本身及其所涉及的技术、制度或应用变化。"),
        ("背景与原理", context["background"] + context["principle"]),
        ("关键内容", context["principle"] + "这类进展通常由多个环节共同构成，既包括前端的研究、设计与资源投入，也包括中间环节的实施、测试和协作，还包括最终应用中的成本、效率、稳定性与实际需求。把这些环节联系起来，可以更清楚地理解一项进展在整个领域中的位置，以及它与既有方法之间的关系。具体案例中的目标、实施主体、所用方法、阶段性结果和应用对象共同构成信息主线，各个环节之间的衔接方式往往比单一指标更能说明其实际意义。参与者之间的分工也会影响成果的形成方式：研究机构提供知识与方法，企业负责工程化和运营，公共部门制定规则并建设基础条件，最终使用者则通过真实需求推动方案持续调整。一个项目从提出概念到稳定应用，通常会依次经历研究、试验、示范、部署和长期运行等阶段，每个阶段关注的问题和形成的价值都不相同。"),
        ("应用与影响", context["impact"] + "从应用角度看，新的知识、技术或制度安排需要经过具体场景的使用，才能转化为持续的社会和产业价值。不同地区、组织和使用者具备的基础条件并不相同，实际影响往往会随着基础设施、专业能力、资源配置和应用方式而变化。围绕这些条件展开，可以把单条信息放进更完整的发展脉络中理解。"),
    ]
    body = "\n\n".join(f"{heading}\n\n{text}" for heading, text in sections)
    body += (
        f"\n\n{SOURCE_DISCLOSURE_HEADING}\n\n"
        f"来源：{display_source}公开资料。版权归原作者或发布机构所有，请以原文为准。"
    )
    if not body_meets_publication_standard(body):
        raise ValueError("结构化整理正文未达到 800 字标准")
    return {
        "title": title,
        "excerpt": excerpt,
        "body": body,
        "translatedSourceTitle": title_source,
        "translatedSourceMaterial": truncate_text(summary, 1600),
    }


def enhance_queue_bodies(queue: list[dict], categories: list[str]) -> dict:
    try:
        target = int(os.environ.get("ARTICLE_GENERATION_TARGET_PER_CATEGORY", 3))
    except ValueError:
        target = 3
    # The public schedule promises at least two candidates per board each day.
    target = max(2, min(10, target))
    try:
        video_target = int(os.environ.get("VIDEO_GENERATION_TARGET", 3))
    except ValueError:
        video_target = 3
    video_target = max(1, min(6, video_target))
    video_candidates = [story for story in queue if story.get("contentKind") == "video"]
    video_candidates.sort(key=story_queue_priority, reverse=True)
    priority_video_ids = {id(story) for story in video_candidates[:video_target]}
    try:
        translation_target = int(os.environ.get("FREE_TRANSLATION_TARGET", 3))
    except ValueError:
        translation_target = 3
    translation_target = max(0, min(6, translation_target))
    translations_used = 0
    stats = {
        "requested": 0, "generated": 0, "translated": 0, "failed": 0,
        "minimumCharacters": MIN_ARTICLE_CHARS,
    }
    force_structured_fallback = env_flag("ARTICLE_FORCE_STRUCTURED_FALLBACK", False)
    for category in categories:
        candidates = [story for story in queue if story.get("category") == category]
        candidates.sort(key=story_queue_priority, reverse=True)
        selected = candidates[:target]
        selected.extend(story for story in candidates if id(story) in priority_video_ids and story not in selected)
        for story in selected:
            if body_meets_publication_standard(story.get("body", "")):
                continue
            stats["requested"] += 1
            if not os.environ.get("GITHUB_MODELS_TOKEN", "").strip() and not force_structured_fallback:
                story["contentGenerationMode"] = "pending-editorial-expansion"
                story["contentGenerationError"] = "未配置 GitHub Models 免费推理令牌"
                story["reviewNote"] = "正文未达到 800 字公开标准，仅保留在待审核区"
                stats["failed"] += 1
                continue
            if len(clean_text(story.get("sourceMaterial", ""))) < 600:
                enriched = enrich_entry_from_page({
                    "link": story.get("sourceUrl", ""),
                    "summary": story.get("sourceMaterial") or story.get("excerpt", ""),
                    "image": story.get("image", ""),
                })
                story["sourceMaterial"] = enriched.get("sourceMaterial") or story.get("sourceMaterial") or story.get("excerpt", "")
                remote_image = safe_image_url(enriched.get("image", ""), story.get("sourceUrl", ""))
                if remote_image and story.get("imageSourceType") == "category-cover":
                    story["image"] = remote_image
                    story["imageSourceType"] = "source-page"
                    story["imageAttribution"] = story.get("source", "来源页面")
            try:
                try:
                    if force_structured_fallback:
                        raise RuntimeError("已启用结构化中文兜底生成")
                    article = generate_ai_article(story)
                    generation_mode = "github-models-source-grounded"
                except (RuntimeError, ValueError) as exc:
                    # GitHub Models can be rate-limited or temporarily retired. Keep
                    # the publication pipeline useful without inventing source facts.
                    source_text = " ".join([
                        str(story.get("originalTitle") or story.get("title") or ""),
                        str(story.get("sourceMaterial") or story.get("excerpt") or ""),
                    ])
                    if text_needs_translation(source_text):
                        translation_ready = has_cjk_text(story.get("translatedSourceTitle")) \
                            and source_material_is_usable(story.get("translatedSourceMaterial"))
                        if not translation_ready:
                            if translations_used >= translation_target:
                                raise ValueError("今日免费外文翻译名额已用完，资料保留在待审核区") from exc
                            if add_free_source_translation(story):
                                translations_used += 1
                                stats["translated"] += 1
                    article = build_structured_article(story)
                    generation_mode = "source-grounded-structured-fallback"
                    story["contentGenerationFallbackReason"] = str(exc)[:300]
                story["originalTitle"] = story.get("originalTitle") or story.get("title", "")
                story.update(article)
                story["language"] = "zh-CN"
                story["contentGenerationMode"] = generation_mode
                story["contentCharacterCount"] = count_content_characters(story["body"])
                story["readMinutes"] = max(4, min(12, round(story["contentCharacterCount"] / 400)))
                story["reviewNote"] = "已通过 800 字、来源可追溯、段落去重和中文结构检查"
                story.pop("contentGenerationError", None)
                stats["generated"] += 1
            except Exception as exc:  # noqa: BLE001
                story["contentGenerationMode"] = "pending-editorial-expansion"
                story["contentGenerationError"] = str(exc)[:300]
                story["reviewNote"] = "正文未达到 800 字公开标准，仅保留在待审核区"
                stats["failed"] += 1
    return stats


def make_story(entry: dict, source: dict, index: int, rules: dict[str, list[str]]) -> dict:
    combined = f"{entry.get('title', '')} {entry.get('summary', '')}"
    fallback = source.get("categoryHint", "")
    if fallback not in rules:
        fallback = next(iter(rules), "科技")
    category = categorize(entry.get("title", ""), entry.get("summary", ""), fallback, rules)
    evidence_score = category_evidence_score(
        entry.get("title", ""), entry.get("summary", ""), category, rules
    )
    if (
        source.get("contentKind") == "video"
        and source.get("trustLevel") == "authoritative"
        and category == source.get("categoryHint")
    ):
        # A curated official science program is itself evidence for its
        # configured fallback category when an episode uses a plain-language title.
        evidence_score = max(2, evidence_score)
    excerpt = truncate_text(entry.get("summary", ""), 280) or "来自公开来源的前沿信息，等待后台进一步编辑摘要。"
    confidence = max(0, min(100, int(source.get("confidence", 75))))
    trust_level = source.get("trustLevel", "standard")
    status = "review" if confidence >= 80 and trust_level in {"authoritative", "professional"} else "draft"
    review_note = "来源可信度较高，仍需核对标题、摘要和原始链接" if status == "review" else "需要编辑核验来源、摘要与分类后再发布"
    fallback_image = category_cover(category)
    source_image = safe_image_url(entry.get("image", ""), entry.get("link", ""))
    image = source_image or fallback_image
    source_name = source.get("name", "公开来源")
    story = {
        "id": index + 1,
        "category": category,
        "categoryEvidenceScore": evidence_score,
        "title": truncate_text(entry["title"], 160),
        "excerpt": excerpt,
        "body": build_review_body(excerpt, source_name, category),
        "image": image,
        "imageFallback": fallback_image,
        "imageSourceType": "rss" if source_image else "category-cover",
        "imageAttribution": source_name if source_image else "平台板块封面",
        "originalTitle": clean_text(entry["title"]),
        "originalExcerpt": truncate_text(entry.get("summary", ""), 2000),
        "source": source_name,
        "sourceUrl": entry.get("link", ""),
        "author": "",
        "language": source.get("language", "en"),
        "sourceLanguage": source.get("language", "en"),
        "confidence": confidence,
        "time": "待审核",
        "readMinutes": 6,
        "heat": 78,
        "date": datetime.now(timezone.utc).date().isoformat(),
        "tags": tags_for(combined, category),
        "status": status,
        "collectionSourceId": source.get("id", ""),
        "sourceType": source.get("type", "professional"),
        "sourceRegion": source.get("region", "全球"),
        "sourceTrustLevel": trust_level,
        "originalPublishedAt": entry.get("published", ""),
        "collectedAt": datetime.now(timezone.utc).isoformat(),
        "reviewNote": review_note,
        "sourceMaterial": truncate_text(entry.get("sourceMaterial") or entry.get("summary", ""), 6000),
        "sourceMaterialType": entry.get("sourceMaterialType", "rss"),
    }
    if source.get("contentKind") == "video":
        story.update({
            "contentKind": "video",
            "videoType": source.get("videoType", "external"),
            "videoUrl": entry.get("link", ""),
            "videoPoster": source_image or fallback_image,
            "videoRightsConfirmed": source.get("videoRightsConfirmed") is True,
            "videoLinkOnly": source.get("videoLinkOnly") is True,
            "homeVideoFeatured": source.get("homeVideoFeatured") is True,
            "homeVideoPriority": max(0, min(100, int(source.get("homeVideoPriority", 50)))),
            "videoDuration": entry.get("duration", ""),
            "videoExternalId": entry.get("externalId", ""),
        })
    return story


def save_collection_log(log: dict) -> None:
    payload = load_json(LOG_FILE, {"logs": []})
    logs = [item for item in payload.get("logs", []) if item.get("id") != log.get("id")]
    logs.insert(0, log)
    LOG_FILE.write_text(
        json.dumps({"logs": logs[:50]}, ensure_ascii=False, indent=2),
        encoding="utf-8",
    )


def main() -> int:
    if not SOURCE_FILE.exists():
        print(f"缺少来源配置：{SOURCE_FILE}", file=sys.stderr)
        return 1

    started_at = datetime.now(timezone.utc).isoformat()
    sources = [source for source in load_sources() if source.get("enabled", True)]
    if not sources:
        print("没有启用的采集来源，已停止更新", file=sys.stderr)
        return 1
    rules = load_category_rules()
    retained_drafts = refresh_retained_categories(pending_drafts(), sources, rules)
    retained_drafts = refresh_retained_source_material(retained_drafts)
    stories = []
    errors = []
    source_results = []
    seen_urls, seen_titles = existing_fingerprints()
    fetched = 0
    duplicates = 0
    invalid_entries = 0

    for source in sources:
        source_added = 0
        source_duplicates = 0
        attempts = 0
        duration_ms = 0
        try:
            raw, attempts, duration_ms = fetch(source["url"])
            entries = parse_source(raw, source)
            if not entries:
                raise ValueError("订阅未返回可解析条目")
            max_items = max(1, min(20, int(source.get("maxItems", 5))))
            for entry in entries[:max_items]:
                fetched += 1
                url_key = normalize_url(entry.get("link", ""))
                title_key = normalize_title(entry.get("title", ""))
                if not url_key:
                    invalid_entries += 1
                    continue
                if (url_key and url_key in seen_urls) or near_duplicate_title(title_key, seen_titles):
                    duplicates += 1
                    source_duplicates += 1
                    continue
                if len(clean_text(entry.get("summary", ""))) < 60:
                    entry = enrich_entry_from_page(entry)
                stories.append(make_story(entry, source, len(stories), rules))
                source_added += 1
                if url_key:
                    seen_urls.add(url_key)
                if title_key:
                    seen_titles.add(title_key)
            source_results.append({
                "sourceId": source.get("id", ""),
                "source": source.get("name", source.get("url")),
                "status": "success",
                "attempts": attempts,
                "durationMs": duration_ms,
                "fetched": min(len(entries), max_items),
                "added": source_added,
                "duplicates": source_duplicates,
            })
        except Exception as exc:  # noqa: BLE001
            error = {"source": source.get("name", source.get("url")), "error": str(exc)}
            errors.append(error)
            source_results.append({
                "sourceId": source.get("id", ""),
                "source": error["source"],
                "status": "failed",
                "attempts": attempts or 3,
                "durationMs": duration_ms,
                "fetched": 0,
                "added": 0,
                "duplicates": 0,
                "error": error["error"],
            })

    finished_at = datetime.now(timezone.utc).isoformat()
    collection = {
        "id": finished_at,
        "startedAt": started_at,
        "finishedAt": finished_at,
        "status": "failed" if sources and len(errors) == len(sources) else ("partial" if errors else "success"),
        "sourcesTotal": len(sources),
        "sourcesSucceeded": len(sources) - len(errors),
        "sourcesFailed": len(errors),
        "fetched": fetched,
        "added": min(len(stories), 30),
        "duplicates": duplicates,
        "invalid": invalid_entries,
        "errors": errors,
        "sourceResults": source_results,
    }

    save_collection_log(collection)
    if len(errors) == len(sources):
        print("全部采集来源失败，已保留原有草稿队列", file=sys.stderr)
        return 1

    queue_limit = max(30, len(rules) * QUEUE_PER_CATEGORY)
    queue = balanced_queue(stories, retained_drafts, list(rules), queue_limit)
    generation = enhance_queue_bodies(queue, list(rules))
    new_story_objects = {id(story) for story in stories}
    new_in_queue = sum(1 for story in queue if id(story) in new_story_objects)
    collection["queueCount"] = len(queue)
    collection["categoryCounts"] = {
        category: sum(1 for story in queue if story.get("category") == category)
        for category in rules
    }
    collection["articleGeneration"] = generation
    payload = {
        "generatedAt": finished_at,
        "stories": queue,
        "errors": errors,
        "collection": collection,
    }
    OUTPUT_FILE.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"已生成：{OUTPUT_FILE}")
    print(
        f"新增入队：{new_in_queue}，保留待审：{len(queue) - new_in_queue}，重复跳过：{duplicates}，"
        f"无效条目：{invalid_entries}，成功来源：{collection['sourcesSucceeded']}，失败来源：{len(errors)}"
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
