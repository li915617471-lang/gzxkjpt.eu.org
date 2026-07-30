const CONTENT_URL = "data/content.json";
const ADMIN_CONTENT_KEY = "fx-admin-content";
const ADMIN_FILES_KEY = "fx-admin-files";
const DRAFTS_KEY = "fx-admin-drafts";
const BACKUPS_KEY = "fx-admin-backups";
const REPORTS_KEY = "fx-content-reports";
const STORY_HISTORY_KEY = "fx-story-history";

let content = null;
let activeStoryId = null;
let uploadedFiles = [];
let drafts = [];
let reports = [];
let cloudMode = false;
let cloudSession = null;
let activeCategoryName = null;
let activeSourceId = null;
let cloudConnectionError = null;
let reportLoadError = null;

const DEFAULT_THEME = {
  background: "#090d10",
  surface: "#10161a",
  text: "#edf4f2",
  primary: "#6ee7a8",
  secondary: "#63cfe3",
  gridOpacity: 0.04
};

const STATUS_LABELS = {
  draft: "草稿",
  review: "待审核",
  scheduled: "定时发布",
  published: "已发布",
  archived: "已下架"
};

const STATUS_COLORS = {
  draft: "#8d9b9c",
  review: "#f0b85a",
  scheduled: "#63cfe3",
  published: "#6ee7a8",
  archived: "#f4776b"
};

const REPORT_TYPE_LABELS = {
  inaccuracy: "事实或表述错误",
  copyright: "版权或授权问题",
  source: "来源失效或不匹配",
  privacy: "隐私或个人信息",
  other: "其他问题"
};

const REPORT_STATUS_LABELS = {
  new: "新反馈",
  processing: "处理中",
  resolved: "已解决",
  rejected: "不予处理"
};

const REPORT_STATUS_COLORS = {
  new: "#f0b85a",
  processing: "#63cfe3",
  resolved: "#6ee7a8",
  rejected: "#8d9b9c"
};

const els = {
  statStories: document.querySelector("#statStories"),
  statCategories: document.querySelector("#statCategories"),
  statDrafts: document.querySelector("#statDrafts"),
  statReports: document.querySelector("#statReports"),
  statFiles: document.querySelector("#statFiles"),
  categoryList: document.querySelector("#categoryList"),
  categoryForm: document.querySelector("#categoryForm"),
  categoryOriginalName: document.querySelector("#categoryOriginalName"),
  categoryName: document.querySelector("#categoryName"),
  categoryColor: document.querySelector("#categoryColor"),
  categoryIcon: document.querySelector("#categoryIcon"),
  categoryEnabled: document.querySelector("#categoryEnabled"),
  categoryKeywords: document.querySelector("#categoryKeywords"),
  storyList: document.querySelector("#storyList"),
  storySearch: document.querySelector("#storySearch"),
  storyStatusFilter: document.querySelector("#storyStatusFilter"),
  storyForm: document.querySelector("#storyForm"),
  storyReviewGuidance: document.querySelector("#storyReviewGuidance"),
  storyQualityScore: document.querySelector("#storyQualityScore"),
  storyQualityBar: document.querySelector("#storyQualityBar"),
  storyQualityChecks: document.querySelector("#storyQualityChecks"),
  storyQualityNote: document.querySelector("#storyQualityNote"),
  storyHistoryFilter: document.querySelector("#storyHistoryFilter"),
  storyHistoryList: document.querySelector("#storyHistoryList"),
  storyId: document.querySelector("#storyId"),
  storyTitle: document.querySelector("#storyTitle"),
  storyCategory: document.querySelector("#storyCategory"),
  storySource: document.querySelector("#storySource"),
  storyStatus: document.querySelector("#storyStatus"),
  storyScheduledAt: document.querySelector("#storyScheduledAt"),
  storyConfidence: document.querySelector("#storyConfidence"),
  storyExcerpt: document.querySelector("#storyExcerpt"),
  storyBody: document.querySelector("#storyBody"),
  storyRead: document.querySelector("#storyRead"),
  storyHeat: document.querySelector("#storyHeat"),
  storyDate: document.querySelector("#storyDate"),
  storyAuthor: document.querySelector("#storyAuthor"),
  storyLanguage: document.querySelector("#storyLanguage"),
  storySourceUrl: document.querySelector("#storySourceUrl"),
  storyImage: document.querySelector("#storyImage"),
  storyTags: document.querySelector("#storyTags"),
  reportList: document.querySelector("#reportList"),
  reportQueueCount: document.querySelector("#reportQueueCount"),
  reportModeNote: document.querySelector("#reportModeNote"),
  reportStatusFilter: document.querySelector("#reportStatusFilter"),
  fileUpload: document.querySelector("#fileUpload"),
  fileList: document.querySelector("#fileList"),
  smartInput: document.querySelector("#smartInput"),
  draftFile: document.querySelector("#draftFile"),
  sourceList: document.querySelector("#sourceList"),
  sourceForm: document.querySelector("#sourceForm"),
  sourceId: document.querySelector("#sourceId"),
  sourceName: document.querySelector("#sourceName"),
  sourceUrl: document.querySelector("#sourceUrl"),
  sourceCategory: document.querySelector("#sourceCategory"),
  sourceType: document.querySelector("#sourceType"),
  sourceTrustLevel: document.querySelector("#sourceTrustLevel"),
  sourceRegion: document.querySelector("#sourceRegion"),
  sourceLanguage: document.querySelector("#sourceLanguage"),
  sourceEnabled: document.querySelector("#sourceEnabled"),
  sourceConfidence: document.querySelector("#sourceConfidence"),
  sourceMaxItems: document.querySelector("#sourceMaxItems"),
  sourceHealthSummary: document.querySelector("#sourceHealthSummary"),
  collectionStats: document.querySelector("#collectionStats"),
  collectionLogList: document.querySelector("#collectionLogList"),
  reviewQueueCount: document.querySelector("#reviewQueueCount"),
  operationsForm: document.querySelector("#operationsForm"),
  operationSiteUrl: document.querySelector("#operationSiteUrl"),
  operationContactEmail: document.querySelector("#operationContactEmail"),
  operationPublicNotice: document.querySelector("#operationPublicNotice"),
  operationLicense: document.querySelector("#operationLicense"),
  operationSearchEnabled: document.querySelector("#operationSearchEnabled"),
  operationAutoBackup: document.querySelector("#operationAutoBackup"),
  operationBackupLimit: document.querySelector("#operationBackupLimit"),
  backupList: document.querySelector("#backupList"),
  jsonFile: document.querySelector("#jsonFile"),
  authGate: document.querySelector("#authGate"),
  loginForm: document.querySelector("#loginForm"),
  loginEmail: document.querySelector("#loginEmail"),
  loginPassword: document.querySelector("#loginPassword"),
  loginMessage: document.querySelector("#loginMessage"),
  cloudStatus: document.querySelector("#cloudStatus"),
  cloudSetupForm: document.querySelector("#cloudSetupForm"),
  cloudProjectUrl: document.querySelector("#cloudProjectUrl"),
  cloudAnonKey: document.querySelector("#cloudAnonKey"),
  cloudContentId: document.querySelector("#cloudContentId"),
  cloudStorageBucket: document.querySelector("#cloudStorageBucket"),
  cloudEnabled: document.querySelector("#cloudEnabled"),
  cloudSetupBadge: document.querySelector("#cloudSetupBadge"),
  cloudSetupStatus: document.querySelector("#cloudSetupStatus"),
  signOut: document.querySelector("#signOut"),
  saveAll: document.querySelector("#saveAll"),
  siteForm: document.querySelector("#siteForm"),
  siteName: document.querySelector("#siteName"),
  siteSubtitle: document.querySelector("#siteSubtitle"),
  siteHeroTitle: document.querySelector("#siteHeroTitle"),
  siteHeroSubtitle: document.querySelector("#siteHeroSubtitle"),
  siteFooter: document.querySelector("#siteFooter"),
  themeBackground: document.querySelector("#themeBackground"),
  themeSurface: document.querySelector("#themeSurface"),
  themeText: document.querySelector("#themeText"),
  themePrimary: document.querySelector("#themePrimary"),
  themeSecondary: document.querySelector("#themeSecondary"),
  rawJson: document.querySelector("#rawJson"),
  toast: document.querySelector("#toast")
};

function initializeIcons() {
  if (window.lucide) window.lucide.createIcons({ attrs: { "stroke-width": 1.7 } });
}

