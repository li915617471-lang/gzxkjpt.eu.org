(function () {
  const defaults = {
    enabled: false,
    supabaseUrl: "",
    supabaseAnonKey: "",
    contentId: "main",
    storageBucket: "media"
  };
  let saved = {};
  try {
    saved = JSON.parse(localStorage.getItem("fx-cloud-config") || "{}");
  } catch (error) {
    console.warn("云端配置读取失败，继续使用本地模式", error);
  }
  window.FX_CLOUD_CONFIG = Object.assign({}, defaults, saved);
})();
