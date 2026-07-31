(function () {
  const form = document.querySelector("#passwordForm");
  const password = document.querySelector("#password");
  const passwordConfirm = document.querySelector("#passwordConfirm");
  const submitButton = document.querySelector("#submitPassword");
  const backButton = document.querySelector("#backToAdmin");
  const message = document.querySelector("#authMessage");
  let client = null;
  let sessionReady = false;

  function setMessage(text, isError) {
    message.textContent = text;
    message.style.color = isError ? "var(--red)" : "var(--green)";
  }

  async function initialize() {
    const config = window.FX_CLOUD_CONFIG || {};
    if (!window.supabase?.createClient || !config.supabaseUrl || !config.supabaseAnonKey) {
      setMessage("云端配置未加载，请返回后台后重试。", true);
      return;
    }

    client = window.supabase.createClient(config.supabaseUrl, config.supabaseAnonKey, {
      auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true }
    });

    const result = await client.auth.getSession();
    if (result.error) {
      setMessage(result.error.message || "邀请链接验证失败。", true);
      return;
    }
    if (!result.data.session) {
      setMessage("邀请链接无效或已经过期，请重新发送管理员邀请。", true);
      return;
    }

    sessionReady = true;
    setMessage("邀请验证成功，请设置新密码。", false);
    password.focus();
  }

  form.addEventListener("submit", async function (event) {
    event.preventDefault();
    if (!client || !sessionReady) {
      setMessage("请先通过有效的邀请链接打开本页面。", true);
      return;
    }
    if (password.value.length < 8) {
      setMessage("密码至少需要 8 位。", true);
      return;
    }
    if (password.value !== passwordConfirm.value) {
      setMessage("两次输入的密码不一致。", true);
      return;
    }

    submitButton.disabled = true;
    setMessage("正在保存新密码...", false);
    const result = await client.auth.updateUser({ password: password.value });
    if (result.error) {
      submitButton.disabled = false;
      setMessage(result.error.message || "密码保存失败，请重试。", true);
      return;
    }
    window.location.replace("admin.html");
  });

  backButton.addEventListener("click", function () {
    window.location.href = "admin.html";
  });

  initialize().catch(function (error) {
    console.error(error);
    setMessage("邀请链接验证失败，请重新打开邮件中的链接。", true);
  });
})();
