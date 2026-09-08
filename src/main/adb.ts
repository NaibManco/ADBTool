import { execFile } from "node:child_process";
import { promisify } from "node:util";
import type {
  AndroidDevice,
  ApkInstallFailure,
  ApkInstallOptions,
  AppProcess,
  DeviceAction,
  LogcatBuffer,
  ManagedApp,
  ManagedAppDetails
} from "../shared/types";

const execFileAsync = promisify(execFile);

type VolumeAction = Extract<DeviceAction, "volumeUp" | "volumeDown">;
type KeyEventAction = Exclude<DeviceAction, "reboot" | VolumeAction>;

const KEY_CODES: Record<KeyEventAction, number> = {
  back: 4,
  home: 3,
  recents: 187,
  power: 26
};

export function parseAdbDevices(
  output: string
): Omit<AndroidDevice, "mirroring" | "mirroringEmbedded">[] {
  const devices: Omit<AndroidDevice, "mirroring" | "mirroringEmbedded">[] = [];

  for (const rawLine of output.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("List of devices") || line.startsWith("*")) {
      continue;
    }

    const parts = line.split(/\s+/);
    if (parts.length < 2 || !["device", "offline", "unauthorized"].includes(parts[1])) {
      continue;
    }

    const attributes = new Map<string, string>();
    for (const part of parts.slice(2)) {
      const separator = part.indexOf(":");
      if (separator > 0) {
        attributes.set(part.slice(0, separator), part.slice(separator + 1));
      }
    }

    devices.push({
      serial: parts[0],
      state: parts[1],
      model: attributes.get("model"),
      product: attributes.get("product"),
      transportId: attributes.get("transport_id")
    });
  }

  return devices;
}

export function buildKeyEventArgs(serial: string, action: KeyEventAction): string[] {
  return [
    "-s",
    serial,
    "shell",
    "input",
    "keyevent",
    String(KEY_CODES[action])
  ];
}

export function buildDeviceActionArgs(
  serial: string,
  action: DeviceAction
): string[] {
  if (action === "reboot") return ["-s", serial, "reboot"];
  if (action === "volumeUp" || action === "volumeDown") {
    return [
      "-s",
      serial,
      "shell",
      "cmd",
      "media_session",
      "volume",
      "--stream",
      "3",
      "--adj",
      action === "volumeUp" ? "raise" : "lower",
      "--show"
    ];
  }
  return buildKeyEventArgs(serial, action);
}

export function buildInstallArgs(
  serial: string,
  apkPath: string,
  options?: ApkInstallOptions
): string[] {
  return [
    "-s",
    serial,
    "install",
    "-r",
    ...(options?.forceDowngrade ? ["-d"] : []),
    apkPath
  ];
}

export function buildBugreportArgs(serial: string, destination: string): string[] {
  return ["-s", serial, "bugreport", destination];
}

export function buildClearAppDataArgs(
  serial: string,
  packageName: string
): string[] {
  return ["-s", serial, "shell", "pm", "clear", packageName];
}

export function buildListInstalledPackagesArgs(serial: string): string[] {
  return ["-s", serial, "shell", "pm", "list", "packages", "-3"];
}

export function buildListManagedAppsArgs(serial: string): string[] {
  return ["-s", serial, "shell", "pm", "list", "packages", "-3", "-f"];
}

export function buildPackageDetailsArgs(
  serial: string,
  packageName: string
): string[] {
  return ["-s", serial, "shell", "dumpsys", "package", packageName];
}

export function buildUninstallArgs(
  serial: string,
  packageName: string
): string[] {
  return ["-s", serial, "uninstall", packageName];
}

export function buildForceStopArgs(
  serial: string,
  packageName: string
): string[] {
  return ["-s", serial, "shell", "am", "force-stop", packageName];
}

export function buildClearLogcatArgs(
  serial: string,
  buffer: LogcatBuffer
): string[] {
  return ["-s", serial, "logcat", "-b", buffer, "-c"];
}

export function parseResumedPackages(output: string): string[] {
  const packages: string[] = [];
  const seen = new Set<string>();
  const activityPattern =
    /(?:topResumedActivity|mResumedActivity)[^}]*\su\d+\s+([A-Za-z0-9_]+(?:\.[A-Za-z0-9_]+)+)\//g;

  for (const match of output.matchAll(activityPattern)) {
    if (!seen.has(match[1])) {
      seen.add(match[1]);
      packages.push(match[1]);
    }
  }

  return packages;
}

export function parseInstalledPackages(output: string): string[] {
  return output
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.startsWith("package:"))
    .map((line) => line.slice("package:".length))
    .filter(Boolean);
}

