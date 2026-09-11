import { describe, expect, it } from "vitest";
import {
  buildBugreportArgs,
  buildClearAppDataArgs,
  buildClearLogcatArgs,
  buildConnectArgs,
  buildDeviceActionArgs,
  buildDeviceIpv4Args,
  buildForceStopArgs,
  buildInstallArgs,
  buildKeyEventArgs,
  buildLaunchAppArgs,
  buildPairArgs,
  buildTcpipArgs,
  buildUninstallArgs,
  findLocalSubnetMatch,
  parseAdbDevices,
  parseConnectResult,
  parseDeviceIpv4Addresses,
  parseInstallFailure,
  parseManagedApps,
  parsePackageDetails,
  parsePairResult,
  parseInstalledPackages,
  parseResumedPackages,
  parseRunningAppProcesses
} from "./adb";

describe("buildBugreportArgs", () => {
  it("exports one selected device to the exact local path", () => {
    expect(
      buildBugreportArgs("serial-one", "D:\\Reports\\device bugreport.zip")
    ).toEqual([
      "-s",
      "serial-one",
      "bugreport",
      "D:\\Reports\\device bugreport.zip"
    ]);
  });
});

describe("application management", () => {
  it("parses third-party package names and APK paths", () => {
    expect(
      parseManagedApps([
        "package:/data/app/~~abc/com.example.alpha-xyz/base.apk=com.example.alpha",
        "package:/data/app/com.example.beta/base.apk=com.example.beta",
        ""
      ].join("\n"))
    ).toEqual([
      {
        packageName: "com.example.alpha",
        apkPath: "/data/app/~~abc/com.example.alpha-xyz/base.apk"
      },
      {
        packageName: "com.example.beta",
        apkPath: "/data/app/com.example.beta/base.apk"
      }
    ]);
  });

  it("parses package version, SDK, install, and permission details", () => {
    const output = [
      "Package [com.example.alpha] (123):",
      "  userId=10234",
      "  codePath=/data/app/com.example.alpha",
      "  primaryCpuAbi=arm64-v8a",
      "  versionCode=42 minSdk=24 targetSdk=35",
      "  versionName=2.4.0",
      "  dataDir=/data/user/0/com.example.alpha",
      "  firstInstallTime=2026-08-01 10:20:30",
      "  lastUpdateTime=2026-08-05 11:22:33",
      "  installerPackageName=com.android.shell",
      "  requested permissions:",
      "    android.permission.CAMERA",
      "    android.permission.INTERNET",
      "  install permissions:"
    ].join("\n");

    expect(parsePackageDetails("com.example.alpha", output)).toEqual({
      packageName: "com.example.alpha",
      userId: 10234,
      codePath: "/data/app/com.example.alpha",
      primaryCpuAbi: "arm64-v8a",
      versionCode: 42,
      versionName: "2.4.0",
      minSdk: 24,
      targetSdk: 35,
      dataDir: "/data/user/0/com.example.alpha",
      firstInstallTime: "2026-08-01 10:20:30",
      lastUpdateTime: "2026-08-05 11:22:33",
      installerPackageName: "com.android.shell",
      requestedPermissions: [
        "android.permission.CAMERA",
        "android.permission.INTERNET"
      ]
    });
  });

  it("builds an uninstall command for exactly one device and package", () => {
    expect(buildUninstallArgs("serial-one", "com.example.alpha")).toEqual([
      "-s",
      "serial-one",
      "uninstall",
      "com.example.alpha"
    ]);
  });

  it("builds a force-stop command for exactly one device and package", () => {
    expect(buildForceStopArgs("serial-one", "com.example.alpha")).toEqual([
      "-s",
      "serial-one",
      "shell",
      "am",
      "force-stop",
      "com.example.alpha"
    ]);
  });

  it("clears only the selected logcat buffer of one device", () => {
    expect(buildClearLogcatArgs("serial-one", "system")).toEqual([
      "-s",
      "serial-one",
      "logcat",
      "-b",
      "system",
      "-c"
    ]);
  });
});

