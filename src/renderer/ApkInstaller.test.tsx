import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { AndroidDevice } from "../shared/types";
import { ApkFailurePrompt, ApkInstaller, mergeRecentApk } from "./ApkInstaller";

const devices: AndroidDevice[] = [
  {
    serial: "serial-one",
    state: "device",
    model: "Pixel_One",
    mirroring: false, mirroringEmbedded: false
  },
  {
    serial: "serial-two",
    state: "device",
    model: "Pixel_Two",
    mirroring: false, mirroringEmbedded: false
  }
];

describe("ApkInstaller", () => {
  it("shows the selected APK and requires an explicit target device", () => {
    const html = renderToStaticMarkup(
      <ApkInstaller
        devices={devices}
        initialFile={{
          path: "C:\\Builds\\android-dev-demo.apk",
          name: "android-dev-demo.apk",
          size: 12_345
        }}
        onClose={() => undefined}
      />
    );

    expect(html).toContain("安装 APK");
    expect(html).toContain("android-dev-demo.apk");
    expect(html).toContain("选择目标设备");
    expect(html).toContain("或输入 APK 绝对路径");
    expect(html).toContain("D:\\Builds\\app-debug.apk");
    expect(html).toContain("使用路径");
    expect(html).toContain("Pixel One");
    expect(html).toContain("Pixel Two");
    expect(html).toContain('type="radio"');
    expect(html).toContain("选择设备后安装");
    expect(html).toContain("安装成功后启动应用");
    expect(html).toContain('type="checkbox"');
  });
});

describe("mergeRecentApk", () => {
  const entry = (path: string, installedAt = 0) => ({
    path,
    name: `${path}.apk`,
    size: 100,
    installedAt,
    serial: "serial-one"
  });

  it("puts the newest install first and dedupes by path", () => {
    const next = mergeRecentApk(
      [entry("a"), entry("b"), entry("c")],
      entry("b", 999)
    );
    expect(next.map((item) => item.path)).toEqual(["b", "a", "c"]);
    expect(next[0].installedAt).toBe(999);
  });

  it("caps the list at five entries", () => {
    const next = mergeRecentApk(
      [entry("a"), entry("b"), entry("c"), entry("d"), entry("e")],
      entry("f")
    );
    expect(next.map((item) => item.path)).toEqual(["f", "a", "b", "c", "d"]);
  });
});

describe("ApkFailurePrompt", () => {
  it("offers a forced downgrade retry only for downgrade failures", () => {
    const downgradeHtml = renderToStaticMarkup(
      <ApkFailurePrompt
        failure={{
          code: "INSTALL_FAILED_VERSION_DOWNGRADE",
          reason: "设备上已安装更高版本，系统默认拒绝降级安装。",
          canForceDowngrade: true,
          raw: "adb: failed to install app.apk: Failure [INSTALL_FAILED_VERSION_DOWNGRADE]"
        }}
        onForceDowngrade={() => undefined}
      />
    );

    expect(downgradeHtml).toContain("是否仍要强制降级安装");
    expect(downgradeHtml).toContain("强制降级安装</button>");
    expect(downgradeHtml).toContain("INSTALL_FAILED_VERSION_DOWNGRADE");

    const signatureHtml = renderToStaticMarkup(
      <ApkFailurePrompt
        failure={{
          code: "INSTALL_FAILED_UPDATE_INCOMPATIBLE",
          reason: "与设备上已安装版本的签名不一致。",
          canForceDowngrade: false,
          raw: "Failure [INSTALL_FAILED_UPDATE_INCOMPATIBLE]"
        }}
        onForceDowngrade={() => undefined}
      />
    );

    expect(signatureHtml).toContain("INSTALL_FAILED_UPDATE_INCOMPATIBLE");
    expect(signatureHtml).not.toContain("强制降级安装");
  });
});
