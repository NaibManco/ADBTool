import { useEffect, useState, type DragEvent as ReactDragEvent } from "react";
import {
  AndroidLogo,
  CaretDown,
  CheckCircle,
  FileArrowUp,
  FolderOpen,
  X,
  XCircle
} from "@phosphor-icons/react";
import type { AndroidDevice, ApkFile, ApkInstallFailure } from "../shared/types";

type InstallState = "idle" | "installing" | "success" | "error";

function deviceLabel(device: AndroidDevice): string {
  return device.model?.replaceAll("_", " ") || device.product || device.serial;
}

function formatSize(size: number): string {
  if (size < 1024 * 1024) return `${Math.max(1, Math.round(size / 1024))} KB`;
  return `${(size / 1024 / 1024).toFixed(1)} MB`;
}

function fileFromDrop(file: File): ApkFile {
  const path = window.androidTool.getDroppedFilePath(file);
  if (!path || !file.name.toLowerCase().endsWith(".apk")) {
    throw new Error("请拖入有效的 APK 文件");
  }
  return { path, name: file.name, size: file.size };
}

export interface RecentApk {
  path: string;
  name: string;
  size: number;
  installedAt: number;
  serial?: string;
}

const RECENT_APK_KEY = "androidDevTool.apk.recent.v1";
const RECENT_APK_CAP = 5;
const LAUNCH_AFTER_INSTALL_KEY = "androidDevTool.apk.launchAfterInstall.v1";

/** 「安装成功后启动应用」勾选跨弹窗会话记忆：只存 "1"/"0"，读取异常按未勾选。 */
function readLaunchAfterInstall(): boolean {
  try {
    return window.localStorage.getItem(LAUNCH_AFTER_INSTALL_KEY) === "1";
  } catch {
    return false;
  }
}

function writeLaunchAfterInstall(value: boolean): void {
  try {
    window.localStorage.setItem(LAUNCH_AFTER_INSTALL_KEY, value ? "1" : "0");
  } catch {
    // 存储不可用时勾选仅保留在本次弹窗
  }
}

/** 成功安装后更新最近列表：按路径去重、新的在前、截断到上限。纯函数供单测。 */
export function mergeRecentApk(
  current: RecentApk[],
  entry: RecentApk,
  cap = RECENT_APK_CAP
): RecentApk[] {
  return [entry, ...current.filter((item) => item.path !== entry.path)].slice(
    0,
    cap
  );
}

function readRecentApks(): RecentApk[] {
  try {
    const raw = window.localStorage.getItem(RECENT_APK_KEY);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter(
        (item): item is RecentApk =>
          Boolean(item) &&
          typeof item === "object" &&
          typeof (item as RecentApk).path === "string" &&
          typeof (item as RecentApk).name === "string"
      )
      .slice(0, RECENT_APK_CAP);
  } catch {
    return [];
  }
}

function writeRecentApks(list: RecentApk[]): void {
  try {
    window.localStorage.setItem(RECENT_APK_KEY, JSON.stringify(list));
  } catch {
    // 存储不可用时历史仅保留在本次会话内存中
  }
}

function formatInstalledAt(timestamp: number): string {
  const date = new Date(timestamp);
  const now = new Date();
  const sameDay =
    date.getFullYear() === now.getFullYear() &&
    date.getMonth() === now.getMonth() &&
    date.getDate() === now.getDate();
  const time = `${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}`;
  return sameDay
    ? `今天 ${time}`
    : `${date.getMonth() + 1}/${date.getDate()} ${time}`;
}

export function ApkFailurePrompt({
  failure,
  onForceDowngrade
}: {
  failure: ApkInstallFailure;
  onForceDowngrade: () => void;
}) {
  return (
    <>
      {failure.raw ? <small title={failure.raw}>{failure.raw}</small> : null}
      {failure.canForceDowngrade ? (
        <div className="apk-downgrade-choice">
          <span>APK 版本低于设备上已安装的版本，是否仍要强制降级安装？</span>
          <button type="button" onClick={onForceDowngrade}>
            强制降级安装
          </button>
        </div>
      ) : null}
    </>
  );
}

