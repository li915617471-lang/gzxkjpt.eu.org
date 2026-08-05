const CATEGORY_CONTENT_URL = "data/content.json";

const CATEGORY_COPY = {
  "金融": { description: "追踪金融基础设施、监管变化、支付体系与宏观政策中的关键公开信息。", image: "assets/network.jpg", focus: ["数字金融", "支付", "监管", "宏观经济"] },
  "科技": { description: "聚焦人工智能、算力、芯片、科研方法与新兴技术的可验证进展。", image: "assets/datacenter.jpg", focus: ["人工智能", "芯片", "算力", "科研"] },
  "工业": { description: "关注制造体系、自动化、供应链、工程能力与工业数字化的实际变化。", image: "assets/factory.jpg", focus: ["制造", "工业软件", "机器人", "供应链"] },
  "能源": { description: "整理电力系统、储能、能源贸易、清洁技术与基础设施的前沿资料。", image: "assets/energy.jpg", focus: ["电力", "储能", "清洁能源", "能源市场"] },
  "农业": { description: "连接农业科研、育种、农机、数据治理与可持续生产中的公开知识。", image: "assets/solar.jpg", focus: ["智慧农业", "育种", "农机", "可持续"] },
  "人文": { description: "汇集文化遗产、教育、历史、艺术与社会研究中的重要发现和讨论。", image: "assets/semiconductor.jpg", focus: ["文化", "教育", "历史", "艺术"] }
};

const EXTERNAL_SEARCH_START_DATE = "2021-01-01";
const EXTERNAL_SEARCH_CACHE_MS = 30 * 60 * 1000;

let categoryContent = null;
let activeCategory = "";
let categoryQuery = "";
let categorySort = "latest";
let categorySearchMode = "local";
let externalSearchController = null;
let externalSearchState = {
  status: "idle",
  queryKey: "",
  results: [],
  providers: 0,
  error: ""
};

