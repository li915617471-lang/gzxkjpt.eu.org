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

function renderBody(story) {
  document.querySelector("#articleBody").innerHTML = bodyParagraphs(story)
    .map(function (paragraph) { return "<p>" + escapeArticleHtml(paragraph) + "</p>"; })
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
      "<small>" + escapeArticleHtml(item.source || "平台内容") + " · " + Number(item.readMinutes || 6) + " 分钟</small>" +
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
  document.querySelector("#articleSource").textContent = story.source || "平台内容";
  document.querySelector("#railCategory").textContent = story.category;
  document.querySelector("#railDate").textContent = story.date || "未设置";
  document.querySelector("#railHeat").textContent = String(story.heat || 0);
  document.querySelector("#railConfidence").textContent = String(story.confidence ?? 80) + "%";
  const sourceLink = document.querySelector("#sourceLink");
  const sourceUrl = story.sourceUrl || story.url;
  sourceLink.hidden = !sourceUrl;
  if (sourceUrl) sourceLink.href = sourceUrl;
  const confidence = Number(story.confidence ?? 80);
  document.querySelector("#sourceTrustNote").textContent = sourceUrl
    ? `${confidence >= 85 ? "高可信" : confidence >= 70 ? "可核验" : "需交叉核验"} · 已保留原始来源链接`
    : `${confidence >= 85 ? "高可信" : "待核验"} · 暂无原始来源链接`;
  const sourceTypeLabels = {
    official: "政府 / 官方机构", research: "科研 / 学术机构", professional: "专业媒体",
    industry: "行业机构", company: "企业发布", community: "社区 / 个人"
  };
  const trustLevelLabels = {
    authoritative: "权威来源", professional: "专业来源", standard: "一般来源", reference: "仅供参考"
  };
  const dateLabel = function (value) {
    if (!value) return "未提供";
    const parsed = new Date(value);
    return Number.isNaN(parsed.getTime()) ? String(value) : parsed.toLocaleString("zh-CN", { hour12: false });
  };
  document.querySelector("#sourceType").textContent = sourceTypeLabels[story.sourceType] || "未标注";
  document.querySelector("#sourceRegion").textContent = story.sourceRegion || "未标注";
  document.querySelector("#sourceTrustLevel").textContent = trustLevelLabels[story.sourceTrustLevel] || "未标注";
  document.querySelector("#sourcePublishedAt").textContent = dateLabel(story.originalPublishedAt);
  document.querySelector("#sourceCollectedAt").textContent = dateLabel(story.collectedAt || story.automaticImportedAt);
  document.querySelector("#sourceGenerationMode").textContent = story.contentGenerationMode === "github-models-source-grounded"
    ? "AI 辅助原创整理" : "编辑整理 / 来源摘要";
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
