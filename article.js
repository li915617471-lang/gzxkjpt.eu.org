const ARTICLE_CONTENT_URL = "data/content.json";
const ARTICLE_SAVED_KEY = "fx-saved";

let articleContent = null;
let currentStory = null;
let activeArticleHls = null;

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

function sourceDisplayName(value) {
  return window.FXContent?.localizedSourceName(value)
    || SOURCE_NAME_ALIASES[String(value || "").trim()]
    || "公开来源";
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
  if (story.contentKind === "video") return false;
  const body = Array.isArray(story.body) ? story.body.join("\n\n") : String(story.body || "");
  if (body.replace(/\s/g, "").length < 800) return false;
  if (window.FXContent?.isChinesePublicStory && !window.FXContent.isChinesePublicStory(story)) return false;
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
  return "来源：" + sourceName +
    (published ? "，原文发布时间：" + published : "") +
    "。版权归原作者或发布机构所有，请以原文为准。";
}

const LEGACY_AUTOMATIC_SECTION_HEADINGS = new Set([
  "编辑状态",
  "局限与待观察",
  "读者如何核验"
]);

const LEGACY_AUTOMATIC_NOTICES = [
  "这段材料只用于确定文章主题和阅读范围，不代表平台已经完成独立事实核查。读者可以先把它理解为一个前沿线索：它提示某个机构、企业或研究团队正在公开讨论相关问题，但具体进展仍要回到原文确认。",
  "因此，平台整理时会优先说明这类信息为什么重要、它通常涉及哪些基本概念，以及哪些内容只是背景解释而不是来源已经证明的结论。",
  "如果来源材料比较短，文章会减少对具体数字的展开，更多提供阅读框架，帮助读者知道下一步应该查什么、问什么、比较什么。",
  "就当前条目而言，来源材料明确说明的影响仅限于上述公开内容；更广泛的市场或社会影响仍需要后续数据验证。不能因为信息来自前沿领域，就直接推断它已经成熟、已经低成本可用，或一定会在所有地区复制。",
  "平台根据可访问的标题、摘要和有限正文片段整理重点，并明确区分来源事实、板块背景与仍待核验的部分。"
];

const LEGACY_GENERIC_OPENING = /^来源线索与[^。]+板块相关，但公开摘要提供的中文细节有限。平台会先给出阅读框架，帮助读者理解这类信息通常应该从哪些角度判断。?/;

function isAutomaticStory(story) {
  return Boolean(story.automaticImport || story.contentGenerationMode || story.collectionSourceId);
}

function cleanLegacyAutomaticText(value, story) {
  let text = window.FXContent.cleanTranslationArtifacts(window.FXContent.cleanSourceText(value), story);
  if (!isAutomaticStory(story)) return text;
  LEGACY_AUTOMATIC_NOTICES.forEach(function (notice) {
    text = text.split(notice).join("");
  });
  text = text
    .replace(/^来源材料显示[:：]\s*/, "")
    .replace(LEGACY_GENERIC_OPENING, "")
    .replace(/。。+/g, "。")
    .trim();
  return /^[。！？；，、,.!?;:：]+$/.test(text) ? "" : text;
}

