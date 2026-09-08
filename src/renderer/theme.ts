import { useCallback, useEffect, useState } from "react";
import type { ThemeMode } from "../shared/types";

export function applyTheme(theme: ThemeMode): void {
  document.documentElement.dataset.theme = theme;
  document.documentElement.style.colorScheme = theme;
}

export function useTheme(): {
  theme: ThemeMode;
  changeTheme: (theme: ThemeMode) => Promise<void>;
} {
  const [theme, setTheme] = useState<ThemeMode>("dark");

  useEffect(() => {
    let active = true;
    const unsubscribe = window.androidTool.onThemeChanged((nextTheme) => {
      if (!active) return;
      setTheme(nextTheme);
      applyTheme(nextTheme);
    });

    void window.androidTool.getTheme().then((nextTheme) => {
      if (!active) return;
      setTheme(nextTheme);
      applyTheme(nextTheme);
    });

    return () => {
      active = false;
      unsubscribe();
    };
  }, []);

  const changeTheme = useCallback(async (nextTheme: ThemeMode) => {
    setTheme(nextTheme);
    applyTheme(nextTheme);
    const result = await window.androidTool.setTheme(nextTheme);
    if (!result.ok) {
      const savedTheme = await window.androidTool.getTheme();
      setTheme(savedTheme);
      applyTheme(savedTheme);
    }
  }, []);

  return { theme, changeTheme };
}