export function parseManagedApps(output: string): ManagedApp[] {
  const apps: ManagedApp[] = [];
  for (const rawLine of output.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line.startsWith("package:")) continue;
    const value = line.slice("package:".length);
    const separator = value.lastIndexOf("=");
    if (separator <= 0 || separator === value.length - 1) continue;
    apps.push({
      apkPath: value.slice(0, separator),
      packageName: value.slice(separator + 1)
    });
  }
  return apps.sort((left, right) =>
    left.packageName.localeCompare(right.packageName)
  );
}

function stringField(output: string, field: string): string | undefined {
  const match = new RegExp(`^\\s*${field}=([^\\r\\n]+)`, "m").exec(output);
  return match?.[1].trim() || undefined;
}

function numberField(output: string, field: string): number | undefined {
  const match = new RegExp(`(?:^|\\s)${field}=(\\d+)`, "m").exec(output);
  return match ? Number(match[1]) : undefined;
}

export function parsePackageDetails(
  packageName: string,
  output: string
): ManagedAppDetails {
  const requestedPermissions: string[] = [];
  let readingPermissions = false;
  for (const rawLine of output.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (line === "requested permissions:") {
      readingPermissions = true;
      continue;
    }
    if (!readingPermissions) continue;
    if (/^[A-Za-z][A-Za-z0-9_.]+$/.test(line)) {
      requestedPermissions.push(line);
    } else if (line) {
      readingPermissions = false;
    }
  }

  return {
    packageName,
    userId: numberField(output, "userId"),
    codePath: stringField(output, "codePath"),
    primaryCpuAbi: stringField(output, "primaryCpuAbi"),
    versionCode: numberField(output, "versionCode"),
    versionName: stringField(output, "versionName"),
    minSdk: numberField(output, "minSdk"),
    targetSdk: numberField(output, "targetSdk"),
    dataDir: stringField(output, "dataDir"),
    firstInstallTime: stringField(output, "firstInstallTime"),
    lastUpdateTime: stringField(output, "lastUpdateTime"),
    installerPackageName: stringField(output, "installerPackageName"),
    requestedPermissions
  };
}

export function parseRunningAppProcesses(
  output: string,
  resumedPackages: string[],
  installedPackages?: Set<string>
): AppProcess[] {
  const foregroundPackages = new Set(resumedPackages);
  const packageProcessPattern =
    /^[A-Za-z][A-Za-z0-9_]*(?:\.[A-Za-z][A-Za-z0-9_]*)+(?::[A-Za-z0-9_.-]+)?$/;
  const processes: AppProcess[] = [];

  for (const rawLine of output.split(/\r?\n/)) {
    const match = /^\s*(\d+)\s+(\S+)\s*$/.exec(rawLine);
    if (!match || !packageProcessPattern.test(match[2])) continue;
    const processName = match[2];
    const packageName = processName.split(":", 1)[0];
    if (installedPackages && !installedPackages.has(packageName)) continue;
    processes.push({
      pid: Number(match[1]),
      processName,
      packageName,
      foreground: foregroundPackages.has(packageName)
    });
  }

  return processes.sort((left, right) => {
    if (left.foreground !== right.foreground) {
      return left.foreground ? -1 : 1;
    }
    const packageOrder = left.packageName.localeCompare(right.packageName);
    return packageOrder || left.processName.localeCompare(right.processName);
  });
}