function normalizeArticleParagraphs(story) {
  const rawParagraphs = bodyParagraphs(story);
  const paragraphs = [];
  let skipNextAutomaticParagraph = false;
  for (const rawParagraph of rawParagraphs) {
    const paragraph = String(rawParagraph || "").trim();
    if (/^(来源与审核说明|简要来源)$/.test(paragraph) || /^(简要来源|来源)[:：]/.test(paragraph)) break;
    if (isAutomaticStory(story) && LEGACY_AUTOMATIC_SECTION_HEADINGS.has(paragraph)) {
      skipNextAutomaticParagraph = true;
      continue;
    }
    if (skipNextAutomaticParagraph) {
      skipNextAutomaticParagraph = false;
      continue;
    }
    const cleaned = cleanLegacyAutomaticText(paragraph, story);
    if (cleaned) {
      paragraphs.push(cleaned);
    } else if (paragraphs.length && /^[^。！？；，、,.!?;:：]{2,18}$/.test(paragraphs[paragraphs.length - 1])) {
      paragraphs.pop();
    }
  }
  return paragraphs;
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
  const automatic = isAutomaticStory(story);
  const rawOriginalTitle = String(story.originalTitle || story.title || "").trim();
  let rawSourceMaterial = String(
    story.sourceMaterial || story.originalExcerpt || story.excerpt || ""
  );
  rawSourceMaterial = window.FXContent.cleanTranslationArtifacts(
    window.FXContent.cleanSourceText(rawSourceMaterial), story
  );
  if (rawSourceMaterial.includes("视频简介")) rawSourceMaterial = rawSourceMaterial.split("视频简介")[0].trim();
  const titleNeedsTranslation = (!window.FXContent.hasChineseText(rawOriginalTitle) && /[A-Za-z]/.test(rawOriginalTitle))
    || window.FXContent.hasLongEnglishRun(rawOriginalTitle);
  const materialNeedsTranslation = (!window.FXContent.hasChineseText(rawSourceMaterial) && /[A-Za-z]/.test(rawSourceMaterial))
    || window.FXContent.hasLongEnglishRun(rawSourceMaterial);
  const translatedTitle = titleNeedsTranslation
    ? String(story.translatedSourceTitle || "").trim()
    : rawOriginalTitle;
  const translatedMaterial = materialNeedsTranslation
    ? String(story.translatedSourceMaterial || "").replace(/\s+/g, " ").trim()
    : rawSourceMaterial;
  const materialIsUsable = window.FXContent.sourceMaterialIsUsable(translatedMaterial);
  const originalContent = document.querySelector("#articleOriginalContent");
  const originalBlocks = [];
  if (titleNeedsTranslation && rawOriginalTitle) {
    originalBlocks.push(
      `<div class="original-material-block is-foreign"><span>外文原始标题</span><p lang="en">${escapeArticleHtml(rawOriginalTitle)}</p></div>`
    );
  }
  if (translatedTitle) {
    originalBlocks.push(
      `<div class="original-material-block"><span>${titleNeedsTranslation ? "原始标题中文机器翻译" : "原始标题"}</span><p>${escapeArticleHtml(translatedTitle)}</p></div>`
    );
  }
  if (materialNeedsTranslation && window.FXContent.sourceMaterialIsUsable(rawSourceMaterial)) {
    originalBlocks.push(
      `<div class="original-material-block is-foreign"><span>外文来源公开摘要或片段</span><p lang="en">${escapeArticleHtml(rawSourceMaterial)}</p></div>`
    );
  }
  if (materialIsUsable) {
    originalBlocks.push(
      `<div class="original-material-block"><span>${materialNeedsTranslation ? "来源公开摘要中文机器翻译" : "来源公开摘要或片段"}</span><p>${escapeArticleHtml(translatedMaterial)}</p></div>`
    );
  } else {
    originalBlocks.push(
      `<p class="original-material-unavailable">当前记录没有可可靠展示的中文原始摘要或译文。为避免把自动扩写冒充原文，本页不补写来源内容，请通过“打开来源页面”查看完整资料。</p>`
    );
  }
  originalContent.innerHTML = originalBlocks.join("");

  const points = [`资料主题：${translatedTitle || story.title}`];
  if (materialIsUsable) {
    const sourcePoints = translatedMaterial
      .split(/(?<=[。！？!?])\s*/)
      .map(function (item) { return item.trim(); })
      .filter(function (item) { return item.length >= 18; });
    sourcePoints.slice(0, 3).forEach(function (item) {
      if (!points.includes(item)) points.push(item);
    });
  } else {
    points.push("当前记录未取得可供可靠展示的原始摘要，平台不补写原文事实。");
  }
  document.querySelector("#articleKeyPoints").innerHTML = points
    .slice(0, 4)
    .map(function (point) { return `<li>${escapeArticleHtml(point)}</li>`; })
    .join("");

  let platformIntro = String(story.excerpt || "").trim();
  if (automatic) {
    platformIntro = window.FXContent.automaticPresentationIntro(story);
    if (materialIsUsable) {
      const firstPoint = points[1] || translatedMaterial;
      platformIntro += ` 原始公开片段首先提到：${firstPoint.slice(0, 180)}`;
    } else {
      platformIntro += " 由于可用原始片段不足，本页不展示旧的自动扩写正文。";
    }
  }
  document.querySelector("#articlePlatformIntro").textContent = platformIntro;

  const paragraphs = normalizeArticleParagraphs(story);
  const platformBody = document.querySelector("#articleBody");
  platformBody.hidden = paragraphs.length === 0;
  platformBody.innerHTML = platformBody.hidden
    ? ""
    : paragraphs.map(articleParagraphHtml).join("");
}

