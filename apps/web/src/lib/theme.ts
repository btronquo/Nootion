export type ThemeChoice = "system" | "light" | "dark";

const KEY = "nootion-theme";
const prefersDark = window.matchMedia("(prefers-color-scheme: dark)");

/** Saved per browser, so each device can have its own choice. */
export function getTheme(): ThemeChoice {
  try {
    const v = localStorage.getItem(KEY);
    if (v === "light" || v === "dark") return v;
  } catch {
    // Storage blocked: follow the system.
  }
  return "system";
}

export function setTheme(choice: ThemeChoice) {
  try {
    if (choice === "system") localStorage.removeItem(KEY);
    else localStorage.setItem(KEY, choice);
  } catch {
    // Applied for this visit only.
  }
  applyTheme(choice);
}

export function applyTheme(choice = getTheme()) {
  const dark = choice === "dark" || (choice === "system" && prefersDark.matches);
  document.documentElement.classList.toggle("dark", dark);
  // Native controls (scrollbars, date pickers) follow the theme too.
  document.documentElement.style.colorScheme = dark ? "dark" : "light";
  // The phone's status bar matches the page.
  document.querySelectorAll('meta[name="theme-color"]').forEach((m) => {
    m.removeAttribute("media");
    m.setAttribute("content", dark ? "#171717" : "#ffffff");
  });
}

export function initTheme() {
  applyTheme();
  prefersDark.addEventListener("change", () => applyTheme());
}