describe("buildClearAppDataArgs", () => {
  it("targets one device and one package", () => {
    expect(buildClearAppDataArgs("serial-one", "com.example.demo")).toEqual([
      "-s",
      "serial-one",
      "shell",
      "pm",
      "clear",
      "com.example.demo"
    ]);
  });
});

describe("buildDeviceActionArgs", () => {
  it("targets exactly one device when rebooting", () => {
    expect(buildDeviceActionArgs("serial-one", "reboot")).toEqual([
      "-s",
      "serial-one",
      "reboot"
    ]);
  });

  it("changes the selected device media stream without dispatching hardware volume keys", () => {
    expect(buildDeviceActionArgs("glasses-serial", "volumeUp")).toEqual([
      "-s",
      "glasses-serial",
      "shell",
      "cmd",
      "media_session",
      "volume",
      "--stream",
      "3",
      "--adj",
      "raise",
      "--show"
    ]);
    expect(buildDeviceActionArgs("glasses-serial", "volumeDown").at(-2)).toBe("lower");
  });
});

describe("buildInstallArgs", () => {
  it("targets one device and replaces an existing APK", () => {
    expect(
      buildInstallArgs("serial-one", "C:\\Builds\\android dev demo.apk")
    ).toEqual([
      "-s",
      "serial-one",
      "install",
      "-r",
      "C:\\Builds\\android dev demo.apk"
    ]);
  });

  it("allows version downgrade only when explicitly forced", () => {
    expect(
      buildInstallArgs("serial-one", "C:\\Builds\\demo.apk", {
        forceDowngrade: true
      })
    ).toEqual(["-s", "serial-one", "install", "-r", "-d", "C:\\Builds\\demo.apk"]);
    expect(
      buildInstallArgs("serial-one", "C:\\Builds\\demo.apk", {
        forceDowngrade: false
      })
    ).toEqual(["-s", "serial-one", "install", "-r", "C:\\Builds\\demo.apk"]);
  });
});

describe("parseInstallFailure", () => {
  it("recognises version downgrade failures and allows a forced retry", () => {
    const failure = parseInstallFailure(
      "adb: failed to install D:\\app-release.apk: Failure [INSTALL_FAILED_VERSION_DOWNGRADE]"
    );

    expect(failure?.code).toBe("INSTALL_FAILED_VERSION_DOWNGRADE");
    expect(failure?.canForceDowngrade).toBe(true);
    expect(failure?.reason).toContain("降级");
    expect(failure?.raw).toContain("INSTALL_FAILED_VERSION_DOWNGRADE");
  });

  it("explains signature mismatches without offering a downgrade", () => {
    const failure = parseInstallFailure(
      "Failure [INSTALL_FAILED_UPDATE_INCOMPATIBLE: Package com.example.app signatures do not match previously installed version; ignoring!]"
    );

    expect(failure?.code).toBe("INSTALL_FAILED_UPDATE_INCOMPATIBLE");
    expect(failure?.canForceDowngrade).toBe(false);
    expect(failure?.reason).toContain("卸载");
  });

  it("falls back to the raw code for unmapped install failures", () => {
    const failure = parseInstallFailure("Failure [INSTALL_FAILED_BRAND_NEW]");
    expect(failure?.code).toBe("INSTALL_FAILED_BRAND_NEW");
    expect(failure?.reason).toContain("INSTALL_FAILED_BRAND_NEW");
    expect(failure?.canForceDowngrade).toBe(false);
  });

  it("explains device connection losses", () => {
    expect(parseInstallFailure("error: device 'serial-one' not found")?.code)
      .toBe("DEVICE_NOT_FOUND");
    expect(parseInstallFailure("adb: error: device offline")?.code)
      .toBe("DEVICE_OFFLINE");
    expect(parseInstallFailure("adb: error: closed")?.code)
      .toBe("CONNECTION_LOST");
  });

  it("keeps a generic reason when adb reports failure without a code", () => {
    const failure = parseInstallFailure("adb: failed to install D:\\app.apk");
    expect(failure?.code).toBe("INSTALL_FAILED");
    expect(failure?.canForceDowngrade).toBe(false);
  });

  it("returns undefined for successful or empty output", () => {
    expect(parseInstallFailure("Success")).toBeUndefined();
    expect(parseInstallFailure("Performing streamed install\nSuccess")).toBeUndefined();
    expect(parseInstallFailure("")).toBeUndefined();
  });
});

