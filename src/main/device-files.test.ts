import { describe, expect, it } from "vitest";
import {
  buildCreateDirectoryArgs,
  buildDeleteFileArgs,
  buildListFilesArgs,
  buildPullFileArgs,
  buildPushFileArgs,
  buildReadFileArgs,
  buildRenameFileArgs,
  normalizeDevicePath,
  detectImageMime,
  parseDeviceFileList
} from "./device-files";

describe("device file commands", () => {
  it("normalizes absolute Android paths and rejects unsafe paths", () => {
    expect(normalizeDevicePath("/sdcard/Download/../Pictures")).toBe("/sdcard/Pictures");
    expect(() => normalizeDevicePath("sdcard/Pictures")).toThrow("绝对路径");
    expect(() => normalizeDevicePath("/sdcard/\0bad")).toThrow("无效字符");
  });

  it("quotes device paths without interpolating them into adb arguments", () => {
    const listArgs = buildListFilesArgs("serial-1", "/sdcard/A B's");
    expect(listArgs.slice(0, 5)).toEqual(["-s", "serial-1", "shell", "sh", "-c"]);
    expect(listArgs[5]).toContain("/sdcard/A B");
    expect(listArgs[5]).toContain("\\\\''s");
    expect(buildCreateDirectoryArgs("serial-1", "/sdcard", "New folder")[5]).toContain("mkdir -- '/sdcard/New folder'");
    expect(buildRenameFileArgs("serial-1", "/sdcard/old name", "new name")[5]).toContain("mv -- '/sdcard/old name' '/sdcard/new name'");
    expect(buildDeleteFileArgs("serial-1", "/sdcard/old name")[5]).toContain("rm -rf -- '/sdcard/old name'");
  });

  it("keeps host paths as direct push and pull arguments", () => {
    expect(buildPushFileArgs("serial-1", "D:\\My Files\\a.txt", "/sdcard/Download")).toEqual([
      "-s", "serial-1", "push", "D:\\My Files\\a.txt", "/sdcard/Download/"
    ]);
    expect(buildPullFileArgs("serial-1", "/sdcard/a.txt", "D:\\Downloads")).toEqual([
      "-s", "serial-1", "pull", "/sdcard/a.txt", "D:\\Downloads"
    ]);
  });

  it("reads quoted remote paths and recognizes supported image bytes", () => {
    const args = buildReadFileArgs("serial-1", "/sdcard/My Photos/a b.png");
    expect(args.slice(0, 5)).toEqual(["-s", "serial-1", "exec-out", "sh", "-c"]);
    expect(args[5]).toContain("/sdcard/My Photos/a b.png");
    expect(detectImageMime(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))).toBe("image/png");
    expect(detectImageMime(Buffer.from([255, 216, 255, 224]))).toBe("image/jpeg");
    expect(detectImageMime(Buffer.from("not-an-image"))).toBeUndefined();
  });

  it("parses stat rows and sorts folders before files", () => {
    const entries = parseDeviceFileList(
      "regular file\t12\t1720000000\t644\t/sdcard/z.txt\n" +
      "directory\t4096\t1720000100\t755\t/sdcard/Alpha\n" +
      "symbolic link\t7\t1720000200\t777\t/sdcard/link\n"
    );
    expect(entries.map((entry) => [entry.name, entry.type])).toEqual([
      ["Alpha", "directory"],
      ["link", "link"],
      ["z.txt", "file"]
    ]);
    expect(entries[2].size).toBe(12);
    expect(entries[2].modifiedAt).toBe(1_720_000_000_000);
  });
});
