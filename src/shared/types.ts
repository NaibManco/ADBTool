export type DeviceState = "device" | "offline" | "unauthorized" | string;

export interface AndroidDevice {
  serial: string;
  state: DeviceState;
  model?: string;
  product?: string;
  transportId?: string;
  mirroring: boolean;
  mirroringEmbedded: boolean;
}

export interface DeviceInfo {
  serial: string;
  deviceSn?: string;
  collectedAt: number;
  system: {
    androidVersion?: string;
    sdkLevel?: number;
    securityPatch?: string;
    buildId?: string;
    displayBuildVersion?: string;
    incrementalBuildVersion?: string;
    buildType?: string;
    fingerprint?: string;
    kernel?: string;
    uptimeSeconds?: number;
    bootloader?: string;
  };
  hardware: {
    manufacturer?: string;
    brand?: string;
    model?: string;
    device?: string;
    product?: string;
    board?: string;
    hardware?: string;
    soc?: string;
    cpuModel?: string;
    cpuCores?: number;
    cpuAbis: string[];
  };
  memory: {
    totalBytes?: number;
    availableBytes?: number;
  };
  storage: {
    totalBytes?: number;
    usedBytes?: number;
    availableBytes?: number;
  };
  display: {
    physicalSize?: string;
    overrideSize?: string;
    physicalDensity?: number;
    overrideDensity?: number;
  };
  battery: {
    level?: number;
    status?: string;
    health?: string;
    temperatureCelsius?: number;
    voltageMillivolts?: number;
    technology?: string;
    acPowered?: boolean;
    usbPowered?: boolean;
    wirelessPowered?: boolean;
  };
  network: {
    connectionType: "USB ADB" | "网络 ADB";
    ipv4Addresses: string[];
  };
}

export type DeviceAction =
  | "back"
  | "home"
  | "recents"
  | "power"
  | "reboot"
  | "volumeUp"
  | "volumeDown";

export type CaptureMediaKind = "image" | "video";

export interface RecordingEndedEvent {
  serial: string;
  ok: boolean;
  message: string;
}

export interface CaptureMedia {
  id: string;
  kind: CaptureMediaKind;
  name: string;
  mimeType: "image/png" | "video/mp4";
  size: number;
  createdAt: number;
  deviceSerial: string;
  url: string;
  width?: number;
  height?: number;
}

export interface ActionResult {
  ok: boolean;
  message?: string;
  cancelled?: boolean;
  savedPath?: string;
  startedAt?: number;
  media?: CaptureMedia;
  installFailure?: ApkInstallFailure;
}

export interface ScreenRecordingSession {
  serial: string;
  startedAt: number;
}

export interface ApkFile {
  path: string;
  name: string;
  size: number;
}

export interface ApkInstallOptions {
  forceDowngrade?: boolean;
}

export interface ApkInstallFailure {
  code: string;
  reason: string;
  canForceDowngrade: boolean;
  raw: string;
}

export interface LocalFile {
  path: string;
  name: string;
  size: number;
}

export type DeviceFileType = "directory" | "file" | "link" | "other";

export interface DeviceFileEntry {
  name: string;
  path: string;
  type: DeviceFileType;
  size: number;
  modifiedAt: number;
  mode: string;
}

export interface DeviceImagePreview {
  dataUrl: string;
  mimeType: string;
  size: number;
}

export type ThemeMode = "dark" | "light";

export type LogcatLevel = "V" | "D" | "I" | "W" | "E" | "F";

export type LogcatBuffer = "main" | "system" | "crash" | "radio" | "events";

export const LOGCAT_BUFFERS: readonly LogcatBuffer[] = [
  "main",
  "system",
  "crash",
  "radio",
  "events"
];

export interface LogcatEntry {
  raw: string;
  timestamp?: string;
  pid?: number;
  tid?: number;
  level: LogcatLevel;
  tag: string;
  message: string;
}

export interface AppProcess {
  pid: number;
  processName: string;
  packageName: string;
  foreground: boolean;
}

