import { act, cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import ThemeToggle from "./ThemeToggle";
import { applyTheme, initialTheme, THEME_KEY } from "./theme";

let dark = false;
const listeners = new Set<(event: { matches: boolean }) => void>();

beforeEach(() => {
  localStorage.clear();
  delete document.documentElement.dataset.theme;
  dark = false;
  listeners.clear();
  vi.stubGlobal(
    "matchMedia",
    vi.fn(() => ({
      get matches() {
        return dark;
      },
      addEventListener: (
        _name: string,
        listener: (event: { matches: boolean }) => void,
      ) => listeners.add(listener),
      removeEventListener: (
        _name: string,
        listener: (event: { matches: boolean }) => void,
      ) => listeners.delete(listener),
    })),
  );
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  localStorage.clear();
  delete document.documentElement.dataset.theme;
  document.querySelector('meta[name="theme-color"]')?.remove();
});

function systemTheme(matches: boolean) {
  act(() => {
    dark = matches;
    listeners.forEach((listener) => listener({ matches }));
  });
}

it("switches both ways and restores the selected theme on reload", async () => {
  const user = userEvent.setup();
  const { unmount } = render(<ThemeToggle />);
  expect(document.documentElement.dataset.theme).toBe("light");
  await user.click(screen.getByRole("button", { name: "Switch to dark mode" }));
  expect(document.documentElement.dataset.theme).toBe("dark");
  expect(localStorage.getItem(THEME_KEY)).toBe("dark");
  unmount();
  render(<ThemeToggle />);
  expect(document.documentElement.dataset.theme).toBe("dark");
  await user.click(
    screen.getByRole("button", { name: "Switch to light mode" }),
  );
  expect(document.documentElement.dataset.theme).toBe("light");
  expect(localStorage.getItem(THEME_KEY)).toBe("light");
});

it("uses the system theme until the user chooses a theme", async () => {
  dark = true;
  const user = userEvent.setup();
  render(<ThemeToggle />);
  expect(document.documentElement.dataset.theme).toBe("dark");
  systemTheme(false);
  expect(document.documentElement.dataset.theme).toBe("light");
  await user.click(screen.getByRole("button", { name: "Switch to dark mode" }));
  systemTheme(false);
  expect(document.documentElement.dataset.theme).toBe("dark");
});

it("honors a saved light preference over a dark system preference", () => {
  dark = true;
  localStorage.setItem(THEME_KEY, "light");
  render(<ThemeToggle />);
  expect(document.documentElement.dataset.theme).toBe("light");
  systemTheme(true);
  expect(document.documentElement.dataset.theme).toBe("light");
});

it("ignores invalid preferences and applies the theme before React mounts", () => {
  localStorage.setItem(THEME_KEY, "invalid");
  dark = true;
  const meta = document.createElement("meta");
  meta.name = "theme-color";
  document.head.append(meta);
  applyTheme(initialTheme());
  expect(document.documentElement.dataset.theme).toBe("dark");
  expect(meta.content).toBe("#121a17");
  applyTheme("light");
  expect(meta.content).toBe("#f6f5f0");
});

it("remains usable when browser storage cannot be read or written", async () => {
  vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
    throw new Error("Storage disabled");
  });
  vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
    throw new Error("Storage disabled");
  });
  const user = userEvent.setup();
  render(<ThemeToggle />);
  await user.click(screen.getByRole("button", { name: "Switch to dark mode" }));
  systemTheme(false);
  expect(document.documentElement.dataset.theme).toBe("dark");
  await user.click(
    screen.getByRole("button", { name: "Switch to light mode" }),
  );
  expect(document.documentElement.dataset.theme).toBe("light");
});

it("supports keyboard activation", async () => {
  const user = userEvent.setup();
  render(<ThemeToggle />);
  await user.tab();
  expect(document.activeElement).toBe(
    screen.getByRole("button", { name: "Switch to dark mode" }),
  );
  await user.keyboard("{Enter}");
  expect(document.documentElement.dataset.theme).toBe("dark");
});
