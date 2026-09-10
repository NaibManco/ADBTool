import { contextBridge, ipcRenderer, webUtils } from "electron";
import type {
  AndroidDevice,
  AndroidToolApi,
  ApkInstallOptions,
  DecompileEvent,
  DeviceAction,
  LogcatBuffer,
  LogcatEvent,
  MirrorControlInput,
  MirrorManagerEvent,
  RecordingEndedEvent,
  TerminalEvent,
  ThemeMode
} from "../shared/types";

const api: AndroidToolApi = {
  listDevices: () => ipcRenderer.invoke("devices:list"),
  getTheme: () => ipcRenderer.invoke("settings:theme-get"),
  setTheme: (theme: ThemeMode) =>
    ipcRenderer.invoke("settings:theme-set", theme),
  selectApkFile: () => ipcRenderer.invoke("apk:select"),
  resolveApkPath: (apkPath: string) =>
    ipcRenderer.invoke("apk:resolve-path", apkPath),
  getDroppedFilePath: (file: unknown) =>
    webUtils.getPathForFile(file as File),
  installApk: (serial: string, apkPath: string, options?: ApkInstallOptions) =>
    ipcRenderer.invoke("apk:install", serial, apkPath, options),
  exportBugreport: (serial: string) =>
    ipcRenderer.invoke("device:bugreport", serial),
  getDeviceInfo: (serial: string) =>
    ipcRenderer.invoke("device:info", serial),
  listDeviceFiles: (serial: string, directory: string) =>
    ipcRenderer.invoke("files:list", serial, directory),
  selectDeviceUploadFiles: () => ipcRenderer.invoke("files:select-upload"),
  uploadDeviceFiles: (serial: string, directory: string, localPaths: string[]) =>
    ipcRenderer.invoke("files:upload", serial, directory, localPaths),
  downloadDeviceFile: (serial: string, remotePath: string) =>
    ipcRenderer.invoke("files:download", serial, remotePath),
  getDeviceImagePreview: (serial: string, remotePath: string) =>
    ipcRenderer.invoke("files:preview", serial, remotePath),
  createDeviceDirectory: (serial: string, parent: string, name: string) =>
    ipcRenderer.invoke("files:mkdir", serial, parent, name),
  renameDeviceFile: (serial: string, source: string, newName: string) =>
    ipcRenderer.invoke("files:rename", serial, source, newName),
  deleteDeviceFile: (serial: string, target: string) =>
    ipcRenderer.invoke("files:delete", serial, target),
  listInstalledPackages: (serial: string) =>
    ipcRenderer.invoke("device:packages", serial),
  clearAppData: (serial: string, packageName: string) =>
    ipcRenderer.invoke("device:clear-data", serial, packageName),
  listManagedApps: (serial: string) =>
    ipcRenderer.invoke("apps:list", serial),
  getManagedAppDetails: (serial: string, packageName: string) =>
    ipcRenderer.invoke("apps:details", serial, packageName),
  uninstallApp: (serial: string, packageName: string) =>
    ipcRenderer.invoke("apps:uninstall", serial, packageName),
  forceStopApp: (serial: string, packageName: string) =>
    ipcRenderer.invoke("apps:force-stop", serial, packageName),
  captureScreenshot: (serial: string) =>
    ipcRenderer.invoke("capture:screenshot", serial),
  copyCaptureMedia: (id: string) =>
    ipcRenderer.invoke("capture:media-copy", id),
  saveCaptureMediaAs: (id: string) =>
    ipcRenderer.invoke("capture:media-save-as", id),
  startScreenRecording: (serial: string) =>
    ipcRenderer.invoke("capture:recording-start", serial),
  stopScreenRecording: (serial: string) =>
    ipcRenderer.invoke("capture:recording-stop", serial),
  listScreenRecordings: () =>
    ipcRenderer.invoke("capture:recording-list"),
  onRecordingEnded: (callback: (event: RecordingEndedEvent) => void) => {
    const listener = (
      _event: Electron.IpcRendererEvent,
      payload: RecordingEndedEvent
    ) => callback(payload);
    ipcRenderer.on("capture:recording-ended", listener);
    return () =>
      ipcRenderer.removeListener("capture:recording-ended", listener);
  },
  openAppManagerWindow: () =>
    ipcRenderer.invoke("manager-window:open", "apps"),
  openFileManagerWindow: () =>
    ipcRenderer.invoke("manager-window:open", "files"),
  openDeviceInfoWindow: () =>
    ipcRenderer.invoke("manager-window:open", "device-info"),
  openDecompilerWindow: () =>
    ipcRenderer.invoke("manager-window:open", "decompiler"),
  openLogcatWindow: (device: AndroidDevice) =>
    ipcRenderer.invoke("logcat:window-open", device),
  getLogcatWindowDevices: () =>
    ipcRenderer.invoke("logcat:window-devices"),
  removeLogcatWindowDevice: (serial: string) =>
    ipcRenderer.invoke("logcat:window-remove", serial),
  startMirror: (serial: string, label: string) =>
    ipcRenderer.invoke("mirror:start", serial, label),
  stopMirror: (serial: string) => ipcRenderer.invoke("mirror:stop", serial),
  setClipboardSync: (serial: string, enabled: boolean) =>
    ipcRenderer.invoke("clipboard-sync:set", serial, enabled),
  getClipboardSyncSerials: () =>
    ipcRenderer.invoke("clipboard-sync:list"),
  startEmbeddedMirror: (serial: string) =>
    ipcRenderer.invoke("mirror:embedded-start", serial),
  stopEmbeddedMirror: (serial: string) =>
    ipcRenderer.invoke("mirror:embedded-stop", serial),
  sendMirrorControl: (serial: string, input: MirrorControlInput) => {
    ipcRenderer.send("mirror:control", serial, input);
  },
  startTerminal: (serial: string) =>
    ipcRenderer.invoke("terminal:start", serial),
  stopTerminal: (serial: string) =>
    ipcRenderer.invoke("terminal:stop", serial),
  sendTerminalInput: (serial: string, data: string) => {
    ipcRenderer.send("terminal:input", serial, data);
  },
  startDecompile: (apkPath: string) =>
    ipcRenderer.invoke("decompile:start", apkPath),
  cancelDecompile: (jobId: string) =>
    ipcRenderer.invoke("decompile:cancel", jobId),
  discardDecompile: (jobId: string) => {
    ipcRenderer.send("decompile:discard", jobId);
  },
  getDecompileTree: (jobId: string) =>
    ipcRenderer.invoke("decompile:tree", jobId),
  readDecompileFile: (jobId: string, relPath: string) =>
    ipcRenderer.invoke("decompile:read", jobId, relPath),
  searchDecompile: (jobId: string, query: string) =>
    ipcRenderer.invoke("decompile:search", jobId, query),
  sendAction: (serial: string, action: DeviceAction) =>
    ipcRenderer.invoke("device:action", serial, action),
  startLogcat: (serial: string, pid?: number) =>
    ipcRenderer.invoke("logcat:start", serial, pid),
  stopLogcat: (serial: string) => ipcRenderer.invoke("logcat:stop", serial),
  setLogcatProcess: (serial: string, pid?: number) =>
    ipcRenderer.invoke("logcat:process", serial, pid),
  setLogcatBuffer: (serial: string, buffer: LogcatBuffer) =>
    ipcRenderer.invoke("logcat:buffer", serial, buffer),
  clearLogcatBuffer: (serial: string, buffer: LogcatBuffer) =>
    ipcRenderer.invoke("logcat:clear-buffer", serial, buffer),
  exportLogcatText: (serial: string, text: string) =>
    ipcRenderer.invoke("logcat:export", serial, text),
  copyLogcatText: (text: string) =>
    ipcRenderer.invoke("logcat:copy-text", text),
  listAppProcesses: (serial: string) =>
    ipcRenderer.invoke("device:processes", serial),
  onThemeChanged: (callback: (theme: ThemeMode) => void) => {
    const listener = (
      _event: Electron.IpcRendererEvent,
      theme: ThemeMode
    ) => callback(theme);
    ipcRenderer.on("settings:theme-changed", listener);
    return () => ipcRenderer.removeListener("settings:theme-changed", listener);
  },
  onLogcatDeviceAdd: (callback: (device: AndroidDevice) => void) => {
    const listener = (
      _event: Electron.IpcRendererEvent,
      device: AndroidDevice
    ) => callback(device);
    ipcRenderer.on("logcat:device-add", listener);
    return () => ipcRenderer.removeListener("logcat:device-add", listener);
  },
  onLogcatEvent: (callback: (event: LogcatEvent) => void) => {
    const listener = (_event: Electron.IpcRendererEvent, event: LogcatEvent) =>
      callback(event);
    ipcRenderer.on("logcat:event", listener);
    return () => ipcRenderer.removeListener("logcat:event", listener);
  },
  onMirrorEvent: (callback: (event: MirrorManagerEvent) => void) => {
    const listener = (
      _event: Electron.IpcRendererEvent,
      event: MirrorManagerEvent
    ) => callback(event);
    ipcRenderer.on("mirror:event", listener);
    return () => ipcRenderer.removeListener("mirror:event", listener);
  },
  onTerminalEvent: (callback: (event: TerminalEvent) => void) => {
    const listener = (
      _event: Electron.IpcRendererEvent,
      event: TerminalEvent
    ) => callback(event);
    ipcRenderer.on("terminal:event", listener);
    return () => ipcRenderer.removeListener("terminal:event", listener);
  },
  onDecompileEvent: (callback: (event: DecompileEvent) => void) => {
    const listener = (
      _event: Electron.IpcRendererEvent,
      event: DecompileEvent
    ) => callback(event);
    ipcRenderer.on("decompile:event", listener);
    return () => ipcRenderer.removeListener("decompile:event", listener);
  }
};

contextBridge.exposeInMainWorld("androidTool", api);
