(function startApp(global) {
  "use strict";

  const boot = () => {
    const root = document.getElementById("app");
    if (!root) throw new Error("App root was not found.");
    global.SanmokuLab.ui = new global.SanmokuLab.UI(root);
  };

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", boot, { once: true });
  } else {
    boot();
  }
})(globalThis);
