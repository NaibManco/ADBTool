import { useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowClockwise,
  DeviceMobile,
  DownloadSimple,
  MagnifyingGlass,
  Package,
  Play,
  Power,
  Trash,
  Warning,
  X
} from "@phosphor-icons/react";
import type {
  ActionResult,
  AndroidDevice,
  ManagedApp,
  ManagedAppDetails
} from "../shared/types";

function deviceName(device: AndroidDevice): string {
  return device.model?.replaceAll("_", " ") || device.product || "Android 设备";
}

function detailValue(value: string | number | undefined): string {
  return value === undefined || value === "" ? "—" : String(value);
}

// 应用名缓存：按 设备序列号 + 包名 存 localStorage，二次打开免等 arsc 传输。
// 按需解析：只拉「搜索结果 + 选中项 + 可视区附近」的名称，滚动到哪拉到哪，
// 不为看不到的条目花 arsc 传输。
const LABEL_CACHE_KEY = "androidDevTool.appLabels.v1";
const LABEL_BATCH_SIZE = 8;
const LABEL_WINDOW_INITIAL = 24;

function readLabelCache(serial: string): Record<string, string> {
  try {
    const raw = window.localStorage.getItem(LABEL_CACHE_KEY);
    const all = raw ? (JSON.parse(raw) as Record<string, Record<string, string>>) : {};
    return all[serial] ?? {};
  } catch {
    return {};
  }
}

function writeLabelCache(serial: string, labels: Record<string, string>): void {
  try {
    const raw = window.localStorage.getItem(LABEL_CACHE_KEY);
    const all = raw ? (JSON.parse(raw) as Record<string, Record<string, string>>) : {};
    all[serial] = { ...all[serial], ...labels };
    window.localStorage.setItem(LABEL_CACHE_KEY, JSON.stringify(all));
  } catch {
    // 缓存失败不影响功能
  }
}

