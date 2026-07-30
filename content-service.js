(function () {
  const ADMIN_CONTENT_KEY = "fx-admin-content";
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

  async function load(url) {
    let fileContent = null;
    try {
      const response = await fetch((url || "data/content.json") + "?v=" + Date.now(), { cache: "no-store" });
      if (!response.ok) throw new Error("HTTP " + response.status);
      fileContent = await response.json();
    } catch (error) {
      console.warn("内容文件读取失败", error);
    }

    if (window.FXCloud?.isConfigured()) {
      try {
        await window.FXCloud.init();
        const cloudContent = await window.FXCloud.getContent();
        if (cloudContent?.stories) {
          return fileContent ? mergeContentBaseline(cloudContent, fileContent, false) : cloudContent;
        }
      } catch (error) {
        console.warn("云端内容读取失败，改用本地数据", error);
      }
    }

    const local = readLocal();
    if (local?.stories) return fileContent ? mergeContentBaseline(local, fileContent, true) : local;
    return fileContent;
  }

  window.FXContent = {
    load: load,
    readLocal: readLocal
  };
})();
