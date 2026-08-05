(function () {
  "use strict";

  const DATA_URL = "data/intelligence-draft.json";
  const REFRESH_WINDOW_MS = 5 * 60 * 1000;
  let cachedBundle = null;
  let cachedAt = 0;

  function hasChinese(value) {
    return /[\u3400-\u9fff]/.test(String(value || ""));
  }

  function clean(value) {
    return String(value || "").replace(/\s+/g, " ").trim();
  }

  function cleanSourceText(value) {
    let text = clean(value).replace(/\.[a-z0-9_-]+\s*\{[^{}]{0,2000}\}/gi, " ");
    const markers = ["中央农业干部教育培训中心", "网站识别码", "京ICP备", "京公网安备", "版权所有", "主办单位"];
    const positions = markers.map(function (marker) { return text.indexOf(marker); }).filter(function (position) { return position >= 20; });
    if (positions.length) text = text.slice(0, Math.min.apply(null, positions)).trim();
    return text;
  }

  function cleanTranslationArtifacts(value, source) {
    let text = clean(value);
    if (source === "National Association of Manufacturers") {
      text = text
        .replace(/不结盟运动/g, "美国制造商协会")
        .replace(/\bPOST\s+/gi, "")
        .replace(/\bNAM\s*[，,]?\s*/g, "美国制造商协会");
    }
    return text.replace(/Magneto\s*[‐‑–—-]\s*ionic/gi, "磁离子").trim();
  }

  function safeUrl(value) {
    try {
      const url = new URL(String(value || ""), location.href);
      return url.protocol === "https:" || url.origin === location.origin ? url.href : "";
    } catch (error) {
      return "";
    }
  }

  function timestamp(story) {
    const candidates = [story.sourcePublishedAt, story.originalPublishedAt, story.date, story.collectedAt];
    for (const candidate of candidates) {
      const parsed = new Date(candidate || 0).getTime();
      if (Number.isFinite(parsed) && parsed > 0) return parsed;
    }
    return 0;
  }

  function displayTitle(story) {
    const candidates = hasChinese(story.originalTitle)
      ? [story.originalTitle, story.translatedSourceTitle, story.title]
      : [story.translatedSourceTitle, story.title, story.originalTitle];
    return clean(candidates.find(hasChinese) || "");
  }

  function displaySummary(story) {
    const candidates = [story.translatedSourceMaterial, story.sourceMaterial, story.originalExcerpt, story.excerpt];
    return cleanSourceText(candidates.find(function (value) { return hasChinese(value) && clean(value).length >= 28; }) || "").slice(0, 360);
  }

  function normalizeStory(story) {
    const title = cleanTranslationArtifacts(displayTitle(story), story.source);
    const url = safeUrl(story.sourceUrl || story.url);
    const excluded = ["公开资料提供新的观察线索", "我爸是顶流", "幸福中国年", "旅游强国里的中式浪漫"];
    if (!title || !url || !story.category || excluded.some(function (term) { return title.includes(term); })) return null;
    const publishedAt = timestamp(story);
    return {
      id: String(story.collectionSourceId || story.source || "source") + ":" + String(story.id || url),
      category: clean(story.category),
      title: title,
      summary: cleanTranslationArtifacts(displaySummary(story), story.source),
      originalTitle: clean(story.originalTitle),
      originalSummary: cleanSourceText(story.sourceMaterial || story.originalExcerpt).slice(0, 600),
      source: clean(story.source || "公开来源"),
      sourceType: clean(story.sourceType || "professional"),
      sourceRegion: clean(story.sourceRegion || "全球"),
      trustLevel: clean(story.sourceTrustLevel || "standard"),
      confidence: Math.max(0, Math.min(100, Number(story.confidence || 0))),
      url: url,
      publishedAt: publishedAt,
      collectedAt: new Date(story.collectedAt || 0).getTime() || 0,
      tags: Array.isArray(story.tags) ? story.tags.map(clean).filter(Boolean) : [],
      classificationMargin: Number(story.categoryClassificationMargin || 0),
      categoryEvidenceScore: Number(story.categoryEvidenceScore || 0),
      translationMode: clean(story.translationMode),
      raw: story
    };
  }

  function queryTerms(value) {
    const query = clean(value).toLowerCase();
    if (!query) return [];
    const terms = query.split(/\s+/).filter(Boolean);
    const aliases = {
      "人工智能": ["ai", "artificial intelligence", "大模型"],
      "大模型": ["llm", "人工智能"],
      "芯片": ["semiconductor", "半导体", "chip"],
      "储能": ["battery", "storage", "电池"],
      "机器人": ["robot", "robotics", "具身智能"],
      "金融科技": ["fintech", "数字金融"],
      "清洁能源": ["renewable", "solar", "新能源"]
    };
    return Array.from(new Set(terms.concat(aliases[query] || [])));
  }

  function relevance(story, query) {
    const normalizedQuery = clean(query).toLowerCase();
    if (!normalizedQuery) return 1;
    const terms = queryTerms(normalizedQuery);
    const title = story.title.toLowerCase();
    const summary = story.summary.toLowerCase();
    const original = `${story.originalTitle} ${story.originalSummary}`.toLowerCase();
    const tags = story.tags.join(" ").toLowerCase();
    const direct = [title, summary, original, tags].some(function (text) { return text.includes(normalizedQuery); });
    const alias = terms.some(function (term) {
      return term !== normalizedQuery && [title, summary, original, tags].some(function (text) { return text.includes(term); });
    });
    if (!direct && !alias) return 0;
    let score = direct ? 120 : 55;
    if (title.includes(normalizedQuery)) score += 100;
    if (summary.includes(normalizedQuery)) score += 45;
    if (tags.includes(normalizedQuery)) score += 30;
    terms.forEach(function (term) {
      if (title.includes(term)) score += 22;
      if (summary.includes(term)) score += 8;
    });
    const ageDays = story.publishedAt ? Math.max(0, (Date.now() - story.publishedAt) / 86400000) : 365;
    score += Math.max(0, 35 - Math.min(35, ageDays));
    return score;
  }

  function search(stories, options) {
    const settings = Object.assign({ query: "", category: "", limit: 12 }, options || {});
    return stories
      .filter(function (story) { return !settings.category || story.category === settings.category; })
      .map(function (story) { return Object.assign({}, story, { searchScore: relevance(story, settings.query) }); })
      .filter(function (story) { return story.searchScore > 0; })
      .sort(function (left, right) {
        return Number(right.publishedAt) - Number(left.publishedAt)
          || Number(right.searchScore) - Number(left.searchScore)
          || Number(right.confidence) - Number(left.confidence);
      })
      .slice(0, settings.limit);
  }

  function latest(stories, category, limit) {
    return search(stories, { category: category || "", limit: limit || 12 }).sort(function (left, right) {
      return Number(right.publishedAt) - Number(left.publishedAt)
        || Number(right.collectedAt) - Number(left.collectedAt)
        || Number(right.confidence) - Number(left.confidence);
    }).slice(0, limit || 12);
  }

  function formatDate(value) {
    if (!value) return "最近采集";
    return new Intl.DateTimeFormat("zh-CN", { month: "2-digit", day: "2-digit" }).format(new Date(value));
  }

  function formatDateTime(value) {
    if (!value) return "等待首次采集";
    return new Intl.DateTimeFormat("zh-CN", {
      month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hour12: false
    }).format(new Date(value));
  }

  async function load(options) {
    const force = options?.force === true;
    if (!force && cachedBundle && Date.now() - cachedAt < REFRESH_WINDOW_MS) return cachedBundle;
    const refreshKey = force ? Date.now() : Math.floor(Date.now() / REFRESH_WINDOW_MS);
    const response = await fetch(`${DATA_URL}?fresh=${refreshKey}`, { cache: "no-store" });
    if (!response.ok) throw new Error(`最新资料接口返回 ${response.status}`);
    const payload = await response.json();
    const stories = (Array.isArray(payload.stories) ? payload.stories : []).map(normalizeStory).filter(Boolean);
    const collection = payload.collection || {};
    cachedBundle = {
      generatedAt: payload.generatedAt || collection.finishedAt || "",
      stories: stories,
      collection: collection,
      errors: Array.isArray(payload.errors) ? payload.errors : []
    };
    cachedAt = Date.now();
    return cachedBundle;
  }

  window.FXIntelligence = {
    load: load,
    search: search,
    latest: latest,
    relevance: relevance,
    formatDate: formatDate,
    formatDateTime: formatDateTime,
    hasChinese: hasChinese
  };
}());
