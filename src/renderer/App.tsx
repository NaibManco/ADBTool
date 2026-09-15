import {
  Fragment,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type DragEvent as ReactDragEvent,
  type PointerEvent as ReactPointerEvent
} from "react";
import {
  ArrowLeft,
  ArrowClockwise,
  CaretDoubleLeft,
  CaretDoubleRight,
  Camera,
  Circle,
  Clipboard as ClipboardIcon,
  CodeBlock,
  Cpu,
  DeviceMobile,
  DownloadSimple,
  FolderOpen,
  House,
  List,
  Power,
  Package,
  Terminal as TerminalIcon,
  TerminalWindow,
  UploadSimple,
  VideoCamera,
  WifiHigh
} from "@phosphor-icons/react";
import type {
  ActionResult,
  AndroidDevice,
  CaptureMedia,
  DeviceAction,
  MirrorQualityPreset,
  ThemeMode
} from "../shared/types";
import { useTheme } from "./theme";
import { ApkInstaller, fileFromDrop } from "./ApkInstaller";
import { CapturePreview } from "./CapturePreview";
import { LogcatWorkspace } from "./LogcatPanel";
import { MirrorPane } from "./MirrorPane";
import { TerminalPane } from "./TerminalPane";
import { WirelessConnect } from "./WirelessConnect";

const ACTIONS: Array<{
  action: DeviceAction;
  icon: string;
  label: string;
}> = [
  { action: "back", icon: "←", label: "返回" },
  { action: "home", icon: "○", label: "主页" },
  { action: "recents", icon: "▢", label: "任务" },
  { action: "power", icon: "⏻", label: "电源" },
  { action: "volumeDown", icon: "−", label: "音量−" },
  { action: "volumeUp", icon: "+", label: "音量+" }
];

function deviceName(device: AndroidDevice): string {
  return device.model?.replaceAll("_", " ") || device.product || "Android 设备";
}

type WorkspaceView = "mirror" | "log" | "terminal";
// nonce 用于强制重挂载死面板（key 变化才会触发 remount）
type MirrorEntry = AndroidDevice & { nonce: number };
const WORKSPACE_VIEW_KEY = "androidDevTool.workspace.view";
const MIRROR_GRID_KEY = "androidDevTool.workspace.mirrorGrid";
const VIEW_LABELS: Record<WorkspaceView, string> = {
  mirror: "投屏",
  log: "日志",
  terminal: "终端"
};
const VIEW_TITLES: Record<WorkspaceView, string> = {
  mirror: "整页查看投屏",
  log: "整页查看日志",
  terminal: "整页查看终端"
};

function readWorkspaceView(): WorkspaceView {
  try {
    const value = window.localStorage.getItem(WORKSPACE_VIEW_KEY);
    return value === "mirror" || value === "terminal" ? value : "log";
  } catch {
    return "log";
  }
}

function persistWorkspace(view: WorkspaceView): void {
  try {
    window.localStorage.setItem(WORKSPACE_VIEW_KEY, view);
  } catch {
    // 存储不可用时布局偏好仅保留在本次会话
  }
}

function readMirrorGrid(): boolean {
  try {
    return window.localStorage.getItem(MIRROR_GRID_KEY) === "on";
  } catch {
    return false;
  }
}

function persistMirrorGrid(on: boolean): void {
  try {
    window.localStorage.setItem(MIRROR_GRID_KEY, on ? "on" : "off");
  } catch {
    // 同上
  }
}

// 网格格宽（像素 flex-grow 值）：按设备 serial 记忆，未设置的设备等分
const MIRROR_GRID_MIN_CELL = 120;

function readMirrorGridSplits(): Record<string, number> {
  try {
    const raw = JSON.parse(
      window.localStorage.getItem(`${MIRROR_GRID_KEY}.splits`) ?? "{}"
    ) as Record<string, unknown>;
    const out: Record<string, number> = {};
    for (const [serial, value] of Object.entries(raw)) {
      if (
        typeof value === "number" &&
        Number.isFinite(value) &&
        value >= MIRROR_GRID_MIN_CELL
      ) {
        out[serial] = value;
      }
    }
    return out;
  } catch {
    return {};
  }
}

function persistMirrorGridSplits(splits: Record<string, number>): void {
  try {
    window.localStorage.setItem(
      `${MIRROR_GRID_KEY}.splits`,
      JSON.stringify(splits)
    );
  } catch {
    // 存储不可用时边界偏好仅保留在本次会话
  }
}

function statusText(state: string): string {
  if (state === "device") return "已连接";
  if (state === "unauthorized") return "等待授权";
  if (state === "offline") return "设备离线";
  return state;
}

