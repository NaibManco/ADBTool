import fs from "node:fs";
import path from "node:path";
import {
  normalizeMirrorQualityPreset,
  type MirrorQualityPreset,
  type ThemeMode
} from "../shared/types";

interface AppSettings {
  theme: ThemeMode;
  mirrorQuality: MirrorQualityPreset;
}

const DEFAULT_SETTINGS: AppSettings = {
  theme: "dark",
  mirrorQuality: "balanced"
};

export function normalizeTheme(value: unknown): ThemeMode {
  return value === "light" || value === "dark" ? value : "dark";
}

export function parseSettings(content: string): AppSettings {
  try {
    const parsed = JSON.parse(content) as {
      theme?: unknown;
      mirrorQuality?: unknown;
    };
    return {
      theme: normalizeTheme(parsed.theme),
      mirrorQuality: normalizeMirrorQualityPreset(parsed.mirrorQuality)
    };
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

  getMirrorQuality(): MirrorQualityPreset {
    return this.settings.mirrorQuality;
  }

  setTheme(theme: ThemeMode): void {
    this.update({ theme: normalizeTheme(theme) });
  }

  setMirrorQuality(preset: MirrorQualityPreset): void {
    this.update({
      mirrorQuality: normalizeMirrorQualityPreset(preset)
    });
  }

  private update(patch: Partial<AppSettings>): void {
    this.settings = { ...this.settings, ...patch };
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