export function ApkInstaller({
  devices,
  initialFile,
  onClose
}: {
  devices: AndroidDevice[];
  initialFile?: ApkFile;
  onClose: () => void;
}) {
  const onlineDevices = devices.filter((device) => device.state === "device");
  const [file, setFile] = useState<ApkFile | undefined>(initialFile);
  const [manualPath, setManualPath] = useState(initialFile?.path ?? "");
  const [selectedSerial, setSelectedSerial] = useState("");
  const [installState, setInstallState] = useState<InstallState>("idle");
  const [progress, setProgress] = useState(0);
  const [message, setMessage] = useState("");
  const [installFailure, setInstallFailure] = useState<ApkInstallFailure | undefined>();
  const [recentApks, setRecentApks] = useState<RecentApk[]>(() =>
    readRecentApks()
  );
  const [recentOpen, setRecentOpen] = useState(false);
  const [launchAfterInstall, setLaunchAfterInstall] = useState(() =>
    readLaunchAfterInstall()
  );
  const installing = installState === "installing";

  useEffect(() => {
    if (selectedSerial && !onlineDevices.some((item) => item.serial === selectedSerial)) {
      setSelectedSerial("");
    }
  }, [onlineDevices, selectedSerial]);

  async function chooseFile(): Promise<void> {
    try {
      const selected = await window.androidTool.selectApkFile();
      if (!selected) return;
      setFile(selected);
      setManualPath(selected.path);
      resetInstallState();
    } catch (error) {
      setInstallState("error");
      setInstallFailure(undefined);
      setMessage(error instanceof Error ? error.message : String(error));
    }
  }

  function acceptDrop(event: ReactDragEvent): void {
    event.preventDefault();
    const dropped = event.dataTransfer.files[0];
    if (!dropped) return;
    try {
      const droppedFile = fileFromDrop(dropped);
      setFile(droppedFile);
      setManualPath(droppedFile.path);
      resetInstallState();
    } catch (error) {
      setInstallState("error");
      setInstallFailure(undefined);
      setMessage(error instanceof Error ? error.message : String(error));
    }
  }

  function resetInstallState(): void {
    setInstallState("idle");
    setMessage("");
    setProgress(0);
    setInstallFailure(undefined);
  }

  async function resolveManualPath(): Promise<ApkFile | undefined> {
    const apkPath = manualPath.trim();
    if (!apkPath) return undefined;
    try {
      const resolved = await window.androidTool.resolveApkPath(apkPath);
      setFile(resolved);
      setManualPath(resolved.path);
      resetInstallState();
      return resolved;
    } catch (error) {
      setFile(undefined);
      setInstallState("error");
      setMessage(error instanceof Error ? error.message : String(error));
      return undefined;
    }
  }

  async function install(forceDowngrade = false): Promise<void> {
    if ((!file && !manualPath.trim()) || !selectedSerial || installing) return;
    let apk = file ?? await resolveManualPath();
    if (!apk) return;
    // 拖入的文件不经过主进程，缺包名时补读一次，供安装后启动使用
    if (launchAfterInstall && !apk.packageName) {
      const resolved = await window.androidTool
        .resolveApkPath(apk.path)
        .catch(() => undefined);
      apk = resolved ?? apk;
    }
    setInstallState("installing");
    setInstallFailure(undefined);
    setProgress(12);
    setMessage(forceDowngrade ? "正在强制降级安装…" : "正在将 APK 传输到设备…");
    const timer = window.setInterval(() => {
      setProgress((current) => Math.min(88, current + Math.max(2, Math.round((90 - current) / 5))));
    }, 450);

    try {
      const result = await window.androidTool.installApk(
        selectedSerial,
        apk.path,
        forceDowngrade ? { forceDowngrade: true } : undefined
      );
      if (!result.ok) {
        setInstallState("error");
        setInstallFailure(result.installFailure);
        setMessage(result.message || "APK 安装失败");
        return;
      }
      setProgress(100);
      setInstallState("success");
      let suffix = "";
      if (launchAfterInstall) {
        if (apk.packageName) {
          const launchResult = await window.androidTool.launchApp(
            selectedSerial,
            apk.packageName
          );
          suffix = launchResult.ok
            ? "应用已启动。"
            : `自动启动失败：${launchResult.message || "未知原因"}，可在应用管理中手动启动。`;
        } else {
          suffix = "未能识别 APK 包名，无法自动启动，可在应用管理中启动。";
        }
      }
      setMessage(`已安装到 ${deviceLabel(onlineDevices.find((item) => item.serial === selectedSerial)!)}。${suffix}`);
      // 记录最近安装（失败不记录）
      const entry: RecentApk = {
        path: apk.path,
        name: apk.name,
        size: apk.size,
        installedAt: Date.now(),
        serial: selectedSerial
      };
      setRecentApks((current) => {
        const next = mergeRecentApk(current, entry);
        writeRecentApks(next);
        return next;
      });
    } catch (error) {
      setInstallState("error");
      setMessage(error instanceof Error ? error.message : String(error));
    } finally {
      window.clearInterval(timer);
    }
  }

  /** 选择历史安装文件：校验路径仍有效，载入并预选上次的目标设备。 */
  async function pickRecentApk(recent: RecentApk): Promise<void> {
    try {
      const resolved = await window.androidTool.resolveApkPath(recent.path);
      setFile(resolved);
      setManualPath(resolved.path);
      resetInstallState();
      if (
        recent.serial &&
        onlineDevices.some((device) => device.serial === recent.serial)
      ) {
        setSelectedSerial(recent.serial);
      }
    } catch (error) {
      setFile(undefined);
      setInstallState("error");
      setInstallFailure(undefined);
      setMessage(
        `历史文件已不可用：${error instanceof Error ? error.message : String(error)}`
      );
    }
  }

  const canInstall = Boolean((file || manualPath.trim()) && selectedSerial && !installing);

  return (
    <div
      className="apk-overlay"
      role="presentation"
      onDragOver={(event) => event.preventDefault()}
      onDrop={acceptDrop}
    >
      <section
        className="apk-installer"
        role="dialog"
        aria-modal="true"
        aria-labelledby="apk-installer-title"
      >
        <header>
          <div className="apk-title-mark">
            <AndroidLogo size={22} weight="fill" />
          </div>
          <div>
            <h2 id="apk-installer-title">安装 APK</h2>
            <p>选择安装包，然后指定一台已连接设备</p>
          </div>
          <button className="apk-close" onClick={onClose} disabled={installing} title="关闭">
            <X size={18} />
          </button>
        </header>

        <div
          className={file ? "apk-dropzone has-file" : "apk-dropzone"}
          onDragOver={(event) => event.preventDefault()}
          onDrop={acceptDrop}
        >
          <FileArrowUp size={30} weight="duotone" />
          {file ? (
            <div className="apk-file-info">
              <strong>{file.name}</strong>
              <span>{formatSize(file.size)}</span>
              <code title={file.path}>{file.path}</code>
            </div>
          ) : (
            <div>
              <strong>将 APK 拖到这里</strong>
              <span>也可以从电脑中选择文件</span>
            </div>
          )}
          <div className="apk-dropzone-actions">
            <button onClick={() => void chooseFile()} disabled={installing}>
              <FolderOpen size={16} />
              {file ? "更换文件" : "选择 APK"}
            </button>
            {file && (
              <button
                className="apk-clear-file"
                onClick={() => {
                  setFile(undefined);
                  setManualPath("");
                  resetInstallState();
                }}
                disabled={installing}
                title="清除已选的安装包"
              >
                <X size={16} />
                清除
              </button>
            )}
          </div>
        </div>

        <div className="apk-path-entry">
          <label htmlFor="apk-absolute-path">或输入 APK 绝对路径</label>
          <div>
            <input
              id="apk-absolute-path"
              type="text"
              value={manualPath}
              disabled={installing}
              placeholder={"例如：D:\\Builds\\app-debug.apk"}
              spellCheck={false}
              onChange={(event) => {
                setManualPath(event.target.value);
                setFile(undefined);
                resetInstallState();
              }}
              onKeyDown={(event) => {
                if (event.key === "Enter") void resolveManualPath();
              }}
            />
            <button
              type="button"
              disabled={!manualPath.trim() || installing}
              onClick={() => void resolveManualPath()}
            >
              使用路径
            </button>
          </div>
          <span>支持本机绝对路径，按 Enter 可校验并载入文件</span>
        </div>

        {recentApks.length > 0 && (
          <div className={recentOpen ? "apk-recent open" : "apk-recent"}>
            <button
              type="button"
              className="apk-recent-toggle"
              onClick={() => setRecentOpen((open) => !open)}
              aria-expanded={recentOpen}
              disabled={installing}
            >
              <span>最近安装</span>
              <small>点击条目可快速重装</small>
              <CaretDown
                size={13}
                weight="bold"
                className={recentOpen ? "open" : ""}
              />
            </button>
            {recentOpen && (
              <div className="apk-recent-list">
                {recentApks.map((recent) => (
                  <button
                    key={recent.path}
                    type="button"
                    className={
                      file?.path === recent.path ? "selected" : ""
                    }
                    disabled={installing}
                    onClick={() => void pickRecentApk(recent)}
                    title={recent.path}
                  >
                    <strong>{recent.name}</strong>
                    <span>
                      {formatSize(recent.size)} · {formatInstalledAt(recent.installedAt)}
                      {recent.serial ? ` · ${recent.serial}` : ""}
                    </span>
                  </button>
                ))}
                <p className="apk-recent-hint">选中条目会自动带上上次安装的设备</p>
              </div>
            )}
          </div>
        )}

        <fieldset className="apk-device-list" disabled={installing}>
          <legend>选择目标设备</legend>
          {onlineDevices.length === 0 ? (
            <p className="apk-no-device">当前没有可安装的在线设备</p>
          ) : (
            onlineDevices.map((device) => (
              <label
                key={device.serial}
                className={selectedSerial === device.serial ? "selected" : ""}
              >
                <input
                  type="radio"
                  name="apk-target"
                  value={device.serial}
                  checked={selectedSerial === device.serial}
                  onChange={() => setSelectedSerial(device.serial)}
                />
                <span className="apk-device-icon"><AndroidLogo size={18} /></span>
                <span>
                  <strong>{deviceLabel(device)}</strong>
                  <code>{device.serial}</code>
                </span>
                <i />
              </label>
            ))
          )}
        </fieldset>

        {installState !== "idle" && (
          <div className={`apk-progress apk-progress--${installState}`}>
            <div>
              {installState === "success" ? (
                <CheckCircle size={17} weight="fill" />
              ) : installState === "error" ? (
                <XCircle size={17} weight="fill" />
              ) : (
                <span className="loader" />
              )}
              <span>{message}</span>
              {installState !== "error" && <b>{progress}%</b>}
            </div>
            {installState === "error" && installFailure && (
              <ApkFailurePrompt
                failure={installFailure}
                onForceDowngrade={() => void install(true)}
              />
            )}
            <span><i style={{ width: `${progress}%` }} /></span>
          </div>
        )}

        <footer className="apk-actions">
          <label
            className={launchAfterInstall ? "apk-launch-option checked" : "apk-launch-option"}
            title="安装成功后立即在所选设备上启动该应用（离线解析 APK 包名）"
          >
            <input
              type="checkbox"
              checked={launchAfterInstall}
              disabled={installing}
              onChange={(event) => {
                setLaunchAfterInstall(event.target.checked);
                writeLaunchAfterInstall(event.target.checked);
              }}
            />
            <span>安装成功后启动应用</span>
          </label>
          <button className="apk-cancel" onClick={onClose} disabled={installing}>
            取消
          </button>
          <button
            className="apk-install"
            disabled={!canInstall}
            onClick={() => void install()}
          >
            {installing
              ? "正在安装…"
              : selectedSerial
                ? "安装到所选设备"
                : "选择设备后安装"}
          </button>
        </footer>
      </section>
    </div>
  );
}

export { fileFromDrop };
