(function () {
  const ADMIN_CONTENT_KEY = "fx-admin-content";
  const PUBLIC_CACHE_KEY = "fx-public-content-cache-v1";
  const LEGACY_AUTOMATIC_EXCERPT_NOTICE = "平台根据可访问的标题、摘要和有限正文片段整理重点，并明确区分来源事实、板块背景与仍待核验的部分。";
  const DEMO_TITLES = new Set([
    "先进封装扩产提速，Chiplet 进入规模化验证阶段",
    "固态电池中试线密集落地，材料体系仍是成本分水岭",
    "边缘智能加速进入设备端，低功耗推理芯片需求上升",
    "数字孪生从展示系统转向生产决策，工厂数据底座重构",
    "新型电力系统扩容，储能调度进入精细化运营阶段",
    "工业网络升级：确定性通信成为柔性产线的连接基础",
    "工业大模型落地路径分化，知识工程重新受到重视",
    "第三代半导体产线向高良率爬坡，车规认证周期仍长",
    "实时支付与数字身份加速融合，金融基础设施进入云原生升级周期",
    "多光谱遥感与田间机器人协同，精准农业从监测走向自主作业",
    "数字人文平台连接档案、博物馆与公共知识服务"
  ]);

  function readLocal() {
    try {
      const raw = localStorage.getItem(ADMIN_CONTENT_KEY);
      const localContent = raw ? JSON.parse(raw) : null;
      if (localContent?.site?.name === "分项科技") {
        localContent.site.name = "信息分享平台";
        localStorage.setItem(ADMIN_CONTENT_KEY, JSON.stringify(localContent));
      }
      return localContent;
    } catch (error) {
      console.warn("本地内容读取失败", error);
      return null;
    }
  }

  function readPublicCache() {
    try {
      const cached = JSON.parse(localStorage.getItem(PUBLIC_CACHE_KEY) || "null");
      return cached?.stories ? cached : null;
    } catch (error) {
      return null;
    }
  }

  function savePublicCache(value) {
    try {
      if (value?.stories) localStorage.setItem(PUBLIC_CACHE_KEY, JSON.stringify(value));
    } catch (error) {
      console.warn("公开内容缓存写入失败", error);
    }
  }

  const PROVINCE_NAV_NAMES = [
    "安徽省", "广西壮族自治区", "河南省", "吉林省", "江西省", "山东省",
    "云南省", "浙江省", "重庆市", "山西省", "内蒙古自治区", "黑龙江省",
    "江苏省", "湖北省", "湖南省", "广东省", "海南省", "宁夏回族自治区",
    "新疆维吾尔自治区", "青海省", "西藏自治区", "河北省"
  ];

  function sourceMaterialIsUsable(value) {
    const text = String(value || "").replace(/\s+/g, " ").trim();
    if (text.length < 24) return false;
    const provinceHits = PROVINCE_NAV_NAMES.filter(function (name) { return text.includes(name); }).length;
    if (provinceHits >= 6) return false;
    const repeatedBlock = text.match(/(.{24,200}?)\s*\1/);
    if (repeatedBlock) return false;
    return true;
  }

  function automaticPresentationIntro(story) {
    const rawSource = String(story?.source || "来源机构").trim();
    const source = /^[\x00-\x7f\s.,&'()/-]+$/.test(rawSource) ? "来源机构" : rawSource;
    const category = String(story?.category || "前沿").trim();
    const originalTitle = String(story?.originalTitle || story?.title || "该公开资料").trim();
    return `${source}发布了一条${category}资料，原始主题为“${originalTitle}”。页面优先展示来源原始公开内容，并将平台整理的信息单独列出。`;
  }

  function presentationExcerpt(story) {
    let text = String(story?.excerpt || "").trim();
    if (!(story?.automaticImport || story?.contentGenerationMode || story?.collectionSourceId)) return text;
    text = text.split(LEGACY_AUTOMATIC_EXCERPT_NOTICE).join("").replace(/。。+/g, "。").trim();
    if (
      !sourceMaterialIsUsable(text)
      || /公开资料提供新的观察线索|公开资料显示的[^。]{0,20}动态/.test(text)
    ) {
      return automaticPresentationIntro(story);
    }
    return text;
  }

  function mergeContentBaseline(existingContent, fileContent, persistLocal) {
    const targetVersion = Number(fileContent?.contentBaselineVersion || 0);
    if (!existingContent?.stories || Number(existingContent.contentBaselineVersion || 0) >= targetVersion) {
      return existingContent;
    }
    const next = JSON.parse(JSON.stringify(existingContent));
    next.site = Object.assign({}, next.site);
    if (next.site.subtitle === "TECH & INDUSTRY INDEX") {
      next.site.subtitle = fileContent.site?.subtitle || "GLOBAL KNOWLEDGE INDEX";
    }
    if (["科技与工业观察台", "前沿产业与科技观察台", "前沿产业与人文观察台"].includes(next.site.heroTitle)) {
      next.site.heroTitle = fileContent.site?.heroTitle || "全球前沿知识观察台";
    }
    next.stories.forEach(function (story) {
      if (DEMO_TITLES.has(story.title)) story.status = "draft";
      if (!story.status) story.status = "draft";
    });
    const curated = (fileContent.stories || []).filter(function (story) { return story.curatedBaseline; });
    let nextId = Math.max(0, ...next.stories.map(function (story) { return Number(story.id) || 0; })) + 1;
    curated.forEach(function (baselineStory) {
      const index = next.stories.findIndex(function (story) {
        return baselineStory.sourceUrl && story.sourceUrl === baselineStory.sourceUrl;
      });
      const replacement = JSON.parse(JSON.stringify(baselineStory));
      if (index >= 0) {
        replacement.id = next.stories[index].id;
        next.stories[index] = replacement;
      } else {
        replacement.id = nextId;
        nextId += 1;
        next.stories.push(replacement);
      }
    });
    next.operations = Object.assign({}, next.operations, { contactEmail: "" });
    next.contentBaselineVersion = targetVersion;
    if (persistLocal) localStorage.setItem(ADMIN_CONTENT_KEY, JSON.stringify(next));
    return next;
  }

  async function loadFile(url) {
    let fileContent = null;
    try {
      const response = await fetch((url || "data/content.json") + "?v=" + Date.now(), { cache: "no-store" });
      if (!response.ok) throw new Error("HTTP " + response.status);
      fileContent = await response.json();
    } catch (error) {
      console.warn("内容文件读取失败", error);
    }
    return fileContent;
  }

  async function loadCloudContent() {
    if (!window.FXCloud?.isConfigured()) return null;
    try {
      await window.FXCloud.init();
      return await window.FXCloud.getContent();
    } catch (error) {
      console.warn("云端内容读取失败，继续使用本地内容", error);
      return null;
    }
  }

  function mergeWithBaseline(value, fileContent) {
    return fileContent ? mergeContentBaseline(value, fileContent, false) : value;
  }

  async function refreshPublicContent(url, initialFileContent) {
    const fileContent = initialFileContent || await loadFile(url);
    const cloudContent = await loadCloudContent();
    const cached = readPublicCache();
    const next = cloudContent?.stories
      ? mergeWithBaseline(cloudContent, fileContent)
      : cached?.stories
        ? mergeWithBaseline(cached, fileContent)
        : fileContent;
    if (!next?.stories) return null;
    savePublicCache(next);
    window.dispatchEvent(new CustomEvent("fxcontentupdate", { detail: next }));
    return next;
  }

  async function load(url, options) {
    const background = options?.background === true;

    if (background) {
      const cached = readPublicCache();
      // Render cached content immediately, then refresh static and cloud data.
      if (cached) {
        refreshPublicContent(url);
        return cached;
      }
      const local = readLocal();
      if (local?.stories) {
        if (window.FXCloud?.isConfigured()) refreshPublicContent(url);
        return local;
      }
      const fileContent = await loadFile(url);
      if (fileContent?.stories) savePublicCache(fileContent);
      if (window.FXCloud?.isConfigured()) refreshPublicContent(url, fileContent);
      return fileContent;
    }

    const fileContent = await loadFile(url);

    if (window.FXCloud?.isConfigured()) {
      const cloudContent = await loadCloudContent();
      if (cloudContent?.stories) {
        const next = mergeWithBaseline(cloudContent, fileContent);
        savePublicCache(next);
        return next;
      }
    }

    const local = readLocal();
    if (local?.stories) return fileContent ? mergeContentBaseline(local, fileContent, true) : local;
    return fileContent;
  }

  window.FXContent = {
    load: load,
    readLocal: readLocal,
    readPublicCache: readPublicCache,
    presentationExcerpt: presentationExcerpt,
    sourceMaterialIsUsable: sourceMaterialIsUsable,
    automaticPresentationIntro: automaticPresentationIntro
  };
})();
