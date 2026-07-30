(function () {
  const ADMIN_CONTENT_KEY = "fx-admin-content";

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

  async function load(url) {
    if (window.FXCloud?.isConfigured()) {
      try {
        await window.FXCloud.init();
        const cloudContent = await window.FXCloud.getContent();
        if (cloudContent?.stories) return cloudContent;
      } catch (error) {
        console.warn("云端内容读取失败，改用本地数据", error);
      }
    }

    const local = readLocal();
    if (local?.stories) return local;

    try {
      const response = await fetch((url || "data/content.json") + "?v=" + Date.now(), { cache: "no-store" });
      if (!response.ok) throw new Error("HTTP " + response.status);
      return await response.json();
    } catch (error) {
      console.warn("内容文件读取失败", error);
      return null;
    }
  }

  window.FXContent = {
    load: load,
    readLocal: readLocal
  };
})();
