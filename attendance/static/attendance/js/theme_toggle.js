(() => {
  const root = document.documentElement;
  const toggle = document.getElementById("theme-toggle");
  const icon = toggle ? toggle.querySelector(".theme-toggle__icon") : null;
  const label = toggle ? toggle.querySelector(".theme-toggle__text") : null;
  const mql = window.matchMedia ? window.matchMedia("(prefers-color-scheme: light)") : null;
  const modes = ["auto", "light", "dark"];

  const readCookie = (name) => {
    const parts = document.cookie.split(";").map(part => part.trim());
    const match = parts.find(part => part.startsWith(`${name}=`));
    return match ? decodeURIComponent(match.split("=").slice(1).join("=")) : "";
  };

  const writeCookie = (name, value) => {
    const maxAge = 60 * 60 * 24 * 365;
    document.cookie = `${name}=${encodeURIComponent(value)}; Max-Age=${maxAge}; Path=/; SameSite=Lax`;
  };

  const getPreferredTheme = () => (mql && mql.matches ? "light" : "dark");

  const normalizeMode = (value) =>
    modes.includes(value) ? value : "auto";

  const resolveTheme = (mode) =>
    mode === "auto" ? getPreferredTheme() : mode;

  const applyTheme = (mode) => {
    const theme = resolveTheme(mode);
    root.setAttribute("data-theme", theme);
    root.setAttribute("data-bs-theme", theme);
    root.setAttribute("data-theme-mode", mode);
  };

  const syncToggle = (mode) => {
    if (!toggle) return;
    const actual = resolveTheme(mode);
    const isDark = actual === "dark";
    const isAuto = mode === "auto";

    toggle.setAttribute("aria-pressed", isDark ? "true" : "false");
    toggle.setAttribute(
      "aria-label",
      isAuto ? "Тема: система" : `Тема: ${isDark ? "тёмная" : "светлая"}`
    );

    if (icon) {
      icon.classList.toggle("bi-circle-half", isAuto);
      icon.classList.toggle("bi-moon-stars-fill", !isAuto && isDark);
      icon.classList.toggle("bi-sun-fill", !isAuto && !isDark);
    }

    if (label) {
      label.textContent = isAuto ? "Система" : (isDark ? "Тёмная" : "Светлая");
    }
  };

  let mode = normalizeMode(readCookie("theme"));
  applyTheme(mode);
  syncToggle(mode);

  if (toggle) {
    toggle.addEventListener("click", () => {
      const currentIndex = modes.indexOf(mode);
      mode = modes[(currentIndex + 1) % modes.length];
      writeCookie("theme", mode);
      applyTheme(mode);
      syncToggle(mode);
    });
  }

  if (mql) {
    const onSystemChange = () => {
      if (mode !== "auto") return;
      applyTheme(mode);
      syncToggle(mode);
    };

    if (mql.addEventListener) {
      mql.addEventListener("change", onSystemChange);
    } else if (mql.addListener) {
      mql.addListener(onSystemChange);
    }
  }
})();