const INSTALL_FAILURE_REASONS: Record<string, string> = {
  INSTALL_FAILED_VERSION_DOWNGRADE:
    "设备上已安装更高版本，系统默认拒绝降级安装。可先卸载设备上的新版本，或选择强制降级安装。",
  INSTALL_FAILED_ALREADY_EXISTS:
    "设备上已存在同包名应用，无法直接安装。请先卸载旧版本后重试。",
  INSTALL_FAILED_DUPLICATE_PACKAGE:
    "设备上已存在同包名应用。请先卸载旧版本后重试。",
  INSTALL_FAILED_UPDATE_INCOMPATIBLE:
    "与设备上已安装版本的签名不一致。请先卸载设备上的旧版本，再安装此 APK。",
  INSTALL_PARSE_FAILED_INCONSISTENT_CERTIFICATES:
    "APK 签名与设备上已安装版本不一致。请先卸载旧版本后重试。",
  INSTALL_FAILED_INVALID_APK:
    "APK 文件无效或已损坏，请重新获取安装包。",
  INSTALL_FAILED_INVALID_URI:
    "APK 路径无效，请确认文件路径正确。",
  INSTALL_PARSE_FAILED_NOT_APK:
    "所选文件不是有效的 APK 安装包。",
  INSTALL_PARSE_FAILED_BAD_MANIFEST:
    "APK 清单文件（AndroidManifest）损坏，安装包可能不完整。",
  INSTALL_PARSE_FAILED_NO_CERTIFICATES:
    "APK 缺少签名证书，无法安装。",
  INSTALL_PARSE_FAILED_CERTIFICATE_ENCODING:
    "APK 证书编码错误，无法安装。",
  INSTALL_FAILED_OLDER_SDK:
    "设备 Android 系统版本过低，不满足该 APK 要求的最低系统版本。",
  INSTALL_FAILED_NO_MATCHING_ABIS:
    "该 APK 不包含此设备支持的 CPU 架构（ABI），无法安装到这台设备。",
  INSTALL_FAILED_INSUFFICIENT_STORAGE:
    "设备存储空间不足，请清理空间后重试。",
  INSTALL_FAILED_DEXOPT:
    "设备优化安装包失败（dexopt）。请确认 APK 与设备系统版本匹配后重试。",
  INSTALL_FAILED_VERIFICATION_FAILURE:
    "安装校验失败，APK 可能不完整或被系统拦截。",
  INSTALL_FAILED_VERIFICATION_TIMEOUT:
    "安装校验超时，请重试。",
  INSTALL_FAILED_SHARED_USER_INCOMPATIBLE:
    "与已安装应用共享 UID 但签名不一致，无法覆盖安装。请先卸载冲突应用。",
  INSTALL_FAILED_MISSING_SHARED_LIBRARY:
    "APK 依赖的共享库在此设备上不存在，无法安装。",
  INSTALL_FAILED_REPLACE_COULDNT_DELETE:
    "覆盖安装时无法删除旧版本，请先卸载旧版本后重试。",
  INSTALL_FAILED_TEST_ONLY:
    "这是 test-only 安装包，系统默认拒绝安装。",
  INSTALL_FAILED_CANCELED:
    "安装已被设备端取消。",
  INSTALL_FAILED_CONFLICTING_PROVIDER:
    "与已安装应用存在同名 ContentProvider 冲突。请先卸载冲突应用。",
  INSTALL_FAILED_INTERNAL_ERROR:
    "设备包管理器内部错误，请重试或重启设备后再试。"
};

const CONNECTION_FAILURES: { pattern: RegExp; code: string; reason: string }[] = [
  {
    pattern: /device .* not found|device not found/i,
    code: "DEVICE_NOT_FOUND",
    reason: "找不到目标设备，设备可能已断开连接。请重新连接设备后重试。"
  },
  {
    pattern: /unauthorized/i,
    code: "DEVICE_UNAUTHORIZED",
    reason: "设备未授权 USB 调试。请在设备屏幕上允许本机的调试授权后重试。"
  },
  {
    pattern: /offline/i,
    code: "DEVICE_OFFLINE",
    reason: "设备当前处于离线状态。请重新插拔设备后重试。"
  },
  {
    pattern: /protocol fault|connection reset|\bclosed\b|mangled/i,
    code: "CONNECTION_LOST",
    reason: "与设备的连接中断，APK 传输未完成。请检查数据线与连接后重试。"
  }
];

const RAW_FAILURE_LIMIT = 200;

function clipFailureRaw(output: string): string {
  const normalized = output
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .join(" ");
  return normalized.length > RAW_FAILURE_LIMIT
    ? `${normalized.slice(0, RAW_FAILURE_LIMIT)}…`
    : normalized;
}

export function parseInstallFailure(
  output: string
): ApkInstallFailure | undefined {
  const text = output.trim();
  if (!text) return undefined;

  const installMatch = /INSTALL_[A-Z0-9_]+/.exec(text);
  if (installMatch) {
    const code = installMatch[0];
    return {
      code,
      reason:
        INSTALL_FAILURE_REASONS[code] ?? `安装失败（原因码：${code}）。`,
      canForceDowngrade: code === "INSTALL_FAILED_VERSION_DOWNGRADE",
      raw: clipFailureRaw(text)
    };
  }

  for (const item of CONNECTION_FAILURES) {
    if (item.pattern.test(text)) {
      return {
        code: item.code,
        reason: item.reason,
        canForceDowngrade: false,
        raw: clipFailureRaw(text)
      };
    }
  }

  if (/Failure|failed to install/i.test(text)) {
    return {
      code: "INSTALL_FAILED",
      reason: "设备端返回安装失败，未提供具体原因。",
      canForceDowngrade: false,
      raw: clipFailureRaw(text)
    };
  }

  return undefined;
}

export class ApkInstallError extends Error {
  constructor(readonly failure: ApkInstallFailure) {
    super(failure.reason);
    this.name = "ApkInstallError";
  }
}

function toInstallError(error: unknown): Error {
  const output = [
    (error as { stderr?: string })?.stderr,
    (error as { stdout?: string })?.stdout,
    error instanceof Error ? error.message : String(error)
  ]
    .filter(Boolean)
    .join("\n");
  const failure = parseInstallFailure(output);
  if (failure) return new ApkInstallError(failure);
  return error instanceof Error ? error : new Error(String(error));
}

