import { useEffect, useRef, useState } from "react";
import { Moon, Sun } from "lucide-react";
import { applyTheme, initialTheme, storedTheme, THEME_KEY } from "./theme";

export default function ThemeToggle() {
  const [theme, setTheme] = useState(initialTheme);
  const chosen = useRef(storedTheme() !== null);

  useEffect(() => applyTheme(theme), [theme]);
  useEffect(() => {
    const media = window.matchMedia?.("(prefers-color-scheme: dark)");
    if (!media) return;
    const changed = (event: MediaQueryListEvent) => {
      if (!chosen.current) setTheme(event.matches ? "dark" : "light");
    };
    media.addEventListener("change", changed);
    return () => media.removeEventListener("change", changed);
  }, []);

  function toggle() {
    const next = theme === "light" ? "dark" : "light";
    chosen.current = true;
    setTheme(next);
    try {
      localStorage.setItem(THEME_KEY, next);
    } catch {
      // Retain the selection for this session even if it cannot be saved.
    }
  }

  const label =
    theme === "light" ? "Switch to dark mode" : "Switch to light mode";
  return (
    <button
      className="theme-toggle"
      aria-label={label}
      title={label}
      onClick={toggle}
    >
      {theme === "light" ? <Moon size={16} /> : <Sun size={16} />}
      <span>{theme === "light" ? "Dark mode" : "Light mode"}</span>
    </button>
  );
}