describe("parseAdbDevices", () => {
  it("parses connected, unauthorized, and offline devices", () => {
    const output = [
      "List of devices attached",
      "48f587f7 device product:dada model:24129PN74C device:dada transport_id:30",
      "emulator-5554 unauthorized usb:1-2 transport_id:31",
      "192.168.1.5:5555 offline transport_id:32",
      ""
    ].join("\r\n");

    expect(parseAdbDevices(output)).toEqual([
      {
        serial: "48f587f7",
        state: "device",
        model: "24129PN74C",
        product: "dada",
        transportId: "30"
      },
      {
        serial: "emulator-5554",
        state: "unauthorized",
        model: undefined,
        product: undefined,
        transportId: "31"
      },
      {
        serial: "192.168.1.5:5555",
        state: "offline",
        model: undefined,
        product: undefined,
        transportId: "32"
      }
    ]);
  });

  it("ignores daemon messages and malformed lines", () => {
    const output = [
      "* daemon not running; starting now at tcp:5037",
      "* daemon started successfully",
      "List of devices attached",
      "unexpected",
      ""
    ].join("\n");

    expect(parseAdbDevices(output)).toEqual([]);
  });
});

describe("buildKeyEventArgs", () => {
  it("targets exactly one serial and maps navigation actions", () => {
    expect(buildKeyEventArgs("abc-123", "back")).toEqual([
      "-s",
      "abc-123",
      "shell",
      "input",
      "keyevent",
      "4"
    ]);
    expect(buildKeyEventArgs("abc-123", "home").at(-1)).toBe("3");
    expect(buildKeyEventArgs("abc-123", "recents").at(-1)).toBe("187");
  });
});

describe("application process discovery", () => {
  it("parses installed package names from package manager output", () => {
    expect(
      parseInstalledPackages(
        "package:com.example.app\r\npackage:com.sunny.glass.xrengine\r\n"
      )
    ).toEqual(["com.example.app", "com.sunny.glass.xrengine"]);
  });

  it("extracts unique resumed packages across Android displays", () => {
    const output = [
      "topResumedActivity=ActivityRecord{abc u0 com.example.phone/.Main t2}",
      "topResumedActivity=ActivityRecord{def u0 com.example.glass/com.demo.Home t3}",
      "mResumedActivity: ActivityRecord{ghi u0 com.example.phone/.Main t2}"
    ].join("\n");

    expect(parseResumedPackages(output)).toEqual([
      "com.example.phone",
      "com.example.glass"
    ]);
  });

  it("lists package processes, preserves remote processes, and marks foreground", () => {
    const output = [
      "PID NAME",
      "4893 com.miui.home",
      "25643 com.sunny.glass.xrengine",
      "25647 com.sunny.glass.xrengine:ardisplay",
      "30982 libtun2socks.so",
      "12 [kworker/R-mm_pe]"
    ].join("\n");

    expect(
      parseRunningAppProcesses(
        output,
        ["com.sunny.glass.xrengine"],
        new Set([
          "com.miui.home",
          "com.sunny.glass.xrengine"
        ])
      )
    ).toEqual([
      {
        pid: 25643,
        processName: "com.sunny.glass.xrengine",
        packageName: "com.sunny.glass.xrengine",
        foreground: true
      },
      {
        pid: 25647,
        processName: "com.sunny.glass.xrengine:ardisplay",
        packageName: "com.sunny.glass.xrengine",
        foreground: true
      },
      {
        pid: 4893,
        processName: "com.miui.home",
        packageName: "com.miui.home",
        foreground: false
      }
    ]);
  });
});

