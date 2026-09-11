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

export function buildLaunchAppArgs(
  serial: string,
  packageName: string
): string[] {
  // monkey 免 root 启动：不需要知道入口 Activity 名即可拉起 launcher intent
  return [
    "-s",
    serial,
    "shell",
    "monkey",
    "-p",
    packageName,
    "-c",
    "android.intent.category.LAUNCHER",
    "1"
  ];
}

export function buildPairArgs(address: string, code: string): string[] {
  return ["pair", address, code];
}

export function buildConnectArgs(address: string): string[] {
  return ["connect", address];
}

export function buildTcpipArgs(serial: string, port: number): string[] {
  return ["-s", serial, "tcpip", String(port)];
}

export function buildDeviceIpv4Args(serial: string): string[] {
  return ["-s", serial, "shell", "ip", "-o", "-4", "addr", "show", "scope", "global"];
}

export interface LocalIpv4Interface {
  address: string;
  netmask: string;
}

function ipv4ToNumber(ip: string): number | undefined {
  const parts = ip.split(".");
  if (parts.length !== 4) return undefined;
  let value = 0;
  for (const part of parts) {
    const octet = Number(part);
    if (!Number.isInteger(octet) || octet < 0 || octet > 255) return undefined;
    value = value * 256 + octet;
  }
  return value;
}

/** 判断 targetIp 是否落在某个本机 IPv4 接口的子网内；命中返回该接口地址。 */
export function findLocalSubnetMatch(
  targetIp: string,
  interfaces: readonly LocalIpv4Interface[]
): string | undefined {
  const target = ipv4ToNumber(targetIp);
  if (target === undefined) return undefined;
  for (const item of interfaces) {
    const address = ipv4ToNumber(item.address);
    const netmask = ipv4ToNumber(item.netmask);
    if (address === undefined || netmask === undefined) continue;
    if ((target & netmask) === (address & netmask)) return item.address;
  }
  return undefined;
}

