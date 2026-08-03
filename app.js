const CONTENT_URL = "data/content.json";
const ADMIN_CONTENT_KEY = "fx-admin-content";
const SAVED_KEY = "fx-saved";

let content = null;
let stories = [];
let chartSeries = {};
let homeVideos = [];
let activeHomeVideoId = "";

const fallbackContent = {
  site: {
    name: "信息分享平台",
    subtitle: "GLOBAL KNOWLEDGE INDEX",
    heroTitle: "全球前沿知识观察台",
    heroSubtitle: "聚合关键技术、制造趋势与产业链信号",
    footer: "聚合公开产业信息，建立可追踪的科技观察坐标。",
    briefing: { title: "每日产业简报", subtitle: "工作日 08:30 更新" }
  },
  categories: ["金融", "科技", "工业", "能源", "农业", "人文"],
  metrics: [],
  chartSeries: {},
  featured: null,
  stories: [],
  signals: { score: 72, items: [] },
  topics: [],
  events: []
};

const state = {
  category: "全部",
  query: "",
  sort: "latest",
  view: "grid",
  source: "all",
  language: "all",
  period: "all",
  trust: "all",
  saved: new Set(JSON.parse(localStorage.getItem(SAVED_KEY) || "[]"))
};

const storyGrid = document.querySelector("#stories");
const resultCount = document.querySelector("#resultCount");
const emptyState = document.querySelector("#emptyState");
const searchInput = document.querySelector("#searchInput");
const clearSearch = document.querySelector("#clearSearch");
const sortSelect = document.querySelector("#sortSelect");
const sourceFilter = document.querySelector("#sourceFilter");
const languageFilter = document.querySelector("#languageFilter");
const periodFilter = document.querySelector("#periodFilter");
const trustFilter = document.querySelector("#trustFilter");
const toast = document.querySelector("#toast");

function initializeIcons() {
  if (window.lucide) {
    window.lucide.createIcons({ attrs: { "stroke-width": 1.7 } });
  }
}

