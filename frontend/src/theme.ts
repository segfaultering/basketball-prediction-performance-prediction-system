export type Theme = "light" | "dark";
export const THEME_KEY = "courtside-theme";

export function storedTheme(): Theme | null {
  try {
    const value = localStorage.getItem(THEME_KEY);
    return value === "light" || value === "dark" ? value : null;
  } catch {
    // Theme switching still works when browser storage is unavailable.
    return null;
  }
}

export function initialTheme(): Theme {
  return (
    storedTheme() ??
    (window.matchMedia?.("(prefers-color-scheme: dark)").matches
      ? "dark"
      : "light")
  );
}

export function applyTheme(theme: Theme) {
  document.documentElement.dataset.theme = theme;
  document
    .querySelector('meta[name="theme-color"]')
    ?.setAttribute("content", theme === "dark" ? "#121a17" : "#f6f5f0");
}