export function parseDeviceIpv4Addresses(output: string): string[] {
  const entries = Array.from(
    output.matchAll(
      /inet\s+(\d+(?:\.\d+){3})\/\d+.*scope\s+global\s+(\S+)/g
    ),
    (match) => ({ address: match[1], iface: match[2] })
  );
  const wifi = entries.filter((item) => /^wlan/i.test(item.iface));
  const other = entries.filter((item) => !/^wlan/i.test(item.iface));
  return [...wifi, ...other]
    .map((item) => item.address)
    .filter((address) => address !== "127.0.0.1");
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

export interface WirelessResult {
  ok: boolean;
  message: string;
}

function clipRawOutput(output: string): string {
  const normalized = output.split(/\r?\n/).map((line) => line.trim()).filter(Boolean).join(" ");
  return normalized.length > RAW_FAILURE_LIMIT
    ? `${normalized.slice(0, RAW_FAILURE_LIMIT)}…`
    : normalized;
}

// 常见 socket 错误与 adb 文案（中英文 locale 均可能出现）统一归因
const WIRELESS_UNREACHABLE =
  /no route to host|host unreachable|unreachable network|network unreachable|timed out|\(10065\)|\(10060\)|\(10071\)/i;
const WIRELESS_REFUSED = /connection refused|actively refused|\(10061\)/i;
const WIRELESS_AUTH = /cannot authenticate|failed to authenticate|closed before.*handshake|\(10054\)|connection reset/i;

export function parsePairResult(output: string): WirelessResult {
  const text = output.trim();
  if (/successfully paired/i.test(text)) {
    return { ok: true, message: "配对成功，现在可以用无线调试主界面的 IP 和端口连接" };
  }
  if (WIRELESS_REFUSED.test(text)) {
    return {
      ok: false,
      message: "配对端口拒绝连接：配对弹窗关闭后端口即失效，请在设备上重新打开「使用配对码配对设备」，用新端口和新配对码重试。"
    };
  }
  if (WIRELESS_AUTH.test(text) || /wrong|password|配对码/i.test(text)) {
    return {
      ok: false,
      message: "配对失败：配对码不正确或已过期，请在设备上重新查看配对码。"
    };
  }
  if (WIRELESS_UNREACHABLE.test(text)) {
    return {
      ok: false,
      message: "无法连接到设备：请确认手机与电脑在同一 Wi-Fi，配对地址和端口输入正确。"
    };
  }
  return { ok: false, message: `配对失败：${clipRawOutput(text) || "adb 未返回原因"}` };
}

export function parseConnectResult(output: string): WirelessResult {
  const text = output.trim();
  const already = /already connected to/i.test(text);
  if (already || /^connected to/im.test(text)) {
    return {
      ok: true,
      message: already ? "该设备地址已处于连接状态" : "已连接设备"
    };
  }
  if (WIRELESS_REFUSED.test(text)) {
    return {
      ok: false,
      message: "连接被拒绝：该端口没有监听。Android 11+ 无线调试请用主界面显示的「IP 地址和端口」（不是配对端口）；tcpip 模式请先用 USB 线执行一键无线连接。"
    };
  }
  if (WIRELESS_UNREACHABLE.test(text)) {
    return {
      ok: false,
      message: "无法访问设备：检查手机与电脑是否在同一网络、IP 是否正确、无线调试是否仍开启。"
    };
  }
  if (WIRELESS_AUTH.test(text)) {
    return {
      ok: false,
      message: "连接认证失败：请在设备屏幕上重新授权本机调试，或重新配对后再连。"
    };
  }
  return { ok: false, message: `连接失败：${clipRawOutput(text) || "adb 未返回原因"}` };
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

  async launchApp(serial: string, packageName: string): Promise<void> {
    let stdout = "";
    let stderr = "";
    let failure: unknown;
    try {
      const result = await execFileAsync(
        this.executable,
        buildLaunchAppArgs(serial, packageName),
        { windowsHide: true, timeout: 20_000 }
      );
      stdout = result.stdout ?? "";
      stderr = result.stderr ?? "";
    } catch (error) {
      // monkey 对部分失败仍以退出码 0 结束，反之也有非零退出但输出可解释的情况，
      // 两条路径的输出合并后统一归因。
      stdout = (error as { stdout?: string })?.stdout ?? "";
      stderr = (error as { stderr?: string })?.stderr ?? "";
      failure = error;
    }
    const text = `${stdout}\n${stderr}`;
    if (/No activities found to run/i.test(text)) {
      throw new Error("该应用没有可启动的入口界面（缺少 LAUNCHER Activity）");
    }
    if (/monkey aborted/i.test(text)) {
      throw new Error("设备端未能启动该应用，请确认包名仍安装在设备上");
    }
    if (failure !== undefined) throw failure;
  }

  async pairWireless(address: string, code: string): Promise<WirelessResult> {
    return this.runWireless(buildPairArgs(address, code), parsePairResult);
  }

  async connectWireless(address: string): Promise<WirelessResult> {
    return this.runWireless(buildConnectArgs(address), parseConnectResult);
  }

  private async runWireless(
    args: string[],
    parse: (output: string) => WirelessResult
  ): Promise<WirelessResult> {
    let text = "";
    try {
      const { stdout, stderr } = await execFileAsync(this.executable, args, {
        windowsHide: true,
        timeout: 15_000
      });
      text = `${stdout ?? ""}\n${stderr ?? ""}`;
    } catch (error) {
      text = [
        (error as { stdout?: string })?.stdout,
        (error as { stderr?: string })?.stderr,
        error instanceof Error ? error.message : String(error)
      ]
        .filter(Boolean)
        .join("\n");
    }
    return parse(text);
  }

  async enableTcpip(serial: string, port: number): Promise<void> {
    const { stdout } = await execFileAsync(
      this.executable,
      buildTcpipArgs(serial, port),
      { windowsHide: true, timeout: 15_000 }
    );
    // 部分设备错误时退出码仍为 0，必须检查输出标记
    if (!/restarting in TCP mode/i.test(stdout)) {
      throw new Error(stdout.trim() || "设备未能切换到 TCP 调试模式");
    }
  }

  async listDeviceIpv4(serial: string): Promise<string[]> {
    const { stdout } = await execFileAsync(
      this.executable,
      buildDeviceIpv4Args(serial),
      { windowsHide: true, timeout: 10_000 }
    );
    return parseDeviceIpv4Addresses(stdout);
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
