import fs from "node:fs";
import path from "node:path";
import type { ThemeMode } from "../shared/types";

interface AppSettings {
  theme: ThemeMode;
}

const DEFAULT_SETTINGS: AppSettings = {
  theme: "dark"
};

export function normalizeTheme(value: unknown): ThemeMode {
  return value === "light" || value === "dark" ? value : "dark";
}

export function parseSettings(content: string): AppSettings {
  try {
    const parsed = JSON.parse(content) as { theme?: unknown };
    return { theme: normalizeTheme(parsed.theme) };
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
}

export class SettingsStore {
  private settings: AppSettings;

  constructor(private readonly filePath: string) {
    this.settings = this.read();
  }

  getTheme(): ThemeMode {
    return this.settings.theme;
  }

  setTheme(theme: ThemeMode): void {
    this.settings = { ...this.settings, theme: normalizeTheme(theme) };
    fs.mkdirSync(path.dirname(this.filePath), { recursive: true });
    fs.writeFileSync(
      this.filePath,
      JSON.stringify(this.settings, undefined, 2),
      "utf8"
    );
  }

  private read(): AppSettings {
    try {
      return parseSettings(fs.readFileSync(this.filePath, "utf8"));
    } catch {
      return { ...DEFAULT_SETTINGS };
    }
  }
}
