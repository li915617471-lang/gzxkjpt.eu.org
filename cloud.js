(function () {
  const config = window.FX_CLOUD_CONFIG || {};
  const CLOUD_CONFIG_KEY = "fx-cloud-config";
  const NORMALIZED_SCHEMA_ERRORS = ["42P01", "42883", "PGRST202", "PGRST205"];
  let client = null;

  function readJwtRole(key) {
    try {
      const payload = String(key || "").split(".")[1];
      if (!payload) return "";
      const normalized = payload.replace(/-/g, "+").replace(/_/g, "/");
      const decoded = atob(normalized.padEnd(Math.ceil(normalized.length / 4) * 4, "="));
      return String(JSON.parse(decoded).role || "");
    } catch (error) {
      return "";
    }
  }

  function validateConfig(candidate) {
    const next = Object.assign({ contentId: "main", storageBucket: "media" }, candidate || {});
    const urlValue = String(next.supabaseUrl || "").trim().replace(/\/$/, "");
    const keyValue = String(next.supabaseAnonKey || "").trim();
    if (!urlValue && !keyValue) return { valid: false, empty: true, message: "尚未填写云端配置" };
    let parsedUrl;
    try {
      parsedUrl = new URL(urlValue);
    } catch (error) {
      return { valid: false, message: "Project URL 格式不正确" };
    }
    if (parsedUrl.protocol !== "https:" || parsedUrl.username || parsedUrl.password || parsedUrl.search || parsedUrl.hash) {
      return { valid: false, message: "Project URL 必须是无账号参数的 HTTPS 地址" };
    }
    const keyRole = readJwtRole(keyValue);
    if (/service[_-]?role/i.test(keyValue) || /^sb_secret_/i.test(keyValue) || keyRole === "service_role") {
      return { valid: false, message: "禁止使用 service_role 或 secret key，请改用公开 anon/publishable key" };
    }
    if (keyValue.length < 20) return { valid: false, message: "anon/publishable key 长度不正确" };
    const contentId = String(next.contentId || "main").trim() || "main";
    const storageBucket = String(next.storageBucket || "media").trim() || "media";
    if (!/^[a-zA-Z0-9_-]{1,40}$/.test(contentId)) return { valid: false, message: "内容空间 ID 只能使用字母、数字、下划线或短横线" };
    if (!/^[a-zA-Z0-9_-]{1,40}$/.test(storageBucket)) return { valid: false, message: "存储桶名称只能使用字母、数字、下划线或短横线" };
    return {
      valid: true,
      config: {
        enabled: next.enabled !== false,
        supabaseUrl: urlValue,
        supabaseAnonKey: keyValue,
        contentId: contentId,
        storageBucket: storageBucket
      }
    };
  }

  function isConfigured() {
    return Boolean(config.enabled && validateConfig(config).valid);
  }

  function saveConfig(candidate) {
    const validation = validateConfig(candidate);
    if (!validation.valid) throw new Error(validation.message);
    localStorage.setItem(CLOUD_CONFIG_KEY, JSON.stringify(validation.config));
    Object.assign(config, validation.config);
    client = null;
    return validation.config;
  }

  function clearConfig() {
    localStorage.removeItem(CLOUD_CONFIG_KEY);
    Object.assign(config, { enabled: false, supabaseUrl: "", supabaseAnonKey: "", contentId: "main", storageBucket: "media" });
    client = null;
  }

  async function testConnection(candidate) {
    const validation = validateConfig(candidate);
    if (!validation.valid) throw new Error(validation.message);
    if (!window.supabase?.createClient) throw new Error("Supabase SDK 未加载，请检查网络连接");
    const testClient = window.supabase.createClient(validation.config.supabaseUrl, validation.config.supabaseAnonKey, {
      auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false }
    });
    const settingsResult = await testClient.from("site_settings").select("id").limit(1);
    if (settingsResult.error && usesLegacyFallback(settingsResult.error)) {
      return { connected: true, schemaReady: false, message: "项目连接成功，请运行 supabase-schema.sql 初始化数据库" };
    }
    if (settingsResult.error) throw new Error(settingsResult.error.message || "Supabase 连接失败");
    const reportsResult = await testClient.from("content_reports").select("id").limit(1);
    if (reportsResult.error && usesLegacyFallback(reportsResult.error)) {
      return { connected: true, schemaReady: false, message: "连接成功，请重新运行 supabase-schema.sql 添加反馈队列" };
    }
    if (reportsResult.error) throw new Error(reportsResult.error.message || "反馈队列检查失败");
    return { connected: true, schemaReady: true, message: "连接成功，内容与反馈数据库结构已就绪" };
  }

  async function init() {
    if (!isConfigured()) return null;
    if (client) return client;
    if (!window.supabase || !window.supabase.createClient) {
      throw new Error("Supabase SDK 未加载");
    }
    client = window.supabase.createClient(config.supabaseUrl, config.supabaseAnonKey, {
      auth: {
        persistSession: true,
        autoRefreshToken: true,
        detectSessionInUrl: true
      }
    });
    return client;
  }

  async function getSession() {
    const active = await init();
    if (!active) return null;
    const result = await active.auth.getSession();
    if (result.error) throw result.error;
    return result.data.session;
  }

  function isAuthNetworkError(error) {
    const message = String(error?.message || error || "");
    return /failed to fetch|fetch failed|networkerror|network request failed|load failed/i.test(message);
  }

  function friendlyAuthError(error) {
    const message = String(error?.message || error || "");
    if (isAuthNetworkError(error)) {
      return new Error("无法连接 Supabase。请刷新页面，并关闭本页的网页翻译或拦截扩展；仍失败时请到“高级配置”点击“测试连接”。");
    }
    if (/invalid login credentials/i.test(message)) {
      return new Error("邮箱或密码不正确，请重新输入；如果尚未设置密码，请先使用 Supabase 邀请邮件中的链接完成设置。");
    }
    if (/email not confirmed/i.test(message)) {
      return new Error("邮箱尚未验证，请先打开 Supabase 发送的确认邮件完成验证。");
    }
    return error instanceof Error ? error : new Error(message || "管理员登录失败");
  }

  async function signIn(email, password) {
    let active = await init();
    if (!active) throw new Error("云端配置尚未启用");
    let result;
    try {
      result = await active.auth.signInWithPassword({ email: email, password: password });
      if (result.error && isAuthNetworkError(result.error)) {
        client = null;
        active = await init();
        result = await active.auth.signInWithPassword({ email: email, password: password });
      }
    } catch (error) {
      throw friendlyAuthError(error);
    }
    if (result.error) throw friendlyAuthError(result.error);
    return result.data.session;
  }

  async function signOut() {
    const active = await init();
    if (!active) return;
    const result = await active.auth.signOut();
    if (result.error) throw result.error;
  }

  function usesLegacyFallback(error) {
    return NORMALIZED_SCHEMA_ERRORS.includes(String(error?.code || ""));
  }

  function mapArticle(row) {
    const extra = row.extra || {};
    const platformPublishedAt = extra.automaticApproval?.reviewedAt
      || extra.automaticImportedAt
      || row.published_date
      || "";
    return Object.assign({}, extra, {
      id: row.id,
      category: row.category,
      title: row.title,
      excerpt: row.excerpt || "",
      image: row.image || "",
      source: row.source || "",
      sourceUrl: row.source_url || "",
      author: row.author || "",
      language: row.language || "zh-CN",
      status: row.status || "published",
      scheduledAt: row.scheduled_at || "",
      confidence: Number(row.confidence || 0),
      body: row.body || "",
      time: row.time_label || "",
      readMinutes: Number(row.read_minutes || 0),
      heat: Number(row.heat || 0),
      date: row.published_date || "",
      platformPublishedAt: platformPublishedAt,
      tags: Array.isArray(row.tags) ? row.tags : []
    });
  }

  async function getLegacyContent(active) {
    const result = await active
      .from("site_content")
      .select("content, updated_at")
      .eq("id", config.contentId || "main")
      .maybeSingle();
    if (result.error) throw result.error;
    return result.data ? result.data.content : null;
  }

  async function getNormalizedContent(active) {
    const siteId = config.contentId || "main";
    const settingsResult = await active
      .from("site_settings")
      .select("site, theme, extra, updated_at")
      .eq("id", siteId)
      .maybeSingle();
    if (settingsResult.error) throw settingsResult.error;
    if (!settingsResult.data) return null;

    const results = await Promise.all([
      active
        .from("categories")
        .select("name, color, icon, enabled, keywords, position")
        .eq("site_id", siteId)
        .order("position", { ascending: true }),
      active
        .from("articles")
        .select("id, category, title, excerpt, image, source, source_url, author, language, status, scheduled_at, confidence, body, time_label, read_minutes, heat, published_date, tags, extra, position")
        .eq("site_id", siteId)
        .order("position", { ascending: true })
    ]);
    const categoriesResult = results[0];
    const articlesResult = results[1];
    if (categoriesResult.error) throw categoriesResult.error;
    if (articlesResult.error) throw articlesResult.error;

    const categorySettings = (categoriesResult.data || []).map(function (category) {
      return {
        name: category.name,
        color: category.color,
        icon: category.icon,
        enabled: category.enabled !== false,
        keywords: Array.isArray(category.keywords) ? category.keywords : []
      };
    });

    return Object.assign({}, settingsResult.data.extra || {}, {
      site: settingsResult.data.site || {},
      theme: settingsResult.data.theme || {},
      categories: categorySettings.map(function (category) { return category.name; }),
      categorySettings: categorySettings,
      stories: (articlesResult.data || []).map(mapArticle)
    });
  }

  async function getContent() {
    const active = await init();
    if (!active) return null;
    try {
      const normalized = await getNormalizedContent(active);
      if (normalized) return normalized;
    } catch (error) {
      if (!usesLegacyFallback(error)) throw error;
      console.warn("规范化数据表尚未初始化，暂时读取旧版内容表");
    }
    return getLegacyContent(active);
  }

  async function saveLegacyContent(active, content) {
    const result = await active
      .from("site_content")
      .upsert({
        id: config.contentId || "main",
        content: content,
        updated_at: new Date().toISOString()
      });
    if (result.error) throw result.error;
  }

  async function saveContent(content) {
    const active = await init();
    if (!active) throw new Error("云端配置尚未启用");
    const session = await getSession();
    if (!session) throw new Error("请先登录管理员账号");
    const result = await active.rpc("save_site_snapshot", {
      p_site_id: config.contentId || "main",
      p_payload: content
    });
    if (!result.error) return;
    if (!usesLegacyFallback(result.error)) throw result.error;
    console.warn("规范化数据表尚未初始化，暂时保存到旧版内容表");
    await saveLegacyContent(active, content);
  }

  function mapReport(row) {
    return {
      id: row.id,
      articleId: row.article_id == null ? null : Number(row.article_id),
      articleUrl: row.article_url || "",
      type: row.report_type || "other",
      details: row.details || "",
      contact: row.contact || "",
      status: row.status || "new",
      resolutionNote: row.resolution_note || "",
      createdAt: row.created_at || "",
      updatedAt: row.updated_at || ""
    };
  }

  async function submitReport(report) {
    const active = await init();
    if (!active) throw new Error("云端配置尚未启用");
    const result = await active.from("content_reports").insert({
      site_id: config.contentId || "main",
      article_id: report.articleId || null,
      article_url: String(report.articleUrl || "").slice(0, 500),
      report_type: String(report.type || "other"),
      details: String(report.details || "").slice(0, 2000),
      contact: String(report.contact || "").slice(0, 120) || null
    });
    if (result.error) throw result.error;
  }

  async function getReports() {
    const active = await init();
    if (!active) return [];
    const result = await active
      .from("content_reports")
      .select("id, article_id, article_url, report_type, details, contact, status, resolution_note, created_at, updated_at")
      .eq("site_id", config.contentId || "main")
      .order("created_at", { ascending: false })
      .limit(500);
    if (result.error) throw result.error;
    return (result.data || []).map(mapReport);
  }

  async function updateReport(id, changes) {
    const active = await init();
    if (!active) throw new Error("云端配置尚未启用");
    const allowedStatus = ["new", "processing", "resolved", "rejected"];
    const payload = { updated_at: new Date().toISOString() };
    if (changes.status && allowedStatus.includes(changes.status)) payload.status = changes.status;
    if (Object.prototype.hasOwnProperty.call(changes, "resolutionNote")) {
      payload.resolution_note = String(changes.resolutionNote || "").slice(0, 1000);
    }
    const result = await active
      .from("content_reports")
      .update(payload)
      .eq("site_id", config.contentId || "main")
      .eq("id", id);
    if (result.error) throw result.error;
  }

  async function deleteReport(id) {
    const active = await init();
    if (!active) throw new Error("云端配置尚未启用");
    const result = await active
      .from("content_reports")
      .delete()
      .eq("site_id", config.contentId || "main")
      .eq("id", id);
    if (result.error) throw result.error;
  }

  function safeFilename(name) {
    const ext = String(name).includes(".") ? "." + String(name).split(".").pop() : "";
    const base = String(name)
      .replace(/\.[^.]+$/, "")
      .replace(/[^a-zA-Z0-9_-]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 48) || "file";
    return base + "-" + Date.now() + ext.toLowerCase();
  }

  async function uploadFile(file) {
    const active = await init();
    if (!active) throw new Error("云端配置尚未启用");
    const session = await getSession();
    if (!session) throw new Error("请先登录管理员账号");
    const bucket = config.storageBucket || "media";
    const path = new Date().toISOString().slice(0, 7) + "/" + safeFilename(file.name);
    const result = await active.storage.from(bucket).upload(path, file, {
      cacheControl: "3600",
      upsert: false,
      contentType: file.type || undefined
    });
    if (result.error) throw result.error;
    return active.storage.from(bucket).getPublicUrl(path).data.publicUrl;
  }

  window.FXCloud = {
    config: config,
    validateConfig: validateConfig,
    saveConfig: saveConfig,
    clearConfig: clearConfig,
    testConnection: testConnection,
    isConfigured: isConfigured,
    init: init,
    getSession: getSession,
    signIn: signIn,
    signOut: signOut,
    getContent: getContent,
    saveContent: saveContent,
    submitReport: submitReport,
    getReports: getReports,
    updateReport: updateReport,
    deleteReport: deleteReport,
    uploadFile: uploadFile
  };
})();
