import { describe, expect, it } from "vitest";
import { getLogcatWindowPosition } from "./window-placement";

describe("getLogcatWindowPosition", () => {
  it("places Logcat beside the main window when the display has room", () => {
    expect(
      getLogcatWindowPosition(
        { x: 20, y: 40, width: 880, height: 700 },
        { x: 0, y: 0, width: 1920, height: 1080 },
        900
      )
    ).toEqual({ x: 912, y: 40 });
  });

  it("lets the operating system place Logcat when it would not fit", () => {
    expect(
      getLogcatWindowPosition(
        { x: 120, y: 40, width: 1180, height: 700 },
        { x: 0, y: 0, width: 1600, height: 900 },
        900
      )
    ).toBeUndefined();
  });
});