function escapeCategoryHtml(value) {
  return String(value || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function safeCategoryColor(value) {
  return /^#[0-9a-f]{6}$/i.test(String(value || "")) ? value : "#6ee7a8";
}

function categoryThemeColor(value, fallback) {
  return /^#[0-9a-f]{6}$/i.test(String(value || "")) ? value : fallback;
}

function categoryCopy() {
  const setting = activeSetting();
  const configured = CATEGORY_COPY[activeCategory];
  if (configured) return configured;
  const keywords = Array.isArray(setting.keywords) ? setting.keywords.filter(function (keyword) {
    return /[\u3400-\u9fff]/.test(keyword);
  }).slice(0, 4) : [];
  return {
    description: "汇集" + activeCategory + "领域的公开资料、关键进展与可验证知识。",
    image: "assets/network.jpg",
    focus: keywords.length ? keywords : ["最新进展", "公开资料", "趋势观察"]
  };
}

function safeCategoryImage(value, fallback) {
  const image = String(value || "").trim();
  if (/^assets\/[a-z0-9._/-]+$/i.test(image) || /^https:\/\/[^\s]+$/i.test(image) || /^data:image\/(?:png|jpe?g|webp|gif);base64,/i.test(image)) {
    return image;
  }
  return fallback;
}

function hasChineseText(value) {
  return /[\u3400-\u9fff]/.test(String(value || ""));
}

function needsChineseTranslation(value) {
  const text = String(value || "");
  const latinCount = (text.match(/[A-Za-z]/g) || []).length;
  const chineseCount = (text.match(/[\u3400-\u9fff]/g) || []).length;
  return latinCount >= 8 && latinCount > chineseCount * 1.5;
}

function truncateCategoryText(value, limit) {
  const text = String(value || "").replace(/\s+/g, " ").trim();
  return text.length > limit ? text.slice(0, limit).trimEnd() + "…" : text;
}

function safeExternalUrl(value, fallback) {
  try {
    const url = new URL(String(value || fallback || ""));
    return url.protocol === "https:" ? url.href : String(fallback || "");
  } catch (error) {
    return String(fallback || "");
  }
}

function reconstructAbstract(index) {
  if (!index || typeof index !== "object") return "";
  const words = [];
  Object.entries(index).forEach(function (entry) {
    const word = entry[0];
    const positions = Array.isArray(entry[1]) ? entry[1] : [];
    positions.forEach(function (position) {
      if (Number.isInteger(position) && position >= 0 && position < 500) words[position] = word;
    });
  });
  return words.filter(Boolean).join(" ");
}

function stripExternalMarkup(value) {
  let source = String(value || "");
  if (!source) return "";
  for (let index = 0; index < 4; index += 1) {
    const documentNode = new DOMParser().parseFromString(source, "text/html");
    const decoded = String(documentNode.body?.textContent || "");
    if (decoded === source) break;
    source = decoded;
  }
  return source.replace(/\s+/g, " ").trim();
}

function cleanExternalTitle(value) {
  return stripExternalMarkup(value)
    .replace(/\s+(?:summary|abstract)\s*[:：].*$/i, "")
    .trim();
}

function academicTypeLabel(value) {
  const type = String(value || "").toLowerCase();
  if (type.includes("book")) return "图书资料";
  if (type.includes("proceedings")) return "会议论文";
  if (type.includes("dissertation")) return "学位论文";
  if (type.includes("report")) return "研究报告";
  return "学术论文";
}

function externalSummary(abstract, typeLabel) {
  const clean = truncateCategoryText(stripExternalMarkup(abstract), 230);
  if (clean) return clean;
  return `该${typeLabel}已被权威开放索引收录。可前往原始出版页面查看研究摘要、方法、数据范围和完整出版信息。`;
}

function externalRelevanceScore(title, summary, query) {
  const normalizedText = `${title || ""} ${summary || ""}`.toLowerCase().replace(/\s+/g, " ");
  const normalizedQuery = String(query || "").toLowerCase().trim();
  const tokens = String(query || "").toLowerCase().split(/\s+/).filter(Boolean);
  const phraseScore = normalizedQuery && normalizedText.includes(normalizedQuery) ? 80 : 0;
  return phraseScore + tokens.reduce(function (score, token) {
    return score + (normalizedText.includes(token) ? 20 : 0);
  }, 0);
}

async function translateExternalText(value, signal) {
  const source = String(value || "").trim().slice(0, 460);
  if (!source || !needsChineseTranslation(source)) return source;
  const params = new URLSearchParams({ q: source, langpair: "en|zh-CN" });
  const payload = await fetchExternalJson(`https://api.mymemory.translated.net/get?${params}`, signal);
  const translated = stripExternalMarkup(payload.responseData?.translatedText || "");
  if (Number(payload.responseStatus || 0) !== 200 || !hasChineseText(translated)) {
    throw new Error("外文资料翻译暂时不可用");
  }
  return translated;
}

async function localizeExternalResult(result, query, signal) {
  const sourceTitle = cleanExternalTitle(result.title);
  const sourceSummary = stripExternalMarkup(result.summary);
  const translateTitle = needsChineseTranslation(sourceTitle);
  const translateSummary = needsChineseTranslation(sourceSummary);
  if (!translateTitle && !translateSummary) {
    const relevance = externalRelevanceScore(result.title, result.summary, query);
    return relevance > 0 ? Object.assign({}, result, { relevanceScore: relevance }) : null;
  }
  const translatedTitle = truncateCategoryText(
    cleanExternalTitle(translateTitle ? await translateExternalText(sourceTitle, signal) : sourceTitle),
    180
  );
  const translatedSummary = truncateCategoryText(
    translateSummary ? await translateExternalText(sourceSummary, signal) : sourceSummary,
    230
  );
  const relevance = externalRelevanceScore(translatedTitle, translatedSummary, query);
  if ((!hasChineseText(translatedTitle) && !hasChineseText(translatedSummary)) || relevance <= 0) return null;
  return Object.assign({}, result, {
    title: translatedTitle,
    summary: translatedSummary,
    originalTitle: sourceTitle,
    originalSummary: sourceSummary,
    translationLabel: "中文机器翻译",
    relevanceScore: relevance
  });
}

async function fetchExternalJson(url, signal) {
  const response = await fetch(url, {
    signal: signal,
    headers: { "Accept": "application/json" },
    referrerPolicy: "no-referrer"
  });
  if (!response.ok) throw new Error(`资料接口返回 ${response.status}`);
  return response.json();
}

async function searchOpenAlex(query, signal) {
  const params = new URLSearchParams({
    search: query,
    filter: `from_publication_date:${EXTERNAL_SEARCH_START_DATE}`,
    "per-page": "16",
    select: "id,doi,display_name,publication_date,primary_location,cited_by_count,type,language,abstract_inverted_index"
  });
  const payload = await fetchExternalJson(`https://api.openalex.org/works?${params}`, signal);
  return (payload.results || []).map(function (item) {
    const title = cleanExternalTitle(item.display_name || "");
    if (!title) return null;
    const doiUrl = safeExternalUrl(item.doi, "");
    const landingPage = safeExternalUrl(item.primary_location?.landing_page_url, doiUrl);
    if (!landingPage) return null;
    const typeLabel = academicTypeLabel(item.type);
    const summary = externalSummary(reconstructAbstract(item.abstract_inverted_index), typeLabel);
    return {
      key: String(item.doi || item.id || title),
      title: title,
      url: landingPage,
      date: String(item.publication_date || ""),
      type: typeLabel,
      source: "国际开放学术索引",
      citations: Math.max(0, Number(item.cited_by_count || 0)),
      authorityScore: 24,
      relevanceScore: 1,
      summary: summary
    };
  }).filter(Boolean);
}

async function searchCrossref(query, signal) {
  const params = new URLSearchParams({
    query: query,
    rows: "16",
    filter: `from-pub-date:${EXTERNAL_SEARCH_START_DATE}`,
    select: "DOI,title,published,container-title,URL,abstract,type"
  });
  const payload = await fetchExternalJson(`https://api.crossref.org/works?${params}`, signal);
  const items = payload.message?.items || [];
  return items.map(function (item) {
    const title = cleanExternalTitle(Array.isArray(item.title) ? item.title[0] : item.title || "");
    if (!title) return null;
    const doiUrl = item.DOI ? `https://doi.org/${encodeURIComponent(item.DOI)}` : "";
    const landingPage = safeExternalUrl(item.URL, doiUrl);
    if (!landingPage) return null;
    const parts = item.published?.["date-parts"]?.[0] || [];
    const date = parts.length ? parts.map(function (part, index) {
      return index === 0 ? String(part) : String(part).padStart(2, "0");
    }).join("-") : "";
    const typeLabel = academicTypeLabel(item.type);
    const summary = externalSummary(stripExternalMarkup(item.abstract), typeLabel);
    return {
      key: String(item.DOI || title),
      title: title,
      url: landingPage,
      date: date,
      type: typeLabel,
      source: "全球学术出版索引",
      citations: 0,
      authorityScore: 20,
      relevanceScore: 1,
      summary: summary
    };
  }).filter(Boolean);
}

async function searchChineseWikipedia(query, signal) {
  const params = new URLSearchParams({
    action: "query",
    generator: "search",
    gsrsearch: query,
    gsrlimit: "10",
    prop: "extracts|info",
    exintro: "1",
    explaintext: "1",
    inprop: "url",
    format: "json",
    origin: "*"
  });
  const payload = await fetchExternalJson(`https://zh.wikipedia.org/w/api.php?${params}`, signal);
  return Object.values(payload.query?.pages || {}).map(function (item) {
    const title = String(item.title || "").trim();
    const url = safeExternalUrl(item.fullurl, "");
    if (!title || !url || !hasChineseText(title)) return null;
    return {
      key: `zhwiki:${item.pageid || title}`,
      title: title,
      url: url,
      date: "",
      type: "中文百科资料",
      source: "中文维基百科",
      citations: 0,
      authorityScore: 4,
      relevanceScore: externalRelevanceScore(title, item.extract, query),
      summary: truncateCategoryText(item.extract, 230) || "该词条提供相关概念、发展背景和参考资料入口。"
    };
  }).filter(Boolean);
}

function externalSearchKey() {
  return `${activeCategory}:${categoryQuery.trim().toLowerCase()}`;
}

function readExternalSearchCache(key) {
  try {
    const cached = JSON.parse(sessionStorage.getItem(`fx-authority-search-v4:${key}`) || "null");
    if (!cached || Date.now() - Number(cached.savedAt || 0) > EXTERNAL_SEARCH_CACHE_MS) return null;
    return Array.isArray(cached.results) && cached.results.length ? cached : null;
  } catch (error) {
    return null;
  }
}

function writeExternalSearchCache(key, results, providers) {
  if (!Array.isArray(results) || results.length === 0) return;
  try {
    sessionStorage.setItem(`fx-authority-search-v4:${key}`, JSON.stringify({
      savedAt: Date.now(),
      results: results,
      providers: providers
    }));
  } catch (error) {
    // Search remains usable when browser storage is unavailable.
  }
}

function deduplicateExternalResults(results, limit = 18) {
  const seen = new Set();
  return results.filter(function (item) {
    const normalizedTitle = item.title.toLowerCase().replace(/[^\w\u3400-\u9fff]+/g, "");
    const key = String(item.key || normalizedTitle).toLowerCase().replace(/^https?:\/\/(?:dx\.)?doi\.org\//, "");
    if (!normalizedTitle || seen.has(key) || seen.has(normalizedTitle)) return false;
    seen.add(key);
    seen.add(normalizedTitle);
    return true;
  }).sort(function (left, right) {
    return Number(right.relevanceScore || 0) - Number(left.relevanceScore || 0)
      || Number(right.authorityScore || 0) - Number(left.authorityScore || 0)
      || Number(right.citations || 0) - Number(left.citations || 0)
      || new Date(right.date || 0).getTime() - new Date(left.date || 0).getTime();
  }).slice(0, limit);
}

async function localizeExternalResults(results, query, signal) {
  let foreignCount = 0;
  const localized = await Promise.all(results.map(function (result) {
    if (hasChineseText(result.title)) return localizeExternalResult(result, query, signal);
    foreignCount += 1;
    if (foreignCount > 6) return Promise.resolve(null);
    return localizeExternalResult(result, query, signal).catch(function () { return null; });
  }));
  return deduplicateExternalResults(localized.filter(Boolean));
}

async function searchExternalSources() {
  const query = categoryQuery.trim();
  if (query.length < 2) {
    externalSearchState = { status: "idle", queryKey: "", results: [], providers: 0, error: "" };
    renderCategoryPage();
    return;
  }
  const key = externalSearchKey();
  const cached = readExternalSearchCache(key);
  if (cached) {
    externalSearchState = {
      status: "ready", queryKey: key, results: cached.results,
      providers: Number(cached.providers || 0), error: ""
    };
    renderCategoryPage();
    return;
  }
  externalSearchController?.abort();
  externalSearchController = new AbortController();
  const timeoutId = window.setTimeout(function () { externalSearchController?.abort(); }, 14000);
  externalSearchState = { status: "loading", queryKey: key, results: [], providers: 0, error: "" };
  renderCategoryPage();
  try {
    const responses = await Promise.allSettled([
      searchOpenAlex(query, externalSearchController.signal),
      searchCrossref(query, externalSearchController.signal),
      searchChineseWikipedia(query, externalSearchController.signal)
    ]);
    if (key !== externalSearchKey() || categorySearchMode !== "authority") return;
    const successful = responses.filter(function (result) { return result.status === "fulfilled"; });
    if (!successful.length) throw new Error("权威资料服务暂时无法连接");
    const candidates = deduplicateExternalResults(successful.flatMap(function (result) { return result.value; }), 30);
    const results = await localizeExternalResults(candidates, query, externalSearchController.signal);
    externalSearchState = {
      status: "ready", queryKey: key, results: results,
      providers: successful.length, error: successful.length < responses.length ? "部分来源暂时不可用" : ""
    };
    writeExternalSearchCache(key, results, successful.length);
  } catch (error) {
    if (error?.name === "AbortError" && key !== externalSearchKey()) return;
    externalSearchState = {
      status: "error", queryKey: key, results: [], providers: 0,
      error: error?.name === "AbortError" ? "搜索超时，请稍后重试" : "权威资料服务暂时无法连接"
    };
  } finally {
    window.clearTimeout(timeoutId);
    if (key === externalSearchKey()) renderCategoryPage();
  }
}

function attachCategoryImageFallbacks() {
  document.querySelectorAll("#categoryStories img[data-image-fallback]").forEach(function (image) {
    if (image.dataset.fallbackReady === "true") return;
    image.dataset.fallbackReady = "true";
    image.addEventListener("error", function () {
      const fallback = image.dataset.imageFallback || "assets/factory.jpg";
      if (image.getAttribute("src") !== fallback) image.src = fallback;
    });
  });
}

function visibleCategoryStories() {
  const queryTokens = categoryQuery.trim().toLowerCase().split(/\s+/).filter(Boolean);
  const filtered = (categoryContent?.stories || []).filter(function (story) {
    const body = Array.isArray(story.body) ? story.body.join("\n") : String(story.body || "");
    const publicStory = story.category === activeCategory
      && body.replace(/\s/g, "").length >= 800
      && (!window.FXContent?.isChinesePublicStory || window.FXContent.isChinesePublicStory(story))
      && (!story.status || story.status === "published" || (story.status === "scheduled" && new Date(story.scheduledAt).getTime() <= Date.now()));
    if (!publicStory) return false;
    const haystack = [story.title, story.excerpt, body, story.source, story.author, (story.tags || []).join(" ")].join(" ").toLowerCase();
    return queryTokens.every(function (token) { return haystack.includes(token); });
  });
  return filtered.sort(function (left, right) {
    if (categorySort === "hot") return Number(right.heat || 0) - Number(left.heat || 0);
    if (categorySort === "depth") return Number(right.readMinutes || 0) - Number(left.readMinutes || 0);
    return new Date(right.date || 0).getTime() - new Date(left.date || 0).getTime() || Number(right.id || 0) - Number(left.id || 0);
  });
}

function activeSetting() {
  return (categoryContent?.categorySettings || []).find(function (item) { return item.name === activeCategory; }) || {};
}

function sourceLabel(value) {
  return window.FXContent.localizedSourceName(value);
}

function storyCard(story, index) {
  const copy = categoryCopy();
  const fallback = safeCategoryImage(story.imageFallback, copy.image);
  const image = safeCategoryImage(story.image, fallback);
  return `<article class="story-card" style="--category-color:${safeCategoryColor(activeSetting().color)}">
    <div class="story-image"><a href="article.html?id=${encodeURIComponent(story.id)}" aria-label="阅读：${escapeCategoryHtml(story.title)}"><img src="${escapeCategoryHtml(image)}" data-image-fallback="${escapeCategoryHtml(fallback)}" alt="${escapeCategoryHtml(story.title)}" loading="lazy" referrerpolicy="no-referrer"></a><span class="story-index">${String(index + 1).padStart(2, "0")}</span></div>
    <div class="story-body"><div class="story-meta"><span class="category-tag">${escapeCategoryHtml(activeCategory)}</span><span>${Number(story.readMinutes || 6)} 分钟阅读</span></div><h3><a href="article.html?id=${encodeURIComponent(story.id)}">${escapeCategoryHtml(story.title)}</a></h3><p>${escapeCategoryHtml(window.FXContent.presentationExcerpt(story))}</p><div class="story-foot"><div class="story-source"><i class="source-mark"></i><span>${escapeCategoryHtml(sourceLabel(story.source))}</span><span>·</span><time>${escapeCategoryHtml(story.date || "最新")}</time></div></div></div>
  </article>`;
}

function externalResultCard(result) {
  const citation = Number(result.citations || 0) > 0 ? `<span>被引用 ${Number(result.citations)} 次</span>` : "";
  const original = result.originalTitle ? `
    <div class="external-original" lang="en">
      <span>外文原文</span>
      <strong>${escapeCategoryHtml(result.originalTitle)}</strong>
      ${result.originalSummary ? `<p>${escapeCategoryHtml(result.originalSummary)}</p>` : ""}
    </div>` : "";
  const translationTag = result.translationLabel ? `<span class="translation-tag">${escapeCategoryHtml(result.translationLabel)}</span>` : "";
  return `<article class="external-result-card" style="--category-color:${safeCategoryColor(activeSetting().color)}">
    <div class="external-result-meta"><span class="category-tag">${escapeCategoryHtml(activeCategory)}</span><span>${escapeCategoryHtml(result.type)}</span>${translationTag}<span>${escapeCategoryHtml(result.date || "近年发布")}</span></div>
    <h3><a href="${escapeCategoryHtml(result.url)}" target="_blank" rel="noopener noreferrer">${escapeCategoryHtml(result.title)}<i data-lucide="external-link"></i></a></h3>
    <p>${escapeCategoryHtml(result.summary)}</p>
    ${original}
    <div class="external-result-foot"><i class="source-mark"></i><span>${escapeCategoryHtml(result.source)}</span>${citation}<span>打开原始出版页面</span></div>
  </article>`;
}

function renderCategoryNav() {
  const categories = (categoryContent?.categorySettings || []).filter(function (item) { return item.enabled !== false; });
  if (!categories.some(function (item) { return item.name === activeCategory; })) {
    activeCategory = categories[0]?.name || "科技";
  }
  document.querySelector("#categoryNav").innerHTML = `<a class="nav-tab" href="index.html">总览</a>` + categories.map(function (item) {
    const active = item.name === activeCategory ? " is-active" : "";
    return `<a class="nav-tab${active}" href="category.html?category=${encodeURIComponent(item.name)}" style="--category-color:${safeCategoryColor(item.color)}">${escapeCategoryHtml(item.name)}</a>`;
  }).join("");
  window.requestAnimationFrame(function () {
    document.querySelector("#categoryNav .is-active")?.scrollIntoView({ block: "nearest", inline: "center" });
  });
}

function applyCategoryTheme() {
  const theme = categoryContent?.theme || {};
  const root = document.documentElement;
  root.style.setProperty("--bg", categoryThemeColor(theme.background, "#090d10"));
  root.style.setProperty("--surface", categoryThemeColor(theme.surface, "#10161a"));
  root.style.setProperty("--text", categoryThemeColor(theme.text, "#edf4f2"));
  root.style.setProperty("--green", categoryThemeColor(theme.primary, "#6ee7a8"));
  root.style.setProperty("--cyan", categoryThemeColor(theme.secondary, "#63cfe3"));
  document.querySelector(".brand-copy strong").textContent = categoryContent?.site?.name || "信息分享平台";
  const subtitle = String(categoryContent?.site?.subtitle || "");
  document.querySelector(".brand-copy small").textContent = hasChineseText(subtitle) ? subtitle : "全球前沿知识索引";
}

function renderCategoryPage() {
  const available = (categoryContent?.categorySettings || []).filter(function (item) { return item.enabled !== false; });
  if (!available.some(function (item) { return item.name === activeCategory; })) activeCategory = available[0]?.name || "科技";
  const setting = activeSetting();
  const copy = categoryCopy();
  const stories = visibleCategoryStories();
  const totalStories = (categoryContent?.stories || []).filter(function (story) {
    const body = Array.isArray(story.body) ? story.body.join("\n") : String(story.body || "");
    return story.category === activeCategory && body.replace(/\s/g, "").length >= 800
      && (!window.FXContent?.isChinesePublicStory || window.FXContent.isChinesePublicStory(story))
      && (!story.status || story.status === "published" || (story.status === "scheduled" && new Date(story.scheduledAt).getTime() <= Date.now()));
  });
  const sourceCount = new Set(totalStories.map(function (story) { return story.source; }).filter(Boolean)).size;
  const hero = document.querySelector("#categoryHero");
  hero.style.setProperty("--category-color", safeCategoryColor(setting.color));
  hero.style.setProperty("--category-image", `url("${copy.image}")`);
  document.title = `${activeCategory}板块 | 信息分享平台`;
  document.querySelector('meta[name="description"]').setAttribute("content", copy.description);
  document.querySelector("#categoryEyebrow").textContent = activeCategory + "板块";
  document.querySelector("#categoryTitle").textContent = activeCategory + "前沿资料库";
  document.querySelector("#categoryDescription").textContent = copy.description;
  document.querySelector("#categoryTopics").innerHTML = copy.focus.map(function (topic) {
    return `<button type="button" data-topic="${escapeCategoryHtml(topic)}">${escapeCategoryHtml(topic)}</button>`;
  }).join("");
  document.querySelector("#categoryFeedTitle").textContent = categorySearchMode === "authority"
    ? activeCategory + "权威资料搜索"
    : activeCategory + "最新资料";
  document.querySelector("#categoryMetrics").innerHTML = `<div><strong>${totalStories.length}</strong><span>可阅读文章</span></div><div><strong>${sourceCount}</strong><span>公开来源</span></div><div><strong>持续</strong><span>每日自动更新</span></div>`;
  document.querySelectorAll("[data-search-mode]").forEach(function (button) {
    const active = button.dataset.searchMode === categorySearchMode;
    button.classList.toggle("is-active", active);
    button.setAttribute("aria-pressed", String(active));
  });
  const searchSubmit = document.querySelector("#categorySearchSubmit");
  const sortLabel = document.querySelector("#categorySortLabel");
  const externalInfo = document.querySelector("#externalSearchInfo");
  searchSubmit.hidden = categorySearchMode !== "authority";
  searchSubmit.disabled = externalSearchState.status === "loading";
  sortLabel.hidden = categorySearchMode === "authority";
  externalInfo.hidden = categorySearchMode !== "authority";
  document.querySelector("#categorySearch").placeholder = categorySearchMode === "authority"
    ? `搜索${activeCategory}权威资料，按回车开始`
    : `搜索${activeCategory}板块内容`;

  const storyGrid = document.querySelector("#categoryStories");
  const empty = document.querySelector("#categoryEmpty");
  if (categorySearchMode === "authority") {
    const matchesCurrentQuery = externalSearchState.queryKey === externalSearchKey();
    const results = matchesCurrentQuery ? externalSearchState.results : [];
    storyGrid.classList.toggle("external-results", true);
    storyGrid.setAttribute("aria-busy", String(externalSearchState.status === "loading"));
    storyGrid.innerHTML = results.map(externalResultCard).join("");
    const infoText = externalInfo.querySelector("span");
    if (externalSearchState.status === "loading") {
      infoText.textContent = "正在并行查询中文百科、开放学术与出版物索引，请稍候。";
    } else if (externalSearchState.error) {
      infoText.textContent = `${externalSearchState.error}；已有本站内容仍可正常搜索。`;
    } else {
      infoText.textContent = "搜索词发送给公开资料索引；外文标题与摘要经公共翻译服务转换，并同时保留原文。";
    }
    empty.hidden = results.length !== 0;
    if (externalSearchState.status === "loading") {
      empty.querySelector("strong").textContent = "正在搜索权威资料";
      empty.querySelector("span").textContent = "正在连接三个公开资料索引";
    } else if (externalSearchState.status === "error") {
      empty.querySelector("strong").textContent = "外部搜索暂时不可用";
      empty.querySelector("span").textContent = externalSearchState.error;
    } else if (categoryQuery.trim().length < 2) {
      empty.querySelector("strong").textContent = "输入专业关键词";
      empty.querySelector("span").textContent = "按回车或点击搜索查询权威资料";
    } else {
      empty.querySelector("strong").textContent = "没有找到中文权威资料";
      empty.querySelector("span").textContent = "尝试使用更具体的中文专业词汇";
    }
    document.querySelector("#categoryCount").textContent = externalSearchState.status === "loading"
      ? "正在查询"
      : `${results.length} 条外部资料`;
  } else {
    storyGrid.classList.toggle("external-results", false);
    storyGrid.setAttribute("aria-busy", "false");
    storyGrid.innerHTML = stories.map(storyCard).join("");
    attachCategoryImageFallbacks();
    empty.hidden = stories.length !== 0;
    empty.querySelector("strong").textContent = categoryQuery ? "没有匹配的内容" : "正在同步内容";
    empty.querySelector("span").textContent = categoryQuery ? "尝试更换关键词" : "内容将在连接完成后自动显示";
    document.querySelector("#categoryCount").textContent = categoryQuery ? `${stories.length} / ${totalStories.length} 篇内容` : `${stories.length} 篇可阅读内容`;
  }
  if (window.lucide) window.lucide.createIcons({ attrs: { "stroke-width": 1.7 } });
}

function syncCategoryUrl() {
  const params = new URLSearchParams({ category: activeCategory });
  if (categoryQuery.trim()) params.set("q", categoryQuery.trim());
  if (categorySort !== "latest") params.set("sort", categorySort);
  if (categorySearchMode === "authority") params.set("scope", "authority");
  history.replaceState(null, "", "category.html?" + params.toString());
}

function setCategorySearchMode(mode) {
  categorySearchMode = mode === "authority" ? "authority" : "local";
  externalSearchController?.abort();
  renderCategoryPage();
  syncCategoryUrl();
  if (categorySearchMode === "authority" && categoryQuery.trim().length >= 2) {
    searchExternalSources();
  }
}

function bindCategoryEvents() {
  document.querySelector("#categorySearch").addEventListener("input", function (event) {
    categoryQuery = event.target.value;
    if (categorySearchMode === "authority") {
      externalSearchController?.abort();
      externalSearchState = { status: "idle", queryKey: "", results: [], providers: 0, error: "" };
    }
    renderCategoryPage();
    syncCategoryUrl();
  });
  document.querySelector("#categorySearchForm").addEventListener("submit", function (event) {
    event.preventDefault();
    if (categorySearchMode === "authority") searchExternalSources();
  });
  document.querySelectorAll("[data-search-mode]").forEach(function (button) {
    button.addEventListener("click", function () { setCategorySearchMode(button.dataset.searchMode); });
  });
  document.querySelector("#categorySort").addEventListener("change", function (event) {
    categorySort = event.target.value;
    renderCategoryPage();
    syncCategoryUrl();
  });
  document.querySelector("#categoryTopics").addEventListener("click", function (event) {
    const button = event.target.closest("[data-topic]");
    if (!button) return;
    categoryQuery = button.dataset.topic || "";
    document.querySelector("#categorySearch").value = categoryQuery;
    renderCategoryPage();
    syncCategoryUrl();
    if (categorySearchMode === "authority") searchExternalSources();
    else document.querySelector("#categorySearch").focus();
  });
}

async function initCategoryPage() {
  const params = new URLSearchParams(location.search);
  const requested = params.get("category");
  categoryContent = await window.FXContent.load(CATEGORY_CONTENT_URL, { background: true });
  activeCategory = requested || categoryContent?.categories?.[0] || "科技";
  categoryQuery = params.get("q") || "";
  categorySearchMode = [params.get("scope"), params.get("mode")].includes("authority") ? "authority" : "local";
  categorySort = ["latest", "hot", "depth"].includes(params.get("sort")) ? params.get("sort") : "latest";
  document.querySelector("#categorySearch").value = categoryQuery;
  document.querySelector("#categorySort").value = categorySort;
  applyCategoryTheme();
  renderCategoryNav();
  renderCategoryPage();
  bindCategoryEvents();
  if (categorySearchMode === "authority" && categoryQuery.trim().length >= 2) {
    searchExternalSources();
  }
}

window.addEventListener("fxcontentupdate", function (event) {
  if (!event.detail?.stories) return;
  categoryContent = event.detail;
  applyCategoryTheme();
  renderCategoryNav();
  renderCategoryPage();
});

initCategoryPage();