function escapeHtml(value) {
  return String(value || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function showToast(message) {
  els.toast.textContent = message;
  els.toast.classList.add("is-visible");
  window.clearTimeout(showToast.timer);
  showToast.timer = window.setTimeout(function () {
    els.toast.classList.remove("is-visible");
  }, 2200);
}

function readJson(key, fallback) {
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : fallback;
  } catch (error) {
    console.warn(key + " 读取失败", error);
    return fallback;
  }
}

function contentHash(value) {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(16);
}

function saveBackupSnapshot(snapshot, reason, force) {
  if (!snapshot || !Array.isArray(snapshot.stories)) return false;
  try {
    const serialized = JSON.stringify(snapshot);
    if (serialized.length > 1500000) {
      console.warn("内容快照超过 1.5 MB，已跳过浏览器自动备份");
      return false;
    }
    const backups = readJson(BACKUPS_KEY, []);
    const signature = contentHash(serialized);
    if (!force && backups[0]?.signature === signature) return false;
    backups.unshift({
      id: new Date().toISOString() + "-" + Math.random().toString(36).slice(2, 6),
      createdAt: new Date().toISOString(),
      reason: reason || "手动快照",
      storyCount: snapshot.stories.length,
      signature: signature,
      content: JSON.parse(serialized)
    });
    const limit = Math.max(3, Math.min(30, Number(content?.operations?.backupLimit) || 10));
    localStorage.setItem(BACKUPS_KEY, JSON.stringify(backups.slice(0, limit)));
    return true;
  } catch (error) {
    console.warn("本地备份失败", error);
    return false;
  }
}

function createManualBackup() {
  const created = saveBackupSnapshot(content, "手动快照", true);
  renderBackups();
  showToast(created ? "内容快照已创建" : "快照创建失败或内容过大");
}

function restoreBackup(id) {
  const backup = readJson(BACKUPS_KEY, []).find(function (item) { return item.id === id; });
  if (!backup?.content) return;
  if (!window.confirm("确定恢复这个内容快照吗？当前内容会先自动备份。")) return;
  saveBackupSnapshot(content, "恢复前快照", true);
  content = JSON.parse(JSON.stringify(backup.content));
  activeStoryId = null;
  activeCategoryName = null;
  activeSourceId = null;
  normalizeContent();
  if (!cloudMode) localStorage.setItem(ADMIN_CONTENT_KEY, JSON.stringify(content));
  refreshAll();
  showToast(cloudMode ? "快照已载入，确认后保存到云端" : "内容快照已恢复");
}

function deleteBackup(id) {
  if (!window.confirm("确定删除这个本地快照吗？")) return;
  const backups = readJson(BACKUPS_KEY, []).filter(function (item) { return item.id !== id; });
  localStorage.setItem(BACKUPS_KEY, JSON.stringify(backups));
  renderBackups();
  showToast("本地快照已删除");
}

function renderBackups() {
  const backups = readJson(BACKUPS_KEY, []);
  els.backupList.innerHTML = backups.map(function (backup) {
    const date = backup.createdAt ? new Date(backup.createdAt).toLocaleString("zh-CN") : "时间未知";
    return "<div class=\"backup-row\">" +
      "<strong>" + escapeHtml(date) + "</strong>" +
      "<small>" + escapeHtml((backup.reason || "内容快照") + " · " + Number(backup.storyCount || 0) + " 条内容") + "</small>" +
      "<div class=\"backup-actions\">" +
        "<button type=\"button\" data-backup-action=\"restore\" data-backup-id=\"" + escapeHtml(backup.id) + "\" title=\"恢复快照\" aria-label=\"恢复快照\"><i data-lucide=\"rotate-ccw\"></i></button>" +
        "<button type=\"button\" data-backup-action=\"download\" data-backup-id=\"" + escapeHtml(backup.id) + "\" title=\"下载快照\" aria-label=\"下载快照\"><i data-lucide=\"download\"></i></button>" +
        "<button type=\"button\" data-backup-action=\"delete\" data-backup-id=\"" + escapeHtml(backup.id) + "\" title=\"删除快照\" aria-label=\"删除快照\"><i data-lucide=\"trash-2\"></i></button>" +
      "</div>" +
    "</div>";
  }).join("") || "<p class=\"muted\">还没有本地内容快照</p>";
  initializeIcons();
}

function handleBackupAction(event) {
  const button = event.target.closest("[data-backup-action]");
  if (!button) return;
  const backups = readJson(BACKUPS_KEY, []);
  const backup = backups.find(function (item) { return item.id === button.dataset.backupId; });
  if (!backup) return;
  if (button.dataset.backupAction === "restore") restoreBackup(backup.id);
  if (button.dataset.backupAction === "delete") deleteBackup(backup.id);
  if (button.dataset.backupAction === "download") {
    downloadFile("fx-backup-" + backup.createdAt.slice(0, 10) + ".json", JSON.stringify(backup.content, null, 2));
  }
}

function colorOr(value, fallback) {
  return /^#[0-9a-f]{6}$/i.test(String(value || "")) ? value : fallback;
}

function normalizeContent() {
  content.site = Object.assign({
    name: "信息分享平台",
    subtitle: "GLOBAL KNOWLEDGE INDEX",
    heroTitle: "前沿产业与人文观察台",
    heroSubtitle: "",
    footer: "",
    briefing: { title: "每日产业简报", subtitle: "工作日 08:30 更新" }
  }, content.site || {});
  content.theme = Object.assign({}, DEFAULT_THEME, content.theme || {});
  content.stories = (Array.isArray(content.stories) ? content.stories : []).map(function (story) {
    story.status = STATUS_LABELS[story.status] ? story.status : "published";
    story.confidence = Number.isFinite(Number(story.confidence)) ? Number(story.confidence) : 80;
    story.language = story.language || "zh-CN";
    story.sourceUrl = story.sourceUrl || story.url || "";
    story.author = story.author || "";
    story.body = story.body || "";
    story.scheduledAt = story.scheduledAt || "";
    return story;
  });

  if (!Array.isArray(content.categorySettings) || !content.categorySettings.length) {
    const source = content.categories?.length ? content.categories : ["金融", "科技", "工业", "能源", "农业", "人文"];
    content.categorySettings = source.map(function (name) {
      return { name: name, color: DEFAULT_THEME.primary, icon: "folder", enabled: true, keywords: [name] };
    });
  }

  content.categorySettings = content.categorySettings
    .filter(function (item) { return item && String(item.name || "").trim(); })
    .map(function (item) {
      return {
        name: String(item.name).trim(),
        color: colorOr(item.color, DEFAULT_THEME.primary),
        icon: String(item.icon || "folder").trim() || "folder",
        enabled: item.enabled !== false,
        keywords: Array.isArray(item.keywords) ? item.keywords.map(String).filter(Boolean) : []
      };
    });
  content.categories = content.categorySettings.map(function (item) { return item.name; });
  content.sourceSettings = (Array.isArray(content.sourceSettings) ? content.sourceSettings : [])
    .filter(function (source) { return source && source.name && source.url; })
    .map(function (source, index) {
      return {
        id: String(source.id || "source-" + (index + 1)),
        name: String(source.name).trim(),
        url: String(source.url).trim(),
        categoryHint: content.categories.includes(source.categoryHint) ? source.categoryHint : (content.categories[0] || "科技"),
        type: ["official", "research", "professional", "industry", "company", "community"].includes(source.type) ? source.type : "professional",
        trustLevel: ["authoritative", "professional", "standard", "reference"].includes(source.trustLevel) ? source.trustLevel : "standard",
        region: String(source.region || "全球").trim() || "全球",
        language: ["zh-CN", "en", "multi"].includes(source.language) ? source.language : "en",
        enabled: source.enabled !== false,
        confidence: Math.max(0, Math.min(100, Number(source.confidence ?? 75))),
        maxItems: Math.max(1, Math.min(20, Number(source.maxItems ?? 5)))
      };
    });
  content.collectionLogs = (Array.isArray(content.collectionLogs) ? content.collectionLogs : [])
    .filter(Boolean)
    .sort(function (a, b) { return String(b.finishedAt || b.startedAt || "").localeCompare(String(a.finishedAt || a.startedAt || "")); })
    .slice(0, 50);
  content.operations = Object.assign({
    siteUrl: "https://gzxkjpt.eu.org",
    contactEmail: "",
    publicNotice: "公益性科技与产业知识聚合平台",
    contentLicense: "仅聚合公开信息摘要，版权归原作者和原发布机构所有。",
    searchEnabled: true,
    autoBackup: true,
    backupLimit: 10
  }, content.operations || {});
  content.operations.searchEnabled = content.operations.searchEnabled !== false;
  content.operations.autoBackup = content.operations.autoBackup !== false;
  content.operations.backupLimit = Math.max(3, Math.min(30, Number(content.operations.backupLimit) || 10));
}

async function hydrateAutomationData() {
  try {
    const response = await fetch("data/update-sources.json?v=" + Date.now(), { cache: "no-store" });
    if (response.ok) {
      const defaults = (await response.json()).sources || [];
      if (!Array.isArray(content.sourceSettings) || !content.sourceSettings.length) {
        content.sourceSettings = defaults;
      } else {
        const defaultsById = new Map(defaults.map(function (source) { return [String(source.id), source]; }));
        content.sourceSettings = content.sourceSettings.map(function (source) {
          return Object.assign({}, defaultsById.get(String(source.id)) || {}, source);
        });
      }
    }
  } catch (error) {
    console.warn("默认来源配置读取失败", error);
  }
  try {
    const response = await fetch("data/collection-logs.json?v=" + Date.now(), { cache: "no-store" });
    if (response.ok) {
      const fileLogs = (await response.json()).logs || [];
      const merged = new Map();
      fileLogs.concat(content.collectionLogs || []).forEach(function (log) {
        const id = String(log.id || log.finishedAt || log.startedAt || "");
        if (id && !merged.has(id)) merged.set(id, log);
      });
      content.collectionLogs = Array.from(merged.values());
    }
  } catch (error) {
    console.warn("采集日志读取失败", error);
  }
}

async function loadContent() {
  const loaded = await window.FXContent?.load(CONTENT_URL);
  if (loaded && Array.isArray(loaded.stories)) return loaded;
  throw new Error("内容数据加载失败");
}

function today() {
  return new Date().toISOString().slice(0, 10);
}

function toLocalDateTimeInput(value) {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60000);
  return local.toISOString().slice(0, 16);
}

function nextStoryId() {
  return Math.max(0, ...content.stories.map(function (story) {
    return Number(story.id) || 0;
  })) + 1;
}

function updateScheduleControl() {
  const scheduled = els.storyStatus.value === "scheduled";
  els.storyScheduledAt.disabled = !scheduled;
  if (!scheduled) els.storyScheduledAt.value = "";
}

async function saveLocal() {
  try {
    if (content.operations?.autoBackup !== false) {
      const previous = cloudMode ? content : readJson(ADMIN_CONTENT_KEY, null);
      if (previous) saveBackupSnapshot(previous, cloudMode ? "云端保存前" : "自动保存前", false);
    }
    if (cloudMode) {
      if (!cloudSession) {
        els.authGate.hidden = false;
        showToast("请先登录管理员账号");
        return;
      }
      await window.FXCloud.saveContent(content);
      localStorage.removeItem(ADMIN_CONTENT_KEY);
      showToast("已保存到云端，所有访客刷新后可看到改动");
    } else {
      localStorage.setItem(ADMIN_CONTENT_KEY, JSON.stringify(content));
      showToast("已保存到本地，前台刷新后可看到改动");
    }
    refreshAll();
  } catch (error) {
    console.error(error);
    showToast("保存失败：" + (error.message || "请检查云端权限"));
  }
}

function renderStats() {
  els.statStories.textContent = content.stories.length;
  els.statCategories.textContent = content.categories.length;
  const pendingCount = content.stories.filter(function (story) {
    return ["draft", "review", "scheduled"].includes(story.status);
  }).length;
  els.statDrafts.textContent = pendingCount;
  els.reviewQueueCount.textContent = pendingCount + " 条内容等待处理";
  els.statReports.textContent = reports.filter(function (report) {
    return ["new", "processing"].includes(report.status);
  }).length;
  els.statFiles.textContent = uploadedFiles.length;
}

