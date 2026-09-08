import { describe, expect, it } from "vitest";
import {
  buildDeleteRecordingArgs,
  buildPullRecordingArgs,
  buildScreenshotArgs,
  buildStartRecordingArgs,
  buildStopRecordingArgs,
  parseRecordingPid
} from "./capture-manager";

describe("screen capture adb commands", () => {
  it("captures a PNG from exactly one device", () => {
    expect(buildScreenshotArgs("serial-one")).toEqual([
      "-s",
      "serial-one",
      "exec-out",
      "screencap",
      "-p"
    ]);
  });

  it("starts a time-limited recording and returns its remote pid", () => {
    expect(
      buildStartRecordingArgs("serial-one", "/sdcard/AndroidDevTool-123.mp4")
    ).toEqual([
      "-s",
      "serial-one",
      "shell",
      "sh",
      "-c",
      "\"screenrecord --time-limit 180 /sdcard/AndroidDevTool-123.mp4 >/dev/null 2>&1 & echo \\$!\""
    ]);
    expect(parseRecordingPid("3214\r\n")).toBe(3214);
  });

  it("stops, pulls, and removes one recording", () => {
    expect(buildStopRecordingArgs("serial-one", 3214)).toEqual([
      "-s",
      "serial-one",
      "shell",
      "kill",
      "-2",
      "3214"
    ]);
    expect(
      buildPullRecordingArgs(
        "serial-one",
        "/sdcard/AndroidDevTool-123.mp4",
        "C:\\Videos\\demo.mp4"
      )
    ).toEqual([
      "-s",
      "serial-one",
      "pull",
      "/sdcard/AndroidDevTool-123.mp4",
      "C:\\Videos\\demo.mp4"
    ]);
    expect(
      buildDeleteRecordingArgs("serial-one", "/sdcard/AndroidDevTool-123.mp4")
    ).toEqual([
      "-s",
      "serial-one",
      "shell",
      "rm",
      "-f",
      "/sdcard/AndroidDevTool-123.mp4"
    ]);
  });

  it("rejects invalid screenrecord pid output", () => {
    expect(() => parseRecordingPid("not-a-pid")).toThrow("录屏进程");
  });
});
