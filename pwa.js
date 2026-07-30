(function () {
  let installPrompt = null;

  function installButton() {
    return document.getElementById("installApp");
  }

  function hideInstallButton() {
    const button = installButton();
    if (button) button.hidden = true;
  }

  async function installApp() {
    if (!installPrompt) return;
    installPrompt.prompt();
    await installPrompt.userChoice;
    installPrompt = null;
    hideInstallButton();
  }

  window.addEventListener("beforeinstallprompt", function (event) {
    const button = installButton();
    if (button) {
      event.preventDefault();
      installPrompt = event;
      button.hidden = false;
      button.addEventListener("click", installApp, { once: true });
    }
  });

  window.addEventListener("appinstalled", function () {
    installPrompt = null;
    hideInstallButton();
  });

  if ("serviceWorker" in navigator && location.protocol.startsWith("http")) {
    window.addEventListener("load", function () {
      document.documentElement.dataset.pwaState = "registering";
      navigator.serviceWorker.register("sw.js").then(function (registration) {
        const worker = registration.installing || registration.waiting || registration.active;
        document.documentElement.dataset.pwaState = worker?.state || "registered";
        worker?.addEventListener("statechange", function () {
          document.documentElement.dataset.pwaState = worker.state;
        });
      }).catch(function (error) {
        document.documentElement.dataset.pwaState = "error";
        console.warn("离线服务注册失败", error);
      });
    });
  } else {
    document.documentElement.dataset.pwaState = "unsupported";
  }
})();