async function loadReports() {
  reportLoadError = null;
  if (cloudMode && cloudSession && window.FXCloud?.getReports) {
    try {
      reports = await window.FXCloud.getReports();
      return;
    } catch (error) {
      console.warn("云端反馈读取失败，显示当前设备中的反馈", error);
      reportLoadError = error;
    }
  }
  reports = readJson(REPORTS_KEY, []);
}

function saveLocalReports() {
  localStorage.setItem(REPORTS_KEY, JSON.stringify(reports.slice(0, 500)));
}

function reportDate(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "时间未知";
  return new Intl.DateTimeFormat("zh-CN", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit"
  }).format(date);
}

function safeReportUrl(value) {
  try {
    const url = new URL(String(value || ""), location.origin);
    return ["http:", "https:"].includes(url.protocol) ? url.href : "";
  } catch (error) {
    return "";
  }
}

function renderReports() {
  const activeCount = reports.filter(function (report) {
    return ["new", "processing"].includes(report.status);
  }).length;
  els.reportQueueCount.textContent = activeCount + " 条待处理";
  if (cloudMode && cloudSession && !reportLoadError) {
    els.reportModeNote.textContent = "云端反馈队列，已登录管理员可处理";
  } else if (reportLoadError) {
    els.reportModeNote.textContent = "云端反馈表暂不可用，当前显示本设备记录";
  } else {
    els.reportModeNote.textContent = "本地反馈仅保存在当前浏览器";
  }

  const filter = els.reportStatusFilter.value || "active";
  const visible = reports.filter(function (report) {
    if (filter === "all") return true;
    if (filter === "active") return ["new", "processing"].includes(report.status);
    return report.status === filter;
  });
  if (!visible.length) {
    els.reportList.innerHTML = "<div class=\"report-empty\">当前筛选条件下没有反馈记录</div>";
    return;
  }

  els.reportList.innerHTML = visible.map(function (report) {
    const story = content.stories.find(function (item) { return Number(item.id) === Number(report.articleId); });
    const status = REPORT_STATUS_LABELS[report.status] || REPORT_STATUS_LABELS.new;
    const type = REPORT_TYPE_LABELS[report.type] || REPORT_TYPE_LABELS.other;
    const statusColor = REPORT_STATUS_COLORS[report.status] || REPORT_STATUS_COLORS.new;
    const reportUrl = safeReportUrl(report.articleUrl);
    const contact = report.contact
      ? "<span class=\"report-contact\">联系方式：" + escapeHtml(report.contact) + "</span>"
      : "<span>未留联系方式</span>";
    const resolution = report.resolutionNote
      ? "<p class=\"report-resolution\">处理记录：" + escapeHtml(report.resolutionNote) + "</p>"
      : "";
    const canProcess = ["new", "processing"].includes(report.status);
    return "<article class=\"report-item is-" + escapeHtml(report.status || "new") + "\">" +
      "<div class=\"report-main\">" +
        "<div class=\"report-heading\"><strong>" + escapeHtml(type) + "</strong>" +
          "<span class=\"report-status-badge\" style=\"--report-color:" + statusColor + "\">" + escapeHtml(status) + "</span>" +
          "<time>" + escapeHtml(reportDate(report.createdAt)) + "</time></div>" +
        "<p class=\"report-details\">" + escapeHtml(report.details) + "</p>" +
        "<div class=\"report-meta\">" +
          (story ? "<span>关联内容：" + escapeHtml(story.title) + "</span>" : "<span>未匹配站内内容</span>") +
          (reportUrl ? "<a href=\"" + escapeHtml(reportUrl) + "\" target=\"_blank\" rel=\"noopener noreferrer\">查看相关页面</a>" : "<span>页面地址无效</span>") +
          contact +
        "</div>" + resolution +
      "</div>" +
      "<div class=\"report-actions\">" +
        (report.status === "new" ? "<button type=\"button\" data-report-action=\"processing\" data-report-id=\"" + escapeHtml(report.id) + "\">开始处理</button>" : "") +
        (canProcess ? "<button type=\"button\" data-report-action=\"resolved\" data-report-id=\"" + escapeHtml(report.id) + "\">标记已解决</button>" : "") +
        (canProcess ? "<button type=\"button\" data-report-action=\"rejected\" data-report-id=\"" + escapeHtml(report.id) + "\">不予处理</button>" : "") +
        (!canProcess ? "<button type=\"button\" data-report-action=\"reopen\" data-report-id=\"" + escapeHtml(report.id) + "\">重新打开</button>" : "") +
        (story ? "<button type=\"button\" data-report-action=\"edit\" data-report-id=\"" + escapeHtml(report.id) + "\">打开内容</button>" : "") +
        (story && story.status !== "archived" && canProcess ? "<button class=\"report-archive\" type=\"button\" data-report-action=\"archive\" data-report-id=\"" + escapeHtml(report.id) + "\">下架内容</button>" : "") +
        (!canProcess ? "<button class=\"report-delete\" type=\"button\" data-report-action=\"delete\" data-report-id=\"" + escapeHtml(report.id) + "\">删除记录</button>" : "") +
      "</div>" +
    "</article>";
  }).join("");
}

async function persistReport(report, changes) {
  Object.assign(report, changes, { updatedAt: new Date().toISOString() });
  if (cloudMode && cloudSession && !reportLoadError && window.FXCloud?.updateReport) {
    await window.FXCloud.updateReport(report.id, changes);
  } else {
    saveLocalReports();
  }
  renderReports();
  renderStats();
}

async function handleReportAction(event) {
  const button = event.target.closest("[data-report-action]");
  if (!button) return;
  const report = reports.find(function (item) { return String(item.id) === String(button.dataset.reportId); });
  if (!report) return;
  const action = button.dataset.reportAction;
  const story = content.stories.find(function (item) { return Number(item.id) === Number(report.articleId); });
  try {
    if (action === "edit" && story) {
      activeStoryId = story.id;
      editStory(story.id);
      document.querySelector("#content").scrollIntoView({ behavior: "smooth", block: "start" });
      return;
    }
    if (action === "archive" && story) {
      if (!window.confirm("确定下架关联内容《" + story.title + "》吗？该内容会立即从前台隐藏。")) return;
      story.status = "archived";
      await persistReport(report, { status: "resolved", resolutionNote: "关联内容已下架" });
      await saveLocal();
      showToast("关联内容已下架，反馈已标记为解决");
      return;
    }
    if (action === "delete") {
      if (button.dataset.confirmed !== "true") {
        button.dataset.confirmed = "true";
        button.textContent = "再次点击确认";
        window.setTimeout(function () {
          if (button.isConnected) {
            button.dataset.confirmed = "false";
            button.textContent = "删除记录";
          }
        }, 4000);
        return;
      }
      if (cloudMode && cloudSession && !reportLoadError && window.FXCloud?.deleteReport) {
        await window.FXCloud.deleteReport(report.id);
      }
      reports = reports.filter(function (item) { return String(item.id) !== String(report.id); });
      if (!cloudMode || reportLoadError) saveLocalReports();
      renderReports();
      renderStats();
      showToast("反馈记录已删除");
      return;
    }
    const changes = action === "processing"
      ? { status: "processing", resolutionNote: "正在核验" }
      : action === "resolved"
        ? { status: "resolved", resolutionNote: "已完成核验或修订" }
        : action === "rejected"
          ? { status: "rejected", resolutionNote: "核验后未发现需要修订的内容" }
          : { status: "new", resolutionNote: "" };
    await persistReport(report, changes);
    showToast("反馈状态已更新为“" + REPORT_STATUS_LABELS[changes.status] + "”");
  } catch (error) {
    console.error(error);
    showToast("反馈处理失败：" + (error.message || "请检查云端权限"));
  }
}

async function refreshReports() {
  await loadReports();
  renderReports();
  renderStats();
  showToast("反馈队列已刷新");
}

function cloudFormValue() {
  return {
    enabled: els.cloudEnabled.checked,
    supabaseUrl: els.cloudProjectUrl.value.trim(),
    supabaseAnonKey: els.cloudAnonKey.value.trim(),
    contentId: els.cloudContentId.value.trim() || "main",
    storageBucket: els.cloudStorageBucket.value.trim() || "media"
  };
}

function setCloudSetupStatus(message, type) {
  els.cloudSetupStatus.textContent = message || "";
  els.cloudSetupStatus.classList.toggle("is-success", type === "success");
  els.cloudSetupStatus.classList.toggle("is-error", type === "error");
}

function renderCloudSettings() {
  const config = window.FXCloud?.config || {};
  const validation = window.FXCloud?.validateConfig(config) || { valid: false, empty: true };
  els.cloudProjectUrl.value = config.supabaseUrl || "";
  els.cloudAnonKey.value = config.supabaseAnonKey || "";
  els.cloudContentId.value = config.contentId || "main";
  els.cloudStorageBucket.value = config.storageBucket || "media";
  els.cloudEnabled.checked = Boolean(config.enabled);
  els.cloudSetupBadge.classList.remove("is-online", "is-error");
  if (cloudConnectionError) {
    els.cloudSetupBadge.textContent = "连接异常";
    els.cloudSetupBadge.classList.add("is-error");
    setCloudSetupStatus(cloudConnectionError.message || "云端连接失败", "error");
  } else if (cloudMode && cloudSession) {
    els.cloudSetupBadge.textContent = "已连接";
    els.cloudSetupBadge.classList.add("is-online");
    setCloudSetupStatus("云端模式已启用，当前管理员已登录。", "success");
  } else if (validation.valid && config.enabled) {
    els.cloudSetupBadge.textContent = "等待登录";
    setCloudSetupStatus("云端参数已保存，登录管理员账号后可保存内容。", "");
  } else if (validation.valid) {
    els.cloudSetupBadge.textContent = "已停用";
    setCloudSetupStatus("云端参数已保存，当前继续使用本地模式。", "");
  } else {
    els.cloudSetupBadge.textContent = "本地模式";
    setCloudSetupStatus(validation.empty ? "填写 Project URL 和公开密钥后可测试连接。" : validation.message, validation.empty ? "" : "error");
  }
}

async function testCloudConnection() {
  setCloudSetupStatus("正在检查项目连接和数据库结构...", "");
  try {
    const result = await window.FXCloud.testConnection(cloudFormValue());
    setCloudSetupStatus(result.message, result.schemaReady ? "success" : "error");
  } catch (error) {
    setCloudSetupStatus(error.message || "连接测试失败", "error");
  }
}

