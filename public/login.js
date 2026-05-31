(function () {
  layui.use(["layer"], function () {
    const layer = layui.layer;
    const form = document.querySelector("#loginForm");
    const password = document.querySelector("#password");
    const button = document.querySelector("#loginButton");

    form.addEventListener("submit", async (event) => {
      event.preventDefault();
      button.disabled = true;
      button.textContent = "登录中...";
      try {
        const res = await fetch("/api/login", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ password: password.value }),
        });
        if (!res.ok) throw new Error((await res.json()).detail || "登录失败");
        location.href = "/";
      } catch (error) {
        layer.msg(error.message || "登录失败", { icon: 2 });
        button.disabled = false;
        button.textContent = "登录后台";
        password.select();
      }
    });
  });
})();
