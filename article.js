const ARTICLE_CONTENT_URL = "data/content.json";
const ARTICLE_SAVED_KEY = "fx-saved";

let articleContent = null;
let currentStory = null;

function initializeArticleIcons() {
  if (window.lucide) window.lucide.createIcons({ attrs: { "stroke-width": 1.7 } });
}

function escapeArticleHtml(value) {
  return String(value || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function safeArticleColor(value) {
  return /^#[0-9a-f]{6}$/i.test(String(value || "")) ? value : "#6ee7a8";
}

const SOURCE_NAME_ALIASES = {
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
  "Smithsonian Magazine": "史密森学会杂志"
};

const ARTICLE_TEXT_ALIASES = Object.assign({}, SOURCE_NAME_ALIASES, {
  "Liber Novus": "《新书》",
  "Nucor": "纽柯钢铁",
  "Chiplet": "芯粒",
  "Digital euro": "数字欧元",
  "Federal Reserve Board": "美国联邦储备委员会",
  "The Red Book": "《红书》",
  "Carl Jung": "卡尔·荣格"
});

function sourceDisplayName(value) {
  const name = String(value || "").trim();
  if (!name) return "公开来源";
  if (SOURCE_NAME_ALIASES[name]) return SOURCE_NAME_ALIASES[name];
  return /^[\x00-\x7f\s.,&'()/-]+$/.test(name) ? "公开来源机构" : name;
}

function localizeArticleText(value, story) {
  let text = String(value || "");
  const rawSource = String(story?.source || "").trim();
  const displaySource = sourceDisplayName(rawSource);
  Object.entries(ARTICLE_TEXT_ALIASES).forEach(function ([raw, translated]) {
    text = text.split(raw).join(translated);
  });
  if (rawSource && rawSource !== displaySource) {
    text = text.split(rawSource).join(displaySource);
  }
  const sourceUrl = String(story?.sourceUrl || story?.url || "").trim();
  if (sourceUrl) {
    text = text.split(sourceUrl).join("原文链接");
  }
  return text.replace(/\b[A-Za-z][A-Za-z'-]*(?:\s+[A-Za-z][A-Za-z'-]*){2,}\b/g, "相关外文信息");
}

function dateLabel(value) {
  if (!value) return "未提供";
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? String(value) : parsed.toLocaleString("zh-CN", { hour12: false });
}

function dateOnlyLabel(value) {
  if (!value) return "";
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? String(value).slice(0, 10) : parsed.toLocaleDateString("zh-CN");
}

function applyArticleTheme() {
  const theme = articleContent.theme || {};
  const root = document.documentElement;
  root.style.setProperty("--bg", safeArticleColor(theme.background || "#090d10"));
  root.style.setProperty("--surface", safeArticleColor(theme.surface || "#10161a"));
  root.style.setProperty("--text", safeArticleColor(theme.text || "#edf4f2"));
  root.style.setProperty("--green", safeArticleColor(theme.primary || "#6ee7a8"));
  root.style.setProperty("--cyan", safeArticleColor(theme.secondary || "#63cfe3"));
}

function categorySetting(name) {
  return (articleContent.categorySettings || []).find(function (item) { return item.name === name; }) || {
    name: name,
    color: articleContent.theme?.primary || "#6ee7a8"
  };
}

function storyIsPublic(story) {
  const body = Array.isArray(story.body) ? story.body.join("\n\n") : String(story.body || "");
  if (body.replace(/\s/g, "").length < 800) return false;
  if (!story.status || story.status === "published") return true;
  if (story.status === "scheduled" && story.scheduledAt) {
    return new Date(story.scheduledAt).getTime() <= Date.now();
  }
  return false;
}

function getStoryId() {
  const value = new URLSearchParams(location.search).get("id");
  return Number.isFinite(Number(value)) ? Number(value) : null;
}

function bodyParagraphs(story) {
  if (Array.isArray(story.body)) return story.body.filter(Boolean);
  if (typeof story.body === "string" && story.body.trim()) {
    return story.body.split(/\n{2,}/).map(function (item) { return item.trim(); }).filter(Boolean);
  }
  const tags = (story.tags || []).slice(0, 4).join("、");
  return [
    story.excerpt,
    tags
      ? "这项进展与" + tags + "等方向密切相关，其影响需要结合技术成熟度、产业链能力和实际应用数据持续观察。"
      : "这项进展仍需结合技术成熟度、产业链能力和实际应用数据持续观察。",
    "信息分享平台将继续跟踪公开资料、产业动态与权威来源，更新相关进展。"
  ];
}

function sourceBriefText(story) {
  const sourceName = sourceDisplayName(story.source);
  const published = dateOnlyLabel(story.originalPublishedAt || story.date);
  return "简要来源：" + sourceName + "公开资料" +
    (published ? "，原文发布时间：" + published : "") +
    "。本文为平台中文整理，版权归原发布方所有，重要数据请以原文为准。";
}

function normalizeArticleParagraphs(story) {
  let paragraphs = bodyParagraphs(story).map(function (paragraph) {
    return localizeArticleText(paragraph, story).trim();
  }).filter(Boolean);
  const disclosureIndex = paragraphs.findIndex(function (paragraph) {
    return /^(来源与审核说明|简要来源)$/.test(paragraph) || /^简要来源[:：]/.test(paragraph);
  });
  if (disclosureIndex >= 0) paragraphs = paragraphs.slice(0, disclosureIndex);
  return paragraphs.concat(["简要来源", sourceBriefText(story)]);
}

function articleParagraphHtml(paragraph, index, paragraphs) {
  const text = escapeArticleHtml(paragraph);
  const isHeading = paragraph.length <= 18
    && index < paragraphs.length - 1
    && !/[。！？；，、,.!?;:：]/.test(paragraph);
  if (isHeading) return "<h2>" + text + "</h2>";
  if (/^简要来源[:：]/.test(paragraph)) return "<p class=\"article-source-note\">" + text + "</p>";
  return "<p>" + text + "</p>";
}

function renderBody(story) {
  const paragraphs = normalizeArticleParagraphs(story);
  document.querySelector("#articleBody").innerHTML = paragraphs
    .map(articleParagraphHtml)
    .join("");
}

function renderRelated(story) {
  const related = (articleContent.stories || [])
    .filter(function (item) {
      return item.id !== story.id && item.category === story.category && storyIsPublic(item);
    })
    .slice(0, 3);
  const section = document.querySelector("#relatedSection");
  section.hidden = related.length === 0;
  document.querySelector("#relatedStories").innerHTML = related.map(function (item) {
    const setting = categorySetting(item.category);
    return "<a class=\"related-item\" href=\"article.html?id=" + encodeURIComponent(item.id) + "\" style=\"--category-color:" + safeArticleColor(setting.color) + "\">" +
      "<span>" + escapeArticleHtml(item.category) + "</span>" +
      "<h3>" + escapeArticleHtml(item.title) + "</h3>" +
      "<small>" + escapeArticleHtml(sourceDisplayName(item.source)) + " · " + Number(item.readMinutes || 6) + " 分钟</small>" +
    "</a>";
  }).join("");
}

function renderArticle(story) {
  const site = articleContent.site || {};
  const setting = categorySetting(story.category);
  const categoryColor = safeArticleColor(setting.color);
  document.title = story.title + " | " + (site.name || "信息分享平台");
  document.querySelector('meta[name="description"]').setAttribute("content", story.excerpt || story.title);
  applyArticleSeo(story, site);
  document.querySelector(".brand-copy strong").textContent = site.name || "信息分享平台";
  document.querySelector(".brand-copy small").textContent = site.subtitle || "GLOBAL KNOWLEDGE INDEX";
  document.querySelector("#articleCategory").textContent = story.category;
  document.querySelector("#articleCategory").style.color = categoryColor;
  document.querySelector("#categoryLink").textContent = story.category;
  document.querySelector("#categoryLink").href = "index.html?category=" + encodeURIComponent(story.category);
  document.querySelector("#articleDate").textContent = story.date || story.time || "";
  document.querySelector("#articleRead").textContent = Number(story.readMinutes || 6) + " 分钟阅读";
  document.querySelector("#articleTitle").textContent = story.title;
  document.querySelector("#articleExcerpt").textContent = story.excerpt || "";
  const articleImage = document.querySelector("#articleImage");
  const imageFallback = story.imageFallback || "assets/factory.jpg";
  articleImage.referrerPolicy = "no-referrer";
  articleImage.onerror = function () {
    if (articleImage.getAttribute("src") !== imageFallback) articleImage.src = imageFallback;
  };
  articleImage.src = story.image || imageFallback;
  articleImage.alt = story.title;
  document.querySelector("#articleSource").textContent = sourceDisplayName(story.source);
  document.querySelector("#railCategory").textContent = story.category;
  document.querySelector("#railDate").textContent = story.date || "未设置";
  document.querySelector("#railHeat").textContent = String(story.heat || 0);
  const sourceLink = document.querySelector("#sourceLink");
  const sourceUrl = story.sourceUrl || story.url;
  sourceLink.hidden = !sourceUrl;
  if (sourceUrl) sourceLink.href = sourceUrl;
  document.querySelector("#sourceBriefNote").textContent = "点击下方可阅读原网站完整原文；平台仅发布中文整理与出处。";
  document.querySelector("#sourcePublishedAt").textContent = dateLabel(story.originalPublishedAt);
  document.querySelector("#sourceCollectedAt").textContent = dateLabel(story.collectedAt || story.automaticImportedAt);
  const correctionParams = new URLSearchParams({
    article: String(story.id),
    url: location.href
  });
  document.querySelector("#correctionLink").href = "governance.html?" + correctionParams.toString() + "#correction";
  document.querySelector("#articleTags").innerHTML = (story.tags || [])
    .map(function (tag) { return "<span>" + escapeArticleHtml(tag) + "</span>"; })
    .join("");
  renderBody(story);
  renderRelated(story);
  updateBookmark();
  document.querySelector("#articleLoading").hidden = true;
  document.querySelector("#articleContent").hidden = false;
  initializeArticleIcons();
}

function updateReadingProgress() {
  const scrollRange = document.documentElement.scrollHeight - window.innerHeight;
  const progress = scrollRange > 0 ? Math.min(100, Math.max(0, window.scrollY / scrollRange * 100)) : 0;
  document.querySelector("#readingProgress").style.width = progress + "%";
}

function setArticleMeta(selector, value) {
  document.querySelector(selector)?.setAttribute("content", value);
}

function absoluteArticleUrl(value, base) {
  try {
    return new URL(value, base).href;
  } catch (error) {
    return value;
  }
}

function applyArticleSeo(story, site) {
  const operations = Object.assign({ siteUrl: "https://gzxkjpt.eu.org" }, articleContent.operations || {});
  const siteUrl = String(operations.siteUrl || location.origin).replace(/\/$/, "") + "/";
  const canonical = absoluteArticleUrl("article.html?id=" + encodeURIComponent(story.id), siteUrl);
  const image = absoluteArticleUrl(story.image || "assets/factory.jpg", siteUrl);
  const description = story.excerpt || story.title;
  document.querySelector('link[rel="canonical"]')?.setAttribute("href", canonical);
  setArticleMeta('meta[property="og:site_name"]', site.name || "信息分享平台");
  setArticleMeta('meta[property="og:title"]', story.title);
  setArticleMeta('meta[property="og:description"]', description);
  setArticleMeta('meta[property="og:url"]', canonical);
  setArticleMeta('meta[property="og:image"]', image);
  const structured = {
    "@context": "https://schema.org",
    "@type": "Article",
    headline: story.title,
    description: description,
    image: [image],
    datePublished: story.date || undefined,
    dateModified: story.updatedAt || story.date || undefined,
    inLanguage: story.language || "zh-CN",
    mainEntityOfPage: canonical,
    author: { "@type": story.author ? "Person" : "Organization", name: story.author || story.source || site.name || "信息分享平台" },
    publisher: { "@type": "Organization", name: site.name || "信息分享平台", url: siteUrl }
  };
  document.querySelector("#articleStructuredData").textContent = JSON.stringify(structured);
}

function updateBookmark() {
  const saved = new Set(JSON.parse(localStorage.getItem(ARTICLE_SAVED_KEY) || "[]"));
  document.querySelector("#articleBookmark").classList.toggle("is-saved", saved.has(currentStory?.id));
}

function toggleBookmark() {
  if (!currentStory) return;
  const saved = new Set(JSON.parse(localStorage.getItem(ARTICLE_SAVED_KEY) || "[]"));
  if (saved.has(currentStory.id)) saved.delete(currentStory.id);
  else saved.add(currentStory.id);
  localStorage.setItem(ARTICLE_SAVED_KEY, JSON.stringify([...saved]));
  updateBookmark();
  showArticleToast(saved.has(currentStory.id) ? "已加入收藏" : "已取消收藏");
}

function showArticleToast(message) {
  const toast = document.querySelector("#articleToast");
  toast.textContent = message;
  toast.classList.add("is-visible");
  window.clearTimeout(showArticleToast.timer);
  showArticleToast.timer = window.setTimeout(function () { toast.classList.remove("is-visible"); }, 2000);
}

async function copyArticleLink() {
  try {
    await navigator.clipboard.writeText(location.href);
    showArticleToast("文章链接已复制");
  } catch (error) {
    showArticleToast("浏览器未允许复制链接");
  }
}

async function initArticle() {
  articleContent = await window.FXContent.load(ARTICLE_CONTENT_URL);
  const storyId = getStoryId();
  currentStory = articleContent?.stories?.find(function (story) {
    return Number(story.id) === storyId && storyIsPublic(story);
  });
  document.querySelector("#copyLink").addEventListener("click", copyArticleLink);
  document.querySelector("#articleBookmark").addEventListener("click", toggleBookmark);
  window.addEventListener("scroll", updateReadingProgress, { passive: true });
  if (!articleContent || !currentStory) {
    document.querySelector("#articleLoading").hidden = true;
    document.querySelector("#articleMissing").hidden = false;
    initializeArticleIcons();
    return;
  }
  applyArticleTheme();
  renderArticle(currentStory);
  updateReadingProgress();
}

initArticle();
window.addEventListener("load", initializeArticleIcons);
