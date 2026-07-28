import { useEffect, useState } from "react";

const themeModes = ["system", "light", "dark"] as const;
type ThemeMode = (typeof themeModes)[number];

const storageKey = "pipeline-studio-theme";

function storedTheme(): ThemeMode {
  const value = window.localStorage.getItem(storageKey);
  return themeModes.includes(value as ThemeMode) ? (value as ThemeMode) : "system";
}

function resolvedTheme(mode: ThemeMode): "light" | "dark" {
  if (mode !== "system") return mode;
  return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

function applyTheme(mode: ThemeMode): void {
  const resolved = resolvedTheme(mode);
  document.documentElement.classList.toggle("dark", resolved === "dark");
  document.documentElement.dataset.theme = mode;
  document.documentElement.style.colorScheme = resolved;
  document
    .querySelector('meta[name="theme-color"]')
    ?.setAttribute("content", resolved === "dark" ? "#10131b" : "#f4f6fb");
}

function initializeTheme(): void {
  applyTheme(storedTheme());
}

function useTheme(): {
  mode: ThemeMode;
  setMode: (mode: ThemeMode) => void;
  cycleMode: () => void;
} {
  const [mode, setModeState] = useState<ThemeMode>(storedTheme);

  useEffect(() => {
    applyTheme(mode);
    window.localStorage.setItem(storageKey, mode);
    const media = window.matchMedia("(prefers-color-scheme: dark)");
    const refresh = () => {
      if (mode === "system") applyTheme("system");
    };
    media.addEventListener("change", refresh);
    return () => media.removeEventListener("change", refresh);
  }, [mode]);

  const setMode = (nextMode: ThemeMode) => setModeState(nextMode);
  const cycleMode = () => {
    const index = themeModes.indexOf(mode);
    setModeState(themeModes[(index + 1) % themeModes.length] ?? "system");
  };

  return { mode, setMode, cycleMode };
}

export { initializeTheme, themeModes, useTheme };
export type { ThemeMode };
