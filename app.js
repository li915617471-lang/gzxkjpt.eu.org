const CONTENT_URL = "data/content.json";
const ADMIN_CONTENT_KEY = "fx-admin-content";
const SAVED_KEY = "fx-saved";

let content = null;
let stories = [];
let chartSeries = {};
let homeVideos = [];
let activeHomeVideoId = "";
let activeHomeVideoHls = null;
let homeVideoLoadToken = 0;
let activeChartRange = "24h";

const fallbackContent = {
  site: {
    name: "信息分享平台",
    subtitle: "全球前沿知识索引",
    heroTitle: "最新文章与前沿资料",
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
  visibleCount: 12,
  saved: new Set(JSON.parse(localStorage.getItem(SAVED_KEY) || "[]"))
};

const storyGrid = document.querySelector("#stories");
const resultCount = document.querySelector("#resultCount");
const emptyState = document.querySelector("#emptyState");
const searchInput = document.querySelector("#searchInput");
const clearSearch = document.querySelector("#clearSearch");
const externalSearchLauncher = document.querySelector("#externalSearchLauncher");
const sortSelect = document.querySelector("#sortSelect");
const sourceFilter = document.querySelector("#sourceFilter");
const languageFilter = document.querySelector("#languageFilter");
const periodFilter = document.querySelector("#periodFilter");
const trustFilter = document.querySelector("#trustFilter");
const loadMoreStories = document.querySelector("#loadMoreStories");
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
  if (window.FXContent?.isChinesePublicStory && !window.FXContent.isChinesePublicStory(story)) return false;
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
  document.querySelector(".brand-copy small").textContent = /[\u3400-\u9fff]/.test(site.subtitle || "")
    ? site.subtitle
    : "全球前沿知识索引";
  document.querySelector(".brand").setAttribute("aria-label", `${site.name}首页`);
  const homepageTitle = site.heroTitle === "全球前沿知识观察台"
    ? "最新文章与前沿资料"
    : site.heroTitle;
  document.querySelector("#pulseTitle").textContent = homepageTitle;
  document.querySelector(".pulse-heading p").textContent = "文章优先呈现，来源资料每日自动同步；数据统计仅作为阅读辅助";
  document.querySelector(".footer-brand").innerHTML = `${escapeHtml(site.name)} <span>知识索引 / 2026</span>`;
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
  sourceFilter.innerHTML = `<option value="all">全部来源</option>${sources.map((source) => `<option value="${escapeHtml(source)}">${escapeHtml(window.FXContent.localizedSourceName(source))}</option>`).join("")}`;
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
    if (type === "external") return Boolean(cctvVideoId(story));
    return type === "file" && /\.(mp4|webm|ogg)$/i.test(url.pathname);
  } catch (error) {
    return false;
  }
}

function cctvVideoId(story) {
  const externalId = String(story.videoExternalId || "").trim();
  if (!/^[a-f0-9]{32}$/i.test(externalId)) return "";
  try {
    const url = new URL(String(story.videoUrl || story.sourceUrl || ""));
    return url.hostname === "tv.cctv.com" ? externalId : "";
  } catch (error) {
    return "";
  }
}