export class AdbClient {
  constructor(private readonly executable: string) {}

  async listDevices(): Promise<
    Array<Omit<AndroidDevice, "mirroring" | "mirroringEmbedded">>
  > {
    const { stdout } = await execFileAsync(this.executable, ["devices", "-l"], {
      windowsHide: true,
      timeout: 8_000
    });
    return parseAdbDevices(stdout);
  }

  async sendAction(serial: string, action: DeviceAction): Promise<void> {
    await execFileAsync(this.executable, buildDeviceActionArgs(serial, action), {
      windowsHide: true,
      timeout: 8_000
    });
  }

  async installApk(
    serial: string,
    apkPath: string,
    options?: ApkInstallOptions
  ): Promise<void> {
    let streamedOutput = "";
    try {
      const result = await execFileAsync(
        this.executable,
        buildInstallArgs(serial, apkPath, options),
        {
          windowsHide: true,
          timeout: 5 * 60_000,
          maxBuffer: 4 * 1024 * 1024
        }
      );
      // 个别 adb 版本安装失败仍以退出码 0 结束，需要检查输出中的失败标记。
      streamedOutput = `${result.stdout ?? ""}\n${result.stderr ?? ""}`;
    } catch (error) {
      throw toInstallError(error);
    }
    const failure = parseInstallFailure(streamedOutput);
    if (failure) throw new ApkInstallError(failure);
  }

  async exportBugreport(serial: string, destination: string): Promise<void> {
    await execFileAsync(
      this.executable,
      buildBugreportArgs(serial, destination),
      {
        windowsHide: true,
        timeout: 15 * 60_000,
        maxBuffer: 8 * 1024 * 1024
      }
    );
  }

  async listInstalledPackages(serial: string): Promise<string[]> {
    const { stdout } = await execFileAsync(
      this.executable,
      buildListInstalledPackagesArgs(serial),
      { windowsHide: true, timeout: 20_000 }
    );
    return parseInstalledPackages(stdout).sort((left, right) =>
      left.localeCompare(right)
    );
  }

  async clearAppData(serial: string, packageName: string): Promise<void> {
    const { stdout } = await execFileAsync(
      this.executable,
      buildClearAppDataArgs(serial, packageName),
      { windowsHide: true, timeout: 20_000 }
    );
    if (stdout.trim() !== "Success") {
      throw new Error(stdout.trim() || "设备未能清除应用数据");
    }
  }

  async listManagedApps(serial: string): Promise<ManagedApp[]> {
    const { stdout } = await execFileAsync(
      this.executable,
      buildListManagedAppsArgs(serial),
      { windowsHide: true, timeout: 20_000 }
    );
    return parseManagedApps(stdout);
  }

  async getManagedAppDetails(
    serial: string,
    packageName: string
  ): Promise<ManagedAppDetails> {
    const { stdout } = await execFileAsync(
      this.executable,
      buildPackageDetailsArgs(serial, packageName),
      { windowsHide: true, timeout: 20_000, maxBuffer: 4 * 1024 * 1024 }
    );
    return parsePackageDetails(packageName, stdout);
  }

  async uninstallApp(serial: string, packageName: string): Promise<void> {
    const { stdout } = await execFileAsync(
      this.executable,
      buildUninstallArgs(serial, packageName),
      { windowsHide: true, timeout: 60_000 }
    );
    if (stdout.trim() !== "Success") {
      throw new Error(stdout.trim() || "设备未能卸载应用");
    }
  }

  async forceStopApp(serial: string, packageName: string): Promise<void> {
    await execFileAsync(
      this.executable,
      buildForceStopArgs(serial, packageName),
      { windowsHide: true, timeout: 20_000 }
    );
  }

  async listAppProcesses(serial: string): Promise<AppProcess[]> {
    const [activities, processes, packages] = await Promise.all([
      execFileAsync(
        this.executable,
        ["-s", serial, "shell", "dumpsys", "activity", "activities"],
        { windowsHide: true, timeout: 10_000 }
      ),
      execFileAsync(
        this.executable,
        ["-s", serial, "shell", "ps", "-A", "-o", "PID,NAME"],
        { windowsHide: true, timeout: 10_000 }
      ),
      execFileAsync(
        this.executable,
        ["-s", serial, "shell", "pm", "list", "packages"],
        { windowsHide: true, timeout: 15_000 }
      )
    ]);
    return parseRunningAppProcesses(
      processes.stdout,
      parseResumedPackages(activities.stdout),
      new Set(parseInstalledPackages(packages.stdout))
    );
  }

  async clearLogcatBuffer(serial: string, buffer: LogcatBuffer): Promise<void> {
    await execFileAsync(
      this.executable,
      buildClearLogcatArgs(serial, buffer),
      { windowsHide: true, timeout: 15_000 }
    );
  }
}
