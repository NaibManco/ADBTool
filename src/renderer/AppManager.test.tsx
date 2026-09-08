import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { AndroidDevice, ManagedApp, ManagedAppDetails } from "../shared/types";
import { AppManager } from "./AppManager";

const device: AndroidDevice = {
  serial: "serial-one",
  state: "device",
  model: "Pixel_One",
  mirroring: false, mirroringEmbedded: false
};

const app: ManagedApp = {
  packageName: "com.example.alpha",
  apkPath: "/data/app/com.example.alpha/base.apk"
};

const details: ManagedAppDetails = {
  packageName: app.packageName,
  versionName: "2.4.0",
  versionCode: 42,
  minSdk: 24,
  targetSdk: 35,
  firstInstallTime: "2026-08-01 10:20:30",
  requestedPermissions: ["android.permission.CAMERA"]
};

describe("AppManager", () => {
  it("shows device selection, searchable apps, details, and destructive actions", () => {
    const html = renderToStaticMarkup(
      <AppManager
        devices={[device]}
        initialApps={[app]}
        initialDetails={details}
        onClose={() => undefined}
      />
    );

    expect(html).toContain("应用管理");
    expect(html).toContain("Pixel One");
    expect(html).toContain("搜索应用包名");
    expect(html).toContain("com.example.alpha");
    expect(html).toContain("2.4.0");
    expect(html).toContain("清除数据");
    expect(html).toContain("停止运行");
    expect(html).toContain("卸载应用");
  });
});
