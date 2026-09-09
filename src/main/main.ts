import path from "node:path";
import {
  copyFileSync,
  mkdtempSync,
  rmSync,
  statSync
} from "node:fs";
import { readFile, writeFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";
import {
  app,
  BrowserWindow,
  clipboard,
  dialog,
  ipcMain,
  nativeImage,
  nativeTheme,
  net,
  protocol,
  screen,
  shell
} from "electron";
import type {
  ActionResult,
  AndroidDevice,
  ApkFile,
  ApkInstallOptions,
  DeviceAction,
  DeviceImagePreview,
  LocalFile,
  LogcatBuffer,
  MirrorControlInput,
  ThemeMode
} from "../shared/types";
import { LOGCAT_BUFFERS } from "../shared/types";
import { AdbClient, ApkInstallError } from "./adb";
import { DecompileManager } from "./decompile-manager";
import { EmbeddedMirrorManager } from "./embedded-mirror-manager";
import { LogcatManager } from "./logcat-manager";
import { TerminalManager } from "./terminal-manager";
import {
  resolveAdbPath,
  resolveJadxJarPath,
  resolveJavaExecutable,
  resolveScrcpyPath,
  resolveScrcpyServerPath
} from "./paths";
import { ScrcpyManager } from "./scrcpy-manager";
import { SettingsStore } from "./settings";
import { getLogcatWindowPosition } from "./window-placement";
import { CaptureManager } from "./capture-manager";
import {
  CAPTURE_MEDIA_SCHEME,
  CaptureMediaStore
} from "./capture-media-store";
import { detectImageMime, DeviceFileManager } from "./device-files";
import { findGeneratedBugreport } from "./bugreport-files";
import { DeviceInfoCollector } from "./device-info";
import { ScreenRecorder } from "./screen-recorder";

protocol.registerSchemesAsPrivileged([
  {
    scheme: CAPTURE_MEDIA_SCHEME,
    privileges: {
      standard: true,
      secure: true,
      supportFetchAPI: true,
      stream: true
    }
  }
]);

let mainWindow: BrowserWindow | undefined;
let logcatWindow: BrowserWindow | undefined;
const managerWindows = new Map<ManagerView, BrowserWindow>();
let settings: SettingsStore;
let captureMedia: CaptureMediaStore;
const logcatDevices = new Map<string, AndroidDevice>();
const adb = new AdbClient(resolveAdbPath());
const scrcpy = new ScrcpyManager(resolveScrcpyPath());
const capture = new CaptureManager(resolveAdbPath());
const deviceFiles = new DeviceFileManager(resolveAdbPath());
const deviceInfo = new DeviceInfoCollector(resolveAdbPath());
const logcat = new LogcatManager(resolveAdbPath(), (event) => {
  for (const window of BrowserWindow.getAllWindows()) {
    if (!window.isDestroyed()) {
      window.webContents.send("logcat:event", event);
    }
  }
});
const embeddedMirror = new EmbeddedMirrorManager(
  resolveAdbPath(),
  // 惰性解析：server 文件缺失只禁用内嵌投屏，不影响应用启动
  () => resolveScrcpyServerPath(),
  (event) => {
    for (const window of BrowserWindow.getAllWindows()) {
      if (!window.isDestroyed()) {
        window.webContents.send("mirror:event", event);
      }
    }
  }
);
const terminal = new TerminalManager(resolveAdbPath(), (event) => {
  for (const window of BrowserWindow.getAllWindows()) {
    if (!window.isDestroyed()) {
      window.webContents.send("terminal:event", event);
    }
  }
});
// jadx/Java 缺失时反编译不可用，但不阻断应用启动（惰性解析）
const decompileJadxJar = resolveJadxJarPathSafe();
const decompileReady = decompileJadxJar !== "";
const decompile = new DecompileManager(
  resolveJavaExecutable(),
  decompileJadxJar,
  (event) => {
    for (const window of BrowserWindow.getAllWindows()) {
      if (!window.isDestroyed()) {
        window.webContents.send("decompile:event", event);
      }
    }
  }
);
// 录屏：scrcpy-server 隐藏会话 + 电脑侧 mp4 封装（绕开设备端 screenrecord 限制）
let scrcpyServerBytesCache: Promise<Uint8Array> | undefined;
const readScrcpyServerBytes = (): Promise<Uint8Array> => {
  scrcpyServerBytesCache ??= readFile(resolveScrcpyServerPath()).then(
    (buffer) => new Uint8Array(buffer),
    (error: unknown) => {
      scrcpyServerBytesCache = undefined; // 读取失败清缓存，下次重试
      throw error;
    }
  );
  return scrcpyServerBytesCache;
};
const screenRecorder = new ScreenRecorder(
  resolveAdbPath(),
  () => resolveScrcpyServerPath(),
  (result) => {
    for (const window of BrowserWindow.getAllWindows()) {
      if (!window.isDestroyed()) {
        window.webContents.send("capture:recording-ended", result);
      }
    }
  },
  readScrcpyServerBytes
);

function resolveJadxJarPathSafe(): string {
  try {
    return resolveJadxJarPath();
  } catch {
    return "";
  }
}
const SERIAL_PATTERN = /^[A-Za-z0-9._:-]+$/;
const PACKAGE_PATTERN = /^[A-Za-z0-9_]+(?:\.[A-Za-z0-9_]+)+$/;
type ManagerView = "apps" | "files" | "device-info" | "decompiler";

function assertSerial(serial: string): void {
  if (!SERIAL_PATTERN.test(serial)) {
    throw new Error("设备序列号格式无效");
  }
}

function assertPackageName(packageName: string): void {
  if (!PACKAGE_PATTERN.test(packageName)) {
    throw new Error("应用包名格式无效");
  }
}

function assertLogcatBuffer(buffer: string): LogcatBuffer {
  if (!LOGCAT_BUFFERS.includes(buffer as LogcatBuffer)) {
    throw new Error("日志缓冲区无效");
  }
  return buffer as LogcatBuffer;
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function isMirrorControlInput(input: unknown): input is MirrorControlInput {
  if (!input || typeof input !== "object") {
    return false;
  }
  const value = input as Record<string, unknown>;
  if (value.type === "back") {
    return true;
  }
  if (value.type === "scroll") {
    return (
      isFiniteNumber(value.x) &&
      isFiniteNumber(value.y) &&
      isFiniteNumber(value.scrollX) &&
      isFiniteNumber(value.scrollY)
    );
  }
  if (value.type === "touch") {
    return (
      (value.action === "down" ||
        value.action === "move" ||
        value.action === "up") &&
      isFiniteNumber(value.pointerId) &&
      isFiniteNumber(value.x) &&
      isFiniteNumber(value.y)
    );
  }
  return false;
}

function resultFromError(error: unknown): ActionResult {
  return {
    ok: false,
    message: error instanceof Error ? error.message : String(error)
  };
}

function readApkFile(apkPath: string): ApkFile {
  const resolvedPath = path.resolve(apkPath);
  if (!path.isAbsolute(apkPath) || path.extname(resolvedPath).toLowerCase() !== ".apk") {
    throw new Error("请选择有效的 APK 文件");
  }
  const info = statSync(resolvedPath);
  if (!info.isFile()) {
    throw new Error("APK 路径不是文件");
  }
  return {
    path: resolvedPath,
    name: path.basename(resolvedPath),
    size: info.size
  };
}

function readLocalFile(localPath: string): LocalFile {
  const resolvedPath = path.resolve(localPath);
  if (!path.isAbsolute(localPath)) throw new Error("本机文件路径无效");
  const info = statSync(resolvedPath);
  if (!info.isFile()) throw new Error(`${path.basename(resolvedPath)} 不是文件`);
  return { path: resolvedPath, name: path.basename(resolvedPath), size: info.size };
}

function bugreportFileName(serial: string): string {
  const safeSerial = serial.replace(/[^A-Za-z0-9._-]/g, "-");
  const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
  return `Bugreport-${safeSerial}-${timestamp}.zip`;
}

function logcatExportFileName(serial: string): string {
  const safeSerial = serial.replace(/[^A-Za-z0-9._-]/g, "-");
  const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
  return `Logcat-${safeSerial}-${timestamp}.txt`;
}

/**
 * 对话框父窗口取「发起请求的窗口」：否则在副窗口（如反编译）里选文件时，
 * 对话框会把主窗口拉到前台盖住发起窗口。
 */
function dialogParent(event: Electron.IpcMainInvokeEvent): BrowserWindow | undefined {
  const sender = BrowserWindow.fromWebContents(event.sender);
  if (sender && !sender.isDestroyed()) {
    return sender;
  }
  return mainWindow && !mainWindow.isDestroyed() ? mainWindow : undefined;
}

async function chooseMediaSavePath(
  event: Electron.IpcMainInvokeEvent,
  name: string,
  kind: "image" | "video"
): Promise<string | undefined> {
  const extension = kind === "image" ? "png" : "mp4";
  const options: Electron.SaveDialogOptions = {
    title: "另存为",
    defaultPath: path.join(
      app.getPath(kind === "image" ? "pictures" : "videos"),
      name
    ),
    filters: [{
      name: kind === "image" ? "PNG 图片" : "MP4 视频",
      extensions: [extension]
    }]
  };
  const parent = dialogParent(event);
  const result = parent
    ? await dialog.showSaveDialog(parent, options)
    : await dialog.showSaveDialog(options);
  return result.canceled ? undefined : result.filePath;
}

function registerCaptureMediaProtocol(): void {
  protocol.handle(CAPTURE_MEDIA_SCHEME, (request) => {
    try {
      const url = new URL(request.url);
      if (url.hostname !== "media") throw new Error("预览地址无效");
      const id = decodeURIComponent(url.pathname.slice(1));
      const entry = captureMedia.get(id);
      return net.fetch(pathToFileURL(entry.localPath).toString(), {
        method: request.method,
        headers: request.headers
      });
    } catch {
      return new Response("Capture media not found", { status: 404 });
    }
  });
}

async function loadRenderer(
  window: BrowserWindow,
  view?: string
): Promise<void> {
  if (process.env.VITE_DEV_SERVER_URL) {
    const url = new URL(process.env.VITE_DEV_SERVER_URL);
    if (view) url.searchParams.set("view", view);
    await window.loadURL(url.toString());
  } else {
    await window.loadFile(path.join(__dirname, "../../renderer/index.html"), {
      query: view ? { view } : undefined
    });
  }
}

async function createLogcatWindow(): Promise<BrowserWindow> {
  const width = 980;
  const height = 720;
  const mainBounds = mainWindow?.getBounds();
  const position = mainBounds
    ? getLogcatWindowPosition(
        mainBounds,
        screen.getDisplayMatching(mainBounds).workArea,
        width
      )
    : undefined;

  const window = new BrowserWindow({
    width,
    height,
    minWidth: 780,
    minHeight: 520,
    ...position,
    backgroundColor: "#0b0f14",
    title: "Android Dev Tool - Logcat",
    webPreferences: {
      preload: path.join(__dirname, "../preload/index.js"),
      contextIsolation: true,
      nodeIntegration: false
    }
  });

  logcatWindow = window;
  window.removeMenu();
  window.on("closed", () => {
    if (logcatWindow === window) {
      logcatWindow = undefined;
      logcatDevices.clear();
      logcat.stopAll();
    }
  });
  await loadRenderer(window, "logcat");
  return window;
}

async function createManagerWindow(view: ManagerView): Promise<BrowserWindow> {
  const window = new BrowserWindow({
    width: view === "files" ? 1240 : view === "device-info" ? 1180 : view === "decompiler" ? 1280 : 1120,
    height: view === "decompiler" ? 800 : 780,
    minWidth: 860,
    minHeight: 560,
    backgroundColor: "#0b0f14",
    title: view === "files"
      ? "Android Dev Tool - 文件管理"
      : view === "device-info"
        ? "Android Dev Tool - 设备信息"
        : view === "decompiler"
          ? "Android Dev Tool - APK 反编译"
          : "Android Dev Tool - 应用管理",
    webPreferences: {
      preload: path.join(__dirname, "../preload/index.js"),
      contextIsolation: true,
      nodeIntegration: false
    }
  });

  managerWindows.set(view, window);
  window.removeMenu();
  window.on("closed", () => {
    if (managerWindows.get(view) === window) {
      managerWindows.delete(view);
    }
  });
  await loadRenderer(window, view);
  return window;
}

function registerIpc(): void {
  ipcMain.handle("settings:theme-get", () => settings.getTheme());

  ipcMain.handle(
    "manager-window:open",
    async (_event, view: ManagerView): Promise<ActionResult> => {
      try {
        if (
          view !== "apps" &&
          view !== "files" &&
          view !== "device-info" &&
          view !== "decompiler"
        ) {
          throw new Error("不支持的管理页面");
        }
        const existing = managerWindows.get(view);
        const window = existing && !existing.isDestroyed()
          ? existing
          : await createManagerWindow(view);
        if (window.isMinimized()) window.restore();
        window.show();
        window.focus();
        return { ok: true };
      } catch (error) {
        return resultFromError(error);
      }
    }
  );

  ipcMain.handle(
    "settings:theme-set",
    (_event, theme: ThemeMode): ActionResult => {
      try {
        settings.setTheme(theme);
        const nextTheme = settings.getTheme();
        nativeTheme.themeSource = nextTheme;
        for (const window of BrowserWindow.getAllWindows()) {
          if (!window.isDestroyed()) {
            window.webContents.send("settings:theme-changed", nextTheme);
          }
        }
        return { ok: true };
      } catch (error) {
        return resultFromError(error);
      }
    }
  );

  ipcMain.handle("device:info", async (_event, serial: string) => {
    assertSerial(serial);
    return deviceInfo.collect(serial);
  });

  ipcMain.handle("devices:list", async () => {
    const devices = await adb.listDevices();
    return devices.map((device) => ({
      ...device,
      mirroring:
        scrcpy.isRunning(device.serial) ||
        embeddedMirror.isRunning(device.serial),
      mirroringEmbedded: embeddedMirror.isRunning(device.serial)
    }));
  });

  ipcMain.handle(
    "apk:select",
    async (event): Promise<ApkFile | undefined> => {
      const options: Electron.OpenDialogOptions = {
        properties: ["openFile"],
        filters: [{ name: "Android APK", extensions: ["apk"] }]
      };
      const parent = dialogParent(event);
      const result = parent
        ? await dialog.showOpenDialog(parent, options)
        : await dialog.showOpenDialog(options);
      if (result.canceled || result.filePaths.length === 0) return undefined;
      return readApkFile(result.filePaths[0]);
    }
  );

  ipcMain.handle("apk:resolve-path", (_event, apkPath: string): ApkFile =>
    readApkFile(apkPath.trim())
  );

  ipcMain.handle(
    "apk:install",
    async (
      _event,
      serial: string,
      apkPath: string,
      options?: ApkInstallOptions
    ): Promise<ActionResult> => {
      try {
        assertSerial(serial);
        const apk = readApkFile(apkPath);
        await adb.installApk(serial, apk.path, options);
        return { ok: true, message: "安装成功" };
      } catch (error) {
        if (error instanceof ApkInstallError) {
          return {
            ok: false,
            message: error.message,
            installFailure: error.failure
          };
        }
        return resultFromError(error);
      }
    }
  );

  ipcMain.handle(
    "device:bugreport",
    async (event, serial: string): Promise<ActionResult> => {
      try {
        assertSerial(serial);
        const options: Electron.SaveDialogOptions = {
          title: "导出 Android Bugreport",
          defaultPath: path.join(app.getPath("downloads"), bugreportFileName(serial)),
          filters: [{ name: "Bugreport ZIP", extensions: ["zip"] }]
        };
        const parent = dialogParent(event);
        const result = parent
          ? await dialog.showSaveDialog(parent, options)
          : await dialog.showSaveDialog(options);
        if (result.canceled || !result.filePath) {
          return { ok: true, cancelled: true };
        }
        const destination = path.extname(result.filePath).toLowerCase() === ".zip"
          ? result.filePath
          : `${result.filePath}.zip`;
        const temporaryDirectory = mkdtempSync(
          path.join(app.getPath("temp"), "android-dev-tool-bugreport-")
        );
        try {
          await adb.exportBugreport(serial, temporaryDirectory);
          const generatedFile = findGeneratedBugreport(temporaryDirectory);
          copyFileSync(generatedFile, destination);
          if (statSync(destination).size === 0) {
            throw new Error("Bugreport ZIP 文件为空");
          }
          shell.showItemInFolder(destination);
          return {
            ok: true,
            message: "Bugreport 导出完成",
            savedPath: destination
          };
        } finally {
          rmSync(temporaryDirectory, { recursive: true, force: true });
        }
      } catch (error) {
        return resultFromError(error);
      }
    }
  );

  ipcMain.handle(
    "files:list",
    async (_event, serial: string, directory: string) => {
      assertSerial(serial);
      return deviceFiles.list(serial, directory);
    }
  );

  ipcMain.handle("files:select-upload", async (event): Promise<LocalFile[]> => {
    const options: Electron.OpenDialogOptions = {
      properties: ["openFile", "multiSelections"]
    };
    const parent = dialogParent(event);
    const result = parent
      ? await dialog.showOpenDialog(parent, options)
      : await dialog.showOpenDialog(options);
    return result.canceled ? [] : result.filePaths.map(readLocalFile);
  });

  ipcMain.handle(
    "files:upload",
    async (
      _event,
      serial: string,
      directory: string,
      localPaths: string[]
    ): Promise<ActionResult> => {
      try {
        assertSerial(serial);
        if (!Array.isArray(localPaths) || localPaths.length === 0) {
          throw new Error("请选择要上传的文件");
        }
        const files = localPaths.map(readLocalFile);
        for (const file of files) {
          await deviceFiles.push(serial, file.path, directory);
        }
        return { ok: true, message: `已上传 ${files.length} 个文件` };
      } catch (error) {
        return resultFromError(error);
      }
    }
  );

  ipcMain.handle(
    "files:download",
    async (event, serial: string, remotePath: string): Promise<ActionResult> => {
      try {
        assertSerial(serial);
        const options: Electron.OpenDialogOptions = {
          title: "选择保存目录",
          defaultPath: app.getPath("downloads"),
          properties: ["openDirectory", "createDirectory"]
        };
        const parent = dialogParent(event);
        const result = parent
          ? await dialog.showOpenDialog(parent, options)
          : await dialog.showOpenDialog(options);
        if (result.canceled || result.filePaths.length === 0) {
          return { ok: true, cancelled: true };
        }
        const destination = result.filePaths[0];
        await deviceFiles.pull(serial, remotePath, destination);
        await shell.openPath(destination);
        return { ok: true, message: "下载完成", savedPath: destination };
      } catch (error) {
        return resultFromError(error);
      }
    }
  );

  ipcMain.handle(
    "files:preview",
    async (_event, serial: string, remotePath: string): Promise<DeviceImagePreview> => {
      assertSerial(serial);
      const image = await deviceFiles.readFile(serial, remotePath);
      if (image.length > 20 * 1024 * 1024) {
        throw new Error("图片超过 20 MB，请下载后查看");
      }
      const mimeType = detectImageMime(image);
      if (!mimeType) throw new Error("设备文件不是受支持的图片格式");
      return {
        dataUrl: `data:${mimeType};base64,${image.toString("base64")}`,
        mimeType,
        size: image.length
      };
    }
  );

  ipcMain.handle(
    "files:mkdir",
    async (_event, serial: string, parent: string, name: string): Promise<ActionResult> => {
      try {
        assertSerial(serial);
        await deviceFiles.createDirectory(serial, parent, name);
        return { ok: true, message: "文件夹已创建" };
      } catch (error) {
        return resultFromError(error);
      }
    }
  );

  ipcMain.handle(
    "files:rename",
    async (_event, serial: string, source: string, newName: string): Promise<ActionResult> => {
      try {
        assertSerial(serial);
        await deviceFiles.rename(serial, source, newName);
        return { ok: true, message: "重命名完成" };
      } catch (error) {
        return resultFromError(error);
      }
    }
  );

  ipcMain.handle(
    "files:delete",
    async (_event, serial: string, target: string): Promise<ActionResult> => {
      try {
        assertSerial(serial);
        await deviceFiles.delete(serial, target);
        return { ok: true, message: "已删除" };
      } catch (error) {
        return resultFromError(error);
      }
    }
  );

  ipcMain.handle(
    "logcat:window-open",
    async (_event, device: AndroidDevice): Promise<ActionResult> => {
      try {
        assertSerial(device.serial);
        logcatDevices.set(device.serial, device);

        const window =
          logcatWindow && !logcatWindow.isDestroyed()
            ? logcatWindow
            : await createLogcatWindow();

        window.webContents.send("logcat:device-add", device);
        if (window.isMinimized()) window.restore();
        window.show();
        window.focus();
        return { ok: true };
      } catch (error) {
        return resultFromError(error);
      }
    }
  );

  ipcMain.handle("logcat:window-devices", () =>
    Array.from(logcatDevices.values())
  );

  ipcMain.handle(
    "logcat:window-remove",
    (_event, serial: string): void => {
      assertSerial(serial);
      logcatDevices.delete(serial);
    }
  );

  ipcMain.handle(
    "mirror:start",
    async (_event, serial: string, label: string): Promise<ActionResult> => {
      try {
        assertSerial(serial);
        const started = scrcpy.start(serial, label);
        return {
          ok: started,
          message: started ? undefined : "该设备已经在投屏"
        };
      } catch (error) {
        return resultFromError(error);
      }
    }
  );

  ipcMain.handle(
    "mirror:stop",
    async (_event, serial: string): Promise<ActionResult> => {
      try {
        assertSerial(serial);
        const stopped = scrcpy.stop(serial);
        return {
          ok: stopped,
          message: stopped ? undefined : "该设备当前没有投屏"
        };
      } catch (error) {
        return resultFromError(error);
      }
    }
  );

  ipcMain.handle(
    "mirror:embedded-start",
    async (_event, serial: string): Promise<ActionResult> => {
      try {
        assertSerial(serial);
        await embeddedMirror.start(serial);
        return { ok: true };
      } catch (error) {
        return resultFromError(error);
      }
    }
  );

  ipcMain.handle(
    "mirror:embedded-stop",
    async (_event, serial: string): Promise<ActionResult> => {
      try {
        assertSerial(serial);
        const stopped = await embeddedMirror.stop(serial);
        return {
          ok: stopped,
          message: stopped ? undefined : "该设备当前没有内嵌投屏"
        };
      } catch (error) {
        return resultFromError(error);
      }
    }
  );

  ipcMain.on(
    "mirror:control",
    (_event, serial: string, input: unknown) => {
      try {
        assertSerial(serial);
        if (!isMirrorControlInput(input)) {
          return;
        }
        embeddedMirror.control(serial, input);
      } catch {
        // 控制消息是尽力而为，无效输入直接忽略
      }
    }
  );

  ipcMain.handle(
    "device:action",
    async (_event, serial: string, action: DeviceAction): Promise<ActionResult> => {
      try {
        assertSerial(serial);
        await adb.sendAction(serial, action);
        return { ok: true };
      } catch (error) {
        return resultFromError(error);
      }
    }
  );

  ipcMain.handle(
    "capture:screenshot",
    async (_event, serial: string): Promise<ActionResult> => {
      try {
        assertSerial(serial);
        const bytes = await capture.captureScreenshotBuffer(serial);
        const image = nativeImage.createFromBuffer(bytes);
        if (image.isEmpty()) throw new Error("设备截图无法写入剪贴板");
        clipboard.writeImage(image);
        const size = image.getSize();
        const media = captureMedia.addScreenshot(
          serial,
          bytes,
          size.width,
          size.height
        );
        return {
          ok: true,
          message: "截图已复制到剪贴板并在右侧打开",
          media
        };
      } catch (error) {
        return resultFromError(error);
      }
    }
  );

  ipcMain.handle(
    "capture:media-copy",
    async (_event, id: string): Promise<ActionResult> => {
      try {
        const entry = captureMedia.get(id);
        if (entry.descriptor.kind !== "image") {
          throw new Error("只有截图可以复制到剪贴板");
        }
        const image = nativeImage.createFromPath(entry.localPath);
        if (image.isEmpty()) throw new Error("截图无法写入剪贴板");
        clipboard.writeImage(image);
        return { ok: true, message: "截图已复制到剪贴板" };
      } catch (error) {
        return resultFromError(error);
      }
    }
  );

  ipcMain.handle(
    "capture:media-save-as",
    async (event, id: string): Promise<ActionResult> => {
      try {
        const entry = captureMedia.get(id);
        const destination = await chooseMediaSavePath(
          event,
          entry.descriptor.name,
          entry.descriptor.kind
        );
        if (!destination) return { ok: true, cancelled: true };
        captureMedia.copyTo(id, destination);
        return {
          ok: true,
          message: `已保存到 ${destination}`,
          savedPath: destination
        };
      } catch (error) {
        return resultFromError(error);
      }
    }
  );

  ipcMain.handle(
    "capture:recording-start",
    async (_event, serial: string): Promise<ActionResult> => {
      try {
        assertSerial(serial);
        if (capture.isRecording(serial) || screenRecorder.isRecording(serial)) {
          return { ok: false, message: "该设备已经在录屏" };
        }
        const localPath = captureMedia.createVideoPath(serial);
        // 策略：优先 adb screenrecord（轻量）；设备封禁时自动回退 scrcpy 链路
        try {
          const startedAt = await capture.startRecording(serial, localPath);
          return {
            ok: true,
            message: `录屏已开始，最长 ${180 / 60} 分钟`,
            startedAt
          };
        } catch (adbError) {
          const reason =
            adbError instanceof Error ? adbError.message : String(adbError);
          const startedAt = await screenRecorder.start(serial, localPath);
          return {
            ok: true,
            message: `录屏已开始（设备限制 screenrecord，已用兼容链路；${reason}）`,
            startedAt
          };
        }
      } catch (error) {
        return resultFromError(error);
      }
    }
  );

  ipcMain.handle(
    "capture:recording-stop",
    async (_event, serial: string): Promise<ActionResult> => {
      try {
        assertSerial(serial);
        let localPath: string | undefined;
        let startedAt: number | undefined;
        if (screenRecorder.isRecording(serial)) {
          startedAt = screenRecorder.recordingSessions()
            .find((session) => session.serial === serial)?.startedAt;
          const result = await screenRecorder.stop(serial);
          localPath = result.localPath;
        } else if (capture.isRecording(serial)) {
          startedAt = capture.adbRecordingSessions()
            .find((session) => session.serial === serial)?.startedAt;
          localPath = await capture.stopRecording(serial);
        }
        if (!localPath) {
          return { ok: false, message: "录屏未保存任何内容" };
        }
        const media = captureMedia.addVideo(
          serial,
          localPath,
          startedAt ?? Date.now()
        );
        return {
          ok: true,
          message: "录屏已完成并在右侧打开",
          media
        };
      } catch (error) {
        return resultFromError(error);
      }
    }
  );

  ipcMain.handle("capture:recording-list", () => [
    ...capture.adbRecordingSessions(),
    ...screenRecorder.recordingSessions()
  ]);

  ipcMain.handle("device:packages", async (_event, serial: string) => {
    assertSerial(serial);
    return adb.listInstalledPackages(serial);
  });

  ipcMain.handle(
    "device:clear-data",
    async (_event, serial: string, packageName: string): Promise<ActionResult> => {
      try {
        assertSerial(serial);
        assertPackageName(packageName);
        await adb.clearAppData(serial, packageName);
        return { ok: true, message: "应用数据已清除" };
      } catch (error) {
        return resultFromError(error);
      }
    }
  );

  ipcMain.handle("apps:list", async (_event, serial: string) => {
    assertSerial(serial);
    return adb.listManagedApps(serial);
  });

  ipcMain.handle(
    "apps:details",
    async (_event, serial: string, packageName: string) => {
      assertSerial(serial);
      assertPackageName(packageName);
      return adb.getManagedAppDetails(serial, packageName);
    }
  );

  ipcMain.handle(
    "apps:uninstall",
    async (_event, serial: string, packageName: string): Promise<ActionResult> => {
      try {
        assertSerial(serial);
        assertPackageName(packageName);
        await adb.uninstallApp(serial, packageName);
        return { ok: true, message: "应用已卸载" };
      } catch (error) {
        return resultFromError(error);
      }
    }
  );

  ipcMain.handle(
    "apps:force-stop",
    async (_event, serial: string, packageName: string): Promise<ActionResult> => {
      try {
        assertSerial(serial);
        assertPackageName(packageName);
        await adb.forceStopApp(serial, packageName);
        return { ok: true, message: "应用已停止运行" };
      } catch (error) {
        return resultFromError(error);
      }
    }
  );

  ipcMain.handle(
    "logcat:start",
    async (_event, serial: string, pid?: number): Promise<ActionResult> => {
      try {
        assertSerial(serial);
        if (pid !== undefined && (!Number.isInteger(pid) || pid <= 0)) {
          throw new Error("进程 PID 无效");
        }
        const started = logcat.start(serial, pid);
        if (!started) {
          logcat.resync(serial);
          return { ok: true, message: "该设备的 Logcat 已经在采集中" };
        }
        return { ok: true };
      } catch (error) {
        return resultFromError(error);
      }
    }
  );

  ipcMain.handle("device:processes", async (_event, serial: string) => {
    assertSerial(serial);
    return adb.listAppProcesses(serial);
  });

  ipcMain.handle(
    "logcat:process",
    async (_event, serial: string, pid?: number): Promise<ActionResult> => {
      try {
        assertSerial(serial);
        if (pid !== undefined && (!Number.isInteger(pid) || pid <= 0)) {
          throw new Error("进程 PID 无效");
        }
        logcat.restart(serial, pid);
        return { ok: true };
      } catch (error) {
        return resultFromError(error);
      }
    }
  );

  ipcMain.handle(
    "logcat:stop",
    async (_event, serial: string): Promise<ActionResult> => {
      try {
        assertSerial(serial);
        const stopped = logcat.stop(serial);
        return {
          ok: stopped,
          message: stopped ? undefined : "该设备当前没有 Logcat 会话"
        };
      } catch (error) {
        return resultFromError(error);
      }
    }
  );

  ipcMain.handle(
    "logcat:buffer",
    async (
      _event,
      serial: string,
      buffer: string
    ): Promise<ActionResult> => {
      try {
        assertSerial(serial);
        const targetBuffer = assertLogcatBuffer(buffer);
        logcat.setBuffer(serial, targetBuffer);
        return { ok: true, message: `已切换到 ${targetBuffer} 缓冲区` };
      } catch (error) {
        return resultFromError(error);
      }
    }
  );

  ipcMain.handle(
    "logcat:clear-buffer",
    async (
      _event,
      serial: string,
      buffer: string
    ): Promise<ActionResult> => {
      try {
        assertSerial(serial);
        const targetBuffer = assertLogcatBuffer(buffer);
        await adb.clearLogcatBuffer(serial, targetBuffer);
        return { ok: true, message: "设备日志缓冲区已清空" };
      } catch (error) {
        return resultFromError(error);
      }
    }
  );

  ipcMain.handle(
    "logcat:export",
    async (
      event,
      serial: string,
      text: string
    ): Promise<ActionResult> => {
      try {
        assertSerial(serial);
        if (typeof text !== "string" || text.length === 0) {
          return { ok: false, message: "没有可导出的日志" };
        }
        if (text.length > 20_000_000) {
          return { ok: false, message: "导出内容过大" };
        }
        const options: Electron.SaveDialogOptions = {
          title: "导出 Logcat 日志",
          defaultPath: path.join(
            app.getPath("downloads"),
            logcatExportFileName(serial)
          ),
          filters: [{ name: "文本文件", extensions: ["txt"] }]
        };
        const parent = dialogParent(event);
        const result = parent
          ? await dialog.showSaveDialog(parent, options)
          : await dialog.showSaveDialog(options);
        if (result.canceled || !result.filePath) {
          return { ok: true, cancelled: true };
        }
        const destination = path.extname(result.filePath).toLowerCase() === ".txt"
          ? result.filePath
          : `${result.filePath}.txt`;
        await writeFile(destination, text, "utf8");
        if (statSync(destination).size === 0) {
          throw new Error("导出的日志文件为空");
        }
        shell.showItemInFolder(destination);
        return { ok: true, message: "日志已导出", savedPath: destination };
      } catch (error) {
        return resultFromError(error);
      }
    }
  );

  ipcMain.handle(
    "logcat:copy-text",
    async (_event, text: string): Promise<ActionResult> => {
      try {
        if (typeof text !== "string" || text.length === 0) {
          return { ok: false, message: "没有可复制的日志" };
        }
        if (text.length > 2_000_000) {
          return { ok: false, message: "复制内容过大，请改用导出" };
        }
        clipboard.writeText(text);
        return { ok: true };
      } catch (error) {
        return resultFromError(error);
      }
    }
  );

  ipcMain.handle(
    "terminal:start",
    async (_event, serial: string): Promise<ActionResult> => {
      try {
        assertSerial(serial);
        terminal.start(serial);
        return { ok: true };
      } catch (error) {
        return resultFromError(error);
      }
    }
  );

  ipcMain.handle(
    "terminal:stop",
    async (_event, serial: string): Promise<ActionResult> => {
      try {
        assertSerial(serial);
        const stopped = terminal.stop(serial);
        return {
          ok: stopped,
          message: stopped ? undefined : "该设备当前没有终端会话"
        };
      } catch (error) {
        return resultFromError(error);
      }
    }
  );

  ipcMain.on("terminal:input", (_event, serial: string, data: unknown) => {
    try {
      assertSerial(serial);
      if (typeof data !== "string" || data.length === 0 || data.length > 4096) {
        return;
      }
      terminal.write(serial, data);
    } catch {
      // 无效输入直接忽略
    }
  });

  ipcMain.handle(
    "decompile:start",
    async (_event, apkPath: string): Promise<
      import("../shared/types").DecompileStartResult
    > => {
      try {
        if (!decompileReady) {
          throw new Error(
            "反编译依赖 Java 运行时（JAVA_HOME 或 Android Studio JBR）和 jadx，当前未检测到，请安装后重试"
          );
        }
        const apk = readApkFile(String(apkPath).trim());
        const jobId = decompile.start(apk.path, apk.name);
        return { ok: true, jobId };
      } catch (error) {
        return resultFromError(error);
      }
    }
  );

  ipcMain.handle(
    "decompile:cancel",
    async (_event, jobId: string): Promise<ActionResult> => {
      const stopped = decompile.cancel(String(jobId));
      return { ok: stopped };
    }
  );

  ipcMain.on("decompile:discard", (_event, jobId: string) => {
    decompile.discard(String(jobId));
  });

  ipcMain.handle(
    "decompile:tree",
    async (
      _event,
      jobId: string
    ): Promise<import("../shared/types").DecompileTreeResult> => {
      try {
        return decompile.tree(String(jobId));
      } catch (error) {
        return {
          nodes: [],
          truncated: false,
          message:
            error instanceof Error ? error.message : String(error)
        };
      }
    }
  );

  ipcMain.handle(
    "decompile:read",
    async (
      _event,
      jobId: string,
      relPath: string
    ): Promise<import("../shared/types").DecompileReadResult> => {
      try {
        return decompile.readFile(String(jobId), String(relPath));
      } catch (error) {
        return resultFromError(error) as never;
      }
    }
  );

  ipcMain.handle(
    "decompile:search",
    async (
      _event,
      jobId: string,
      query: string
    ): Promise<import("../shared/types").DecompileSearchResult> => {
      try {
        return decompile.search(String(jobId), String(query));
      } catch (error) {
        return resultFromError(error) as never;
      }
    }
  );
}

async function createWindow(): Promise<void> {
  mainWindow = new BrowserWindow({
    width: 1180,
    height: 760,
    minWidth: 850,
    minHeight: 560,
    backgroundColor: "#0b0f14",
    title: "Android Dev Tool",
    webPreferences: {
      preload: path.join(__dirname, "../preload/index.js"),
      contextIsolation: true,
      nodeIntegration: false
    }
  });

  mainWindow.removeMenu();
  mainWindow.on("closed", () => {
    mainWindow = undefined;
  });
  await loadRenderer(mainWindow);
}

app.whenReady().then(async () => {
  settings = new SettingsStore(
    path.join(app.getPath("userData"), "settings.json")
  );
  captureMedia = new CaptureMediaStore(
    path.join(app.getPath("temp"), "AndroidDevTool", "capture-preview")
  );
  captureMedia.reset();
  registerCaptureMediaProtocol();
  nativeTheme.themeSource = settings.getTheme();
  registerIpc();
  await createWindow();

  app.on("activate", async () => {
    if (!mainWindow || mainWindow.isDestroyed()) {
      await createWindow();
    }
  });
});

app.on("before-quit", () => {
  captureMedia?.cleanup();
  decompile.cleanup();
});

app.on("window-all-closed", () => {
  scrcpy.stopAll();
  void embeddedMirror.stopAll();
  logcat.stopAll();
  terminal.stopAll();
  screenRecorder.stopAll();
  if (process.platform !== "darwin") {
    app.quit();
  }
});