export type MirrorVideoPacketKind = "configuration" | "data" | "session";

export type MirrorManagerEvent =
  | {
      type: "video";
      serial: string;
      kind: MirrorVideoPacketKind;
      data?: Uint8Array;
      keyframe?: boolean;
      pts?: bigint;
      width?: number;
      height?: number;
      isClientResize?: boolean;
    }
  | {
      type: "meta";
      serial: string;
      codec: number;
      deviceName?: string;
    }
  | {
      type: "status";
      serial: string;
      running: boolean;
      message?: string;
    };

export type MirrorControlInput =
  | {
      type: "touch";
      action: "down" | "move" | "up";
      pointerId: number;
      x: number;
      y: number;
    }
  | {
      type: "scroll";
      x: number;
      y: number;
      scrollX: number;
      scrollY: number;
    }
  | { type: "back" };

export type TerminalEvent =
  | {
      type: "data";
      serial: string;
      stream: "out" | "err";
      data: string;
    }
  | {
      type: "status";
      serial: string;
      running: boolean;
      message?: string;
    };

export type DecompileEvent =
  | {
      type: "progress";
      jobId: string;
      line: string;
    }
  | {
      type: "done";
      jobId: string;
      ok: boolean;
      message: string;
    };

export interface DecompileFileNode {
  name: string;
  relPath: string;
  type: "dir" | "file";
  size: number;
}

export interface DecompileStartResult {
  ok: boolean;
  jobId?: string;
  message?: string;
}

export interface DecompileTreeResult {
  nodes: DecompileFileNode[];
  truncated: boolean;
  message?: string;
}

export interface DecompileReadResult {
  ok: boolean;
  content?: string;
  binary?: boolean;
  message?: string;
}

export interface DecompileSearchHit {
  relPath: string;
  context: string;
}

export interface DecompileSearchResult {
  hits: DecompileSearchHit[];
  truncated: boolean;
  message?: string;
}

export interface ManagedApp {
  packageName: string;
  apkPath: string;
}

export interface ManagedAppDetails {
  packageName: string;
  versionName?: string;
  versionCode?: number;
  minSdk?: number;
  targetSdk?: number;
  firstInstallTime?: string;
  lastUpdateTime?: string;
  installerPackageName?: string;
  dataDir?: string;
  codePath?: string;
  primaryCpuAbi?: string;
  userId?: number;
  requestedPermissions: string[];
}

export type LogcatEvent =
  | {
      type: "entry";
      serial: string;
      entry: LogcatEntry;
    }
  | {
      type: "status";
      serial: string;
      running: boolean;
      message?: string;
      pid?: number;
      buffer?: LogcatBuffer;
    };