function getHomeVideos() {
  const publishedVideos = stories
    .filter((story) => storyIsPublic(story) && story.homeVideoFeatured !== false && validHomeVideo(story))
    .sort((a, b) => {
      const priority = Number(b.homeVideoPriority ?? 50) - Number(a.homeVideoPriority ?? 50);
      if (priority) return priority;
      return new Date(b.date || 0).getTime() - new Date(a.date || 0).getTime();
    })
    .map((story) => {
      const cctvId = cctvVideoId(story);
      return {
        id: `story-${story.id}`,
        storyId: story.id,
        title: story.title,
        description: window.FXContent.presentationExcerpt(story),
        category: story.category,
        source: story.source,
        sourceUrl: story.sourceUrl || "",
        videoType: cctvId ? "cctv" : story.videoType,
        videoExternalId: cctvId,
        videoUrl: story.videoUrl,
        videoPoster: story.videoPoster || story.image || story.imageFallback || "assets/network.jpg"
      };
    });
  const selectedVideos = [];
  const selectedIds = new Set();
  const representedSources = new Set();
  publishedVideos.forEach((video) => {
    const sourceKey = String(video.source || "").trim();
    if (selectedVideos.length >= 5 || !sourceKey || representedSources.has(sourceKey)) return;
    selectedVideos.push(video);
    selectedIds.add(video.id);
    representedSources.add(sourceKey);
  });
  publishedVideos.forEach((video) => {
    if (selectedVideos.length >= 5 || selectedIds.has(video.id)) return;
    selectedVideos.push(video);
  });
  return selectedVideos.concat({
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

function destroyHomeVideoHls() {
  activeHomeVideoHls?.destroy();
  activeHomeVideoHls = null;
}

function showHomeVideoFallback(screen, video, message) {
  if (!screen.isConnected) return;
  destroyHomeVideoHls();
  [...screen.children].forEach((element) => {
    if (!element.matches("[data-video-expand]")) element.remove();
  });
  const preview = document.createElement("a");
  preview.className = "home-video-external";
  preview.href = video.sourceUrl || video.videoUrl;
  preview.target = "_blank";
  preview.rel = "noopener noreferrer";
  preview.innerHTML = `<img src="${escapeHtml(video.videoPoster)}" data-image-fallback="assets/network.jpg" alt="${escapeHtml(video.title)}"><span><i data-lucide="external-link"></i>${escapeHtml(message)}</span>`;
  screen.prepend(preview);
  attachImageFallbacks(screen);
  initializeIcons();
}

async function loadCctvVideo(video, player, loading, screen, token) {
  try {
    const endpoint = `https://vdn.apps.cntv.cn/api/getHttpVideoInfo.do?pid=${encodeURIComponent(video.videoExternalId)}`;
    const response = await fetch(endpoint);
    if (!response.ok) throw new Error(`CCTV video API returned ${response.status}`);
    const payload = await response.json();
    const streamUrl = String(payload.hls_url || "").trim();
    if (payload.ack !== "yes" || payload.play === "0" || !streamUrl.startsWith("https://")) {
      throw new Error("CCTV video stream is unavailable");
    }
    if (token !== homeVideoLoadToken || !player.isConnected) return;

    const playbackUrl = new URL(streamUrl);
    const currentMaxBitrate = Number(playbackUrl.searchParams.get("maxbr") || 0);
    if (currentMaxBitrate && currentMaxBitrate < 4096) playbackUrl.searchParams.set("maxbr", "4096");
    if (player.canPlayType("application/vnd.apple.mpegurl")) {
      player.src = playbackUrl.href;
      loading.remove();
      return;
    }
    if (!window.Hls?.isSupported()) throw new Error("HLS playback is unsupported");

    const hls = new window.Hls({
      capLevelToPlayerSize: true,
      enableWorker: true,
      maxBufferLength: 30
    });
    activeHomeVideoHls = hls;
    let recoveryAttempts = 0;
    hls.on(window.Hls.Events.MANIFEST_PARSED, () => loading.remove());
    hls.on(window.Hls.Events.ERROR, (_event, data) => {
      if (!data.fatal || token !== homeVideoLoadToken) return;
      recoveryAttempts += 1;
      if (recoveryAttempts <= 2 && data.type === window.Hls.ErrorTypes.NETWORK_ERROR) {
        hls.startLoad();
      } else if (recoveryAttempts <= 2 && data.type === window.Hls.ErrorTypes.MEDIA_ERROR) {
        hls.recoverMediaError();
      } else {
        showHomeVideoFallback(screen, video, "播放失败，前往央视观看");
      }
    });
    hls.loadSource(playbackUrl.href);
    hls.attachMedia(player);
  } catch (error) {
    if (token === homeVideoLoadToken) showHomeVideoFallback(screen, video, "前往央视官方页面播放");
  }
}

function renderHomeVideoScreen(video) {
  const screen = document.querySelector("#homeVideoScreen");
  destroyHomeVideoHls();
  const token = ++homeVideoLoadToken;
  screen.innerHTML = "";
  if (video.videoType === "bilibili") {
    const frame = document.createElement("iframe");
    frame.src = bilibiliPlayerUrl(video.videoUrl);
    frame.title = `${video.title} 视频`;
    frame.loading = "lazy";
    frame.allow = "autoplay; fullscreen; picture-in-picture";
    frame.allowFullscreen = true;
    screen.appendChild(frame);
  } else if (video.videoType === "file" || video.videoType === "cctv") {
    const player = document.createElement("video");
    player.controls = true;
    player.playsInline = true;
    player.preload = "metadata";
    player.poster = video.videoPoster;
    player.setAttribute("controlsList", "nodownload");
    screen.appendChild(player);
    if (video.videoType === "cctv") {
      const loading = document.createElement("div");
      loading.className = "home-video-loading";
      loading.innerHTML = '<i data-lucide="loader-circle"></i><span>正在连接央视官方视频</span>';
      screen.appendChild(loading);
      loadCctvVideo(video, player, loading, screen, token);
    } else {
      const source = document.createElement("source");
      source.src = video.videoUrl;
      source.type = video.videoUrl.toLowerCase().includes(".webm") ? "video/webm" : "video/mp4";
      player.appendChild(source);
      player.append("您的浏览器暂不支持此视频格式。");
    }
  } else {
    const preview = document.createElement("a");
    preview.className = "home-video-external";
    preview.href = video.sourceUrl || video.videoUrl;
    preview.target = "_blank";
    preview.rel = "noopener noreferrer";
    preview.innerHTML = `<img src="${escapeHtml(video.videoPoster)}" data-image-fallback="assets/network.jpg" alt="${escapeHtml(video.title)}"><span><i data-lucide="external-link"></i>前往官方页面播放</span>`;
    screen.appendChild(preview);
    attachImageFallbacks(screen);
  }
  const expand = document.createElement("button");
  expand.className = "home-video-expand";
  expand.type = "button";
  expand.dataset.videoExpand = "true";
  expand.setAttribute("aria-label", "放大视频窗口");
  expand.title = "放大视频窗口";
  expand.innerHTML = '<i data-lucide="maximize-2"></i>';
  screen.appendChild(expand);
}

async function toggleHomeVideoFullscreen() {
  const screen = document.querySelector("#homeVideoScreen");
  try {
    if (document.fullscreenElement === screen) await document.exitFullscreen();
    else if (screen.requestFullscreen) await screen.requestFullscreen();
  } catch (error) {
    showToast("当前浏览器无法放大视频窗口");
  }
}

function renderHomeVideos() {
  homeVideos = getHomeVideos();
  if (!homeVideos.some((video) => video.id === activeHomeVideoId)) activeHomeVideoId = homeVideos[0]?.id || "";
  const active = homeVideos.find((video) => video.id === activeHomeVideoId) || homeVideos[0];
  if (!active) return;
  renderHomeVideoScreen(active);
  document.querySelector("#homeVideoCategory").textContent = active.category;
  const videoKind = { cctv: "央视高清播放", bilibili: "哔哩哔哩播放", file: "站内视频" };
  document.querySelector("#homeVideoKind").textContent = videoKind[active.videoType] || "视频资料";
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
      <span class="home-video-copy"><small>${escapeHtml(video.category)} · ${String(index + 1).padStart(2, "0")}</small><strong>${escapeHtml(video.title)}</strong><em>${escapeHtml(window.FXContent.localizedSourceName(video.source))}</em></span>
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

function pulseStoryTimestamp(story) {
  const candidates = [story.collectedAt, story.originalPublishedAt, story.date];
  for (const candidate of candidates) {
    const timestamp = new Date(candidate || 0).getTime();
    if (Number.isFinite(timestamp) && timestamp > 0) return timestamp;
  }
  return 0;
}

function storiesInWindow(publicStories, start, end = Date.now()) {
  return publicStories.filter((story) => {
    const timestamp = pulseStoryTimestamp(story);
    return timestamp >= start && timestamp < end;
  });
}

function periodTrend(current, previous) {
  const difference = current - previous;
  if (!difference) return { label: "与前期持平", direction: "neutral", icon: "minus" };
  return {
    label: `较前期 ${difference > 0 ? "+" : ""}${difference}`,
    direction: difference > 0 ? "positive" : "negative",
    icon: difference > 0 ? "trending-up" : "trending-down"
  };
}

function pulseRangeSeries(publicStories, range) {
  const config = {
    "24h": { duration: 24 * 60 * 60 * 1000, buckets: 12, label: "近24小时" },
    "7d": { duration: 7 * 24 * 60 * 60 * 1000, buckets: 7, label: "近7日" },
    "30d": { duration: 30 * 24 * 60 * 60 * 1000, buckets: 15, label: "近30日" }
  }[range];
  const now = Date.now();
  const start = now - config.duration;
  const bucketSize = config.duration / config.buckets;
  const values = Array.from({ length: config.buckets }, () => 0);
  publicStories.forEach((story) => {
    const timestamp = pulseStoryTimestamp(story);
    if (timestamp < start || timestamp > now) return;
    const index = Math.min(config.buckets - 1, Math.floor((timestamp - start) / bucketSize));
    values[index] += 1;
  });
  const current = values.reduce((sum, value) => sum + value, 0);
  const previous = storiesInWindow(publicStories, start - config.duration, start).length;
  const trend = periodTrend(current, previous);
  const labels = Array.from({ length: 7 }, (_, index) => {
    const time = new Date(start + (config.duration * index / 6));
    if (range === "24h") return `${String(time.getHours()).padStart(2, "0")}:00`;
    if (range === "7d") return new Intl.DateTimeFormat("zh-CN", { weekday: "short" }).format(time);
    return `${String(time.getMonth() + 1).padStart(2, "0")}.${String(time.getDate()).padStart(2, "0")}`;
  });
  return {
    values: values,
    labels: labels,
    value: `${current} 条`,
    delta: trend.label,
    direction: trend.direction,
    label: `${config.label}内容更新`
  };
}

function pulseFreshnessLabel(publicStories) {
  const latest = Math.max(0, ...publicStories.map(pulseStoryTimestamp));
  if (!latest) return "平台实时计算 · 等待来源同步";
  const minutes = Math.max(0, Math.floor((Date.now() - latest) / 60000));
  if (minutes < 60) return `平台实时计算 · ${Math.max(1, minutes)} 分钟内有更新`;
  if (minutes < 24 * 60) return `平台实时计算 · ${Math.floor(minutes / 60)} 小时内有更新`;
  return `平台实时计算 · 最近更新 ${new Intl.DateTimeFormat("zh-CN", { month: "2-digit", day: "2-digit" }).format(new Date(latest))}`;
}

function renderCategoryPulse(publicStories) {
  const categories = getCategorySettings().filter((item) => item.enabled !== false);
  const recentStart = Date.now() - 30 * 24 * 60 * 60 * 1000;
  const recentStories = storiesInWindow(publicStories, recentStart);
  const basis = recentStories.length ? recentStories : publicStories;
  const counts = categories.map((category) => ({
    category: category,
    count: basis.filter((story) => story.category === category.name).length
  }));
  const maximum = Math.max(1, ...counts.map((item) => item.count));
  document.querySelector("#pulseCategoryBars").innerHTML = counts.map((item) => `
    <a class="pulse-category-item" href="category.html?category=${encodeURIComponent(item.category.name)}" style="--category-color:${safeColor(item.category.color)};--activity:${Math.max(6, Math.round(item.count / maximum * 100))}%">
      <span>${escapeHtml(item.category.name)}<strong>${item.count}</strong></span>
      <span class="pulse-category-track"><i></i></span>
    </a>
  `).join("");
  document.querySelector("#pulseCoverage").textContent = recentStories.length
    ? `近30日 ${recentStories.length} 条公开内容`
    : `当前 ${publicStories.length} 条公开内容`;
}

function renderMetrics() {
  const publicStories = stories.filter(storyIsPublic);
  const now = Date.now();
  const recent24 = storiesInWindow(publicStories, now - 24 * 60 * 60 * 1000).length;
  const previous24 = storiesInWindow(publicStories, now - 48 * 60 * 60 * 1000, now - 24 * 60 * 60 * 1000).length;
  const recent7 = storiesInWindow(publicStories, now - 7 * 24 * 60 * 60 * 1000).length;
  const previous7 = storiesInWindow(publicStories, now - 14 * 24 * 60 * 60 * 1000, now - 7 * 24 * 60 * 60 * 1000).length;
  const trustedSources = new Set(publicStories.filter((story) =>
    ["authoritative", "professional"].includes(story.sourceTrustLevel) || Number(story.confidence || 0) >= 85
  ).map((story) => story.source).filter(Boolean));
  const categories = getCategorySettings().filter((item) => item.enabled !== false);
  const coveredCategories = new Set(publicStories.map((story) => story.category)).size;
  const videoCount = publicStories.filter(validHomeVideo).length;
  const averageConfidence = publicStories.length
    ? Math.round(publicStories.reduce((sum, story) => sum + Number(story.confidence || 0), 0) / publicStories.length)
    : 0;
  const trend24 = periodTrend(recent24, previous24);
  const trend7 = periodTrend(recent7, previous7);
  const metrics = [
    { label: "近24小时新增", value: String(recent24), trend: trend24.label, direction: trend24.direction, trendIcon: trend24.icon, caption: "当前公开内容", icon: "radio-tower" },
    { label: "近7日新增", value: String(recent7), trend: trend7.label, direction: trend7.direction, trendIcon: trend7.icon, caption: "滚动时间窗口", icon: "calendar-range" },
    { label: "权威来源", value: String(trustedSources.size), trend: "通过来源核验", direction: "positive", trendIcon: "shield-check", caption: "高可信公开机构", icon: "landmark" },
    { label: "板块覆盖", value: `${coveredCategories}/${categories.length}`, trend: "动态归类", direction: "neutral", trendIcon: "network", caption: "当前启用板块", icon: "layout-dashboard" },
    { label: "科普视频", value: String(videoCount), trend: "官方链接", direction: "neutral", trendIcon: "play", caption: "已确认展示权限", icon: "video" },
    { label: "平均可信度", value: `${averageConfidence}%`, trend: "自动审核", direction: averageConfidence >= 85 ? "positive" : "neutral", trendIcon: "scan-search", caption: "公开内容平均值", icon: "badge-check" }
  ];
  chartSeries = {
    "24h": pulseRangeSeries(publicStories, "24h"),
    "7d": pulseRangeSeries(publicStories, "7d"),
    "30d": pulseRangeSeries(publicStories, "30d")
  };
  document.querySelector("#pulseFreshness").textContent = pulseFreshnessLabel(publicStories);
  renderCategoryPulse(publicStories);
  const grid = document.querySelector(".metrics-grid");
  grid.innerHTML = metrics
    .map((metric) => `
      <article class="metric">
        <div class="metric-label"><i data-lucide="${escapeHtml(metric.icon || "activity")}"></i><span>${escapeHtml(metric.label)}</span></div>
        <strong>${escapeHtml(metric.value)}</strong>
        <span class="metric-trend ${escapeHtml(metric.direction || "neutral")}"><i data-lucide="${escapeHtml(metric.trendIcon || "activity")}"></i> ${escapeHtml(metric.trend)}</span>
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
            <span>${escapeHtml(window.FXContent.localizedSourceName(story.source))}</span>
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
  const renderedStories = visibleStories.slice(0, state.visibleCount);
  document.querySelector("#feedTitle").textContent = state.category === "全部" ? "今日聚合" : `${state.category}前沿`;
  storyGrid.classList.toggle("is-list", state.view === "list");
  storyGrid.innerHTML = renderedStories.map(storyTemplate).join("");
  attachImageFallbacks(storyGrid);
  const waitingForCloud = visibleStories.length === 0 && !window.FXContent?.readPublicCache?.();
  loadMoreStories.hidden = waitingForCloud || renderedStories.length >= visibleStories.length;
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
  state.visibleCount = 12;
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

function suggestedExternalSearchCategory(query) {
  const text = String(query || "").toLowerCase();
  const preferred = state.category !== "全部" ? state.category : "";
  let best = { name: preferred || "科技", score: preferred ? 1 : 0 };
  getCategorySettings().filter((item) => item.enabled !== false).forEach((item) => {
    const terms = [item.name].concat(Array.isArray(item.keywords) ? item.keywords : []);
    const score = terms.reduce((total, term) => total + (term && text.includes(String(term).toLowerCase()) ? 1 : 0), 0);
    if (score > best.score) best = { name: item.name, score: score };
  });
  return best.name;
}

function openExternalAuthoritySearch() {
  const query = searchInput.value.trim();
  if (query.length < 2) {
    showToast("请先输入至少两个字的搜索词");
    searchInput.focus();
    return;
  }
  const params = new URLSearchParams({
    category: suggestedExternalSearchCategory(query),
    q: query,
    scope: "authority"
  });
  location.href = "category.html?" + params.toString();
}

function renderChart(range) {
  const series = chartSeries[range] || chartSeries["24h"];
  if (!series) return;
  activeChartRange = range;
  const width = 620;
  const height = 150;
  const inset = 10;
  const rawMin = Math.min(...series.values);
  const rawMax = Math.max(...series.values);
  const spread = Math.max(1, rawMax - rawMin);
  const min = Math.max(0, rawMin - spread * 0.2);
  const max = rawMax + spread * 0.2;
  const points = series.values.map((value, index) => {
    const x = (index / Math.max(1, series.values.length - 1)) * width;
    const y = height - inset - ((value - min) / (max - min)) * (height - inset * 2);
    return { x, y };
  });

  const line = document.querySelector("#chartLine");
  line.setAttribute("points", points.map(({ x, y }) => `${x},${y}`).join(" "));
  line.style.animation = "none";
  line.getBoundingClientRect();
  line.style.animation = "";
  document.querySelector("#chartArea").setAttribute(
    "d",
    `M 0 ${height} L ${points.map(({ x, y }) => `${x} ${y}`).join(" L ")} L ${width} ${height} Z`
  );
  document.querySelector("#chartDots").innerHTML = points
    .filter((_, index) => index === points.length - 1 || index % 3 === 0)
    .map(({ x, y }) => `<circle class="chart-dot" cx="${x}" cy="${y}" r="3.5"></circle>`)
    .join("");
  document.querySelector("#chartLabels").innerHTML = series.labels.map((label) => `<span>${escapeHtml(label)}</span>`).join("");
  document.querySelector("#chartMetricLabel").textContent = series.label || "内容更新活跃度";
  document.querySelector("#chartValue").textContent = series.value;
  const delta = document.querySelector("#chartDelta");
  delta.textContent = series.delta;
  delta.className = series.direction || "neutral";
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
  const videoScreen = document.querySelector("#homeVideoScreen");
  videoScreen.addEventListener("click", (event) => {
    if (!event.target.closest("[data-video-expand]")) return;
    toggleHomeVideoFullscreen();
  });
  videoScreen.addEventListener("dblclick", (event) => {
    if (event.target.closest("button")) return;
    event.preventDefault();
    toggleHomeVideoFullscreen();
  }, true);
  document.addEventListener("fullscreenchange", () => {
    const button = document.querySelector("[data-video-expand]");
    if (!button) return;
    const expanded = document.fullscreenElement === videoScreen;
    button.setAttribute("aria-label", expanded ? "退出放大视频窗口" : "放大视频窗口");
    button.title = expanded ? "退出放大视频窗口" : "放大视频窗口";
    button.innerHTML = `<i data-lucide="${expanded ? "minimize-2" : "maximize-2"}"></i>`;
    initializeIcons();
  });

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
      activeChartRange = button.dataset.range;
      document.querySelectorAll(".range-button").forEach((item) => item.classList.toggle("is-active", item === button));
      renderChart(activeChartRange);
    });
  });

  searchInput.addEventListener("input", (event) => {
    state.query = event.target.value;
    state.visibleCount = 12;
    clearSearch.classList.toggle("is-visible", Boolean(state.query));
    renderStories();
    syncSearchUrl();
  });

  clearSearch.addEventListener("click", () => {
    searchInput.value = "";
    state.query = "";
    state.visibleCount = 12;
    clearSearch.classList.remove("is-visible");
    searchInput.focus();
    renderStories();
    syncSearchUrl();
  });

  sortSelect.addEventListener("change", (event) => {
    state.sort = event.target.value;
    state.visibleCount = 12;
    renderStories();
  });

  [[sourceFilter, "source"], [languageFilter, "language"], [periodFilter, "period"], [trustFilter, "trust"]].forEach(([control, key]) => {
    control.addEventListener("change", (event) => {
      state[key] = event.target.value;
      state.visibleCount = 12;
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
    state.visibleCount = 12;
    searchInput.value = "";
    clearSearch.classList.remove("is-visible");
    setCategory("全部");
    renderStories();
    syncSearchUrl();
  });

  externalSearchLauncher?.addEventListener("click", openExternalAuthoritySearch);

  loadMoreStories.addEventListener("click", () => {
    state.visibleCount += 12;
    renderStories();
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
  renderChart(activeChartRange);
  updateClock();
  bindStaticEvents();
  initializeIcons();
}

window.addEventListener("fxcontentupdate", (event) => {
  if (!event.detail?.stories) return;
  content = event.detail;
  stories = content.stories;
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
  renderChart(activeChartRange);
});

init();
window.setInterval(updateClock, 1000);
window.addEventListener("load", initializeIcons);