function saveCloudSetup(event) {
  event.preventDefault();
  try {
    window.FXCloud.saveConfig(cloudFormValue());
    setCloudSetupStatus("配置已安全保存在当前浏览器，正在切换运行模式...", "success");
    window.setTimeout(function () { location.reload(); }, 300);
  } catch (error) {
    setCloudSetupStatus(error.message || "配置保存失败", "error");
  }
}

function clearCloudSetup() {
  if (!window.confirm("确定清除当前浏览器中的云端连接参数并返回本地模式吗？云端数据不会被删除。")) return;
  window.FXCloud.clearConfig();
  location.reload();
}

function useLocalMode() {
  window.FXCloud.clearConfig();
  location.reload();
}

function renderCategoryOptions() {
  els.storyCategory.innerHTML = content.categorySettings.map(function (category) {
    const suffix = category.enabled ? "" : "（停用）";
    return "<option value=\"" + escapeHtml(category.name) + "\">" + escapeHtml(category.name + suffix) + "</option>";
  }).join("");
}

function renderCategorySettings() {
  els.categoryList.innerHTML = content.categorySettings.map(function (category, index) {
    const keywords = category.keywords.length ? category.keywords.join("、") : "未设置自动分类关键词";
    const active = category.name === activeCategoryName ? " is-active" : "";
    const status = category.enabled ? "" : " · 已停用";
    return "<article class=\"category-item" + active + "\" style=\"--category-color:" + category.color + "\">" +
      "<span class=\"category-swatch\"><i data-lucide=\"" + escapeHtml(category.icon) + "\"></i></span>" +
      "<button class=\"category-copy category-edit\" type=\"button\" data-name=\"" + escapeHtml(category.name) + "\">" +
        "<strong>" + escapeHtml(category.name) + "</strong>" +
        "<small>" + escapeHtml(keywords + status) + "</small>" +
      "</button>" +
      "<span class=\"category-actions\">" +
        "<button type=\"button\" data-move=\"-1\" data-name=\"" + escapeHtml(category.name) + "\" aria-label=\"上移板块\" " + (index === 0 ? "disabled" : "") + "><i data-lucide=\"arrow-up\"></i></button>" +
        "<button type=\"button\" data-move=\"1\" data-name=\"" + escapeHtml(category.name) + "\" aria-label=\"下移板块\" " + (index === content.categorySettings.length - 1 ? "disabled" : "") + "><i data-lucide=\"arrow-down\"></i></button>" +
      "</span>" +
    "</article>";
  }).join("");

  els.categoryList.querySelectorAll(".category-edit").forEach(function (button) {
    button.addEventListener("click", function () { editCategory(button.dataset.name); });
  });
  els.categoryList.querySelectorAll("[data-move]").forEach(function (button) {
    button.addEventListener("click", function () {
      moveCategory(button.dataset.name, Number(button.dataset.move));
    });
  });
  initializeIcons();
}

function newCategory() {
  activeCategoryName = null;
  els.categoryForm.reset();
  els.categoryOriginalName.value = "";
  els.categoryColor.value = content.theme.primary || DEFAULT_THEME.primary;
  els.categoryIcon.value = "folder";
  els.categoryEnabled.checked = true;
  renderCategorySettings();
  els.categoryName.focus();
}

function editCategory(name) {
  const category = content.categorySettings.find(function (item) { return item.name === name; });
  if (!category) return;
  activeCategoryName = name;
  els.categoryOriginalName.value = name;
  els.categoryName.value = category.name;
  els.categoryColor.value = category.color;
  els.categoryIcon.value = category.icon;
  els.categoryEnabled.checked = category.enabled;
  els.categoryKeywords.value = category.keywords.join(", ");
  renderCategorySettings();
}

function renameCategoryReferences(oldName, newName) {
  if (!oldName || oldName === newName) return;
  content.stories.forEach(function (story) {
    if (story.category === oldName) story.category = newName;
  });
  if (content.featured?.category === oldName) content.featured.category = newName;
  (content.signals?.items || []).forEach(function (item) {
    if (item.label === oldName) item.label = newName;
  });
}

function saveCategoryForm(event) {
  event.preventDefault();
  const originalName = els.categoryOriginalName.value;
  const name = els.categoryName.value.trim();
  if (!name) {
    showToast("请填写板块名称");
    return;
  }
  const duplicate = content.categorySettings.some(function (item) {
    return item.name === name && item.name !== originalName;
  });
  if (duplicate) {
    showToast("已经存在同名板块");
    return;
  }
  const nextCategory = {
    name: name,
    color: colorOr(els.categoryColor.value, DEFAULT_THEME.primary),
    icon: els.categoryIcon.value.trim() || "folder",
    enabled: els.categoryEnabled.checked,
    keywords: els.categoryKeywords.value.split(/[,，\n]/).map(function (word) { return word.trim(); }).filter(Boolean)
  };
  const index = content.categorySettings.findIndex(function (item) { return item.name === originalName; });
  if (index >= 0) {
    content.categorySettings[index] = nextCategory;
    renameCategoryReferences(originalName, name);
  } else {
    content.categorySettings.push(nextCategory);
  }
  activeCategoryName = name;
  normalizeContent();
  saveLocal();
}

function deleteCategory() {
  const name = els.categoryOriginalName.value;
  if (!name) {
    showToast("请先选择一个板块");
    return;
  }
  if (content.categorySettings.length <= 1) {
    showToast("至少需要保留一个板块");
    return;
  }
  const fallback = content.categorySettings.find(function (item) { return item.name !== name; });
  const affected = content.stories.filter(function (story) { return story.category === name; }).length;
  const message = "确定删除“" + name + "”吗？" + affected + " 条内容将转移到“" + fallback.name + "”。";
  if (!window.confirm(message)) return;
  content.categorySettings = content.categorySettings.filter(function (item) { return item.name !== name; });
  renameCategoryReferences(name, fallback.name);
  activeCategoryName = fallback.name;
  normalizeContent();
  saveLocal();
}

function moveCategory(name, delta) {
  const index = content.categorySettings.findIndex(function (item) { return item.name === name; });
  const nextIndex = index + delta;
  if (index < 0 || nextIndex < 0 || nextIndex >= content.categorySettings.length) return;
  const next = content.categorySettings.slice();
  const current = next[index];
  next[index] = next[nextIndex];
  next[nextIndex] = current;
  content.categorySettings = next;
  activeCategoryName = name;
  normalizeContent();
  saveLocal();
}

function nextSourceId() {
  return "source-" + Date.now().toString(36) + "-" + Math.random().toString(36).slice(2, 7);
}

function renderSourceManager() {
  const trustLabels = { authoritative: "权威", professional: "专业", standard: "一般", reference: "参考" };
  const typeLabels = { official: "官方", research: "科研", professional: "专业媒体", industry: "行业平台", company: "企业", community: "社区" };
  const latestLog = content.collectionLogs[0] || {};
  const latestResults = Array.isArray(latestLog.sourceResults) ? latestLog.sourceResults : [];
  const resultFor = function (source) {
    return latestResults.find(function (result) {
      return result.sourceId === source.id || result.source === source.name;
    });
  };
  const enabledSources = content.sourceSettings.filter(function (source) { return source.enabled; });
  const healthyCount = enabledSources.filter(function (source) { return resultFor(source)?.status === "success"; }).length;
  const failedCount = enabledSources.filter(function (source) { return resultFor(source)?.status === "failed"; }).length;
  els.sourceHealthSummary.innerHTML = [
    ["已配置来源", content.sourceSettings.length],
    ["启用采集", enabledSources.length],
    ["最近正常", healthyCount],
    ["需要处理", failedCount]
  ].map(function (item) {
    return "<article><span>" + escapeHtml(item[0]) + "</span><strong>" + Number(item[1]) + "</strong></article>";
  }).join("");
  els.sourceCategory.innerHTML = content.categorySettings.map(function (category) {
    return "<option value=\"" + escapeHtml(category.name) + "\">" + escapeHtml(category.name) + "</option>";
  }).join("");
  els.sourceList.innerHTML = content.sourceSettings.map(function (source) {
    const active = source.id === activeSourceId ? " is-active" : "";
    const result = resultFor(source);
    const stateClass = !source.enabled ? " is-off" : result?.status === "failed" ? " is-error" : result ? "" : " is-idle";
    const stateLabel = !source.enabled ? "已停用" : result?.status === "failed" ? "采集异常" : result ? "运行正常" : "等待检测";
    return "<button class=\"source-item" + active + "\" type=\"button\" data-source-id=\"" + escapeHtml(source.id) + "\">" +
      "<strong>" + escapeHtml(source.name) + "</strong>" +
      "<span class=\"source-state" + stateClass + "\">" + stateLabel + "</span>" +
      "<small>" + escapeHtml(source.categoryHint + " · " + (typeLabels[source.type] || "专业媒体") + " · " + (trustLabels[source.trustLevel] || "一般") + " · " + source.region + " · 可信度 " + source.confidence) + "</small>" +
    "</button>";
  }).join("") || "<p class=\"muted\">暂无采集来源</p>";
  els.sourceList.querySelectorAll("[data-source-id]").forEach(function (button) {
    button.addEventListener("click", function () { editSource(button.dataset.sourceId); });
  });
}

function newSource() {
  activeSourceId = null;
  els.sourceForm.reset();
  els.sourceId.value = "";
  els.sourceEnabled.checked = true;
  els.sourceType.value = "professional";
  els.sourceTrustLevel.value = "standard";
  els.sourceRegion.value = "全球";
  els.sourceLanguage.value = "en";
  els.sourceConfidence.value = 75;
  els.sourceMaxItems.value = 5;
  els.sourceCategory.value = content.categories[0] || "";
  renderSourceManager();
  els.sourceName.focus();
}

function editSource(id) {
  const source = content.sourceSettings.find(function (item) { return item.id === id; });
  if (!source) return;
  activeSourceId = id;
  els.sourceId.value = source.id;
  els.sourceName.value = source.name;
  els.sourceUrl.value = source.url;
  els.sourceCategory.value = source.categoryHint;
  els.sourceType.value = source.type;
  els.sourceTrustLevel.value = source.trustLevel;
  els.sourceRegion.value = source.region;
  els.sourceLanguage.value = source.language;
  els.sourceEnabled.checked = source.enabled;
  els.sourceConfidence.value = source.confidence;
  els.sourceMaxItems.value = source.maxItems;
  renderSourceManager();
}

