import React, { createContext, useContext, useEffect, useState } from "react";

type Theme = "light" | "dark";

/**
 * The one key the theme is stored under.
 *
 * Named here because the setting is written in two places — this provider and
 * nothing else. `Settings` used to write it directly while the provider decided
 * separately, and the two disagreed: the officer's choice was saved but never
 * read back, so a reload returned the platform to light with `localStorage`
 * still holding `"dark"`.
 */
const THEME_STORAGE_KEY = "theme";

interface ThemeContextType {
  theme: Theme;
  toggleTheme?: () => void;
  /** Choose one outright, for a control that offers both rather than a toggle. */
  setThemeValue?: (theme: Theme) => void;
  switchable: boolean;
}

const ThemeContext = createContext<ThemeContextType | undefined>(undefined);

interface ThemeProviderProps {
  children: React.ReactNode;
  defaultTheme?: Theme;
  switchable?: boolean;
}

export function ThemeProvider({
  children,
  defaultTheme = "light",
  switchable = false,
}: ThemeProviderProps) {
  const [theme, setTheme] = useState<Theme>(defaultTheme);

  /**
   * The stored theme is restored after mount rather than read in the `useState`
   * initializer. The initializer runs again on the browser's hydration render,
   * where `localStorage` does exist, so reading it there renders a *different*
   * theme from the one the server rendered and fails hydration — the server has
   * no storage to read and always answers `defaultTheme`. Restoring in an effect
   * means the first client render matches the server's and the stored theme is
   * applied immediately after, which is the one-frame flash this arrangement
   * trades away against a hydration error and a mismatched tree.
   */
  useEffect(() => {
    if (!switchable) return;
    const stored = localStorage.getItem(THEME_STORAGE_KEY);
    if (stored === "light" || stored === "dark") setTheme(stored);
  }, [switchable]);

  useEffect(() => {
    const root = document.documentElement;
    if (theme === "dark") {
      root.classList.add("dark");
    } else {
      root.classList.remove("dark");
    }

    if (switchable) {
      try {
        localStorage.setItem(THEME_STORAGE_KEY, theme);
      } catch {
        // A browser with storage disabled still gets the theme for this session.
      }
    }
  }, [theme, switchable]);

  const setThemeValue = switchable
    ? (next: Theme) => {
        setTheme(next);
      }
    : undefined;

  const toggleTheme = switchable
    ? () => {
        setTheme(prev => (prev === "light" ? "dark" : "light"));
      }
    : undefined;

  return (
    <ThemeContext.Provider
      value={{ theme, setThemeValue, toggleTheme, switchable }}
    >
      {children}
    </ThemeContext.Provider>
  );
}

export function useTheme() {
  const context = useContext(ThemeContext);
  if (!context) {
    throw new Error("useTheme must be used within ThemeProvider");
  }
  return context;
}