export function AppManager({
  devices,
  initialApps,
  initialDetails,
  onClose
}: {
  devices: AndroidDevice[];
  initialApps?: ManagedApp[];
  initialDetails?: ManagedAppDetails;
  onClose: () => void;
}) {
  const onlineDevices = useMemo(
    () => devices.filter((device) => device.state === "device"),
    [devices]
  );
  const [serial, setSerial] = useState(onlineDevices[0]?.serial ?? "");
  const [apps, setApps] = useState<ManagedApp[]>(initialApps ?? []);
  const [selectedPackage, setSelectedPackage] = useState(
    initialDetails?.packageName ?? initialApps?.[0]?.packageName ?? ""
  );
  const [details, setDetails] = useState<ManagedAppDetails | undefined>(initialDetails);
  const [query, setQuery] = useState("");
  const [loadingApps, setLoadingApps] = useState(initialApps === undefined);
  const [loadingDetails, setLoadingDetails] = useState(false);
  const [operating, setOperating] = useState<"launch" | "clear" | "stop" | "uninstall" | "pull-apk">();
  const [status, setStatus] = useState<ActionResult>();

  useEffect(() => {
    if (!serial || initialApps !== undefined) return;
    let active = true;
    setLoadingApps(true);
    setApps([]);
    setSelectedPackage("");
    setDetails(undefined);
    setStatus(undefined);
    void window.androidTool.listManagedApps(serial)
      .then((nextApps) => {
        if (!active) return;
        // 先用上次缓存的名称立即展示；未命中的交给按需解析（见 label 调度 effect）
        requestedLabels.current = new Set();
        setLabelWindow(LABEL_WINDOW_INITIAL);
        const cached = readLabelCache(serial);
        const withCache = nextApps.map((app) =>
          cached[app.packageName] ? { ...app, label: cached[app.packageName] } : app
        );
        setApps(withCache);
        setSelectedPackage(withCache[0]?.packageName ?? "");
      })
      .catch((loadError) => {
        if (active) {
          setStatus({
            ok: false,
            message: loadError instanceof Error ? loadError.message : String(loadError)
          });
        }
      })
      .finally(() => {
        if (active) setLoadingApps(false);
      });
    return () => {
      active = false;
    };
  }, [initialApps, serial]);

  useEffect(() => {
    if (!serial || !selectedPackage) {
      setDetails(undefined);
      return;
    }
    if (initialDetails?.packageName === selectedPackage) return;
    let active = true;
    setLoadingDetails(true);
    setDetails(undefined);
    void window.androidTool.getManagedAppDetails(serial, selectedPackage)
      .then((nextDetails) => {
        if (active) setDetails(nextDetails);
      })
      .catch((loadError) => {
        if (active) {
          setStatus({
            ok: false,
            message: loadError instanceof Error ? loadError.message : String(loadError)
          });
        }
      })
      .finally(() => {
        if (active) setLoadingDetails(false);
      });
    return () => {
      active = false;
    };
  }, [initialDetails, selectedPackage, serial]);

  const visibleApps = useMemo(() => {
    const keyword = query.trim().toLocaleLowerCase();
    return apps.filter(
      (app) =>
        !keyword ||
        app.packageName.toLocaleLowerCase().includes(keyword) ||
        app.label?.toLocaleLowerCase().includes(keyword)
    );
  }, [apps, query]);

  // 应用名按需解析调度：目标 = 当前列表前 labelWindow 个未解析条目（选中项优先）。
  // 用「可见列表的包名签名」做依赖——名称 merge 不触发重跑，搜索/卸载/扩窗才触发。
  const [labelWindow, setLabelWindow] = useState(LABEL_WINDOW_INITIAL);
  const requestedLabels = useRef<Set<string>>(new Set());
  const serialRef = useRef(serial);
  serialRef.current = serial;
  const pendingKey = visibleApps.map((app) => app.packageName).join("\n");
  useEffect(() => {
    if (!serial) return;
    const pending = visibleApps.filter(
      (app) => app.label === undefined && !requestedLabels.current.has(app.packageName)
    );
    const ordered = [
      ...pending.filter((app) => app.packageName === selectedPackage),
      ...pending.filter((app) => app.packageName !== selectedPackage)
    ];
    const targets = ordered.slice(0, labelWindow);
    if (targets.length === 0) return;
    for (const app of targets) requestedLabels.current.add(app.packageName);
    void (async () => {
      for (let i = 0; i < targets.length; i += LABEL_BATCH_SIZE) {
        if (serialRef.current !== serial) return; // 设备已切换，丢弃本轮
        const batch = targets.slice(i, i + LABEL_BATCH_SIZE);
        try {
          const labels = await window.androidTool.getManagedAppLabels(serial, batch);
          if (serialRef.current !== serial) return;
          writeLabelCache(serial, labels);
          setApps((prev) => prev.map((app) =>
            labels[app.packageName] ? { ...app, label: labels[app.packageName] } : app
          ));
        } catch {
          // 应用名是增强信息，失败降级为包名
        }
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- labelWindow/pendingKey 是显式依赖，selectedPackage 只影响排序优先级
  }, [labelWindow, pendingKey, serial]); // eslint-disable-line react-hooks/exhaustive-deps

  const selectedApp = apps.find((app) => app.packageName === selectedPackage);

  async function performAction(
    action: "launch" | "clear" | "stop" | "uninstall" | "pull-apk",
    operation: () => Promise<ActionResult>
  ): Promise<void> {
    setOperating(action);
    setStatus(undefined);
    try {
      const result = await operation();
      setStatus(result);
      if (result.ok && action === "uninstall") {
        const remaining = apps.filter((app) => app.packageName !== selectedPackage);
        setApps(remaining);
        setSelectedPackage(remaining[0]?.packageName ?? "");
      }
    } catch (operationError) {
      setStatus({
        ok: false,
        message: operationError instanceof Error
          ? operationError.message
          : String(operationError)
      });
    } finally {
      setOperating(undefined);
    }
  }

  function launchApp(): void {
    if (!selectedPackage || !serial) return;
    void performAction("launch", () =>
      window.androidTool.launchApp(serial, selectedPackage)
    );
  }

  function clearData(): void {
    if (!selectedPackage || !serial) return;
    if (!window.confirm(
      `确认清除 ${selectedPackage} 的全部应用数据？\n\n账号、设置、数据库和缓存都会被删除，此操作无法撤销。`
    )) return;
    void performAction("clear", () =>
      window.androidTool.clearAppData(serial, selectedPackage)
    );
  }

  function uninstall(): void {
    if (!selectedPackage || !serial) return;
    if (!window.confirm(
      `确认从设备卸载 ${selectedPackage}？\n\n该应用及其数据将被删除，此操作无法撤销。`
    )) return;
    void performAction("uninstall", () =>
      window.androidTool.uninstallApp(serial, selectedPackage)
    );
  }

  function forceStop(): void {
    if (!selectedPackage || !serial) return;
    if (!window.confirm(
      `确认停止 ${selectedPackage}？\n\n应用的前台和后台进程都会结束，未保存的状态可能丢失。`
    )) return;
    void performAction("stop", () =>
      window.androidTool.forceStopApp(serial, selectedPackage)
    );
  }

  // 提取 APK 备份：把设备端已安装的 base.apk 拉回本机
  function pullApk(): void {
    if (!selectedPackage || !serial || !selectedApp) return;
    void performAction("pull-apk", () =>
      window.androidTool.pullDeviceApk(
        serial,
        selectedPackage,
        selectedApp.apkPath
      )
    );
  }

  return (
    <div className="app-manager-overlay" role="presentation">
      <section
        className="app-manager"
        role="dialog"
        aria-modal="true"
        aria-labelledby="app-manager-title"
      >
        <header className="app-manager-header">
          <span className="app-manager-mark"><Package size={21} weight="duotone" /></span>
          <div>
            <h2 id="app-manager-title">应用管理</h2>
            <p>查看设备中的第三方应用、版本与安装信息</p>
          </div>
          <label className="app-manager-device">
            <DeviceMobile size={15} />
            <select
              value={serial}
              onChange={(event) => setSerial(event.target.value)}
              aria-label="选择设备"
            >
              {onlineDevices.map((device) => (
                <option key={device.serial} value={device.serial}>
                  {deviceName(device)} · {device.serial}
                </option>
              ))}
            </select>
          </label>
          <button className="app-manager-close" onClick={onClose} title="关闭应用管理">
            <X size={18} />
          </button>
        </header>

        {onlineDevices.length === 0 ? (
          <div className="app-manager-no-device">
            <DeviceMobile size={38} weight="duotone" />
            <h3>没有可用设备</h3>
            <p>连接设备并完成 USB 调试授权后再试。</p>
          </div>
        ) : (
          <div className="app-manager-body">
            <aside className="app-manager-list-pane">
              <label className="app-manager-search">
                <MagnifyingGlass size={16} />
                <input
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                  placeholder="搜索应用名称或包名"
                />
              </label>
              <div className="app-manager-list-meta">
                <span>{apps.length} 个第三方应用</span>
                <span>仅用户安装</span>
              </div>
              <div
                className="app-manager-app-list"
                onScroll={(event) => {
                  // 接近底部时扩窗解析更多名称（只增不减，列表条目本身全部渲染）
                  const el = event.currentTarget;
                  if (
                    labelWindow < apps.length &&
                    el.scrollTop + el.clientHeight > el.scrollHeight - 300
                  ) {
                    setLabelWindow((window) => Math.min(window + LABEL_WINDOW_INITIAL, apps.length));
                  }
                }}
              >
                {loadingApps ? (
                  <div className="app-manager-empty"><span className="loader" /> 正在读取应用…</div>
                ) : visibleApps.length === 0 ? (
                  <div className="app-manager-empty">
                    {query ? "没有匹配的应用" : "未发现第三方应用"}
                  </div>
                ) : (
                  visibleApps.map((app) => (
                    <button
                      key={app.packageName}
                      className={selectedPackage === app.packageName ? "selected" : ""}
                      onClick={() => {
                        setSelectedPackage(app.packageName);
                        setStatus(undefined);
                      }}
                    >
                      <span><Package size={16} /></span>
                      <span className="app-manager-app-name">
                        <strong title={app.label ?? app.packageName}>
                          {app.label ?? app.packageName}
                        </strong>
                        {app.label && <code>{app.packageName}</code>}
                      </span>
                    </button>
                  ))
                )}
              </div>
            </aside>

            <section className="app-manager-detail-pane">
              {!selectedApp ? (
                <div className="app-manager-detail-empty">
                  <Package size={38} weight="duotone" />
                  <p>从左侧选择应用查看详细信息</p>
                </div>
              ) : (
                <>
                  <header className="app-detail-heading">
                    <span><Package size={28} weight="duotone" /></span>
                    <div>
                      <h3>{selectedApp.label ?? selectedApp.packageName}</h3>
                      <p>
                        {selectedApp.label ? `${selectedApp.packageName} · ` : ""}
                        {details?.versionName ? `版本 ${details.versionName}` : "正在读取版本信息"}
                      </p>
                    </div>
                    {loadingDetails && <ArrowClockwise className="spinning" size={17} />}
                  </header>

                  <div className="app-detail-grid">
                    <Detail label="版本名称" value={detailValue(details?.versionName)} />
                    <Detail label="版本号" value={detailValue(details?.versionCode)} />
                    <Detail label="最低 SDK" value={detailValue(details?.minSdk)} />
                    <Detail label="目标 SDK" value={detailValue(details?.targetSdk)} />
                    <Detail label="用户 ID" value={detailValue(details?.userId)} />
                    <Detail label="CPU 架构" value={detailValue(details?.primaryCpuAbi)} />
                    <Detail label="首次安装" value={detailValue(details?.firstInstallTime)} wide />
                    <Detail label="最近更新" value={detailValue(details?.lastUpdateTime)} wide />
                    <Detail label="安装来源" value={detailValue(details?.installerPackageName)} wide />
                    <Detail label="APK 路径" value={selectedApp.apkPath} wide code />
                    <Detail label="数据目录" value={detailValue(details?.dataDir)} wide code />
                  </div>

                  <section className="app-permissions">
                    <header>
                      <strong>请求的权限</strong>
                      <span>{details?.requestedPermissions.length ?? 0} 项</span>
                    </header>
                    <div>
                      {details?.requestedPermissions.length ? (
                        details.requestedPermissions.map((permission) => (
                          <code key={permission}>{permission}</code>
                        ))
                      ) : (
                        <p>{loadingDetails ? "正在读取…" : "未声明权限或无法读取"}</p>
                      )}
                    </div>
                  </section>

                  {status && (
                    <div className={status.ok ? "app-manager-status success" : "app-manager-status error"}>
                      {status.message || (status.ok ? "操作完成" : "操作失败")}
                    </div>
                  )}

                  <footer className="app-manager-actions">
                    <span><Warning size={14} /> 请确认当前设备和应用</span>
                    <button
                      className="app-pull-apk-button"
                      disabled={Boolean(operating)}
                      onClick={pullApk}
                      title="把设备上的 APK 拉回本机备份"
                    >
                      <DownloadSimple size={15} />
                      {operating === "pull-apk" ? "正在提取…" : "提取 APK"}
                    </button>
                    <button
                      className="app-launch-button"
                      disabled={Boolean(operating)}
                      onClick={launchApp}
                    >
                      <Play size={15} weight="fill" />
                      {operating === "launch" ? "正在启动…" : "启动应用"}
                    </button>
                    <button
                      className="app-force-stop-button"
                      disabled={Boolean(operating)}
                      onClick={forceStop}
                    >
                      <Power size={15} />
                      {operating === "stop" ? "正在停止…" : "停止运行"}
                    </button>
                    <button
                      className="app-clear-button"
                      disabled={Boolean(operating)}
                      onClick={clearData}
                    >
                      <Warning size={15} />
                      {operating === "clear" ? "正在清除…" : "清除数据"}
                    </button>
                    <button
                      className="app-uninstall-button"
                      disabled={Boolean(operating)}
                      onClick={uninstall}
                    >
                      <Trash size={15} />
                      {operating === "uninstall" ? "正在卸载…" : "卸载应用"}
                    </button>
                  </footer>
                </>
              )}
            </section>
          </div>
        )}
      </section>
    </div>
  );
}

function Detail({
  label,
  value,
  wide = false,
  code = false
}: {
  label: string;
  value: string;
  wide?: boolean;
  code?: boolean;
}) {
  return (
    <div className={wide ? "app-detail-item wide" : "app-detail-item"}>
      <small>{label}</small>
      {code ? <code title={value}>{value}</code> : <strong>{value}</strong>}
    </div>
  );
}
