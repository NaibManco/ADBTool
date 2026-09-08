import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { DeviceDirectoryCache, FileManager, isPreviewableImage } from "./FileManager";

describe("FileManager", () => {
  it("previews common image files within the size limit", () => {
    const base = {
      path: "/sdcard/photo.jpg",
      type: "file" as const,
      modifiedAt: 0,
      mode: "644"
    };
    expect(isPreviewableImage({ ...base, name: "photo.jpg", size: 1024 })).toBe(true);
    expect(isPreviewableImage({ ...base, name: "photo.txt", size: 1024 })).toBe(false);
    expect(isPreviewableImage({ ...base, name: "photo.png", size: 21 * 1024 * 1024 })).toBe(false);
  });

  it("reuses directory listings per device and invalidates changed directories", () => {
    const cache = new DeviceDirectoryCache();
    const listing = [{
      name: "Download",
      path: "/sdcard/Download",
      type: "directory" as const,
      size: 4096,
      modifiedAt: 1_720_000_000_000,
      mode: "755"
    }];

    cache.set("device-1", "/sdcard", listing);
    expect(cache.get("device-1", "/sdcard")).toBe(listing);
    expect(cache.get("device-2", "/sdcard")).toBeUndefined();
    cache.invalidate("device-1", "/sdcard");
    expect(cache.get("device-1", "/sdcard")).toBeUndefined();
  });

  it("renders the complete device file workflow", () => {
    const html = renderToStaticMarkup(
      <FileManager
        devices={[{ serial: "device-1", state: "device", model: "Pixel_9", mirroring: false, mirroringEmbedded: false }]}
        initialPath="/sdcard"
        initialEntries={[{
          name: "Download",
          path: "/sdcard/Download",
          type: "directory",
          size: 4096,
          modifiedAt: 1_720_000_000_000,
          mode: "755"
        }]}
        onClose={() => undefined}
      />
    );

    expect(html).toContain("设备文件管理");
    expect(html).toContain("/sdcard");
    expect(html).toContain("Download");
    expect(html).toContain("上传文件");
    expect(html).toContain("新建文件夹");
    expect(html).toContain("下载");
    expect(html).toContain("重命名");
    expect(html).toContain("删除");
    expect(html).toContain("权限");
  });
});