function saveSourceForm(event) {
  event.preventDefault();
  const id = els.sourceId.value || nextSourceId();
  const source = {
    id: id,
    name: els.sourceName.value.trim(),
    url: els.sourceUrl.value.trim(),
    categoryHint: els.sourceCategory.value,
    type: els.sourceType.value,
    trustLevel: els.sourceTrustLevel.value,
    region: els.sourceRegion.value.trim() || "全球",
    language: els.sourceLanguage.value,
    enabled: els.sourceEnabled.checked,
    confidence: Math.max(0, Math.min(100, Number(els.sourceConfidence.value) || 0)),
    maxItems: Math.max(1, Math.min(20, Number(els.sourceMaxItems.value) || 5))
  };
  if (!source.name || !source.url) {
    showToast("请填写来源名称和订阅地址");
    return;
  }
  const duplicate = content.sourceSettings.some(function (item) {
    return item.id !== id && normalizeSourceUrl(item.url) === normalizeSourceUrl(source.url);
  });
  if (duplicate) {
    showToast("这个订阅地址已经存在");
    return;
  }
  const index = content.sourceSettings.findIndex(function (item) { return item.id === id; });
  if (index >= 0) content.sourceSettings[index] = source;
  else content.sourceSettings.push(source);
  activeSourceId = id;
  saveLocal();
  showToast("来源设置已保存");
}

function deleteSource() {
  const id = els.sourceId.value;
  const source = content.sourceSettings.find(function (item) { return item.id === id; });
  if (!source) {
    showToast("请先选择一个来源");
    return;
  }
  if (!window.confirm("确定删除来源《" + source.name + "》吗？")) return;
  content.sourceSettings = content.sourceSettings.filter(function (item) { return item.id !== id; });
  activeSourceId = content.sourceSettings[0]?.id || null;
  saveLocal();
}

function renderCollectionLogs() {
  const latest = content.collectionLogs[0] || {};
  els.collectionStats.innerHTML = [
    "新增 " + Number(latest.added || 0),
    "重复 " + Number(latest.duplicates || 0),
    "失败来源 " + Number(latest.sourcesFailed || 0)
  ].map(function (label) { return "<span>" + escapeHtml(label) + "</span>"; }).join("");
  els.collectionLogList.innerHTML = content.collectionLogs.slice(0, 12).map(function (log) {
    const time = log.finishedAt || log.startedAt || "";
    const results = Array.isArray(log.sourceResults) ? log.sourceResults : [];
    const retryCount = results.reduce(function (total, result) { return total + Math.max(0, Number(result.attempts || 1) - 1); }, 0);
    const slowest = results.reduce(function (current, result) {
      return Number(result.durationMs || 0) > Number(current.durationMs || 0) ? result : current;
    }, {});
    const errorText = (log.errors || []).map(function (error) {
      return (error.source || "来源") + "：" + (error.error || "失败");
    }).join("；") || (results.length ? "重试 " + retryCount + " 次 · 最慢 " + (slowest.source || "来源") + " " + Number(slowest.durationMs || 0) + "ms" : "无错误");
    return "<div class=\"collection-log\">" +
      "<strong>" + escapeHtml(time ? new Date(time).toLocaleString("zh-CN") : "时间未知") + "</strong>" +
      "<span>来源 " + Number(log.sourcesTotal || 0) + "</span>" +
      "<span>抓取 " + Number(log.fetched || 0) + "</span>" +
      "<span>新增 " + Number(log.added || 0) + "</span>" +
      "<span>重复 " + Number(log.duplicates || 0) + "</span>" +
      "<span class=\"" + ((log.errors || []).length ? "is-error" : "") + "\">" + escapeHtml(errorText) + "</span>" +
    "</div>";
  }).join("") || "<p class=\"muted\">还没有采集记录</p>";
}

function normalizeSourceUrl(value) {
  try {
    const url = new URL(String(value || ""), location.href);
    url.hash = "";
    ["utm_source", "utm_medium", "utm_campaign", "utm_term", "utm_content", "fbclid", "gclid"].forEach(function (key) {
      url.searchParams.delete(key);
    });
    return (url.origin + url.pathname.replace(/\/$/, "") + (url.searchParams.toString() ? "?" + url.searchParams.toString() : "")).toLowerCase();
  } catch (error) {
    return String(value || "").trim().toLowerCase();
  }
}

function normalizeStoryTitle(value) {
  return String(value || "").toLowerCase().replace(/[\s\p{P}\p{S}]+/gu, "");
}

function storyDedupKeys(story) {
  return {
    url: normalizeSourceUrl(story.sourceUrl || story.url || ""),
    title: normalizeStoryTitle(story.title)
  };
}

function recordCollectionLog(log) {
  if (!log) return;
  const id = String(log.id || log.finishedAt || log.generatedAt || Date.now());
  const next = Object.assign({}, log, { id: id });
  content.collectionLogs = content.collectionLogs.filter(function (item) { return String(item.id) !== id; });
  content.collectionLogs.unshift(next);
  content.collectionLogs = content.collectionLogs.slice(0, 50);
}

function renderStoryList() {
  const query = els.storySearch.value.trim().toLowerCase();
  const statusFilter = els.storyStatusFilter.value;
  const stories = content.stories.filter(function (story) {
    const haystack = [story.title, story.category, story.source, (story.tags || []).join(" ")].join(" ").toLowerCase();
    const queryMatch = !query || haystack.includes(query);
    const statusMatch = statusFilter === "all" || (statusFilter === "pending" && ["draft", "review", "scheduled"].includes(story.status)) || story.status === statusFilter;
    return queryMatch && statusMatch;
  });
  els.storyList.innerHTML = stories.map(function (story) {
    const active = story.id === activeStoryId ? " is-active" : "";
    const status = story.status || "published";
    return "<button class=\"story-item" + active + "\" type=\"button\" data-id=\"" + story.id + "\">" +
      "<strong>" + escapeHtml(story.title) + "</strong>" +
      "<span>" + escapeHtml(story.category) + " · " + escapeHtml(story.source || "未设置来源") + " · 热度 " + Number(story.heat || 0) + "</span>" +
      "<span class=\"story-item-status\" style=\"--status-color:" + STATUS_COLORS[status] + "\">" + STATUS_LABELS[status] + "</span>" +
      "</button>";
  }).join("");
  els.storyList.querySelectorAll(".story-item").forEach(function (button) {
    button.addEventListener("click", function () {
      editStory(Number(button.dataset.id));
    });
  });
}

function newStory() {
  activeStoryId = null;
  els.storyForm.reset();
  els.storyId.value = "";
  els.storyDate.value = today();
  els.storyRead.value = 8;
  els.storyHeat.value = 80;
  els.storyStatus.value = "draft";
  els.storyReviewGuidance.hidden = true;
  els.storyScheduledAt.value = "";
  els.storyConfidence.value = 70;
  els.storyBody.value = "";
  els.storyAuthor.value = "";
  els.storyLanguage.value = "zh-CN";
  els.storySourceUrl.value = "";
  const image = uploadedFiles.find(function (file) { return file.kind === "image"; });
  els.storyImage.value = image ? image.dataUrl : "assets/factory.jpg";
  updateScheduleControl();
  renderStoryQuality();
  renderStoryHistory();
  renderStoryList();
  els.storyTitle.focus();
}

function editStory(id) {
  const story = content.stories.find(function (item) { return item.id === id; });
  if (!story) return;
  activeStoryId = id;
  loadStoryIntoForm(story);
  renderStoryList();
}

function loadStoryIntoForm(story) {
  els.storyId.value = story.id;
  els.storyTitle.value = story.title || "";
  els.storyCategory.value = story.category || content.categories[0];
  els.storySource.value = story.source || "";
  els.storyStatus.value = story.status || "published";
  els.storyScheduledAt.value = toLocalDateTimeInput(story.scheduledAt);
  els.storyConfidence.value = story.confidence ?? 80;
  els.storyExcerpt.value = story.excerpt || "";
  els.storyBody.value = Array.isArray(story.body) ? story.body.join("\n\n") : (story.body || "");
  els.storyRead.value = story.readMinutes || 8;
  els.storyHeat.value = story.heat || 80;
  els.storyDate.value = story.date || today();
  els.storyAuthor.value = story.author || "";
  els.storyLanguage.value = story.language || "zh-CN";
  els.storySourceUrl.value = story.sourceUrl || story.url || "";
  els.storyImage.value = story.image || "";
  els.storyTags.value = (story.tags || []).join(", ");
  els.storyReviewGuidance.hidden = !(story.reviewNote || story.collectionSourceId);
  els.storyReviewGuidance.textContent = story.reviewNote || "这是自动采集内容，请核对原始来源、标题、摘要和分类后再发布。";
  updateScheduleControl();
  renderStoryQuality();
  renderStoryHistory();
}

function formToStory() {
  const id = Number(els.storyId.value) || nextStoryId();
  const date = els.storyDate.value || today();
  const existing = content.stories.find(function (story) { return Number(story.id) === id; }) || {};
  return Object.assign({}, existing, {
    id: id,
    category: els.storyCategory.value,
    title: els.storyTitle.value.trim(),
    excerpt: els.storyExcerpt.value.trim(),
    image: els.storyImage.value.trim() || "assets/factory.jpg",
    source: els.storySource.value.trim() || "平台编辑",
    sourceUrl: els.storySourceUrl.value.trim(),
    author: els.storyAuthor.value.trim(),
    language: els.storyLanguage.value.trim() || "zh-CN",
    status: els.storyStatus.value,
    scheduledAt: els.storyScheduledAt.value ? new Date(els.storyScheduledAt.value).toISOString() : "",
    confidence: Number(els.storyConfidence.value) || 0,
    body: els.storyBody.value.trim(),
    time: date === today() ? "刚刚" : date,
    readMinutes: Number(els.storyRead.value) || 8,
    heat: Number(els.storyHeat.value) || 80,
    date: date,
    tags: els.storyTags.value.split(/[,，]/).map(function (tag) { return tag.trim(); }).filter(Boolean)
  });
}

