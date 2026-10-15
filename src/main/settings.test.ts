import { describe, expect, it } from "vitest";
import { parseSettings, normalizeTheme } from "./settings";

describe("settings", () => {
  it("accepts supported themes and falls back to dark", () => {
    expect(normalizeTheme("light")).toBe("light");
    expect(normalizeTheme("dark")).toBe("dark");
    expect(normalizeTheme("system")).toBe("dark");
    expect(normalizeTheme(undefined)).toBe("dark");
  });

  it("recovers safely from missing or malformed settings", () => {
    expect(parseSettings('{"theme":"light"}')).toEqual({
      theme: "light",
      mirrorQuality: "balanced",
      mirrorLandscapeLock: []
    });
    expect(parseSettings('{"theme":"unknown"}')).toEqual({
      theme: "dark",
      mirrorQuality: "balanced",
      mirrorLandscapeLock: []
    });
    expect(parseSettings("not-json")).toEqual({
      theme: "dark",
      mirrorQuality: "balanced",
      mirrorLandscapeLock: []
    });
  });

  it("persists mirror quality presets with safe fallback", () => {
    expect(parseSettings('{"theme":"dark","mirrorQuality":"high"}')).toEqual({
      theme: "dark",
      mirrorQuality: "high",
      mirrorLandscapeLock: []
    });
    expect(
      parseSettings('{"theme":"dark","mirrorQuality":"ultra"}')
    ).toEqual({
      theme: "dark",
      mirrorQuality: "balanced",
      mirrorLandscapeLock: []
    });
  });

  it("keeps the landscape lock as a deduplicated serial allowlist", () => {
    expect(
      parseSettings('{"mirrorLandscapeLock":["glasses","phone","glasses"]}')
    ).toEqual({
      theme: "dark",
      mirrorQuality: "balanced",
      mirrorLandscapeLock: ["glasses", "phone"]
    });
    // 非字符串与空串条目丢弃，非数组整体回退为空
    expect(
      parseSettings('{"mirrorLandscapeLock":["glasses",1,null,""]}')
    ).toEqual({
      theme: "dark",
      mirrorQuality: "balanced",
      mirrorLandscapeLock: ["glasses"]
    });
    expect(parseSettings('{"mirrorLandscapeLock":"glasses"}')).toEqual({
      theme: "dark",
      mirrorQuality: "balanced",
      mirrorLandscapeLock: []
    });
  });
});
