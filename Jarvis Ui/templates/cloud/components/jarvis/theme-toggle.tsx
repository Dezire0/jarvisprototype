"use client";

import { MoonStarIcon, SunMediumIcon } from "lucide-react";
import { useEffect, useState } from "react";

const STORAGE_KEY = "jarvis-ui-theme";

function applyTheme(nextTheme: "dark" | "light") {
  if (typeof document === "undefined") {
    return;
  }

  document.documentElement.classList.toggle("dark", nextTheme === "dark");
  document.documentElement.style.colorScheme =
    nextTheme === "dark" ? "dark" : "light";
}

export function ThemeToggle() {
  const [theme, setTheme] = useState<"dark" | "light">("dark");

  useEffect(() => {
    const storedTheme =
      typeof window !== "undefined"
        ? window.localStorage.getItem(STORAGE_KEY)
        : null;
    const resolvedTheme =
      storedTheme === "light" || storedTheme === "dark"
        ? storedTheme
        : "dark";

    setTheme(resolvedTheme);
    applyTheme(resolvedTheme);
  }, []);

  function toggleTheme() {
    const nextTheme = theme === "dark" ? "light" : "dark";
    setTheme(nextTheme);
    applyTheme(nextTheme);
    window.localStorage.setItem(STORAGE_KEY, nextTheme);
  }

  return (
    <button
      type="button"
      onClick={toggleTheme}
      className="aui-theme-toggle inline-flex h-10 items-center gap-2 rounded-full border border-border/70 bg-card/70 px-4 text-sm font-medium text-foreground transition hover:bg-accent"
      aria-label={
        theme === "dark" ? "Switch to light mode" : "Switch to dark mode"
      }
    >
      {theme === "dark" ? (
        <SunMediumIcon className="size-4" />
      ) : (
        <MoonStarIcon className="size-4" />
      )}
      <span>{theme === "dark" ? "Light mode" : "Dark mode"}</span>
    </button>
  );
}