function isValidPublicUrl(value) {
  try {
    const url = new URL(String(value || ""));
    return ["http:", "https:"].includes(url.protocol) && Boolean(url.hostname);
  } catch (error) {
    return false;
  }
}

function evaluateStoryQuality(story) {
  const normalizedTitle = normalizeStoryTitle(story.title);
  const duplicate = content.stories.some(function (item) {
    return Number(item.id) !== Number(story.id) && normalizeStoryTitle(item.title) === normalizedTitle && normalizedTitle;
  });
  const checks = [
    { label: "标题不少于 10 个字", pass: story.title.length >= 10, required: true, weight: 15 },
    { label: "标题未与现有内容重复", pass: !duplicate && Boolean(normalizedTitle), required: true, weight: 10 },
    { label: "摘要不少于 30 个字", pass: story.excerpt.length >= 30, required: true, weight: 15 },
    { label: "来源或作者信息完整", pass: story.source !== "平台编辑" || story.author.length >= 2, required: true, weight: 10 },
    { label: "原始来源链接有效", pass: isValidPublicUrl(story.sourceUrl), required: true, weight: 20 },
    { label: "可信度不低于 70", pass: Number(story.confidence) >= 70, required: true, weight: 15 },
    { label: "至少设置 2 个标签", pass: story.tags.length >= 2, required: false, weight: 5 },
    { label: "正文不少于 80 个字", pass: story.body.length >= 80, required: false, weight: 10 }
  ];
  return {
    checks: checks,
    score: checks.reduce(function (total, check) { return total + (check.pass ? check.weight : 0); }, 0),
    ready: checks.every(function (check) { return !check.required || check.pass; }),
    blocking: checks.filter(function (check) { return check.required && !check.pass; }).map(function (check) { return check.label; })
  };
}

function renderStoryQuality() {
  const result = evaluateStoryQuality(formToStory());
  const qualityGate = els.storyQualityChecks.closest(".quality-gate");
  const color = result.ready ? "var(--green)" : result.score >= 60 ? "var(--amber)" : "var(--red)";
  els.storyQualityScore.textContent = result.score + " / 100";
  els.storyQualityScore.style.color = color;
  els.storyQualityBar.style.width = result.score + "%";
  els.storyQualityBar.style.setProperty("--quality-color", color);
  els.storyQualityChecks.innerHTML = result.checks.map(function (check) {
    return "<span class=\"quality-check" + (check.pass ? " is-pass" : "") + "\"><i data-lucide=\"" + (check.pass ? "circle-check" : "circle-x") + "\"></i>" + escapeHtml(check.label + (check.required ? " · 必检" : "")) + "</span>";
  }).join("");
  els.storyQualityNote.textContent = result.ready
    ? "必检项已通过，可以公开发布；补齐建议项可提高内容完整度。"
    : "发布前还需完成：" + result.blocking.join("、");
  qualityGate.classList.toggle("is-blocked", !result.ready);
  document.querySelector("#publishStory").disabled = !result.ready;
  initializeIcons();
  return result;
}

function readStoryHistory() {
  const history = readJson(STORY_HISTORY_KEY, []);
  return Array.isArray(history) ? history : [];
}

function recordStoryVersion(story, reason) {
  if (!story?.id) return;
  try {
    const snapshot = JSON.parse(JSON.stringify(story));
    const signature = contentHash(JSON.stringify(snapshot));
    let history = readStoryHistory();
    const latest = history.find(function (entry) { return Number(entry.storyId) === Number(story.id); });
    if (latest?.signature === signature) return;
    history.unshift({
      id: "version-" + Date.now() + "-" + Math.random().toString(36).slice(2, 6),
      storyId: story.id,
      title: story.title || "未命名内容",
      reason: reason || "保存前版本",
      createdAt: new Date().toISOString(),
      signature: signature,
      snapshot: snapshot
    });
    const perStory = new Map();
    history = history.filter(function (entry) {
      const key = String(entry.storyId);
      const count = perStory.get(key) || 0;
      perStory.set(key, count + 1);
      return count < 12;
    }).slice(0, 200);
    localStorage.setItem(STORY_HISTORY_KEY, JSON.stringify(history));
  } catch (error) {
    console.warn("内容版本记录失败", error);
  }
}

function renderStoryHistory() {
  const scope = els.storyHistoryFilter.value || "current";
  const currentId = Number(els.storyId.value) || activeStoryId;
  const history = readStoryHistory()
    .filter(function (entry) { return scope === "all" || (currentId && Number(entry.storyId) === Number(currentId)); })
    .slice(0, scope === "all" ? 12 : 8);
  els.storyHistoryList.innerHTML = history.map(function (entry) {
    const time = entry.createdAt ? new Date(entry.createdAt).toLocaleString("zh-CN") : "时间未知";
    return "<div class=\"story-history-row\" data-history-story-id=\"" + escapeHtml(entry.storyId) + "\"><div>" +
      "<strong>" + escapeHtml(entry.title || "未命名内容") + "</strong>" +
      "<small>" + escapeHtml((entry.reason || "历史版本") + " · " + time) + "</small>" +
      "</div><div class=\"story-history-actions\">" +
        "<button type=\"button\" data-story-version-action=\"restore\" data-story-version=\"" + escapeHtml(entry.id) + "\">载入版本</button>" +
        "<button type=\"button\" data-story-version-action=\"delete\" data-story-version=\"" + escapeHtml(entry.id) + "\" aria-label=\"删除版本\"><i data-lucide=\"trash-2\"></i></button>" +
      "</div></div>";
  }).join("") || "<div class=\"story-history-empty\">还没有可恢复的历史版本</div>";
  initializeIcons();
}

function restoreStoryVersion(versionId) {
  const entry = readStoryHistory().find(function (item) { return item.id === versionId; });
  if (!entry?.snapshot) return;
  const restored = JSON.parse(JSON.stringify(entry.snapshot));
  restored.status = "draft";
  restored.scheduledAt = "";
  activeStoryId = restored.id;
  loadStoryIntoForm(restored);
  renderStoryList();
  showToast("旧版本已载入并转为草稿，确认后点击保存内容");
}

function handleStoryHistoryAction(event) {
  const button = event.target.closest("[data-story-version-action]");
  if (!button) return;
  if (button.dataset.storyVersionAction === "restore") {
    restoreStoryVersion(button.dataset.storyVersion);
    return;
  }
  if (button.dataset.confirmed !== "true") {
    button.dataset.confirmed = "true";
    button.innerHTML = "确认";
    window.setTimeout(function () {
      if (button.isConnected) {
        button.dataset.confirmed = "false";
        button.innerHTML = "<i data-lucide=\"trash-2\"></i>";
        initializeIcons();
      }
    }, 4000);
    return;
  }
  const history = readStoryHistory().filter(function (entry) { return entry.id !== button.dataset.storyVersion; });
  localStorage.setItem(STORY_HISTORY_KEY, JSON.stringify(history));
  renderStoryHistory();
  showToast("历史版本已删除");
}

function saveStory(event) {
  event.preventDefault();
  const story = formToStory();
  if (!story.title) {
    showToast("请先填写标题");
    return;
  }
  if (story.status === "scheduled" && !story.scheduledAt) {
    showToast("定时发布内容必须设置发布时间");
    return;
  }
  const quality = evaluateStoryQuality(story);
  story.qualityScore = quality.score;
  if (["published", "scheduled"].includes(story.status) && !quality.ready) {
    showToast("暂不能发布，请先完成：" + quality.blocking[0]);
    renderStoryQuality();
    return;
  }
  const index = content.stories.findIndex(function (item) { return item.id === story.id; });
  if (index >= 0) {
    if (JSON.stringify(content.stories[index]) !== JSON.stringify(story)) {
      recordStoryVersion(content.stories[index], "保存前版本");
    }
    content.stories[index] = story;
  }
  else content.stories.unshift(story);
  activeStoryId = story.id;
  saveLocal();
}

function setActiveStoryStatus(status) {
  const id = Number(els.storyId.value);
  const story = content.stories.find(function (item) { return item.id === id; });
  if (!story) {
    showToast("请先选择一篇内容");
    return;
  }
  const formStory = formToStory();
  formStory.status = status;
  if (status === "published") {
    const quality = evaluateStoryQuality(formStory);
    formStory.qualityScore = quality.score;
    if (!quality.ready) {
      showToast("暂不能发布，请先完成：" + quality.blocking[0]);
      renderStoryQuality();
      return;
    }
    formStory.scheduledAt = "";
    formStory.date = today();
    formStory.time = "刚刚";
  }
  const index = content.stories.findIndex(function (item) { return item.id === id; });
  recordStoryVersion(story, status === "published" ? "发布前版本" : "下架前版本");
  content.stories[index] = formStory;
  activeStoryId = id;
  saveLocal();
  showToast(status === "published" ? "内容已审核并发布" : "内容已下架");
}

function deleteStory(event) {
  const id = Number(els.storyId.value);
  if (!id) {
    showToast("当前没有选中文章");
    return;
  }
  const story = content.stories.find(function (item) { return item.id === id; });
  if (!story) return;
  const button = event?.currentTarget || document.querySelector("#deleteStory");
  if (button.dataset.confirmed !== "true") {
    button.dataset.confirmed = "true";
    button.innerHTML = "<i data-lucide=\"alert-triangle\"></i> 再次点击删除";
    initializeIcons();
    window.setTimeout(function () {
      if (button.isConnected) {
        button.dataset.confirmed = "false";
        button.innerHTML = "<i data-lucide=\"trash-2\"></i> 删除";
        initializeIcons();
      }
    }, 4000);
    return;
  }
  button.dataset.confirmed = "false";
  button.innerHTML = "<i data-lucide=\"trash-2\"></i> 删除";
  recordStoryVersion(story, "删除前版本");
  content.stories = content.stories.filter(function (item) { return item.id !== id; });
  activeStoryId = content.stories[0] ? content.stories[0].id : null;
  saveLocal();
}

function categorizeText(text) {
  const rules = content.categorySettings
    .filter(function (category) { return category.enabled; })
    .map(function (category) {
      return [category.name, category.keywords.length ? category.keywords : [category.name]];
    });
  const lower = text.toLowerCase();
  const ranked = rules.map(function (rule) {
    const score = rule[1].reduce(function (total, word) {
      return total + (lower.includes(word.toLowerCase()) ? 1 : 0);
    }, 0);
    return { category: rule[0], score: score };
  }).sort(function (a, b) {
    return b.score - a.score;
  });
  return ranked.length && ranked[0].score > 0 ? ranked[0].category : (rules[0]?.[0] || "其他");
}