function platformPublishedValue(story) {
  return story.platformPublishedAt
    || story.automaticApproval?.reviewedAt
    || story.automaticImportedAt
    || story.publishedAt
    || story.date
    || story.time
    || "";
}

function safeVideoUrl(value) {
  try {
    const url = new URL(String(value || ""), location.href);
    return url.protocol === "https:" || url.origin === location.origin ? url.href : "";
  } catch (error) {
    return "";
  }
}

function bilibiliPlayerUrl(value) {
  try {
    const url = new URL(String(value || ""));
    if (!/(^|\.)bilibili\.com$/i.test(url.hostname)) return "";
    const match = url.href.match(/\b(BV[0-9A-Za-z]{10})\b/);
    return match ? "https://player.bilibili.com/player.html?bvid=" + encodeURIComponent(match[1]) + "&autoplay=0" : "";
  } catch (error) {
    return "";
  }
}

function appendExternalVideoLink(container, href) {
  const overlay = document.createElement("div");
  overlay.className = "article-video-external";
  const link = document.createElement("a");
  link.href = href;
  link.target = "_blank";
  link.rel = "noopener noreferrer";
  link.textContent = "前往来源网站观看";
  const icon = document.createElement("i");
  icon.setAttribute("data-lucide", "external-link");
  link.appendChild(icon);
  overlay.appendChild(link);
  container.appendChild(overlay);
}

function cctvArticleVideoId(story) {
  const externalId = String(story.videoExternalId || "").trim();
  if (!/^[a-f0-9]{32}$/i.test(externalId)) return "";
  try {
    const url = new URL(String(story.videoUrl || story.sourceUrl || ""));
    return url.hostname === "tv.cctv.com" ? externalId : "";
  } catch (error) {
    return "";
  }
}

async function loadCctvArticleVideo(story, video, player, fallbackUrl) {
  const externalId = cctvArticleVideoId(story);
  if (!externalId) return false;
  try {
    const endpoint = "https://vdn.apps.cntv.cn/api/getHttpVideoInfo.do?pid=" + encodeURIComponent(externalId);
    const response = await fetch(endpoint);
    if (!response.ok) throw new Error("央视视频接口暂时不可用");
    const payload = await response.json();
    const streamUrl = String(payload.hls_url || "").trim();
    if (payload.ack !== "yes" || payload.play === "0" || !streamUrl.startsWith("https://")) {
      throw new Error("央视视频流暂时不可用");
    }
    const playbackUrl = new URL(streamUrl);
    const maxBitrate = Number(playbackUrl.searchParams.get("maxbr") || 0);
    if (maxBitrate && maxBitrate < 4096) playbackUrl.searchParams.set("maxbr", "4096");
    if (video.canPlayType("application/vnd.apple.mpegurl")) {
      video.src = playbackUrl.href;
      return true;
    }
    if (!window.Hls?.isSupported()) throw new Error("浏览器不支持该视频格式");
    activeArticleHls?.destroy();
    activeArticleHls = new window.Hls({ capLevelToPlayerSize: true, enableWorker: true, maxBufferLength: 30 });
    activeArticleHls.on(window.Hls.Events.ERROR, function (_event, data) {
      if (!data.fatal) return;
      activeArticleHls?.destroy();
      activeArticleHls = null;
      if (!player.querySelector(".article-video-external")) appendExternalVideoLink(player, fallbackUrl);
    });
    activeArticleHls.loadSource(playbackUrl.href);
    activeArticleHls.attachMedia(video);
    return true;
  } catch (error) {
    video.remove();
    appendExternalVideoLink(player, fallbackUrl);
    initializeArticleIcons();
    return false;
  }
}

