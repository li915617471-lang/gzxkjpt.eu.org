(function () {
  const defaults = {
    enabled: true,
    supabaseUrl: "https://zpwqkveymyfwgebpkemt.supabase.co",
    supabaseAnonKey: "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Inpwd3FrdmV5bXlmd2dlYnBrZW10Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODU0NjMyMjgsImV4cCI6MjEwMTAzOTIyOH0.yDgIn3zNvfbDFbOpmDlUtDF5U9__f_L10jamPA2bMVE",
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
