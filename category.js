const CATEGORY_CONTENT_URL = "data/content.json";

const CATEGORY_COPY = {
  "金融": { description: "追踪金融基础设施、监管变化、支付体系与宏观政策中的关键公开信息。", image: "assets/network.jpg", icon: "landmark" },
  "科技": { description: "聚焦人工智能、算力、芯片、科研方法与新兴技术的可验证进展。", image: "assets/datacenter.jpg", icon: "cpu" },
  "工业": { description: "关注制造体系、自动化、供应链、工程能力与工业数字化的实际变化。", image: "assets/factory.jpg", icon: "factory" },
  "能源": { description: "整理电力系统、储能、能源贸易、清洁技术与基础设施的前沿资料。", image: "assets/energy.jpg", icon: "battery-charging" },
  "农业": { description: "连接农业科研、育种、农机、数据治理与可持续生产中的公开知识。", image: "assets/solar.jpg", icon: "sprout" },
  "人文": { description: "汇集文化遗产、教育、历史、艺术与社会研究中的重要发现和讨论。", image: "assets/semiconductor.jpg", icon: "book-open" }
};

let categoryContent = null;
let activeCategory = "";

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

function visibleCategoryStories() {
  return (categoryContent?.stories || []).filter(function (story) {
    const body = Array.isArray(story.body) ? story.body.join("\n") : String(story.body || "");
    return story.category === activeCategory
      && body.replace(/\s/g, "").length >= 800
      && (!story.status || story.status === "published" || (story.status === "scheduled" && new Date(story.scheduledAt).getTime() <= Date.now()));
  }).sort(function (left, right) {
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
  const fallback = story.imageFallback || CATEGORY_COPY[activeCategory].image;
  return `<article class="story-card" style="--category-color:${safeCategoryColor(activeSetting().color)}">
    <div class="story-image"><a href="article.html?id=${encodeURIComponent(story.id)}" aria-label="阅读：${escapeCategoryHtml(story.title)}"><img src="${escapeCategoryHtml(story.image || fallback)}" alt="${escapeCategoryHtml(story.title)}" loading="lazy" referrerpolicy="no-referrer" onerror="this.onerror=null;this.src='${escapeCategoryHtml(fallback)}'"></a><span class="story-index">${String(index + 1).padStart(2, "0")}</span></div>
    <div class="story-body"><div class="story-meta"><span class="category-tag">${escapeCategoryHtml(activeCategory)}</span><span>${Number(story.readMinutes || 6)} 分钟阅读</span></div><h3><a href="article.html?id=${encodeURIComponent(story.id)}">${escapeCategoryHtml(story.title)}</a></h3><p>${escapeCategoryHtml(story.excerpt)}</p><div class="story-foot"><div class="story-source"><i class="source-mark"></i><span>${escapeCategoryHtml(sourceLabel(story.source))}</span><span>·</span><time>${escapeCategoryHtml(story.date || "最新")}</time></div></div></div>
  </article>`;
}

function renderCategoryNav() {
  const categories = (categoryContent?.categorySettings || []).filter(function (item) { return item.enabled !== false; });
  document.querySelector("#categoryNav").innerHTML = `<a class="nav-tab" href="index.html">总览</a>` + categories.map(function (item) {
    const active = item.name === activeCategory ? " is-active" : "";
    return `<a class="nav-tab${active}" href="category.html?category=${encodeURIComponent(item.name)}" style="--category-color:${safeCategoryColor(item.color)}">${escapeCategoryHtml(item.name)}</a>`;
  }).join("");
}

function renderCategoryPage() {
  const available = (categoryContent?.categorySettings || []).filter(function (item) { return item.enabled !== false; });
  if (!available.some(function (item) { return item.name === activeCategory; })) activeCategory = available[0]?.name || "科技";
  const setting = activeSetting();
  const copy = CATEGORY_COPY[activeCategory] || CATEGORY_COPY["科技"];
  const stories = visibleCategoryStories();
  const sourceCount = new Set(stories.map(function (story) { return story.source; }).filter(Boolean)).size;
  const hero = document.querySelector("#categoryHero");
  hero.style.setProperty("--category-color", safeCategoryColor(setting.color));
  hero.style.setProperty("--category-image", `url("${copy.image}")`);
  document.title = `${activeCategory}板块 | 信息分享平台`;
  document.querySelector('meta[name="description"]').setAttribute("content", copy.description);
  document.querySelector("#categoryEyebrow").textContent = activeCategory + "板块";
  document.querySelector("#categoryTitle").textContent = activeCategory + "前沿资料库";
  document.querySelector("#categoryDescription").textContent = copy.description;
  document.querySelector("#categoryFeedTitle").textContent = activeCategory + "最新资料";
  document.querySelector("#categoryMetrics").innerHTML = `<div><strong>${stories.length}</strong><span>可阅读文章</span></div><div><strong>${sourceCount}</strong><span>公开来源</span></div><div><strong>${copy.icon ? "持续" : ""}</strong><span>每日自动更新</span></div>`;
  document.querySelector("#categoryStories").innerHTML = stories.map(storyCard).join("");
  const empty = document.querySelector("#categoryEmpty");
  empty.hidden = stories.length !== 0;
  document.querySelector("#categoryCount").textContent = stories.length ? `${stories.length} 篇可阅读内容` : "正在同步内容";
  if (window.lucide) window.lucide.createIcons({ attrs: { "stroke-width": 1.7 } });
}

async function initCategoryPage() {
  const requested = new URLSearchParams(location.search).get("category");
  categoryContent = await window.FXContent.load(CATEGORY_CONTENT_URL, { background: true });
  activeCategory = requested || categoryContent?.categories?.[0] || "科技";
  renderCategoryNav();
  renderCategoryPage();
}

window.addEventListener("fxcontentupdate", function (event) {
  if (!event.detail?.stories) return;
  categoryContent = event.detail;
  renderCategoryNav();
  renderCategoryPage();
});

initCategoryPage();