function renderArticleVideo(story) {
  const section = document.querySelector("#articleVideo");
  const player = document.querySelector("#articleVideoPlayer");
  const sourceLink = document.querySelector("#articleVideoSource");
  const videoType = String(story.videoType || "none");
  const videoUrl = safeVideoUrl(story.videoUrl);
  section.hidden = true;
  player.replaceChildren();
  if (videoType === "none" || !videoUrl || story.videoRightsConfirmed !== true) return false;

  if (videoType === "file") {
    const pathname = new URL(videoUrl).pathname.toLowerCase();
    if (!/\.(mp4|webm|ogg)$/.test(pathname)) return false;
    const video = document.createElement("video");
    video.src = videoUrl;
    video.controls = true;
    video.preload = "metadata";
    video.playsInline = true;
    video.setAttribute("controlsList", "nodownload");
    const poster = safeVideoUrl(story.videoPoster || story.image);
    if (poster) video.poster = poster;
    player.appendChild(video);
  } else if (videoType === "bilibili") {
    const embedUrl = bilibiliPlayerUrl(videoUrl);
    if (!embedUrl) return false;
    const frame = document.createElement("iframe");
    frame.src = embedUrl;
    frame.title = story.title + " 视频";
    frame.loading = "lazy";
    frame.allow = "fullscreen; autoplay; encrypted-media; picture-in-picture";
    frame.allowFullscreen = true;
    frame.referrerPolicy = "strict-origin-when-cross-origin";
    player.appendChild(frame);
  } else if (videoType === "external") {
    if (cctvArticleVideoId(story)) {
      const video = document.createElement("video");
      video.controls = true;
      video.preload = "metadata";
      video.playsInline = true;
      video.setAttribute("controlsList", "nodownload");
      const poster = safeVideoUrl(story.videoPoster || story.image);
      if (poster) video.poster = poster;
      player.appendChild(video);
      loadCctvArticleVideo(story, video, player, videoUrl);
    } else {
      const poster = document.createElement("img");
      poster.src = safeVideoUrl(story.videoPoster || story.image) || "assets/factory.jpg";
      poster.alt = story.title + " 视频封面";
      player.appendChild(poster);
      appendExternalVideoLink(player, videoUrl);
    }
  } else {
    return false;
  }

  sourceLink.href = videoUrl;
  section.hidden = false;
  return true;
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
  document.querySelector(".brand-copy small").textContent = /[\u3400-\u9fff]/.test(site.subtitle || "")
    ? site.subtitle
    : "全球前沿知识索引";
  document.querySelector("#articleCategory").textContent = story.category;
  document.querySelector("#articleCategory").style.color = categoryColor;
  document.querySelector("#categoryLink").textContent = story.category;
  document.querySelector("#categoryLink").href = "category.html?category=" + encodeURIComponent(story.category);
  document.querySelector("#articleDate").textContent = dateOnlyLabel(platformPublishedValue(story));
  document.querySelector("#articleRead").textContent = Number(story.readMinutes || 6) + " 分钟阅读";
  document.querySelector("#articleTitle").textContent = story.title;
  const articleExcerpt = document.querySelector("#articleExcerpt");
  articleExcerpt.hidden = false;
  articleExcerpt.textContent = window.FXContent.presentationExcerpt(story);
  const articleImage = document.querySelector("#articleImage");
  const imageFallback = story.imageFallback || "assets/factory.jpg";
  articleImage.referrerPolicy = "no-referrer";
  articleImage.onerror = function () {
    if (articleImage.getAttribute("src") !== imageFallback) articleImage.src = imageFallback;
  };
  articleImage.src = story.image || imageFallback;
  articleImage.alt = story.title;
  document.querySelector("#articleVideo").hidden = true;
  document.querySelector(".article-cover").hidden = false;
  document.querySelector("#articleSource").textContent = sourceDisplayName(story.source);
  document.querySelector("#railCategory").textContent = story.category;
  document.querySelector("#railDate").textContent = dateOnlyLabel(platformPublishedValue(story)) || "未设置";
  document.querySelector("#railHeat").textContent = String(story.heat || 0);
  const sourceLink = document.querySelector("#sourceLink");
  const sourceUrl = story.sourceUrl || story.url;
  sourceLink.hidden = !sourceUrl;
  if (sourceUrl) sourceLink.href = sourceUrl;
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
    datePublished: platformPublishedValue(story) || undefined,
    dateModified: story.updatedAt || platformPublishedValue(story) || undefined,
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
  articleContent = await window.FXContent.load(ARTICLE_CONTENT_URL, { background: true });
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

window.addEventListener("fxcontentupdate", function (event) {
  if (!event.detail?.stories) return;
  articleContent = event.detail;
  const storyId = getStoryId();
  const refreshedStory = articleContent.stories.find(function (story) {
    return Number(story.id) === storyId && storyIsPublic(story);
  });
  if (!refreshedStory) return;
  currentStory = refreshedStory;
  applyArticleTheme();
  renderArticle(currentStory);
  updateReadingProgress();
});

initArticle();
window.addEventListener("load", initializeArticleIcons);
