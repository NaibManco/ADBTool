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
    expect(parseSettings('{"theme":"light"}')).toEqual({ theme: "light" });
    expect(parseSettings('{"theme":"unknown"}')).toEqual({ theme: "dark" });
    expect(parseSettings("not-json")).toEqual({ theme: "dark" });
  });
});