describe("application launch", () => {
  it("launches the launcher activity via monkey without knowing activity names", () => {
    expect(buildLaunchAppArgs("serial-one", "com.example.alpha")).toEqual([
      "-s",
      "serial-one",
      "shell",
      "monkey",
      "-p",
      "com.example.alpha",
      "-c",
      "android.intent.category.LAUNCHER",
      "1"
    ]);
  });
});

describe("wireless debugging", () => {
  it("builds pair, connect, tcpip, and address-list commands", () => {
    expect(buildPairArgs("192.168.1.5:37123", "482913")).toEqual([
      "pair",
      "192.168.1.5:37123",
      "482913"
    ]);
    expect(buildConnectArgs("192.168.1.5:5555")).toEqual([
      "connect",
      "192.168.1.5:5555"
    ]);
    expect(buildTcpipArgs("serial-one", 5555)).toEqual([
      "-s",
      "serial-one",
      "tcpip",
      "5555"
    ]);
    expect(buildDeviceIpv4Args("serial-one")).toEqual([
      "-s",
      "serial-one",
      "shell",
      "ip",
      "-o",
      "-4",
      "addr",
      "show",
      "scope",
      "global"
    ]);
  });

  it("parses device IPv4 addresses and prefers wlan interfaces", () => {
    const output = [
      "2: wlan0    inet 192.168.1.5/24 brd 192.168.1.255 scope global wlan0",
      "8: rmnet_data0    inet 10.72.162.33/30 scope global rmnet_data0",
      "3: wlan1    inet 192.168.2.7/24 scope global wlan1"
    ].join("\n");

    expect(parseDeviceIpv4Addresses(output)).toEqual([
      "192.168.1.5",
      "192.168.2.7",
      "10.72.162.33"
    ]);
  });

  it("maps pair results to success and friendly failures", () => {
    expect(parsePairResult("Successfully paired to 192.168.1.5:37123")).toEqual({
      ok: true,
      message: expect.stringContaining("配对成功")
    });
    expect(
      parsePairResult(
        "Failed to pair to 192.168.1.5:37123: cannot connect to 192.168.1.5:37123: No connection could be made because the target machine actively refused it. (10061)"
      )
    ).toMatchObject({ ok: false });
    expect(
      parsePairResult(
        "Failed to pair to 192.168.1.5:37123: cannot authenticate to target: wrong password"
      )
    ).toMatchObject({ ok: false });
    expect(
      parsePairResult("cannot connect to 192.168.1.5:37123: No route to host (10065)")
    ).toMatchObject({ ok: false });
  });

  it("maps connect results to success and friendly failures", () => {
    const connected = parseConnectResult("connected to 192.168.1.5:5555");
    expect(connected.ok).toBe(true);
    const already = parseConnectResult("already connected to 192.168.1.5:5555");
    expect(already.ok).toBe(true);
    expect(
      parseConnectResult(
        "failed to connect to '192.168.1.5:5555': cannot connect to 192.168.1.5:5555: A connection attempt failed because the connected party did not properly respond after a period of time (10060)"
      )
    ).toMatchObject({ ok: false });
    expect(
      parseConnectResult(
        "cannot connect to 192.168.1.5:5555: No connection could be made because the target machine actively refused it. (10061)"
      )
    ).toMatchObject({ ok: false });
  });
});

describe("findLocalSubnetMatch", () => {
  const interfaces = [
    { address: "172.16.130.30", netmask: "255.255.255.0" },
    { address: "10.41.21.146", netmask: "255.255.0.0" }
  ];

  it("matches when the target falls inside a local interface subnet", () => {
    expect(findLocalSubnetMatch("10.41.99.1", interfaces)).toBe("10.41.21.146");
  });

  it("detects a phone subnet the PC has no interface for", () => {
    expect(findLocalSubnetMatch("192.168.137.5", interfaces)).toBeUndefined();
  });

  it("ignores invalid targets and malformed interfaces", () => {
    expect(findLocalSubnetMatch("not-an-ip", interfaces)).toBeUndefined();
    expect(findLocalSubnetMatch("192.168.137.5", [])).toBeUndefined();
  });
});
