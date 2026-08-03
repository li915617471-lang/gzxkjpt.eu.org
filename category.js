const CATEGORY_CONTENT_URL = "data/content.json";

const CATEGORY_COPY = {
  "金融": { description: "追踪金融基础设施、监管变化、支付体系与宏观政策中的关键公开信息。", image: "assets/network.jpg", focus: ["数字金融", "支付", "监管", "宏观经济"] },
  "科技": { description: "聚焦人工智能、算力、芯片、科研方法与新兴技术的可验证进展。", image: "assets/datacenter.jpg", focus: ["人工智能", "芯片", "算力", "科研"] },
  "工业": { description: "关注制造体系、自动化、供应链、工程能力与工业数字化的实际变化。", image: "assets/factory.jpg", focus: ["制造", "工业软件", "机器人", "供应链"] },
  "能源": { description: "整理电力系统、储能、能源贸易、清洁技术与基础设施的前沿资料。", image: "assets/energy.jpg", focus: ["电力", "储能", "清洁能源", "能源市场"] },
  "农业": { description: "连接农业科研、育种、农机、数据治理与可持续生产中的公开知识。", image: "assets/solar.jpg", focus: ["智慧农业", "育种", "农机", "可持续"] },
  "人文": { description: "汇集文化遗产、教育、历史、艺术与社会研究中的重要发现和讨论。", image: "assets/semiconductor.jpg", focus: ["文化", "教育", "历史", "艺术"] }
};

let categoryContent = null;
let activeCategory = "";
let categoryQuery = "";
let categorySort = "latest";

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
  const name = String(value || "").trim();
  return /^[\x00-\x7f\s.,&'()/-]+$/.test(name) ? "权威公开来源" : (name || "公开来源");
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
  document.querySelector(".brand-copy small").textContent = categoryContent?.site?.subtitle || "GLOBAL KNOWLEDGE INDEX";
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
  document.querySelector("#categoryFeedTitle").textContent = activeCategory + "最新资料";
  document.querySelector("#categoryMetrics").innerHTML = `<div><strong>${totalStories.length}</strong><span>可阅读文章</span></div><div><strong>${sourceCount}</strong><span>公开来源</span></div><div><strong>持续</strong><span>每日自动更新</span></div>`;
  document.querySelector("#categoryStories").innerHTML = stories.map(storyCard).join("");
  attachCategoryImageFallbacks();
  const empty = document.querySelector("#categoryEmpty");
  empty.hidden = stories.length !== 0;
  empty.querySelector("strong").textContent = categoryQuery ? "没有匹配的内容" : "正在同步内容";
  empty.querySelector("span").textContent = categoryQuery ? "尝试更换关键词" : "内容将在连接完成后自动显示";
  document.querySelector("#categoryCount").textContent = categoryQuery ? `${stories.length} / ${totalStories.length} 篇内容` : `${stories.length} 篇可阅读内容`;
  document.querySelector("#categorySearch").placeholder = `搜索${activeCategory}板块内容`;
  if (window.lucide) window.lucide.createIcons({ attrs: { "stroke-width": 1.7 } });
}

function syncCategoryUrl() {
  const params = new URLSearchParams({ category: activeCategory });
  if (categoryQuery.trim()) params.set("q", categoryQuery.trim());
  if (categorySort !== "latest") params.set("sort", categorySort);
  history.replaceState(null, "", "category.html?" + params.toString());
}

function bindCategoryEvents() {
  document.querySelector("#categorySearch").addEventListener("input", function (event) {
    categoryQuery = event.target.value;
    renderCategoryPage();
    syncCategoryUrl();
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
    document.querySelector("#categorySearch").focus();
  });
}

async function initCategoryPage() {
  const params = new URLSearchParams(location.search);
  const requested = params.get("category");
  categoryContent = await window.FXContent.load(CATEGORY_CONTENT_URL, { background: true });
  activeCategory = requested || categoryContent?.categories?.[0] || "科技";
  categoryQuery = params.get("q") || "";
  categorySort = ["latest", "hot", "depth"].includes(params.get("sort")) ? params.get("sort") : "latest";
  document.querySelector("#categorySearch").value = categoryQuery;
  document.querySelector("#categorySort").value = categorySort;
  applyCategoryTheme();
  renderCategoryNav();
  renderCategoryPage();
  bindCategoryEvents();
}

window.addEventListener("fxcontentupdate", function (event) {
  if (!event.detail?.stories) return;
  categoryContent = event.detail;
  applyCategoryTheme();
  renderCategoryNav();
  renderCategoryPage();
});

initCategoryPage();
