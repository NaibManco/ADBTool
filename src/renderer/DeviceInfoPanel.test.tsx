import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { AndroidDevice, DeviceInfo } from "../shared/types";
import { DeviceInfoPanel } from "./DeviceInfoPanel";

const device: AndroidDevice = {
  serial: "serial-one",
  state: "device",
  model: "Pixel_One",
  mirroring: false, mirroringEmbedded: false
};

const info: DeviceInfo = {
  serial: device.serial,
  collectedAt: 1_725_000_000_000,
  system: {
    androidVersion: "15",
    sdkLevel: 35,
    securityPatch: "2026-07-05",
    buildId: "AP4A.260705.001",
    displayBuildVersion: "AP4A.260705.001 release-keys",
    incrementalBuildVersion: "12345678",
    kernel: "Linux localhost 6.1.0-android",
    uptimeSeconds: 93661
  },
  hardware: {
    manufacturer: "Google",
    brand: "google",
    model: "Pixel One",
    device: "pixel_one",
    product: "pixel_one",
    soc: "Google Tensor",
    cpuModel: "ARMv8 Processor",
    cpuCores: 8,
    cpuAbis: ["arm64-v8a"]
  },
  memory: { totalBytes: 8 * 1024 ** 3, availableBytes: 4 * 1024 ** 3 },
  storage: { totalBytes: 128 * 1024 ** 3, usedBytes: 48 * 1024 ** 3, availableBytes: 80 * 1024 ** 3 },
  display: { physicalSize: "1080 × 2400", physicalDensity: 440 },
  battery: { level: 86, status: "充电中", health: "良好", temperatureCelsius: 31.5, usbPowered: true },
  network: { connectionType: "USB ADB", ipv4Addresses: ["192.168.1.20"] }
};

describe("DeviceInfoPanel", () => {
  it("shows selectable device system and hardware information", () => {
    const html = renderToStaticMarkup(
      <DeviceInfoPanel
        devices={[device]}
        initialInfo={info}
        onClose={() => undefined}
      />
    );

    expect(html).toContain("设备信息");
    expect(html).toContain("Pixel One");
    expect(html).toContain("Android 15");
    expect(html).toContain("系统构建版本");
    expect(html).toContain("AP4A.260705.001 release-keys");
    expect(html).toContain("增量版本");
    expect(html).toContain("系统信息");
    expect(html).toContain("硬件信息");
    expect(html).toContain("内存与存储");
    expect(html).toContain("屏幕与电池");
    expect(html).toContain("Google Tensor");
    expect(html).toContain("1080 × 2400");
    expect(html).toContain("86%");
    expect(html).toContain("刷新信息");
  });
});