export function formatRecordingDuration(totalSeconds: number): string {
  const safeSeconds = Math.max(0, Math.floor(totalSeconds));
  const minutes = Math.floor(safeSeconds / 60);
  const seconds = safeSeconds % 60;
  return `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
}

export function SettingsPanel({
  theme,
  quality,
  onThemeChange,
  onQualityChange,
  onClose
}: {
  theme: ThemeMode;
  quality: MirrorQualityPreset;
  onThemeChange: (theme: ThemeMode) => void;
  onQualityChange: (preset: MirrorQualityPreset) => void;
  onClose: () => void;
}) {
  const choices: Array<{
    value: ThemeMode;
    title: string;
    description: string;
  }> = [
    {
      value: "dark",
      title: "深色模式",
      description: "适合长时间查看日志与夜间调试"
    },
    {
      value: "light",
      title: "浅色模式",
      description: "提高明亮环境下的界面对比度"
    }
  ];

  const qualityChoices: Array<{
    value: MirrorQualityPreset;
    title: string;
    description: string;
  }> = [
    {
      value: "smooth",
      title: "流畅",
      description: "2 Mbps · 1024px · 30fps，弱网与低端设备首选"
    },
    {
      value: "balanced",
      title: "均衡",
      description: "8 Mbps · 1600px，日常调试默认档"
    },
    {
      value: "high",
      title: "高清",
      description: "16 Mbps · 原始分辨率，看细节与 UI 走查用"
    }
  ];

  return (
    <div className="settings-overlay" role="presentation">
      <section
        className="settings-panel"
        role="dialog"
        aria-modal="true"
        aria-labelledby="settings-title"
      >
        <header>
          <div>
            <h2 id="settings-title">设置</h2>
            <p>调整开发工具的显示与使用偏好</p>
          </div>
          <button className="settings-close" onClick={onClose} title="关闭设置">
            ×
          </button>
        </header>

        <div className="settings-group">
          <h3>外观设置</h3>
          <div className="theme-options" role="radiogroup" aria-label="界面主题">
            {choices.map((choice) => {
              const selected = theme === choice.value;
              return (
                <button
                  key={choice.value}
                  className={selected ? "theme-option selected" : "theme-option"}
                  role="radio"
                  aria-checked={selected}
                  onClick={() => onThemeChange(choice.value)}
                >
                  <span className={`theme-preview theme-preview--${choice.value}`}>
                    <i />
                    <i />
                    <i />
                  </span>
                  <span>
                    <strong>{choice.title}</strong>
                    <small>{choice.description}</small>
                  </span>
                  <b>{selected ? "✓" : ""}</b>
                </button>
              );
            })}
          </div>
        </div>

        <div className="settings-group">
          <h3>投屏画质</h3>
          <div className="theme-options" role="radiogroup" aria-label="投屏画质档位">
            {qualityChoices.map((choice, index) => {
              const selected = quality === choice.value;
              // 档位序号（0/1/2）决定点亮柱数：流畅 1 根、均衡 2 根、高清 3 根
              const barsOn = index + 1;
              return (
                <button
                  key={choice.value}
                  className={selected ? "theme-option selected" : "theme-option"}
                  role="radio"
                  aria-checked={selected}
                  onClick={() => onQualityChange(choice.value)}
                >
                  <span className="quality-preview">
                    <i className={barsOn >= 1 ? "on" : ""} />
                    <i className={barsOn >= 2 ? "on" : ""} />
                    <i className={barsOn >= 3 ? "on" : ""} />
                  </span>
                  <span>
                    <strong>{choice.title}</strong>
                    <small>{choice.description}</small>
                  </span>
                  <b>{selected ? "✓" : ""}</b>
                </button>
              );
            })}
          </div>
          <p className="settings-hint">切换后正在投屏的会话会自动按新档位重连</p>
        </div>
      </section>
    </div>
  );
}

export function DeviceCard({
  device,
  busy,
  onMirror,
  onAction,
  onLogs
}: {
  device: AndroidDevice;
  busy: boolean;
  onMirror: (device: AndroidDevice) => Promise<void>;
  onAction: (device: AndroidDevice, action: DeviceAction) => Promise<void>;
  onLogs: (device: AndroidDevice) => Promise<void>;
}) {
  const ready = device.state === "device";

  return (
    <article className="device-card">
      <div className="device-card__glow" />
      <header className="device-header">
        <div className="device-icon" aria-hidden="true">
          <span />
        </div>
        <div className="device-heading">
          <h2>{deviceName(device)}</h2>
          <code>{device.serial}</code>
        </div>
        <span className={`status status--${device.state}`}>
          <i />
          {statusText(device.state)}
        </span>
      </header>

      <div className="device-meta">
        <span>
          <small>连接</small>
          {device.serial.includes(":") ? "Wi-Fi" : "USB"}
        </span>
        <span>
          <small>产品</small>
          {device.product || "—"}
        </span>
        <span>
          <small>投屏</small>
          {device.mirroring ? "运行中" : "未启动"}
        </span>
      </div>

      <div className="primary-actions">
        <button
          className={device.mirroring ? "mirror-button stop" : "mirror-button"}
          disabled={!ready || busy}
          onClick={() => void onMirror(device)}
        >
          <span>{device.mirroring ? "■" : "▶"}</span>
          {device.mirroring ? "停止投屏" : "启动投屏"}
        </button>
        <button
          className="log-button"
          disabled={!ready}
          onClick={() => void onLogs(device)}
        >
          <span>&gt;_</span>
          打开日志
        </button>
      </div>

      <div className="divider">
        <span>快捷控制</span>
      </div>

      <div className="action-grid">
        {ACTIONS.map(({ action, icon, label }) => (
          <button
            key={action}
            disabled={!ready || busy}
            onClick={() => void onAction(device, action)}
            title={label}
          >
            <b>{icon}</b>
            <span>{label}</span>
          </button>
        ))}
      </div>
    </article>
  );
}

const RAIL_ACTIONS: Array<{
  action: DeviceAction;
  label: string;
  icon: typeof ArrowLeft;
}> = [
  { action: "back", label: "返回", icon: ArrowLeft },
  { action: "home", label: "主页", icon: House },
  { action: "recents", label: "任务", icon: List },
  { action: "power", label: "电源", icon: Power }
];

export function DeviceRailCard({
  device,
  busy,
  selected,
  collapsed,
  recording,
  recordingSeconds,
  bugreporting,
  clipboardSync,
  onMirror,
  onTerminal,
  onClipboardSync,
  onAction,
  onScreenshot,
  onRecording,
  onBugreport,
  onLogs
}: {
  device: AndroidDevice;
  busy: boolean;
  selected: boolean;
  collapsed: boolean;
  recording: boolean;
  recordingSeconds: number;
  bugreporting: boolean;
  clipboardSync: boolean;
  onMirror: (device: AndroidDevice) => void;
  onTerminal: (device: AndroidDevice) => void;
  onClipboardSync: (device: AndroidDevice, enabled: boolean) => void;
  onAction: (device: AndroidDevice, action: DeviceAction) => Promise<void>;
  onScreenshot: (device: AndroidDevice) => Promise<void>;
  onRecording: (device: AndroidDevice) => Promise<void>;
  onBugreport: (device: AndroidDevice) => Promise<void>;
  onLogs: (device: AndroidDevice) => void;
}) {
  const ready = device.state === "device";
  const embedded = device.mirroringEmbedded;

  if (collapsed) {
    return (
      <button
        className={selected ? "rail-device-dot active" : "rail-device-dot"}
        onClick={() => ready && onLogs(device)}
        title={`${deviceName(device)} · ${statusText(device.state)}`}
      >
        <DeviceMobile size={19} />
        <i className={`rail-state rail-state--${device.state}`} />
      </button>
    );
  }

  return (
    <article className={selected ? "rail-device-card selected" : "rail-device-card"}>
      <header>
        <span className="rail-phone"><DeviceMobile size={20} /></span>
        <span>
          <span className="rail-name-line">
            <strong>{deviceName(device)}</strong>
            <i className={`rail-state rail-state--${device.state}`} title={statusText(device.state)} />
          </span>
          <code>{device.serial}</code>
        </span>
        <button
          className={clipboardSync ? "rail-clip-sync active" : "rail-clip-sync"}
          disabled={!ready}
          onClick={() => onClipboardSync(device, !clipboardSync)}
          title={
            clipboardSync
              ? "剪贴板同步开启中（双向自动），点击关闭"
              : "开启剪贴板双向同步（电脑与这台设备自动共享复制内容）"
          }
        >
          <ClipboardIcon size={18} weight={clipboardSync ? "fill" : "regular"} />
        </button>
      </header>

      <div className="rail-primary-actions">
        <button
          className={embedded ? "rail-mirror stop" : "rail-mirror"}
          disabled={!ready || busy}
          onClick={() => onMirror(device)}
          title={embedded ? "停止内嵌投屏" : "内嵌投屏到右侧工作区"}
        >
          <DeviceMobile size={15} weight="bold" />
          {embedded ? "停止" : "投屏"}
        </button>
        <button
          className="rail-log"
          disabled={!ready}
          onClick={() => onLogs(device)}
          title="打开 Logcat 日志"
        >
          <TerminalWindow size={15} />
          日志
        </button>
      </div>

      <div className="rail-action-grid">
        {RAIL_ACTIONS.map(({ action, label, icon: Icon }) => (
          <button
            key={action}
            disabled={!ready || busy}
            onClick={() => void onAction(device, action)}
            title={label}
          >
            <Icon size={14} />
            <span>{label}</span>
          </button>
        ))}
      </div>
      <div className="rail-tool-actions">
        <button
          className="rail-screenshot"
          disabled={!ready || busy}
          onClick={() => void onScreenshot(device)}
          title="截取设备屏幕并复制到剪贴板"
        >
          <Camera size={14} />
          <span>屏幕截图</span>
        </button>
        <button
          className={recording ? "rail-recording active" : "rail-recording"}
          disabled={!ready || busy}
          onClick={() => void onRecording(device)}
          title={recording ? `停止录屏（已录制 ${formatRecordingDuration(recordingSeconds)}）` : "开始录屏"}
        >
          <VideoCamera size={14} />
          <span>{recording ? `停止 ${formatRecordingDuration(recordingSeconds)}` : "开始录屏"}</span>
        </button>
        <button
          className="rail-reboot"
          disabled={!ready || busy}
          onClick={() => {
            if (window.confirm(`确认重启 ${deviceName(device)}？设备连接会暂时断开。`)) {
              void onAction(device, "reboot");
            }
          }}
          title="重启设备（连接会暂时断开）"
        >
          <ArrowClockwise size={14} />
          <span>重启设备</span>
        </button>
        <button
          className="rail-bugreport"
          disabled={!ready || busy}
          onClick={() => void onBugreport(device)}
          title="导出完整 Bugreport ZIP"
        >
          <DownloadSimple size={14} />
          <span>{bugreporting ? "正在导出…" : "导出 Bugreport"}</span>
        </button>
      </div>

      <div className="rail-terminal-row">
        <button
          className="rail-terminal"
          disabled={!ready || busy}
          onClick={() => onTerminal(device)}
          title="打开该设备的交互式 Shell 终端"
        >
          <TerminalIcon size={15} />
          终端
        </button>
      </div>
    </article>
  );
}

function LegacyApp() {
  const [devices, setDevices] = useState<AndroidDevice[]>([]);
  const [loading, setLoading] = useState(true);
  const [busySerial, setBusySerial] = useState<string>();
  const [error, setError] = useState<string>();
  const [lastUpdated, setLastUpdated] = useState<Date>();
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [mirrorQuality, setMirrorQuality] = useState<MirrorQualityPreset>("balanced");
  const { theme, changeTheme } = useTheme();

  const changeMirrorQuality = useCallback(async (next: MirrorQualityPreset) => {
    setMirrorQuality(next);
    await window.androidTool.setMirrorQuality(next);
  }, []);

  const refresh = useCallback(async (showLoading = false) => {
    if (showLoading) setLoading(true);
    try {
      const nextDevices = await window.androidTool.listDevices();
      setDevices(nextDevices);
      setError(undefined);
      setLastUpdated(new Date());
    } catch (refreshError) {
      setError(
        refreshError instanceof Error ? refreshError.message : String(refreshError)
      );
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh(true);
    const timer = window.setInterval(() => void refresh(), 2_500);
    return () => window.clearInterval(timer);
  }, [refresh]);

  const onlineCount = useMemo(
    () => devices.filter((device) => device.state === "device").length,
    [devices]
  );

  async function run(
    serial: string,
    operation: () => Promise<ActionResult>
  ): Promise<void> {
    setBusySerial(serial);
    try {
      const result = await operation();
      if (!result.ok) {
        setError(result.message || "操作失败");
      } else {
        setError(undefined);
      }
      await refresh();
    } finally {
      setBusySerial(undefined);
    }
  }

  async function toggleMirror(device: AndroidDevice): Promise<void> {
    await run(device.serial, () =>
      device.mirroring
        ? window.androidTool.stopMirror(device.serial)
        : window.androidTool.startMirror(device.serial, deviceName(device))
    );
  }

  async function sendAction(
    device: AndroidDevice,
    action: DeviceAction
  ): Promise<void> {
    await run(device.serial, () =>
      window.androidTool.sendAction(device.serial, action)
    );
  }

  async function openLogs(device: AndroidDevice): Promise<void> {
    const result = await window.androidTool.openLogcatWindow(device);
    setError(result.ok ? undefined : result.message || "无法打开 Logcat");
  }

  return (
    <main>
      <header className="app-header">
        <div className="brand">
          <div className="brand-mark">
            <span />
          </div>
          <div>
            <h1>Android Dev Tool</h1>
            <p>设备投屏与快捷调试</p>
          </div>
        </div>

        <div className="header-actions">
          <div className="device-summary">
            <span className="pulse" />
            <strong>{onlineCount}</strong> 台设备在线
          </div>
          <button
            className="refresh-button"
            onClick={() => void refresh(true)}
            disabled={loading}
          >
            <span className={loading ? "spinning" : ""}>↻</span>
            刷新
          </button>
          <button
            className="settings-button"
            onClick={() => setSettingsOpen(true)}
            aria-label="打开设置"
          >
            <span>⚙</span>
            设置
          </button>
        </div>
      </header>

      {error && (
        <div className="error-banner">
          <strong>操作未完成</strong>
          <span>{error}</span>
          <button onClick={() => setError(undefined)}>×</button>
        </div>
      )}

      <section className="section-heading">
        <div>
          <h2>已发现设备</h2>
          <p>ADB 将自动刷新 USB 和无线连接</p>
        </div>
        {lastUpdated && (
          <small>
            最近刷新{" "}
            {lastUpdated.toLocaleTimeString("zh-CN", {
              hour: "2-digit",
              minute: "2-digit",
              second: "2-digit"
            })}
          </small>
        )}
      </section>

      {loading && devices.length === 0 ? (
        <div className="empty-state">
          <span className="loader" />
          <h2>正在查找 Android 设备</h2>
          <p>请确保设备已开启 USB 调试</p>
        </div>
      ) : devices.length === 0 ? (
        <div className="empty-state">
          <div className="empty-phone">?</div>
          <h2>没有发现设备</h2>
          <p>连接设备并确认 USB 调试授权后，再点击刷新</p>
          <button onClick={() => void refresh(true)}>重新扫描</button>
        </div>
      ) : (
        <section className="device-grid">
          {devices.map((device) => (
            <DeviceCard
              key={device.serial}
              device={device}
              busy={busySerial === device.serial}
              onMirror={toggleMirror}
              onAction={sendAction}
              onLogs={openLogs}
            />
          ))}
        </section>
      )}

      <footer>
        <span>ADB</span>
        <i />
        <span>scrcpy 4.0</span>
        <b>本机运行 · 数据不离开电脑</b>
      </footer>

      {settingsOpen && (
        <SettingsPanel
          theme={theme}
          quality={mirrorQuality}
          onThemeChange={(nextTheme) => void changeTheme(nextTheme)}
          onQualityChange={(next) => void changeMirrorQuality(next)}
          onClose={() => setSettingsOpen(false)}
        />
      )}
    </main>
  );
}

export function App() {
  const [devices, setDevices] = useState<AndroidDevice[]>([]);
  const [logDevices, setLogDevices] = useState<AndroidDevice[]>([]);
  const [mirrorDevices, setMirrorDevices] = useState<MirrorEntry[]>([]);
  const [activeMirrorSerial, setActiveMirrorSerial] = useState("");
  const [terminalDevices, setTerminalDevices] = useState<AndroidDevice[]>([]);
  const [activeTerminalSerial, setActiveTerminalSerial] = useState("");
  const [clipboardSyncSerials, setClipboardSyncSerials] = useState<
    Set<string>
  >(new Set());
  const [workspaceView, setWorkspaceView] = useState<WorkspaceView>(() =>
    readWorkspaceView()
  );
  const [mirrorGrid, setMirrorGrid] = useState(() => readMirrorGrid());
  const [mirrorGridSplits, setMirrorGridSplits] = useState<
    Record<string, number>
  >(() => readMirrorGridSplits());
  const [loading, setLoading] = useState(true);
  const [busySerial, setBusySerial] = useState<string>();
  const [error, setError] = useState<string>();
  const [capturePreview, setCapturePreview] = useState<CaptureMedia>();
  const [bugreportSerial, setBugreportSerial] = useState<string>();
  const [recordingSerials, setRecordingSerials] = useState<Set<string>>(new Set());
  const [recordingStarts, setRecordingStarts] = useState<Map<string, number>>(new Map());
  const [recordingNow, setRecordingNow] = useState(Date.now());
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [mirrorQuality, setMirrorQuality] = useState<MirrorQualityPreset>("balanced");
  const [wirelessOpen, setWirelessOpen] = useState(false);
  const [apkOpen, setApkOpen] = useState(false);
  const [droppedApk, setDroppedApk] = useState<ReturnType<typeof fileFromDrop>>();
  const [railCollapsed, setRailCollapsed] = useState(false);
  const [railWidth, setRailWidth] = useState(340);
  const [draggingApk, setDraggingApk] = useState(false);
  const [copiedError, setCopiedError] = useState(false);
  const { theme, changeTheme } = useTheme();

  useEffect(() => {
    void window.androidTool.getMirrorQuality().then(setMirrorQuality);
  }, []);

  const changeMirrorQuality = useCallback(
    async (next: MirrorQualityPreset) => {
      setMirrorQuality(next);
      const result = await window.androidTool.setMirrorQuality(next);
      if (!result.ok) {
        setMirrorQuality(await window.androidTool.getMirrorQuality());
      }
    },
    []
  );

  const refresh = useCallback(async (showLoading = false) => {
    if (showLoading) setLoading(true);
    try {
      const [nextDevices, syncSerials] = await Promise.all([
        window.androidTool.listDevices(),
        window.androidTool.getClipboardSyncSerials().catch(() => [] as string[])
      ]);
      setDevices(nextDevices);
      setClipboardSyncSerials(new Set(syncSerials));
      setLogDevices((current) =>
        current.map(
          (selected) =>
            nextDevices.find((device) => device.serial === selected.serial) ??
            selected
        )
      );
      setTerminalDevices((current) =>
        current.filter((selected) =>
          nextDevices.some(
            (device) =>
              device.serial === selected.serial && device.state === "device"
          )
        )
      );
      setMirrorDevices((current) =>
        current
          .map((selected) => {
            const fresh = nextDevices.find(
              (device) =>
                device.serial === selected.serial && device.state === "device"
            );
            return fresh ? { ...fresh, nonce: selected.nonce } : selected;
          })
          .filter((selected) =>
            nextDevices.some(
              (device) =>
                device.serial === selected.serial &&
                device.state === "device"
            )
          )
      );
      // 错误提示只允许手动关闭，轮询成功不再自动清除
    } catch (refreshError) {
      setError(
        refreshError instanceof Error ? refreshError.message : String(refreshError)
      );
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh(true);
    const timer = window.setInterval(() => void refresh(), 2_500);
    return () => window.clearInterval(timer);
  }, [refresh]);

  // 内嵌投屏状态变化即时刷新设备列表（不等 2.5s 轮询）
  useEffect(() => {
    return window.androidTool.onMirrorEvent((event) => {
      if (event.type === "status") {
        void refresh();
      }
    });
  }, [refresh]);

  useEffect(() => {
    void window.androidTool.listScreenRecordings()
      .then((sessions) => {
        setRecordingSerials(new Set(sessions.map((session) => session.serial)));
        setRecordingStarts(
          new Map(sessions.map((session) => [session.serial, session.startedAt]))
        );
      })
      .catch(() => undefined);
  }, []);

  useEffect(() => {
    if (recordingSerials.size === 0) return;
    setRecordingNow(Date.now());
    const timer = window.setInterval(() => setRecordingNow(Date.now()), 1_000);
    return () => window.clearInterval(timer);
  }, [recordingSerials.size]);

  // 录屏意外结束（设备断开/画面旋转）：同步清理本地状态并提示
  useEffect(() => {
    return window.androidTool.onRecordingEnded((event) => {
      setRecordingSerials((current) => {
        if (!current.has(event.serial)) return current;
        const next = new Set(current);
        next.delete(event.serial);
        return next;
      });
      setRecordingStarts((current) => {
        if (!current.has(event.serial)) return current;
        const next = new Map(current);
        next.delete(event.serial);
        return next;
      });
      setError(event.ok ? event.message : `录屏异常结束：${event.message}`);
    });
  }, []);

  useEffect(() => {
    if (!mirrorDevices.some((device) => device.serial === activeMirrorSerial)) {
      setActiveMirrorSerial(mirrorDevices[0]?.serial ?? "");
    }
  }, [activeMirrorSerial, mirrorDevices]);

  useEffect(() => {
    if (
      !terminalDevices.some((device) => device.serial === activeTerminalSerial)
    ) {
      setActiveTerminalSerial(terminalDevices[0]?.serial ?? "");
    }
  }, [activeTerminalSerial, terminalDevices]);

  useEffect(() => {
    // A file dragged from Explorer can be cancelled outside the app window,
    // in which case React's root onDragLeave is not guaranteed to run.
    const clearDragging = () => setDraggingApk(false);
    const clearWhenLeavingViewport = (event: DragEvent) => {
      if (event.relatedTarget === null) clearDragging();
    };
    const clearOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") clearDragging();
    };

    window.addEventListener("dragend", clearDragging);
    window.addEventListener("drop", clearDragging);
    window.addEventListener("dragleave", clearWhenLeavingViewport);
    window.addEventListener("blur", clearDragging);
    window.addEventListener("keydown", clearOnEscape);
    return () => {
      window.removeEventListener("dragend", clearDragging);
      window.removeEventListener("drop", clearDragging);
      window.removeEventListener("dragleave", clearWhenLeavingViewport);
      window.removeEventListener("blur", clearDragging);
      window.removeEventListener("keydown", clearOnEscape);
    };
  }, []);

  const onlineCount = useMemo(
    () => devices.filter((device) => device.state === "device").length,
    [devices]
  );

  // 工作区当前存在内容的视图 + 生效视图（偏好指向已清空的视图时回落）
  const availableViews = useMemo<Array<WorkspaceView>>(
    () =>
      [
        mirrorDevices.length > 0 ? "mirror" : undefined,
        logDevices.length > 0 ? "log" : undefined,
        terminalDevices.length > 0 ? "terminal" : undefined
      ].filter((view): view is WorkspaceView => view !== undefined),
    [mirrorDevices.length, logDevices.length, terminalDevices.length]
  );
  const effectiveView: WorkspaceView = availableViews.includes(workspaceView)
    ? workspaceView
    : (availableViews[0] ?? "log");

  async function run(
    serial: string,
    operation: () => Promise<ActionResult>
  ): Promise<ActionResult> {
    setBusySerial(serial);
    try {
      const result = await operation();
      setError(result.ok ? undefined : result.message || "操作失败");
      await refresh();
      return result;
    } finally {
      setBusySerial(undefined);
    }
  }

  // 启动投屏 = 内嵌到右侧工作区；运行中再点 = 关闭；
  // 面板还在但会话已结束（设备仍在线）时 = 换 nonce 重挂载面板重启会话
  function toggleMirror(device: AndroidDevice): void {
    const existing = mirrorDevices.find(
      (item) => item.serial === device.serial
    );
    if (existing) {
      if (device.mirroringEmbedded) {
        closeMirror(device.serial);
        return;
      }
      const nonce = Date.now();
      setMirrorDevices((current) => [
        ...current.filter((item) => item.serial !== device.serial),
        { ...device, nonce }
      ]);
      setActiveMirrorSerial(device.serial);
      setWorkspaceView("mirror");
      return;
    }
    setCapturePreview(undefined);
    setActiveMirrorSerial(device.serial);
    setWorkspaceView("mirror");
    setMirrorDevices((current) => [...current, { ...device, nonce: Date.now() }]);
  }

  function closeMirror(serial: string): void {
    setMirrorDevices((current) =>
      current.filter((device) => device.serial !== serial)
    );
  }

  // 终端 = 该设备的交互式 adb shell，从设备卡打开即针对该设备
  function toggleTerminal(device: AndroidDevice): void {
    if (terminalDevices.some((item) => item.serial === device.serial)) {
      setTerminalDevices((current) =>
        current.filter((item) => item.serial !== device.serial)
      );
      return;
    }
    setCapturePreview(undefined);
    setWorkspaceView("terminal");
    setActiveTerminalSerial(device.serial);
    setTerminalDevices((current) => [...current, device]);
  }

  // 剪贴板双向同步（每设备独立开关，主进程持隐藏会话）
  function toggleClipboardSync(device: AndroidDevice, enabled: boolean): void {
    void window.androidTool
      .setClipboardSync(device.serial, enabled)
      .then((result) => {
        setClipboardSyncSerials((current) => {
          const next = new Set(current);
          if (result.ok && enabled) next.add(device.serial);
          else next.delete(device.serial);
          return next;
        });
        if (!result.ok) {
          setError(result.message || "剪贴板同步设置失败");
        }
      });
  }

  // 弹出窗口 = 换用独立大屏窗口（主进程 yume-chan 会话），同时自动关闭内嵌投屏。
  // 先弹窗再撤面板：面板卸载发出的停会话请求必然落在窗口注册之后，
  // 被主进程"窗口已接管"守卫吞掉，会话在两种形态间保持连续
  async function toggleMirrorWindow(device: AndroidDevice): Promise<void> {
    if (device.mirroring && !device.mirroringEmbedded) {
      await run(device.serial, () =>
        window.androidTool.stopMirror(device.serial)
      );
      return;
    }
    const result = await run(device.serial, () =>
      window.androidTool.startMirror(device.serial, deviceName(device))
    );
    if (result?.ok !== false) {
      closeMirror(device.serial);
    }
  }

  function changeWorkspaceView(view: WorkspaceView): void {
    setWorkspaceView(view);
    persistWorkspace(view);
  }

  async function sendAction(
    device: AndroidDevice,
    action: DeviceAction
  ): Promise<void> {
    await run(device.serial, () =>
      window.androidTool.sendAction(device.serial, action)
    );
  }

  async function captureScreenshot(device: AndroidDevice): Promise<void> {
    setBusySerial(device.serial);
    try {
      const result = await window.androidTool.captureScreenshot(device.serial);
      if (!result.ok) {
        setError(result.message || "截图失败");
      } else if (!result.media) {
        setError("截图完成，但未返回可预览的图片");
      } else {
        setCapturePreview(result.media);
      }
    } finally {
      setBusySerial(undefined);
    }
  }

  async function toggleRecording(device: AndroidDevice): Promise<void> {
    const recording = recordingSerials.has(device.serial);
    setBusySerial(device.serial);
    try {
      if (recording) {
        // 停止路径：主进程无论成败都会结束会话，本地状态同步清掉，
        // 避免停止失败时永远停在"录制中"
        const result = await window.androidTool.stopScreenRecording(device.serial);
        setRecordingSerials((current) => {
          const next = new Set(current);
          next.delete(device.serial);
          return next;
        });
        setRecordingStarts((current) => {
          const next = new Map(current);
          next.delete(device.serial);
          return next;
        });
        if (!result.ok) {
          setError(result.message || "录屏停止失败");
          return;
        }
        if (result.cancelled) return;
        if (!result.media) {
          setError("录屏完成，但未返回可预览的视频");
          return;
        }
        setCapturePreview(result.media);
        return;
      }

      const result = await window.androidTool.startScreenRecording(device.serial);
      if (!result.ok) {
        setError(result.message || "录屏启动失败");
        return;
      }
      if (result.cancelled) return;
      setRecordingSerials((current) => new Set(current).add(device.serial));
      setRecordingStarts((current) =>
        new Map(current).set(device.serial, result.startedAt ?? Date.now())
      );
    } finally {
      setBusySerial(undefined);
    }
  }

  async function exportBugreport(device: AndroidDevice): Promise<void> {
    setBusySerial(device.serial);
    setBugreportSerial(device.serial);
    try {
      const result = await window.androidTool.exportBugreport(device.serial);
      if (!result.cancelled) {
        setError(result.ok ? undefined : result.message || "Bugreport 导出失败");
      }
    } finally {
      setBugreportSerial(undefined);
      setBusySerial(undefined);
    }
  }

  function openLogs(device: AndroidDevice): void {
    setCapturePreview(undefined);
    setWorkspaceView("log");
    setLogDevices((current) =>
      current.some((item) => item.serial === device.serial)
        ? current.map((item) => (item.serial === device.serial ? device : item))
        : [...current, device]
    );
  }

  function removeLogs(serial: string): void {
    setLogDevices((current) =>
      current.filter((device) => device.serial !== serial)
    );
  }

  function beginRailResize(event: ReactPointerEvent<HTMLDivElement>): void {
    if (railCollapsed) {
      setRailCollapsed(false);
      return;
    }
    event.preventDefault();
    const startX = event.clientX;
    const startWidth = railWidth;
    const onMove = (moveEvent: PointerEvent) => {
      setRailWidth(Math.min(520, Math.max(270, startWidth + moveEvent.clientX - startX)));
    };
    const onUp = () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
  }

  function handleWorkbenchDrop(event: ReactDragEvent<HTMLElement>): void {
    event.preventDefault();
    setDraggingApk(false);
    const file = event.dataTransfer.files[0];
    if (!file) return;
    try {
      setDroppedApk(fileFromDrop(file));
      setApkOpen(true);
    } catch (dropError) {
      setError(dropError instanceof Error ? dropError.message : String(dropError));
    }
  }

  // 网格格间边界拖动：改相邻两格的像素宽度（flex-grow），按 serial 持久化
  const mirrorGridSplitsRef = useRef(mirrorGridSplits);
  mirrorGridSplitsRef.current = mirrorGridSplits;

  function beginGridSplitResize(
    event: ReactPointerEvent<HTMLDivElement>,
    rightIndex: number
  ): void {
    event.preventDefault();
    const left = mirrorDevices[rightIndex - 1];
    const right = mirrorDevices[rightIndex];
    if (!left || !right) return;
    const cells = document.querySelectorAll<HTMLElement>(".mirror-grid-cell");
    const leftCell = cells[rightIndex - 1];
    const rightCell = cells[rightIndex];
    if (!leftCell || !rightCell) return;
    const startX = event.clientX;
    const startLeft = leftCell.getBoundingClientRect().width;
    const startRight = rightCell.getBoundingClientRect().width;
    const onMove = (moveEvent: PointerEvent) => {
      const delta = moveEvent.clientX - startX;
      setMirrorGridSplits({
        ...mirrorGridSplitsRef.current,
        [left.serial]: Math.max(MIRROR_GRID_MIN_CELL, startLeft + delta),
        [right.serial]: Math.max(MIRROR_GRID_MIN_CELL, startRight - delta)
      });
    };
    const onUp = () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      persistMirrorGridSplits(mirrorGridSplitsRef.current);
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
  }

  const workbenchStyle = {
    "--rail-width": railCollapsed ? "60px" : `${railWidth}px`
  } as CSSProperties;

  return (
    <main
      className="app-shell"
      onDragEnter={(event) => {
        if (Array.from(event.dataTransfer.items).some((item) => item.kind === "file")) {
          setDraggingApk(true);
        }
      }}
      onDragOver={(event) => event.preventDefault()}
      onDragLeave={(event) => {
        const relatedTarget = event.relatedTarget;
        if (!(relatedTarget instanceof Node) || !event.currentTarget.contains(relatedTarget)) {
          setDraggingApk(false);
        }
      }}
      onDrop={handleWorkbenchDrop}
    >
      <header className="app-header compact">
        <div className="brand">
          <div className="brand-mark"><span /></div>
          <div>
            <h1>Android Dev Tool</h1>
            <p>设备控制与实时日志工作台</p>
          </div>
        </div>

        <div className="header-actions">
          <div className="device-summary">
            <span className="pulse" />
            <strong>{onlineCount}</strong> 台设备在线
          </div>
          <button
            className="file-manager-header-button"
            onClick={() => void window.androidTool.openFileManagerWindow()}
          >
            <FolderOpen size={16} />
            文件管理
          </button>
          <button
            className="app-manager-header-button"
            onClick={() => void window.androidTool.openAppManagerWindow()}
          >
            <Package size={16} />
            应用管理
          </button>
          <button
            className="device-info-header-button"
            onClick={() => void window.androidTool.openDeviceInfoWindow()}
          >
            <Cpu size={16} />
            设备信息
          </button>
          <button
            className="decompiler-header-button"
            onClick={() => void window.androidTool.openDecompilerWindow()}
            title="反编译 APK 查看 Java 源码与资源"
          >
            <CodeBlock size={16} />
            反编译
          </button>
          <button
            className="apk-header-button"
            onClick={() => {
              setDroppedApk(undefined);
              setApkOpen(true);
            }}
          >
            <UploadSimple size={16} />
            安装 APK
          </button>
          <button
            className="settings-button"
            onClick={() => setSettingsOpen(true)}
            aria-label="打开设置"
          >
            <span>⚙</span>
            设置
          </button>
        </div>
      </header>

      {error && (
        <div className="error-banner workbench-error">
          <strong>操作未完成</strong>
          <span>{error}</span>
          <button
            className="error-copy"
            onClick={() => {
              void window.androidTool
                .copyLogcatText(error)
                .then((result) => {
                  setCopiedError(result.ok);
                  window.setTimeout(
                    () => setCopiedError(false),
                    1_500
                  );
                });
            }}
            title="复制完整错误信息"
          >
            {copiedError ? "已复制" : "复制"}
          </button>
          <button
            className="error-close"
            onClick={() => setError(undefined)}
            title="关闭"
          >
            ×
          </button>
        </div>
      )}

      <section
        className={railCollapsed ? "unified-workbench rail-collapsed" : "unified-workbench"}
        style={workbenchStyle}
      >
        <aside className="device-rail">
          <header className="rail-header">
            {!railCollapsed && (
              <div>
                <h2>设备</h2>
                <p>{loading ? "正在刷新…" : `${onlineCount} 台在线`}</p>
              </div>
            )}
            <div className="rail-header-actions">
              {!railCollapsed && (
                <button
                  className="rail-wireless-button"
                  onClick={() => setWirelessOpen(true)}
                  title="无线连接设备（Wi-Fi ADB：USB 一键转无线或配对码连接）"
                >
                  <WifiHigh size={15} />
                  <span>无线</span>
                </button>
              )}
              <button
                className="rail-collapse"
                onClick={() => setRailCollapsed((current) => !current)}
                title={railCollapsed ? "展开设备栏" : "收起设备栏"}
              >
                {railCollapsed
                  ? <CaretDoubleRight size={15} />
                  : <CaretDoubleLeft size={15} />}
              </button>
            </div>
          </header>

          <div className="rail-device-list">
            {loading && devices.length === 0 ? (
              <div className="rail-empty"><span className="loader" /><p>查找设备</p></div>
            ) : devices.length === 0 ? (
              <div className="rail-empty">
                <DeviceMobile size={28} />
                {!railCollapsed && <p>未发现设备<br /><small>请检查 USB 调试授权，或使用无线连接</small></p>}
                {!railCollapsed && (
                  <button
                    className="rail-empty-wireless"
                    onClick={() => setWirelessOpen(true)}
                  >
                    <WifiHigh size={14} />
                    无线连接设备
                  </button>
                )}
              </div>
            ) : (
              devices.map((device) => (
                <DeviceRailCard
                  key={device.serial}
                  device={device}
                  busy={busySerial === device.serial}
                  selected={
                    logDevices.some((item) => item.serial === device.serial) ||
                    mirrorDevices.some((item) => item.serial === device.serial) ||
                    capturePreview?.deviceSerial === device.serial
                  }
                  collapsed={railCollapsed}
                  recording={recordingSerials.has(device.serial)}
                  recordingSeconds={Math.floor(
                    (recordingNow - (recordingStarts.get(device.serial) ?? recordingNow)) / 1_000
                  )}
                  bugreporting={bugreportSerial === device.serial}
                  clipboardSync={clipboardSyncSerials.has(device.serial)}
                  onMirror={toggleMirror}
                  onTerminal={toggleTerminal}
                  onClipboardSync={toggleClipboardSync}
                  onAction={sendAction}
                  onScreenshot={captureScreenshot}
                  onRecording={toggleRecording}
                  onBugreport={exportBugreport}
                  onLogs={openLogs}
                />
              ))
            )}
          </div>

          {!railCollapsed && (
            <footer className="rail-footer">
              <span>ADB</span><i /><span>scrcpy 4.0</span>
              <b>本机运行</b>
            </footer>
          )}
        </aside>

        <div
          className="rail-resizer"
          role="separator"
          aria-orientation="vertical"
          aria-label="调整设备栏宽度"
          onPointerDown={beginRailResize}
        />

        <section className="workbench-log">
          {capturePreview && (
            <div className="ws-overlay">
              <CapturePreview
                media={capturePreview}
                onClose={() => setCapturePreview(undefined)}
              />
            </div>
          )}
          {mirrorDevices.length === 0 &&
          logDevices.length === 0 &&
          terminalDevices.length === 0 ? (
            <div className="logcat-home">
              <span className="logcat-home-mark"><TerminalWindow size={34} weight="duotone" /></span>
              <h2>设备工作区</h2>
              <p>从左侧设备启动投屏、打开 Logcat 或终端，即可一边操作设备，一边查看实时日志。</p>
              <div>
                {devices.filter((device) => device.state === "device").map((device) => (
                  <button key={device.serial} onClick={() => openLogs(device)}>
                    <Circle size={8} weight="fill" />
                    {deviceName(device)}
                  </button>
                ))}
              </div>
            </div>
          ) : (
            <div className="ws-shell">
              {availableViews.length > 1 && (
                <header className="ws-toolbar">
                  <div className="ws-mode" role="tablist" aria-label="工作区视图">
                    {availableViews.map((view) => (
                      <button
                        key={view}
                        className={effectiveView === view ? "active" : ""}
                        onClick={() => changeWorkspaceView(view)}
                        title={VIEW_TITLES[view]}
                      >
                        {VIEW_LABELS[view]}
                      </button>
                    ))}
                  </div>
                </header>
              )}

              <div className="ws-body">
                {mirrorDevices.length > 0 && (
                  <div
                    className={
                      effectiveView === "mirror"
                        ? "mirror-area"
                        : "mirror-area pane-hidden"
                    }
                  >
                    <div className="mirror-tabs" role="tablist" aria-label="投屏设备">
                      {mirrorDevices.map((device) => (
                        <button
                          key={device.serial}
                          role="tab"
                          aria-selected={device.serial === activeMirrorSerial}
                          className={device.serial === activeMirrorSerial ? "active" : ""}
                          onClick={() => setActiveMirrorSerial(device.serial)}
                          title={device.serial}
                        >
                          {deviceName(device)}
                        </button>
                      ))}
                      {mirrorDevices.length > 1 && (
                        <button
                          className={mirrorGrid ? "mirror-grid-toggle on" : "mirror-grid-toggle"}
                          onClick={() => {
                            const next = !mirrorGrid;
                            setMirrorGrid(next);
                            persistMirrorGrid(next);
                          }}
                          title={mirrorGrid ? "切回单设备大画面" : "多设备同屏网格"}
                        >
                          {mirrorGrid ? "单屏" : "网格"}
                        </button>
                      )}
                    </div>
                    <div
                      className={
                        mirrorGrid ? "mirror-stage grid" : "mirror-stage"
                      }
                    >
                      {mirrorDevices.map((device, index) => (
                        <Fragment key={`${device.serial}:${device.nonce}`}>
                          {mirrorGrid && index > 0 && (
                            <div
                              className="mirror-grid-divider"
                              role="separator"
                              aria-orientation="vertical"
                              aria-label="调整相邻投屏画面的边界"
                              title="拖动调整两格画面的边界"
                              onPointerDown={(event) =>
                                beginGridSplitResize(event, index)
                              }
                            />
                          )}
                          {mirrorGrid ? (
                            <div
                              className="mirror-grid-cell"
                              style={{
                                flexGrow: mirrorGridSplits[device.serial] ?? 1
                              }}
                            >
                              <MirrorPane
                                device={device}
                                active={
                                  mirrorGrid ||
                                  (device.serial === activeMirrorSerial &&
                                    effectiveView === "mirror")
                                }
                                onMirrorWindow={() => toggleMirrorWindow(device)}
                                onClose={() => closeMirror(device.serial)}
                              />
                            </div>
                          ) : (
                            <MirrorPane
                              device={device}
                              active={
                                device.serial === activeMirrorSerial &&
                                effectiveView === "mirror"
                              }
                              onMirrorWindow={() => toggleMirrorWindow(device)}
                              onClose={() => closeMirror(device.serial)}
                            />
                          )}
                        </Fragment>
                      ))}
                    </div>
                  </div>
                )}

                {logDevices.length > 0 && (
                  <div
                    className={
                      effectiveView === "log"
                        ? "ws-log-area"
                        : "ws-log-area pane-hidden"
                    }
                  >
                    <LogcatWorkspace
                      devices={logDevices}
                      availableDevices={devices}
                      onAdd={openLogs}
                      onRemove={removeLogs}
                      onClose={() => setLogDevices([])}
                    />
                  </div>
                )}

                {terminalDevices.length > 0 && (
                  <div
                    className={
                      effectiveView === "terminal"
                        ? "terminal-area"
                        : "terminal-area pane-hidden"
                    }
                  >
                    <div className="mirror-tabs" role="tablist" aria-label="终端设备">
                      {terminalDevices.map((device) => (
                        <button
                          key={device.serial}
                          role="tab"
                          aria-selected={device.serial === activeTerminalSerial}
                          className={device.serial === activeTerminalSerial ? "active" : ""}
                          onClick={() => setActiveTerminalSerial(device.serial)}
                          title={device.serial}
                        >
                          {deviceName(device)}
                        </button>
                      ))}
                    </div>
                    <div className="terminal-stage">
                      {terminalDevices.map((device) => (
                        <TerminalPane
                          key={device.serial}
                          device={device}
                          active={
                            device.serial === activeTerminalSerial &&
                            effectiveView === "terminal"
                          }
                          onClose={() =>
                            setTerminalDevices((current) =>
                              current.filter(
                                (item) => item.serial !== device.serial
                              )
                            )
                          }
                        />
                      ))}
                    </div>
                  </div>
                )}
              </div>
            </div>
          )}
        </section>
      </section>

      {draggingApk && (
        <div className="apk-global-drop">
          <FileArrowUpIcon />
          <strong>松开以安装 APK</strong>
          <span>稍后选择目标设备</span>
        </div>
      )}

      {settingsOpen && (
        <SettingsPanel
          theme={theme}
          quality={mirrorQuality}
          onThemeChange={(nextTheme) => void changeTheme(nextTheme)}
          onQualityChange={(next) => void changeMirrorQuality(next)}
          onClose={() => setSettingsOpen(false)}
        />
      )}

      {wirelessOpen && (
        <WirelessConnect
          devices={devices}
          onClose={() => setWirelessOpen(false)}
        />
      )}

      {apkOpen && (
        <ApkInstaller
          devices={devices}
          initialFile={droppedApk}
          onClose={() => {
            setApkOpen(false);
            setDroppedApk(undefined);
          }}
        />
      )}

    </main>
  );
}

function FileArrowUpIcon() {
  return <UploadSimple size={34} weight="duotone" />;
}
