(function () {
  const REPORTS_KEY = "fx-content-reports";
  const REPORT_COOLDOWN_KEY = "fx-report-cooldown";

  function setText(id, value) {
    const element = document.getElementById(id);
    if (element && value) element.textContent = value;
  }

  function applyTheme(theme) {
    const root = document.documentElement;
    const colorMap = {
      background: "--bg",
      surface: "--surface",
      text: "--text",
      primary: "--green",
      secondary: "--cyan"
    };
    Object.keys(colorMap).forEach(function (key) {
      const value = String(theme?.[key] || "").trim();
      if (/^#[0-9a-f]{6}$/i.test(value)) root.style.setProperty(colorMap[key], value);
    });
  }

  function isPublicEmail(value) {
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
  }

  function applyContent(content) {
    if (!content) return;
    const site = content.site || {};
    const operations = content.operations || {};
    const siteName = String(site.name || "信息分享平台").trim();
    const publicNotice = String(operations.publicNotice || "").trim();
    const license = String(operations.contentLicense || "").trim();
    const contactEmail = String(operations.contactEmail || "").trim();
    const siteUrl = String(operations.siteUrl || "").trim().replace(/\/$/, "");

    setText("governanceSiteName", siteName);
    setText("governanceFooterName", siteName);
    setText("governanceNotice", publicNotice);
    setText("governanceLicense", license);
    document.title = "平台治理与内容规范 | " + siteName;

    if (/^https:\/\//i.test(siteUrl)) {
      const canonical = document.querySelector('link[rel="canonical"]');
      if (canonical) canonical.href = siteUrl + "/governance.html";
    }

    const configured = document.getElementById("contactConfigured");
    const missing = document.getElementById("contactMissing");
    const contact = document.getElementById("governanceContact");
    if (isPublicEmail(contactEmail)) {
      contact.textContent = contactEmail;
      contact.href = "mailto:" + contactEmail;
      configured.hidden = false;
      missing.hidden = true;
    } else {
      configured.hidden = true;
      missing.hidden = false;
      contact.removeAttribute("href");
      contact.textContent = "";
    }

    applyTheme(content.theme || {});
  }

  function readLocalReports() {
    try {
      const value = JSON.parse(localStorage.getItem(REPORTS_KEY) || "[]");
      return Array.isArray(value) ? value : [];
    } catch (error) {
      return [];
    }
  }

  function saveLocalReport(report) {
    const reports = readLocalReports();
    reports.unshift(report);
    localStorage.setItem(REPORTS_KEY, JSON.stringify(reports.slice(0, 200)));
  }

  function reportId() {
    if (window.crypto?.randomUUID) return window.crypto.randomUUID();
    return "report-" + Date.now() + "-" + Math.random().toString(16).slice(2);
  }

  function setReportStatus(message, isError) {
    const status = document.getElementById("reportStatus");
    status.textContent = message || "";
    status.classList.toggle("is-error", Boolean(isError));
  }

  function prefillReport() {
    const params = new URLSearchParams(location.search);
    const articleId = params.get("article") || "";
    const requestedUrl = params.get("url") || "";
    document.getElementById("reportArticleId").value = /^\d+$/.test(articleId) ? articleId : "";
    document.getElementById("reportUrl").value = /^https?:\/\//i.test(requestedUrl) ? requestedUrl : location.href.split("#")[0];
  }

  async function submitReport(event) {
    event.preventDefault();
    const form = event.currentTarget;
    const submitButton = document.getElementById("reportSubmit");
    if (document.getElementById("reportWebsite").value) {
      form.reset();
      setReportStatus("反馈已提交，感谢你的帮助。", false);
      return;
    }

    const pageUrl = document.getElementById("reportUrl").value.trim();
    const details = document.getElementById("reportDetails").value.trim();
    if (!/^https?:\/\//i.test(pageUrl)) {
      setReportStatus("相关页面地址必须以 http:// 或 https:// 开头。", true);
      return;
    }
    if (details.length < 10) {
      setReportStatus("问题说明至少需要 10 个字。", true);
      return;
    }

    const lastSubmittedAt = Number(localStorage.getItem(REPORT_COOLDOWN_KEY) || 0);
    if (Date.now() - lastSubmittedAt < 30000) {
      setReportStatus("提交过于频繁，请稍后再试。", true);
      return;
    }

    const report = {
      id: reportId(),
      articleId: Number(document.getElementById("reportArticleId").value) || null,
      articleUrl: pageUrl.slice(0, 500),
      type: document.getElementById("reportType").value,
      details: details.slice(0, 2000),
      contact: document.getElementById("reportContact").value.trim().slice(0, 120),
      status: "new",
      resolutionNote: "",
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };

    submitButton.disabled = true;
    setReportStatus("正在提交...", false);
    let savedToCloud = false;
    try {
      if (window.FXCloud?.isConfigured() && window.FXCloud.submitReport) {
        await window.FXCloud.submitReport(report);
        savedToCloud = true;
      } else {
        saveLocalReport(report);
      }
      localStorage.setItem(REPORT_COOLDOWN_KEY, String(Date.now()));
      document.getElementById("reportDetails").value = "";
      document.getElementById("reportContact").value = "";
      setReportStatus(savedToCloud
        ? "反馈已发送至平台审核队列，感谢你的帮助。"
        : "反馈已保存在本设备后台。平台上线云端后可接收异地访客提交。", false);
    } catch (error) {
      console.warn("云端反馈提交失败，改为本地保存", error);
      saveLocalReport(report);
      localStorage.setItem(REPORT_COOLDOWN_KEY, String(Date.now()));
      setReportStatus("云端暂不可用，反馈已保存在本设备后台。", false);
    } finally {
      submitButton.disabled = false;
    }
  }

  async function init() {
    try {
      const content = await window.FXContent?.load("data/content.json");
      applyContent(content);
    } catch (error) {
      console.warn("治理页配置加载失败，继续显示公开规则", error);
    }
    prefillReport();
    document.getElementById("correctionForm").addEventListener("submit", submitReport);
    if (window.lucide) window.lucide.createIcons();
  }

  window.addEventListener("DOMContentLoaded", init);
})();
