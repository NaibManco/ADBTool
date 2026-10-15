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
  /** 投屏期间锁定横屏的设备序列号（眼镜锁横屏，手机跟随旋转，各自记忆）。 */
  mirrorLandscapeLock: string[];
}

const DEFAULT_SETTINGS: AppSettings = {
  theme: "dark",
  mirrorQuality: "balanced",
  mirrorLandscapeLock: []
};

export function normalizeTheme(value: unknown): ThemeMode {
  return value === "light" || value === "dark" ? value : "dark";
}

export function parseSettings(content: string): AppSettings {
  try {
    const parsed = JSON.parse(content) as {
      theme?: unknown;
      mirrorQuality?: unknown;
      mirrorLandscapeLock?: unknown;
    };
    return {
      theme: normalizeTheme(parsed.theme),
      mirrorQuality: normalizeMirrorQualityPreset(parsed.mirrorQuality),
      mirrorLandscapeLock: Array.isArray(parsed.mirrorLandscapeLock)
        ? [...new Set(
            parsed.mirrorLandscapeLock.filter(
              (item): item is string => typeof item === "string" && !!item
            )
          )]
        : []
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

  isMirrorLandscapeLocked(serial: string): boolean {
    return this.settings.mirrorLandscapeLock.includes(serial);
  }

  setMirrorLandscapeLock(serial: string, locked: boolean): void {
    const current = new Set(this.settings.mirrorLandscapeLock);
    if (locked) {
      current.add(serial);
    } else {
      current.delete(serial);
    }
    this.update({ mirrorLandscapeLock: [...current] });
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