function escapeHtml(value = "") {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function safeColor(value, fallback = "#6ee7a8") {
  return /^#[0-9a-f]{6}$/i.test(String(value || "")) ? value : fallback;
}

function attachImageFallbacks(root = document) {
  root.querySelectorAll("img[data-image-fallback]").forEach((img) => {
    if (img.dataset.fallbackReady === "true") return;
    img.dataset.fallbackReady = "true";
    img.referrerPolicy = "no-referrer";
    img.addEventListener("error", () => {
      const fallback = img.dataset.imageFallback || "assets/factory.jpg";
      if (img.getAttribute("src") !== fallback) img.src = fallback;
    });
  });
}

function getCategorySettings() {
  const settings = Array.isArray(content.categorySettings) && content.categorySettings.length
    ? content.categorySettings
    : (content.categories || []).map((name) => ({ name, color: "#6ee7a8", icon: "folder", enabled: true, keywords: [] }));
  return settings;
}

function getCategorySetting(name) {
  return getCategorySettings().find((item) => item.name === name) || { name, color: "#6ee7a8", icon: "folder", enabled: true };
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

function applyTheme() {
  const theme = content.theme || {};
  const root = document.documentElement;
  root.style.setProperty("--bg", safeColor(theme.background, "#090d10"));
  root.style.setProperty("--surface", safeColor(theme.surface, "#10161a"));
  root.style.setProperty("--text", safeColor(theme.text, "#edf4f2"));
  root.style.setProperty("--green", safeColor(theme.primary, "#6ee7a8"));
  root.style.setProperty("--cyan", safeColor(theme.secondary, "#63cfe3"));
}

async function loadContent() {
  const loaded = await window.FXContent?.load(CONTENT_URL, { background: true });
  return loaded || fallbackContent;
}

function applySiteContent() {
  const site = content.site || fallbackContent.site;
  const operations = Object.assign({
    siteUrl: "https://gzxkjpt.eu.org",
    publicNotice: "公益性科技与产业知识聚合平台",
    searchEnabled: true
  }, content.operations || {});
  document.title = `${site.name} | 全球前沿知识聚合平台`;
  const description = site.heroSubtitle || `${site.name} - 全球前沿知识聚合平台`;
  document.querySelector('meta[name="description"]')?.setAttribute("content", description);
  document.querySelector(".brand-copy strong").textContent = site.name;
  document.querySelector(".brand-copy small").textContent = site.subtitle;
  document.querySelector(".brand").setAttribute("aria-label", `${site.name}首页`);
  document.querySelector("#pulseTitle").textContent = site.heroTitle;
  document.querySelector(".pulse-heading p").textContent = site.heroSubtitle;
  document.querySelector(".footer-brand").innerHTML = `${escapeHtml(site.name)} <span>FX INDEX / 2026</span>`;
  document.querySelector("#footerDescription").textContent = site.footer;
  document.querySelector("#footerNotice").textContent = operations.publicNotice || "公益性科技与产业知识聚合平台";
  const footerContact = document.querySelector("#footerContact");
  footerContact.hidden = !operations.contactEmail;
  if (operations.contactEmail) {
    footerContact.href = `mailto:${operations.contactEmail}`;
    footerContact.textContent = operations.contactEmail;
  }
  document.querySelector(".search-box").hidden = operations.searchEnabled === false;
  document.querySelector(".briefing-panel strong").textContent = site.briefing?.title || "每日产业简报";
  document.querySelector(".briefing-panel span").textContent = site.briefing?.subtitle || "工作日 08:30 更新";
  applyHomepageSeo(site, operations, description);
}

function setMeta(selector, value) {
  document.querySelector(selector)?.setAttribute("content", value);
}

function applyHomepageSeo(site, operations, description) {
  const siteUrl = String(operations.siteUrl || location.origin).replace(/\/$/, "") + "/";
  document.querySelector('link[rel="canonical"]')?.setAttribute("href", siteUrl);
  setMeta('meta[property="og:site_name"]', site.name || "信息分享平台");
  setMeta('meta[property="og:title"]', document.title);
  setMeta('meta[property="og:description"]', description);
  setMeta('meta[property="og:url"]', siteUrl);
  const structured = {
    "@context": "https://schema.org",
    "@type": "WebSite",
    name: site.name || "信息分享平台",
    url: siteUrl,
    description: description,
    inLanguage: "zh-CN"
  };
  if (operations.searchEnabled !== false) {
    structured.potentialAction = {
      "@type": "SearchAction",
      target: siteUrl + "?q={search_term_string}",
      "query-input": "required name=search_term_string"
    };
  }
  document.querySelector("#siteStructuredData").textContent = JSON.stringify(structured);
}

function renderNav() {
  const nav = document.querySelector(".primary-nav");
  const categories = getCategorySettings().filter((item) => item.enabled !== false);
  nav.innerHTML = [{ name: "全部", color: content.theme?.primary || "#6ee7a8" }, ...categories]
    .map((category) => {
      const label = category.name === "全部" ? "总览" : category.name;
      const href = category.name === "全部"
        ? "index.html"
        : `category.html?category=${encodeURIComponent(category.name)}`;
      return `<a class="nav-tab ${category.name === state.category ? "is-active" : ""}" href="${href}" style="--category-color:${safeColor(category.color)}">${escapeHtml(label)}</a>`;
    })
    .join("");
}

function renderDiscovery() {
  const publicStories = stories.filter(storyIsPublic).slice().sort((a, b) => {
    const dateDelta = new Date(b.date || 0).getTime() - new Date(a.date || 0).getTime();
    return dateDelta || Number(b.id || 0) - Number(a.id || 0);
  });
  const latestSignals = document.querySelector("#latestSignals");
  latestSignals.innerHTML = publicStories.slice(0, 3).map((story) => {
    const category = getCategorySetting(story.category);
    return `<a href="article.html?id=${encodeURIComponent(story.id)}" style="--category-color:${safeColor(category.color)}">
      <span>${escapeHtml(story.category)}</span>
      <strong>${escapeHtml(story.title)}</strong>
      <time>${escapeHtml(story.time || story.date || "最新")}</time>
    </a>`;
  }).join("");

  const directory = document.querySelector("#categoryDirectory");
  const categories = getCategorySettings().filter((item) => item.enabled !== false);
  directory.innerHTML = categories.map((category) => {
    const count = publicStories.filter((story) => story.category === category.name).length;
    return `<a href="category.html?category=${encodeURIComponent(category.name)}" style="--category-color:${safeColor(category.color)}">
      <i data-lucide="${escapeHtml(category.icon || "folder")}"></i>
      <span><strong>${escapeHtml(category.name)}</strong><small>${count} 条内容</small></span>
    </a>`;
  }).join("");

  const sources = Array.from(new Set(publicStories.map((story) => story.source).filter(Boolean))).sort((a, b) => a.localeCompare(b, "zh-CN"));
  sourceFilter.innerHTML = `<option value="all">全部来源</option>${sources.map((source) => `<option value="${escapeHtml(source)}">${escapeHtml(source)}</option>`).join("")}`;
  sourceFilter.value = sources.includes(state.source) ? state.source : "all";
  state.source = sourceFilter.value;
  updateFilterUi();
}

function bilibiliPlayerUrl(value) {
  try {
    const url = new URL(String(value || ""));
    if (!(url.hostname === "bilibili.com" || url.hostname.endsWith(".bilibili.com"))) return "";
    const match = url.href.match(/\b(BV[0-9A-Za-z]{10})\b/);
    return match ? `https://player.bilibili.com/player.html?bvid=${encodeURIComponent(match[1])}&page=1&high_quality=1` : "";
  } catch (error) {
    return "";
  }
}

function validHomeVideo(story) {
  if (story.videoRightsConfirmed !== true) return false;
  const type = String(story.videoType || "none");
  const value = String(story.videoUrl || "").trim();
  if (type === "bilibili") return Boolean(bilibiliPlayerUrl(value));
  try {
    const url = new URL(value);
    if (url.protocol !== "https:") return false;
    if (type === "external") return true;
    return type === "file" && /\.(mp4|webm|ogg)$/i.test(url.pathname);
  } catch (error) {
    return false;
  }
}

function getHomeVideos() {
  const publishedVideos = stories
    .filter((story) => storyIsPublic(story) && validHomeVideo(story))
    .map((story) => ({
      id: `story-${story.id}`,
      storyId: story.id,
      title: story.title,
      description: window.FXContent.presentationExcerpt(story),
      category: story.category,
      source: story.source,
      sourceUrl: story.sourceUrl || "",
      videoType: story.videoType,
      videoUrl: story.videoUrl,
      videoPoster: story.videoPoster || story.image || story.imageFallback || "assets/network.jpg"
    }));
  return publishedVideos.slice(0, 5).concat({
    id: "platform-overview",
    title: "信息分享平台：六大板块前沿内容导航",
    description: "快速了解金融、科技、工业、能源、农业与人文内容，以及文章、视频和原始来源之间的阅读路径。",
    category: "平台导览",
    source: "信息分享平台",
    sourceUrl: "",
    videoType: "file",
    videoUrl: "assets/platform-overview.webm",
    videoPoster: "assets/network.jpg"
  });
}

function renderHomeVideoScreen(video) {
  const screen = document.querySelector("#homeVideoScreen");
  screen.innerHTML = "";
  if (video.videoType === "bilibili") {
    const frame = document.createElement("iframe");
    frame.src = bilibiliPlayerUrl(video.videoUrl);
    frame.title = `${video.title} 视频`;
    frame.loading = "lazy";
    frame.allow = "autoplay; fullscreen; picture-in-picture";
    frame.allowFullscreen = true;
    screen.appendChild(frame);
    return;
  }
  if (video.videoType === "file") {
    const player = document.createElement("video");
    player.controls = true;
    player.playsInline = true;
    player.preload = "metadata";
    player.poster = video.videoPoster;
    player.setAttribute("controlsList", "nodownload");
    const source = document.createElement("source");
    source.src = video.videoUrl;
    source.type = video.videoUrl.toLowerCase().includes(".webm") ? "video/webm" : "video/mp4";
    player.appendChild(source);
    player.append("您的浏览器暂不支持此视频格式。");
    screen.appendChild(player);
    return;
  }
  const link = document.createElement("a");
  link.className = "home-video-external";
  link.href = video.videoUrl;
  link.target = "_blank";
  link.rel = "noopener noreferrer";
  link.innerHTML = `<img src="${escapeHtml(video.videoPoster)}" data-image-fallback="assets/network.jpg" alt="${escapeHtml(video.title)}"><span><i data-lucide="external-link"></i>前往来源网站观看</span>`;
  screen.appendChild(link);
  attachImageFallbacks(screen);
}

function renderHomeVideos() {
  homeVideos = getHomeVideos();
  if (!homeVideos.some((video) => video.id === activeHomeVideoId)) activeHomeVideoId = homeVideos[0]?.id || "";
  const active = homeVideos.find((video) => video.id === activeHomeVideoId) || homeVideos[0];
  if (!active) return;
  renderHomeVideoScreen(active);
  document.querySelector("#homeVideoCategory").textContent = active.category;
  document.querySelector("#homeVideoKind").textContent = active.videoType === "external" ? "外部观看" : active.videoType === "bilibili" ? "哔哩哔哩" : "站内视频";
  document.querySelector("#homeVideoTitle").textContent = active.title;
  document.querySelector("#homeVideoDescription").textContent = active.description;
  document.querySelector("#homeVideoCount").textContent = `${homeVideos.length} 条`;
  const actions = [];
  if (active.storyId) actions.push(`<a href="article.html?id=${encodeURIComponent(active.storyId)}"><i data-lucide="newspaper"></i>阅读对应文章</a>`);
  if (active.sourceUrl) actions.push(`<a href="${escapeHtml(active.sourceUrl)}" target="_blank" rel="noopener noreferrer"><i data-lucide="external-link"></i>查看资料来源</a>`);
  document.querySelector("#homeVideoActions").innerHTML = actions.join("");
  document.querySelector("#homeVideoPlaylist").innerHTML = homeVideos.map((video, index) => `
    <button class="home-video-item ${video.id === active.id ? "is-active" : ""}" type="button" data-home-video="${escapeHtml(video.id)}" aria-pressed="${video.id === active.id}">
      <span class="home-video-thumb"><img src="${escapeHtml(video.videoPoster)}" data-image-fallback="assets/network.jpg" alt="" loading="lazy"><i data-lucide="play"></i></span>
      <span class="home-video-copy"><small>${escapeHtml(video.category)} · ${String(index + 1).padStart(2, "0")}</small><strong>${escapeHtml(video.title)}</strong><em>${escapeHtml(video.source)}</em></span>
    </button>
  `).join("");
  attachImageFallbacks(document.querySelector("#homeVideoPlaylist"));
  initializeIcons();
}

function updateFilterUi() {
  const activeCount = [state.source, state.language, state.period, state.trust].filter((value) => value !== "all").length
    + (state.category !== "全部" ? 1 : 0)
    + (state.query.trim() ? 1 : 0);
  document.querySelector("#activeFilterCount").textContent = String(activeCount);
  document.querySelector("#resetFilters").classList.toggle("is-active", activeCount > 0);
  sourceFilter.value = state.source;
  languageFilter.value = state.language;
  periodFilter.value = state.period;
  trustFilter.value = state.trust;
}

function renderMetrics() {
  const grid = document.querySelector(".metrics-grid");
  const metrics = content.metrics || [];
  grid.innerHTML = metrics
    .map((metric) => `
      <article class="metric">
        <div class="metric-label"><i data-lucide="${escapeHtml(metric.icon || "activity")}"></i><span>${escapeHtml(metric.label)}</span></div>
        <strong>${escapeHtml(metric.value)}</strong>
        <span class="metric-trend ${escapeHtml(metric.direction || "positive")}"><i data-lucide="${metric.direction === "negative" ? "trending-down" : "trending-up"}"></i> ${escapeHtml(metric.trend)}</span>
        <small>${escapeHtml(metric.caption)}</small>
      </article>
    `)
    .join("");
}

function renderFeatured() {
  const featured = content.featured;
  const target = document.querySelector(".featured-story");
  if (!featured) {
    target.hidden = true;
    return;
  }
  target.hidden = false;
  const category = getCategorySetting(featured.category);
  const featuredStory = stories.find((story) => Number(story.id) === Number(featured.storyId) && storyIsPublic(story))
    || stories.find((story) => story.category === featured.category && storyIsPublic(story))
    || stories.find(storyIsPublic);
  const featuredImage = featured.image || featuredStory?.image || "assets/factory.jpg";
  const featuredFallback = featuredStory?.imageFallback || "assets/factory.jpg";
  target.innerHTML = `
    <img src="${escapeHtml(featuredImage)}" data-image-fallback="${escapeHtml(featuredFallback)}" referrerpolicy="no-referrer" alt="${escapeHtml(featured.title)}">
    <div class="featured-overlay">
      <div class="story-meta">
        <span class="category-tag" style="color:${safeColor(category.color)}">${escapeHtml(featured.category)}</span>
        <span>${escapeHtml(featured.label || "重点观察")}</span>
        <span>${Number(featured.readMinutes || 8)} 分钟阅读</span>
      </div>
      <h2>${escapeHtml(featured.title)}</h2>
      <p>${escapeHtml(window.FXContent.presentationExcerpt(featured))}</p>
      <a href="article.html?id=${encodeURIComponent(featuredStory?.id || 1)}" class="featured-link">查看专题 <i data-lucide="arrow-up-right"></i></a>
    </div>
  `;
  attachImageFallbacks(target);
}

function renderSignals() {
  const signals = content.signals || fallbackContent.signals;
  document.querySelector(".donut strong").textContent = signals.score ?? 72;
  const legend = document.querySelector(".signal-legend");
  legend.innerHTML = (signals.items || [])
    .map((item) => `<span><i class="${escapeHtml(item.className || "")}"></i>${escapeHtml(item.label)} <b>${Number(item.value || 0)}%</b></span>`)
    .join("");
}

function renderTopics() {
  const list = document.querySelector(".topic-list");
  list.innerHTML = (content.topics || [])
    .map((topic, index) => `
      <li>
        <span class="topic-rank">${String(index + 1).padStart(2, "0")}</span>
        <div><strong>${escapeHtml(topic.label)}</strong><div class="topic-bar"><i style="--score: ${Number(topic.score || 0)}%"></i></div></div>
        <b>${escapeHtml(topic.growth)}</b>
      </li>
    `)
    .join("");
}

function renderEvents() {
  const list = document.querySelector(".event-list");
  list.innerHTML = (content.events || [])
    .map((event) => `<article><time>${escapeHtml(event.date)}</time><div><strong>${escapeHtml(event.title)}</strong><span>${escapeHtml(event.meta)}</span></div></article>`)
    .join("");
}

function storyTemplate(story, index) {
  const saved = state.saved.has(story.id);
  const category = getCategorySetting(story.category);
  const detailUrl = `article.html?id=${encodeURIComponent(story.id)}`;
  return `
    <article class="story-card" data-story-id="${story.id}" data-category="${escapeHtml(story.category)}" style="--category-color:${safeColor(category.color)}">
      <div class="story-image">
        <a href="${detailUrl}" aria-label="阅读：${escapeHtml(story.title)}"><img src="${escapeHtml(story.image || story.imageFallback || "assets/factory.jpg")}" data-image-fallback="${escapeHtml(story.imageFallback || "assets/factory.jpg")}" referrerpolicy="no-referrer" alt="${escapeHtml(story.title)}" loading="lazy"></a>
        <span class="story-index">FX-${String(index + 1).padStart(2, "0")}</span>
      </div>
      <div class="story-body">
        <div class="story-meta">
          <span class="category-tag">${escapeHtml(story.category)}</span>
          <span>${Number(story.readMinutes || 6)} 分钟阅读</span>
          <span>热度 ${Number(story.heat || 60)}</span>
        </div>
        <h3><a href="${detailUrl}">${escapeHtml(story.title)}</a></h3>
        <p>${escapeHtml(window.FXContent.presentationExcerpt(story))}</p>
        <div class="story-foot">
          <div class="story-source">
            <i class="source-mark"></i>
            <span>${escapeHtml(story.source)}</span>
            <span>·</span>
            <time>${escapeHtml(story.time || story.date || "刚刚")}</time>
          </div>
          <button class="bookmark-button ${saved ? "is-saved" : ""}" type="button" data-bookmark="${story.id}" aria-label="${saved ? "取消收藏" : "收藏内容"}" title="${saved ? "取消收藏" : "收藏内容"}">
            <i data-lucide="bookmark"></i>
          </button>
        </div>
      </div>
    </article>
  `;
}

function getVisibleStories() {
  const queryTokens = state.query.trim().toLowerCase().split(/\s+/).filter(Boolean);
  const filtered = stories.filter((story) => {
    if (!storyIsPublic(story)) return false;
    const categoryMatch = state.category === "全部" || story.category === state.category;
    const sourceMatch = state.source === "all" || story.source === state.source;
    const language = story.language || "zh-CN";
    const languageMatch = state.language === "all" || language === state.language;
    const confidence = Number(story.confidence ?? 80);
    const trustMatch = state.trust === "all"
      || (state.trust === "high" && confidence >= 85)
      || (state.trust === "standard" && confidence >= 70 && confidence < 85)
      || (state.trust === "low" && confidence < 70);
    let periodMatch = true;
    if (state.period !== "all") {
      const periodHours = { "24h": 24, "7d": 24 * 7, "30d": 24 * 30 }[state.period];
      const timestamp = new Date(story.collectedAt || story.date || 0).getTime();
      periodMatch = Number.isFinite(timestamp) && timestamp >= Date.now() - periodHours * 60 * 60 * 1000;
    }
    const body = Array.isArray(story.body) ? story.body.join(" ") : (story.body || "");
    const haystack = `${story.title} ${story.excerpt} ${body} ${story.category} ${story.source} ${story.author || ""} ${(story.tags || []).join(" ")}`.toLowerCase();
    return categoryMatch && sourceMatch && languageMatch && trustMatch && periodMatch && queryTokens.every((token) => haystack.includes(token));
  });

  return filtered.sort((a, b) => {
    if (state.sort === "hot") return Number(b.heat || 0) - Number(a.heat || 0);
    if (state.sort === "read") return Number(b.readMinutes || 0) - Number(a.readMinutes || 0);
    const dateDelta = new Date(b.date || 0).getTime() - new Date(a.date || 0).getTime();
    return dateDelta || Number(b.id || 0) - Number(a.id || 0);
  });
}

function renderStories() {
  const visibleStories = getVisibleStories();
  document.querySelector("#feedTitle").textContent = state.category === "全部" ? "今日聚合" : `${state.category}前沿`;
  storyGrid.classList.toggle("is-list", state.view === "list");
  storyGrid.innerHTML = visibleStories.map(storyTemplate).join("");
  attachImageFallbacks(storyGrid);
  const waitingForCloud = visibleStories.length === 0 && !window.FXContent?.readPublicCache?.();
  resultCount.textContent = waitingForCloud ? "正在同步内容" : `${visibleStories.length} 条内容`;
  emptyState.hidden = visibleStories.length !== 0;
  if (waitingForCloud) {
    emptyState.querySelector("strong").textContent = "正在连接内容服务";
    emptyState.querySelector("span").textContent = "内容将在连接完成后自动显示";
  } else {
    emptyState.querySelector("strong").textContent = "没有匹配的内容";
    emptyState.querySelector("span").textContent = "尝试更换关键词或频道";
  }
  updateFilterUi();
  initializeIcons();
}

function setCategory(category) {
  state.category = category;
  document.querySelectorAll(".nav-tab").forEach((button) => {
    button.classList.toggle("is-active", button.dataset.category === category);
  });
  document.querySelectorAll("[data-category-filter]").forEach((button) => {
    button.classList.toggle("is-active", button.dataset.categoryFilter === category);
  });
  document.querySelector("#feedTitle").textContent = category === "全部" ? "今日聚合" : `${category}前沿`;
  updateFilterUi();
  renderStories();
  syncSearchUrl();
}

function syncSearchUrl() {
  const params = new URLSearchParams(location.search);
  if (state.query.trim()) params.set("q", state.query.trim());
  else params.delete("q");
  if (state.category !== "全部") params.set("category", state.category);
  else params.delete("category");
  [["source", state.source], ["language", state.language], ["period", state.period], ["trust", state.trust]].forEach(([key, value]) => {
    if (value !== "all") params.set(key, value);
    else params.delete(key);
  });
  const query = params.toString();
  history.replaceState(null, "", location.pathname + (query ? "?" + query : ""));
}

function renderChart(range) {
  const series = chartSeries[range] || chartSeries["24h"];
  if (!series) return;
  const width = 620;
  const height = 150;
  const inset = 10;
  const min = Math.min(...series.values) - 5;
  const max = Math.max(...series.values) + 5;
  const points = series.values.map((value, index) => {
    const x = (index / (series.values.length - 1)) * width;
    const y = height - inset - ((value - min) / (max - min)) * (height - inset * 2);
    return { x, y };
  });

  document.querySelector("#chartLine").setAttribute("points", points.map(({ x, y }) => `${x},${y}`).join(" "));
  document.querySelector("#chartArea").setAttribute(
    "d",
    `M 0 ${height} L ${points.map(({ x, y }) => `${x} ${y}`).join(" L ")} L ${width} ${height} Z`
  );
  document.querySelector("#chartDots").innerHTML = points
    .filter((_, index) => index === points.length - 1 || index % 3 === 0)
    .map(({ x, y }) => `<circle class="chart-dot" cx="${x}" cy="${y}" r="3.5"></circle>`)
    .join("");
  document.querySelector("#chartLabels").innerHTML = series.labels.map((label) => `<span>${escapeHtml(label)}</span>`).join("");
  document.querySelector("#chartValue").textContent = series.value;
  document.querySelector("#chartDelta").textContent = series.delta;
}

let toastTimer;
function showToast(message) {
  window.clearTimeout(toastTimer);
  toast.textContent = message;
  toast.classList.add("is-visible");
  toastTimer = window.setTimeout(() => toast.classList.remove("is-visible"), 2200);
}

function updateClock() {
  const formatter = new Intl.DateTimeFormat("zh-CN", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false
  });
  document.querySelector("#currentTime").textContent = `${formatter.format(new Date())} CST`;
}

function bindStaticEvents() {
  document.querySelector("#homeVideoPlaylist").addEventListener("click", (event) => {
    const button = event.target.closest("[data-home-video]");
    if (!button || button.dataset.homeVideo === activeHomeVideoId) return;
    activeHomeVideoId = button.dataset.homeVideo;
    renderHomeVideos();
  });

  document.querySelectorAll(".view-button").forEach((button) => {
    button.addEventListener("click", () => {
      state.view = button.dataset.view;
      document.querySelectorAll(".view-button").forEach((item) => item.classList.toggle("is-active", item === button));
      renderStories();
    });
  });

  document.querySelectorAll(".range-button").forEach((button) => {
    button.addEventListener("click", () => {
      document.querySelectorAll(".range-button").forEach((item) => item.classList.toggle("is-active", item === button));
      renderChart(button.dataset.range);
    });
  });

  searchInput.addEventListener("input", (event) => {
    state.query = event.target.value;
    clearSearch.classList.toggle("is-visible", Boolean(state.query));
    renderStories();
    syncSearchUrl();
  });

  clearSearch.addEventListener("click", () => {
    searchInput.value = "";
    state.query = "";
    clearSearch.classList.remove("is-visible");
    searchInput.focus();
    renderStories();
    syncSearchUrl();
  });

  sortSelect.addEventListener("change", (event) => {
    state.sort = event.target.value;
    renderStories();
  });

  [[sourceFilter, "source"], [languageFilter, "language"], [periodFilter, "period"], [trustFilter, "trust"]].forEach(([control, key]) => {
    control.addEventListener("change", (event) => {
      state[key] = event.target.value;
      renderStories();
      syncSearchUrl();
    });
  });

  document.querySelector("#resetFilters").addEventListener("click", () => {
    state.source = "all";
    state.language = "all";
    state.period = "all";
    state.trust = "all";
    state.query = "";
    searchInput.value = "";
    clearSearch.classList.remove("is-visible");
    setCategory("全部");
    renderStories();
    syncSearchUrl();
  });

  storyGrid.addEventListener("click", (event) => {
    const button = event.target.closest("[data-bookmark]");
    if (!button) return;
    const id = Number(button.dataset.bookmark);
    if (state.saved.has(id)) {
      state.saved.delete(id);
      showToast("已取消收藏");
    } else {
      state.saved.add(id);
      showToast("已加入收藏");
    }
    localStorage.setItem(SAVED_KEY, JSON.stringify([...state.saved]));
    renderStories();
  });

  document.querySelector("#briefingToggle").addEventListener("click", (event) => {
    const nextState = event.currentTarget.getAttribute("aria-checked") !== "true";
    event.currentTarget.setAttribute("aria-checked", String(nextState));
    showToast(nextState ? "产业简报已开启" : "产业简报已关闭");
  });

  document.querySelector("#refreshSignals").addEventListener("click", (event) => {
    const icon = event.currentTarget.querySelector("svg");
    icon?.animate([{ transform: "rotate(0deg)" }, { transform: "rotate(360deg)" }], { duration: 520 });
    const score = document.querySelector(".donut strong");
    score.textContent = String(Math.min(99, Number(score.textContent || 72) + 2));
    showToast("领域热度已刷新");
  });

  document.querySelector("#themeToggle").addEventListener("click", (event) => {
    document.body.classList.toggle("light");
    const isLight = document.body.classList.contains("light");
    event.currentTarget.innerHTML = `<i data-lucide="${isLight ? "moon" : "sun"}"></i>`;
    initializeIcons();
  });
}

async function init() {
  content = await loadContent();
  stories = content.stories || [];
  chartSeries = content.chartSeries || {};
  const requestedCategory = new URLSearchParams(location.search).get("category");
  const requestedQuery = new URLSearchParams(location.search).get("q") || "";
  const params = new URLSearchParams(location.search);
  const visibleCategories = getCategorySettings().filter((item) => item.enabled !== false).map((item) => item.name);
  if (requestedCategory && visibleCategories.includes(requestedCategory)) {
    const categoryParams = new URLSearchParams({ category: requestedCategory });
    if (requestedQuery) categoryParams.set("q", requestedQuery);
    location.replace("category.html?" + categoryParams.toString());
    return;
  }
  if (content.operations?.searchEnabled !== false && requestedQuery) {
    state.query = requestedQuery;
    searchInput.value = requestedQuery;
    clearSearch.classList.add("is-visible");
  }
  const allowedPeriods = ["all", "24h", "7d", "30d"];
  const allowedTrust = ["all", "high", "standard", "low"];
  const allowedLanguages = ["all", "zh-CN", "en", "multi"];
  state.source = params.get("source") || "all";
  state.language = allowedLanguages.includes(params.get("language")) ? params.get("language") : "all";
  state.period = allowedPeriods.includes(params.get("period")) ? params.get("period") : "all";
  state.trust = allowedTrust.includes(params.get("trust")) ? params.get("trust") : "all";
  applyTheme();
  applySiteContent();
  renderNav();
  renderDiscovery();
  renderMetrics();
  renderFeatured();
  renderHomeVideos();
  renderSignals();
  renderTopics();
  renderEvents();
  renderStories();
  renderChart("24h");
  updateClock();
  bindStaticEvents();
  initializeIcons();
}

window.addEventListener("fxcontentupdate", (event) => {
  if (!event.detail?.stories) return;
  content = event.detail;
  stories = content.stories;
  chartSeries = content.chartSeries || {};
  applyTheme();
  applySiteContent();
  renderNav();
  renderDiscovery();
  renderMetrics();
  renderFeatured();
  renderHomeVideos();
  renderSignals();
  renderTopics();
  renderEvents();
  renderStories();
  renderChart("24h");
});

init();
window.setInterval(updateClock, 1000);
window.addEventListener("load", initializeIcons);
