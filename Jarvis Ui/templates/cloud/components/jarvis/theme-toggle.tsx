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
    const colors = window.matchMedia("(prefers-color-scheme: dark)");
    function updateTheme() {
      let storedTheme: string | null = null;
      try {
        storedTheme = window.localStorage.getItem(STORAGE_KEY);
      } catch {
        // A browser with storage disabled can still render the system theme.
      }
      const next = storedTheme === "light" || storedTheme === "dark"
        ? storedTheme : colors.matches ? "dark" : "light";
      setTheme(next);
      applyTheme(next);
    }
    updateTheme();
    colors.addEventListener("change", updateTheme);
    return () => colors.removeEventListener("change", updateTheme);
  }, []);

  function toggleTheme() {
    const nextTheme = theme === "dark" ? "light" : "dark";
    setTheme(nextTheme);
    applyTheme(nextTheme);
    try {
      window.localStorage.setItem(STORAGE_KEY, nextTheme);
    } catch {
      // Keep the live appearance when preferences cannot be persisted.
    }
  }

  return (
    <button
      type="button"
      onClick={toggleTheme}
      className="jarvis-icon-button"
      aria-label={
        theme === "dark" ? "Switch to light mode" : "Switch to dark mode"
      }
    >
      {theme === "dark" ? (
        <SunMediumIcon className="size-4" />
      ) : (
        <MoonStarIcon className="size-4" />
      )}
    </button>
  );
}