export interface AndroidToolApi {
  listDevices(): Promise<AndroidDevice[]>;
  getTheme(): Promise<ThemeMode>;
  setTheme(theme: ThemeMode): Promise<ActionResult>;
  selectApkFile(): Promise<ApkFile | undefined>;
  resolveApkPath(apkPath: string): Promise<ApkFile>;
  getDroppedFilePath(file: unknown): string;
  installApk(
    serial: string,
    apkPath: string,
    options?: ApkInstallOptions
  ): Promise<ActionResult>;
  exportBugreport(serial: string): Promise<ActionResult>;
  getDeviceInfo(serial: string): Promise<DeviceInfo>;
  listDeviceFiles(serial: string, directory: string): Promise<DeviceFileEntry[]>;
  selectDeviceUploadFiles(): Promise<LocalFile[]>;
  uploadDeviceFiles(serial: string, directory: string, localPaths: string[]): Promise<ActionResult>;
  downloadDeviceFile(serial: string, remotePath: string): Promise<ActionResult>;
  getDeviceImagePreview(serial: string, remotePath: string): Promise<DeviceImagePreview>;
  createDeviceDirectory(serial: string, parent: string, name: string): Promise<ActionResult>;
  renameDeviceFile(serial: string, source: string, newName: string): Promise<ActionResult>;
  deleteDeviceFile(serial: string, target: string): Promise<ActionResult>;
  listInstalledPackages(serial: string): Promise<string[]>;
  clearAppData(serial: string, packageName: string): Promise<ActionResult>;
  listManagedApps(serial: string): Promise<ManagedApp[]>;
  getManagedAppDetails(serial: string, packageName: string): Promise<ManagedAppDetails>;
  uninstallApp(serial: string, packageName: string): Promise<ActionResult>;
  forceStopApp(serial: string, packageName: string): Promise<ActionResult>;
  captureScreenshot(serial: string): Promise<ActionResult>;
  copyCaptureMedia(id: string): Promise<ActionResult>;
  saveCaptureMediaAs(id: string): Promise<ActionResult>;
  startScreenRecording(serial: string): Promise<ActionResult>;
  stopScreenRecording(serial: string): Promise<ActionResult>;
  listScreenRecordings(): Promise<ScreenRecordingSession[]>;
  onRecordingEnded(
    listener: (event: RecordingEndedEvent) => void
  ): () => void;
  openAppManagerWindow(): Promise<ActionResult>;
  openFileManagerWindow(): Promise<ActionResult>;
  openDeviceInfoWindow(): Promise<ActionResult>;
  openDecompilerWindow(): Promise<ActionResult>;
  openLogcatWindow(device: AndroidDevice): Promise<ActionResult>;
  getLogcatWindowDevices(): Promise<AndroidDevice[]>;
  removeLogcatWindowDevice(serial: string): Promise<void>;
  startMirror(serial: string, label: string): Promise<ActionResult>;
  stopMirror(serial: string): Promise<ActionResult>;
  setClipboardSync(serial: string, enabled: boolean): Promise<ActionResult>;
  getClipboardSyncSerials(): Promise<string[]>;
  startEmbeddedMirror(serial: string): Promise<ActionResult>;
  stopEmbeddedMirror(serial: string): Promise<ActionResult>;
  sendMirrorControl(serial: string, input: MirrorControlInput): void;
  startTerminal(serial: string): Promise<ActionResult>;
  stopTerminal(serial: string): Promise<ActionResult>;
  sendTerminalInput(serial: string, data: string): void;
  startDecompile(apkPath: string): Promise<DecompileStartResult>;
  cancelDecompile(jobId: string): Promise<ActionResult>;
  discardDecompile(jobId: string): void;
  getDecompileTree(jobId: string): Promise<DecompileTreeResult>;
  readDecompileFile(jobId: string, relPath: string): Promise<DecompileReadResult>;
  searchDecompile(jobId: string, query: string): Promise<DecompileSearchResult>;
  onDecompileEvent(listener: (event: DecompileEvent) => void): () => void;
  sendAction(serial: string, action: DeviceAction): Promise<ActionResult>;
  startLogcat(serial: string, pid?: number): Promise<ActionResult>;
  stopLogcat(serial: string): Promise<ActionResult>;
  setLogcatProcess(serial: string, pid?: number): Promise<ActionResult>;
  setLogcatBuffer(serial: string, buffer: LogcatBuffer): Promise<ActionResult>;
  clearLogcatBuffer(serial: string, buffer: LogcatBuffer): Promise<ActionResult>;
  exportLogcatText(serial: string, text: string): Promise<ActionResult>;
  copyLogcatText(text: string): Promise<ActionResult>;
  listAppProcesses(serial: string): Promise<AppProcess[]>;
  onThemeChanged(listener: (theme: ThemeMode) => void): () => void;
  onLogcatDeviceAdd(listener: (device: AndroidDevice) => void): () => void;
  onLogcatEvent(listener: (event: LogcatEvent) => void): () => void;
  onMirrorEvent(listener: (event: MirrorManagerEvent) => void): () => void;
  onTerminalEvent(listener: (event: TerminalEvent) => void): () => void;
}
