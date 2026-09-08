import { describe, expect, it } from "vitest";
import { parseDeviceInfo } from "./device-info";

describe("parseDeviceInfo", () => {
  it("parses system, hardware, memory, storage, display, battery, and network data", () => {
    const info = parseDeviceInfo("192.168.1.20:5555", {
      properties: [
        "[ro.build.version.release]: [15]",
        "[ro.build.version.sdk]: [35]",
        "[ro.build.version.security_patch]: [2026-07-05]",
        "[ro.build.id]: [AP4A.260705.001]",
        "[ro.build.display.id]: [AP4A.260705.001 release-keys]",
        "[ro.build.version.incremental]: [12345678]",
        "[ro.build.type]: [userdebug]",
        "[ro.build.fingerprint]: [demo/device/build:15/AP4A/123:userdebug/test-keys]",
        "[ro.product.manufacturer]: [Demo]",
        "[ro.product.brand]: [DemoBrand]",
        "[ro.product.model]: [Demo Phone]",
        "[ro.product.device]: [demo_device]",
        "[ro.product.name]: [demo_product]",
        "[ro.product.board]: [demo_board]",
        "[ro.hardware]: [qcom]",
        "[ro.soc.manufacturer]: [Qualcomm]",
        "[ro.soc.model]: [SM8650]",
        "[ro.product.cpu.abilist]: [arm64-v8a,armeabi-v7a]",
        "[ro.serialno]: [R28M30ABCDE]",
        "[ro.bootloader]: [demo-1.0]"
      ].join("\n"),
      cpuInfo: "Processor\t: AArch64 Processor rev 1\nHardware\t: Qualcomm Technologies, Inc SM8650\n",
      cpuPresent: "0-7\n",
      memory: "MemTotal:       12288000 kB\nMemAvailable:    6144000 kB\n",
      storage: "Filesystem 1K-blocks Used Available Use% Mounted on\n/dev/block/dm-8 120000000 40000000 80000000 34% /data\n",
      display: "Physical size: 1080x2400\nOverride size: 720x1600\nPhysical density: 440\nOverride density: 320\n",
      battery: "AC powered: false\nUSB powered: true\nWireless powered: false\nstatus: 2\nhealth: 2\nlevel: 86\nvoltage: 4380\ntemperature: 315\ntechnology: Li-ion\n",
      kernel: "Linux localhost 6.1.0-android #1 SMP PREEMPT",
      uptime: "93661.42 12345.67\n",
      network: "12: wlan0    inet 192.168.1.20/24 brd 192.168.1.255 scope global wlan0\n"
    }, 1_725_000_000_000);

    expect(info.deviceSn).toBe("R28M30ABCDE");
    expect(info.system).toMatchObject({
      androidVersion: "15",
      sdkLevel: 35,
      securityPatch: "2026-07-05",
      buildId: "AP4A.260705.001",
      displayBuildVersion: "AP4A.260705.001 release-keys",
      incrementalBuildVersion: "12345678",
      buildType: "userdebug",
      kernel: "Linux localhost 6.1.0-android #1 SMP PREEMPT",
      uptimeSeconds: 93661
    });
    expect(info.hardware).toMatchObject({
      manufacturer: "Demo",
      model: "Demo Phone",
      soc: "Qualcomm SM8650",
      cpuCores: 8,
      cpuAbis: ["arm64-v8a", "armeabi-v7a"]
    });
    expect(info.memory).toEqual({
      totalBytes: 12_582_912_000,
      availableBytes: 6_291_456_000
    });
    expect(info.storage).toEqual({
      totalBytes: 122_880_000_000,
      usedBytes: 40_960_000_000,
      availableBytes: 81_920_000_000
    });
    expect(info.display).toEqual({
      physicalSize: "1080 × 2400",
      overrideSize: "720 × 1600",
      physicalDensity: 440,
      overrideDensity: 320
    });
    expect(info.battery).toMatchObject({
      level: 86,
      status: "充电中",
      health: "良好",
      temperatureCelsius: 31.5,
      voltageMillivolts: 4380,
      usbPowered: true
    });
    expect(info.network).toEqual({
      connectionType: "网络 ADB",
      ipv4Addresses: ["192.168.1.20"]
    });
  });

  it("keeps unavailable optional fields empty without inventing values", () => {
    const info = parseDeviceInfo("serial-one", {
      properties: "[ro.product.model]: [Minimal Device]",
      cpuInfo: "processor\t: 0\nprocessor\t: 1\n",
      cpuPresent: "",
      memory: "",
      storage: "",
      display: "",
      battery: "",
      kernel: "",
      uptime: "",
      network: ""
    }, 1000);

    expect(info.hardware.model).toBe("Minimal Device");
    expect(info.deviceSn).toBeUndefined();
    expect(info.hardware.cpuCores).toBeUndefined();
    expect(info.hardware.cpuModel).toBeUndefined();
    expect(info.storage.totalBytes).toBeUndefined();
    expect(info.battery.level).toBeUndefined();
    expect(info.network.connectionType).toBe("USB ADB");
  });
});