function extractTitle(text) {
  const lines = text.split(/\r?\n/).map(function (line) { return line.trim(); }).filter(Boolean);
  const title = lines.find(function (line) { return line.length >= 8 && line.length <= 80; }) || lines[0] || "未命名科技信息";
  return title.replace(/^#+\s*/, "").slice(0, 80);
}

function summarize(text) {
  const clean = text.replace(/\s+/g, " ").trim();
  const sentences = clean.split(/[。！？.!?]/).map(function (item) { return item.trim(); }).filter(Boolean);
  return ((sentences.slice(0, 2).join("。") || clean).slice(0, 120)) + "。";
}

function extractTags(text, category) {
  const keywords = ["金融科技", "数字支付", "工业大模型", "人形机器人", "先进封装", "Chiplet", "固态电池", "数字孪生", "储能", "算力", "精准农业", "农业机器人", "数字人文", "文化遗产", "工业互联网", "半导体", "新能源", "智能制造"];
  const found = keywords.filter(function (word) { return text.toLowerCase().includes(word.toLowerCase()); });
  return Array.from(new Set([category].concat(found))).slice(0, 5);
}

function generateDraftFromText() {
  const text = els.smartInput.value.trim();
  if (!text) {
    showToast("请先粘贴资料或新闻文本");
    return;
  }
  const category = categorizeText(text);
  const image = uploadedFiles.find(function (file) { return file.kind === "image"; });
  const story = {
    id: nextStoryId(),
    category: category,
    title: extractTitle(text),
    excerpt: summarize(text),
    image: image ? image.dataUrl : "assets/factory.jpg",
    source: "智能整理",
    sourceUrl: "",
    author: "",
    language: "zh-CN",
    status: "draft",
    scheduledAt: "",
    confidence: 72,
    body: "",
    time: "刚刚",
    readMinutes: Math.min(18, Math.max(5, Math.ceil(text.length / 180))),
    heat: Math.min(96, 70 + extractTags(text, category).length * 4),
    date: today(),
    tags: extractTags(text, category)
  };
  content.stories.unshift(story);
  activeStoryId = story.id;
  drafts.unshift({ title: story.title, createdAt: new Date().toISOString() });
  localStorage.setItem(DRAFTS_KEY, JSON.stringify(drafts));
  editStory(story.id);
  saveLocal();
}

function renderFiles() {
  if (!uploadedFiles.length) {
    els.fileList.innerHTML = "<p class=\"muted\">还没有上传资料。</p>";
    return;
  }
  els.fileList.innerHTML = uploadedFiles.map(function (file, index) {
    const preview = file.kind === "image"
      ? "<img src=\"" + file.dataUrl + "\" alt=\"" + escapeHtml(file.name) + "\">"
      : "<strong>" + escapeHtml(file.name) + "</strong>";
    const action = file.kind === "image"
      ? "<button class=\"ghost-button use-image\" type=\"button\" data-index=\"" + index + "\">用作当前封面</button>"
      : "";
    return "<article class=\"file-card\">" + preview + "<small>" + escapeHtml(file.name) + " · " + Math.round(file.size / 1024) + " KB</small>" + action + "</article>";
  }).join("");
  els.fileList.querySelectorAll(".use-image").forEach(function (button) {
    button.addEventListener("click", function () {
      const file = uploadedFiles[Number(button.dataset.index)];
      els.storyImage.value = file.dataUrl;
      showToast("已填入当前文章封面");
    });
  });
}

function fileToDataUrl(file) {
  return new Promise(function (resolve, reject) {
    const reader = new FileReader();
    reader.onload = function () { resolve(reader.result); };
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

async function handleFiles(event) {
  const files = Array.from(event.target.files || []);
  for (const file of files) {
    const record = {
      name: file.name,
      type: file.type || "application/octet-stream",
      size: file.size,
      kind: file.type.startsWith("image/") ? "image" : "document",
      createdAt: new Date().toISOString()
    };
    if (cloudMode) {
      if (!cloudSession) {
        els.authGate.hidden = false;
        showToast("请先登录再上传云端文件");
        return;
      }
      try {
        record.dataUrl = await window.FXCloud.uploadFile(file);
        record.cloud = true;
      } catch (error) {
        console.error(error);
        showToast("上传失败：" + (error.message || "请检查存储权限"));
        return;
      }
    } else if (record.kind === "image") {
      record.dataUrl = await fileToDataUrl(file);
    }
    uploadedFiles.unshift(record);
  }
  localStorage.setItem(ADMIN_FILES_KEY, JSON.stringify(uploadedFiles));
  renderFiles();
  renderStats();
  showToast(cloudMode ? "文件已上传到云端资料库" : "文件已加入本地资料库");
}

function readFileAsText(file) {
  return new Promise(function (resolve, reject) {
    const reader = new FileReader();
    reader.onload = function () { resolve(reader.result); };
    reader.onerror = reject;
    reader.readAsText(file, "utf-8");
  });
}

async function importContentFile(input, mode) {
  const file = input.files && input.files[0];
  if (!file) return;
  const imported = JSON.parse(await readFileAsText(file));
  if (mode === "draft") {
    const result = importDraftStories(imported);
    showToast("新增 " + result.added + " 条草稿，跳过 " + result.duplicates + " 条重复内容");
  } else {
    content = imported;
    showToast("已导入 content.json");
  }
  input.value = "";
  saveLocal();
}

function importDraftStories(imported) {
  const incomingStories = imported.stories || (Array.isArray(imported) ? imported : []);
  const seenUrls = new Set();
  const seenTitles = new Set();
  content.stories.forEach(function (story) {
    const keys = storyDedupKeys(story);
    if (keys.url) seenUrls.add(keys.url);
    if (keys.title) seenTitles.add(keys.title);
  });
  const accepted = [];
  let duplicates = 0;
  incomingStories.forEach(function (story) {
    const keys = storyDedupKeys(story);
    const duplicate = (keys.url && seenUrls.has(keys.url)) || (keys.title && seenTitles.has(keys.title));
    if (duplicate) {
      duplicates += 1;
      return;
    }
    const next = Object.assign({}, story, {
      id: nextStoryId(),
      sourceUrl: story.sourceUrl || story.url || "",
      time: story.time || "待审核",
      status: ["draft", "review"].includes(story.status) ? story.status : "draft"
    });
    delete next.url;
    content.stories.unshift(next);
    accepted.push(next);
    if (keys.url) seenUrls.add(keys.url);
    if (keys.title) seenTitles.add(keys.title);
  });
  drafts.unshift.apply(drafts, accepted.map(function (story) {
    return { title: story.title || "智能草稿", createdAt: new Date().toISOString() };
  }));
  localStorage.setItem(DRAFTS_KEY, JSON.stringify(drafts));
  recordCollectionLog(imported.collection || imported.run || null);
  renderCollectionLogs();
  return { total: incomingStories.length, added: accepted.length, duplicates: duplicates };
}

async function syncLatestDraft() {
  try {
    const response = await fetch("data/intelligence-draft.json?v=" + Date.now(), { cache: "no-store" });
    if (!response.ok) throw new Error("HTTP " + response.status);
    const imported = await response.json();
    const result = importDraftStories(imported);
    saveLocal();
    showToast("新增 " + result.added + " 条草稿，跳过 " + result.duplicates + " 条重复内容");
  } catch (error) {
    console.error(error);
    showToast("同步失败，请先运行自动更新脚本");
  }
}

function downloadFile(filename, text) {
  const blob = new Blob([text], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

function renderSiteSettings() {
  els.siteName.value = content.site.name || "";
  els.siteSubtitle.value = content.site.subtitle || "";
  els.siteHeroTitle.value = content.site.heroTitle || "";
  els.siteHeroSubtitle.value = content.site.heroSubtitle || "";
  els.siteFooter.value = content.site.footer || "";
  els.themeBackground.value = colorOr(content.theme.background, DEFAULT_THEME.background);
  els.themeSurface.value = colorOr(content.theme.surface, DEFAULT_THEME.surface);
  els.themeText.value = colorOr(content.theme.text, DEFAULT_THEME.text);
  els.themePrimary.value = colorOr(content.theme.primary, DEFAULT_THEME.primary);
  els.themeSecondary.value = colorOr(content.theme.secondary, DEFAULT_THEME.secondary);
}

function renderOperationsSettings() {
  const operations = content.operations || {};
  els.operationSiteUrl.value = operations.siteUrl || "";
  els.operationContactEmail.value = operations.contactEmail || "";
  els.operationPublicNotice.value = operations.publicNotice || "";
  els.operationLicense.value = operations.contentLicense || "";
  els.operationSearchEnabled.checked = operations.searchEnabled !== false;
  els.operationAutoBackup.checked = operations.autoBackup !== false;
  els.operationBackupLimit.value = Number(operations.backupLimit || 10);
}

function saveOperationsSettings(event) {
  event.preventDefault();
  content.operations = {
    siteUrl: els.operationSiteUrl.value.trim().replace(/\/$/, ""),
    contactEmail: els.operationContactEmail.value.trim(),
    publicNotice: els.operationPublicNotice.value.trim(),
    contentLicense: els.operationLicense.value.trim(),
    searchEnabled: els.operationSearchEnabled.checked,
    autoBackup: els.operationAutoBackup.checked,
    backupLimit: Math.max(3, Math.min(30, Number(els.operationBackupLimit.value) || 10))
  };
  saveLocal();
  showToast("公益运营设置已保存");
}

function saveSiteSettings(event) {
  event.preventDefault();
  content.site.name = els.siteName.value.trim() || "信息分享平台";
  content.site.subtitle = els.siteSubtitle.value.trim();
  content.site.heroTitle = els.siteHeroTitle.value.trim() || "前沿观察台";
  content.site.heroSubtitle = els.siteHeroSubtitle.value.trim();
  content.site.footer = els.siteFooter.value.trim();
  content.theme = {
    background: colorOr(els.themeBackground.value, DEFAULT_THEME.background),
    surface: colorOr(els.themeSurface.value, DEFAULT_THEME.surface),
    text: colorOr(els.themeText.value, DEFAULT_THEME.text),
    primary: colorOr(els.themePrimary.value, DEFAULT_THEME.primary),
    secondary: colorOr(els.themeSecondary.value, DEFAULT_THEME.secondary),
    gridOpacity: Number(content.theme.gridOpacity ?? DEFAULT_THEME.gridOpacity)
  };
  normalizeContent();
  saveLocal();
}

function resetTheme() {
  content.theme = Object.assign({}, DEFAULT_THEME);
  renderSiteSettings();
  saveLocal();
}

function refreshRawJson() {
  els.rawJson.value = JSON.stringify(content, null, 2);
}

function applyRawJson() {
  try {
    const nextContent = JSON.parse(els.rawJson.value);
    if (!nextContent || !Array.isArray(nextContent.stories)) {
      throw new Error("配置中必须包含 stories 数组");
    }
    content = nextContent;
    activeStoryId = null;
    activeCategoryName = null;
    normalizeContent();
    saveLocal();
    showToast("高级配置校验通过并已应用");
  } catch (error) {
    console.error(error);
    showToast("JSON 配置错误：" + error.message);
  }
}

function refreshAll() {
  normalizeContent();
  renderStats();
  renderCategoryOptions();
  renderCategorySettings();
  renderSourceManager();
  renderCollectionLogs();
  renderStoryList();
  renderReports();
  renderFiles();
  renderSiteSettings();
  renderOperationsSettings();
  renderBackups();
  renderCloudSettings();
  refreshRawJson();
  if (activeCategoryName && content.categorySettings.some(function (item) { return item.name === activeCategoryName; })) {
    editCategory(activeCategoryName);
  } else if (content.categorySettings[0]) {
    editCategory(content.categorySettings[0].name);
  } else {
    newCategory();
  }
  if (activeSourceId && content.sourceSettings.some(function (item) { return item.id === activeSourceId; })) {
    editSource(activeSourceId);
  } else if (content.sourceSettings[0]) {
    editSource(content.sourceSettings[0].id);
  } else {
    newSource();
  }
  if (activeStoryId && content.stories.some(function (story) { return story.id === activeStoryId; })) editStory(activeStoryId);
  else if (content.stories[0]) editStory(content.stories[0].id);
  else newStory();
  initializeIcons();
}

function updateCloudUi() {
  if (!cloudMode) {
    els.authGate.hidden = true;
    els.cloudStatus.textContent = cloudConnectionError ? "云端配置异常" : "本地模式";
    els.cloudStatus.classList.remove("is-online");
    els.signOut.hidden = true;
    els.saveAll.innerHTML = "<i data-lucide=\"save\"></i> 保存到本地";
    initializeIcons();
    return;
  }

  els.cloudStatus.textContent = cloudSession ? "云端已连接" : "等待管理员登录";
  els.cloudStatus.classList.toggle("is-online", Boolean(cloudSession));
  els.authGate.hidden = Boolean(cloudSession);
  els.signOut.hidden = !cloudSession;
  els.saveAll.innerHTML = "<i data-lucide=\"cloud-upload\"></i> 保存到云端";
  initializeIcons();
}

async function handleLogin(event) {
  event.preventDefault();
  els.loginMessage.textContent = "正在验证管理员账号...";
  try {
    cloudSession = await window.FXCloud.signIn(
      els.loginEmail.value.trim(),
      els.loginPassword.value
    );
    els.loginPassword.value = "";
    els.loginMessage.textContent = "";
    content = await loadContent();
    await loadReports();
    updateCloudUi();
    refreshAll();
    showToast("管理员登录成功");
  } catch (error) {
    console.error(error);
    els.loginMessage.textContent = error.message || "登录失败，请检查邮箱和密码";
  }
}

async function handleSignOut() {
  try {
    await window.FXCloud.signOut();
  } finally {
    cloudSession = null;
    updateCloudUi();
    showToast("已退出云端后台");
  }
}

function bindEvents() {
  els.saveAll.addEventListener("click", saveLocal);
  els.loginForm.addEventListener("submit", handleLogin);
  els.signOut.addEventListener("click", handleSignOut);
  document.querySelector("#useLocalMode").addEventListener("click", useLocalMode);
  els.cloudSetupForm.addEventListener("submit", saveCloudSetup);
  document.querySelector("#testCloudConnection").addEventListener("click", testCloudConnection);
  document.querySelector("#clearCloudConfig").addEventListener("click", clearCloudSetup);
  document.querySelector("#toggleCloudKey").addEventListener("click", function (event) {
    const visible = els.cloudAnonKey.type === "text";
    els.cloudAnonKey.type = visible ? "password" : "text";
    event.currentTarget.innerHTML = "<i data-lucide=\"" + (visible ? "eye" : "eye-off") + "\"></i>";
    initializeIcons();
  });
  document.querySelector("#newCategory").addEventListener("click", newCategory);
  document.querySelector("#deleteCategory").addEventListener("click", deleteCategory);
  els.categoryForm.addEventListener("submit", saveCategoryForm);
  document.querySelector("#newStory").addEventListener("click", newStory);
  document.querySelector("#deleteStory").addEventListener("click", deleteStory);
  document.querySelector("#publishStory").addEventListener("click", function () { setActiveStoryStatus("published"); });
  document.querySelector("#archiveStory").addEventListener("click", function () { setActiveStoryStatus("archived"); });
  document.querySelector("#newSource").addEventListener("click", newSource);
  document.querySelector("#deleteSource").addEventListener("click", deleteSource);
  els.sourceForm.addEventListener("submit", saveSourceForm);
  document.querySelector("#createBackup").addEventListener("click", createManualBackup);
  els.backupList.addEventListener("click", handleBackupAction);
  document.querySelector("#generateFromText").addEventListener("click", generateDraftFromText);
  document.querySelector("#openReviewQueue").addEventListener("click", function () {
    els.storyStatusFilter.value = "pending";
    renderStoryList();
    document.querySelector("#content").scrollIntoView({ behavior: "smooth", block: "start" });
  });
  document.querySelector("#syncDraft").addEventListener("click", syncLatestDraft);
  document.querySelector("#exportJson").addEventListener("click", function () { downloadFile("content.json", JSON.stringify(content, null, 2)); });
  document.querySelector("#importJson").addEventListener("click", function () { els.jsonFile.click(); });
  document.querySelector("#importDraft").addEventListener("click", function () { els.draftFile.click(); });
  document.querySelector("#resetLocal").addEventListener("click", function () {
    if (!window.confirm("确定清除本地后台改动吗？前台会恢复读取 data/content.json。")) return;
    localStorage.removeItem(ADMIN_CONTENT_KEY);
    localStorage.removeItem(DRAFTS_KEY);
    location.reload();
  });
  els.storySearch.addEventListener("input", renderStoryList);
  els.storyStatusFilter.addEventListener("change", renderStoryList);
  els.storyStatus.addEventListener("change", updateScheduleControl);
  els.storyForm.addEventListener("input", renderStoryQuality);
  els.storyForm.addEventListener("change", renderStoryQuality);
  els.storyHistoryFilter.addEventListener("change", renderStoryHistory);
  els.storyHistoryList.addEventListener("click", handleStoryHistoryAction);
  els.storyForm.addEventListener("submit", saveStory);
  els.reportStatusFilter.addEventListener("change", renderReports);
  els.reportList.addEventListener("click", handleReportAction);
  document.querySelector("#refreshReports").addEventListener("click", refreshReports);
  els.fileUpload.addEventListener("change", handleFiles);
  els.jsonFile.addEventListener("change", function () { importContentFile(els.jsonFile, "replace"); });
  els.draftFile.addEventListener("change", function () { importContentFile(els.draftFile, "draft"); });
  els.siteForm.addEventListener("submit", saveSiteSettings);
  els.operationsForm.addEventListener("submit", saveOperationsSettings);
  document.querySelector("#resetTheme").addEventListener("click", resetTheme);
  document.querySelector("#refreshRawJson").addEventListener("click", refreshRawJson);
  document.querySelector("#applyRawJson").addEventListener("click", applyRawJson);
}

function bindAdminNavigation() {
  const sectionNames = {
    dashboard: "总览工作台",
    sections: "内容运营 · 板块设置",
    content: "内容运营 · 内容管理",
    reports: "内容运营 · 反馈与下架",
    smart: "自动化 · 智能更新",
    files: "内容运营 · 资料中心",
    appearance: "站点与系统 · 外观设置",
    advanced: "站点与系统 · 高级配置",
    publish: "站点与系统 · 发布上线"
  };
  const links = Array.from(document.querySelectorAll(".admin-sidebar nav a, .workflow-step"));
  const workspace = document.querySelector("#currentWorkspace");
  const activate = function (id) {
    links.forEach(function (link) {
      link.classList.toggle("is-active", link.getAttribute("href") === "#" + id);
    });
    workspace.textContent = sectionNames[id] || "平台管理后台";
  };
  document.querySelectorAll(".admin-main > section[id]").forEach(function (section) {
    new IntersectionObserver(function (entries) {
      entries.forEach(function (entry) {
        if (entry.isIntersecting) activate(entry.target.id);
      });
    }, { rootMargin: "-18% 0px -72% 0px", threshold: 0 }).observe(section);
  });
  links.forEach(function (link) {
    link.addEventListener("click", function () {
      activate(link.getAttribute("href").slice(1));
    });
  });
  window.addEventListener("hashchange", function () {
    const id = location.hash.slice(1);
    if (sectionNames[id]) activate(id);
  });
  window.setTimeout(function () {
    const id = location.hash.slice(1);
    if (sectionNames[id]) activate(id);
  }, 80);
}

async function init() {
  try {
    cloudMode = Boolean(window.FXCloud?.isConfigured());
    if (cloudMode) {
      try {
        await window.FXCloud.init();
        cloudSession = await window.FXCloud.getSession();
      } catch (error) {
        cloudConnectionError = error;
        cloudMode = false;
      }
    }
    content = await loadContent();
    await hydrateAutomationData();
    uploadedFiles = readJson(ADMIN_FILES_KEY, []);
    drafts = readJson(DRAFTS_KEY, []);
    await loadReports();
    bindEvents();
    bindAdminNavigation();
    updateCloudUi();
    refreshAll();
    showToast(cloudMode ? "云端后台已就绪" : "本地后台已就绪");
  } catch (error) {
    console.error(error);
    showToast("后台加载失败，请检查 data/content.json");
  }
}

init();
window.addEventListener("load", initializeIcons);
