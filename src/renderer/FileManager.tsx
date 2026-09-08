import { useCallback, useEffect, useMemo, useRef, useState, type DragEvent } from "react";
import {
  ArrowClockwise,
  ArrowUp,
  CaretRight,
  DeviceMobile,
  DownloadSimple,
  File,
  Folder,
  FolderOpen,
  HardDrives,
  MagnifyingGlass,
  PencilSimple,
  Plus,
  Trash,
  UploadSimple,
  X
} from "@phosphor-icons/react";
import type { ActionResult, AndroidDevice, DeviceFileEntry } from "../shared/types";

const LOCATIONS = [
  { label: "内部存储", path: "/sdcard" },
  { label: "下载", path: "/sdcard/Download" },
  { label: "相机", path: "/sdcard/DCIM" },
  { label: "临时目录", path: "/data/local/tmp" },
  { label: "系统根目录", path: "/" },
  { label: "应用数据", path: "/data/data" }
];

const MAX_PREVIEW_BYTES = 20 * 1024 * 1024;
const IMAGE_FILE_PATTERN = /\.(?:png|jpe?g|gif|webp|bmp)$/i;

export function isPreviewableImage(entry: DeviceFileEntry): boolean {
  return entry.type === "file" &&
    IMAGE_FILE_PATTERN.test(entry.name) &&
    entry.size <= MAX_PREVIEW_BYTES;
}

export class DeviceDirectoryCache {
  private readonly entries = new Map<string, DeviceFileEntry[]>();

  get(serial: string, path: string): DeviceFileEntry[] | undefined {
    return this.entries.get(`${serial}\0${path}`);
  }

  set(serial: string, path: string, entries: DeviceFileEntry[]): void {
    this.entries.set(`${serial}\0${path}`, entries);
  }

  invalidate(serial: string, path: string): void {
    this.entries.delete(`${serial}\0${path}`);
  }
}

function deviceName(device: AndroidDevice): string {
  return device.model?.replaceAll("_", " ") || device.product || "Android 设备";
}

function parentPath(value: string): string {
  if (value === "/") return "/";
  const parts = value.split("/").filter(Boolean);
  parts.pop();
  return parts.length ? `/${parts.join("/")}` : "/";
}

function formatSize(size: number, type: DeviceFileEntry["type"]): string {
  if (type === "directory") return "—";
  if (size < 1024) return `${size} B`;
  if (size < 1024 ** 2) return `${(size / 1024).toFixed(1)} KB`;
  if (size < 1024 ** 3) return `${(size / 1024 ** 2).toFixed(1)} MB`;
  return `${(size / 1024 ** 3).toFixed(1)} GB`;
}

function typeLabel(type: DeviceFileEntry["type"]): string {
  if (type === "directory") return "文件夹";
  if (type === "file") return "文件";
  if (type === "link") return "链接";
  return "其他";
}

export function FileManager({
  devices,
  initialPath = "/sdcard",
  initialEntries,
  onClose
}: {
  devices: AndroidDevice[];
  initialPath?: string;
  initialEntries?: DeviceFileEntry[];
  onClose: () => void;
}) {
  const onlineDevices = useMemo(
    () => devices.filter((device) => device.state === "device"),
    [devices]
  );
  const [serial, setSerial] = useState(onlineDevices[0]?.serial ?? "");
  const [currentPath, setCurrentPath] = useState(initialPath);
  const [entries, setEntries] = useState<DeviceFileEntry[]>(initialEntries ?? []);
  const [selectedPath, setSelectedPath] = useState(initialEntries?.[0]?.path ?? "");
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(initialEntries === undefined);
  const [operating, setOperating] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [status, setStatus] = useState<ActionResult>();
  const directoryCache = useRef(new DeviceDirectoryCache()).current;
  const previewCache = useRef(new Map<string, string>()).current;
  const [previewDataUrl, setPreviewDataUrl] = useState<string>();
  const [previewLoading, setPreviewLoading] = useState(false);
  const [previewError, setPreviewError] = useState<string>();
  if (serial && initialEntries && !directoryCache.get(serial, initialPath)) {
    directoryCache.set(serial, initialPath, initialEntries);
  }

  const selected = entries.find((entry) => entry.path === selectedPath);
  const visibleEntries = useMemo(() => {
    const keyword = query.trim().toLowerCase();
    return keyword
      ? entries.filter((entry) => entry.name.toLowerCase().includes(keyword))
      : entries;
  }, [entries, query]);
  const breadcrumbs = useMemo(() => {
    const parts = currentPath.split("/").filter(Boolean);
    return [
      { label: "根目录", path: "/" },
      ...parts.map((part, index) => ({
        label: part,
        path: `/${parts.slice(0, index + 1).join("/")}`
      }))
    ];
  }, [currentPath]);

  const load = useCallback(async (path: string, force = false) => {
    if (!serial) return;
    const cached = directoryCache.get(serial, path);
    if (!force && cached) {
      setEntries(cached);
      setSelectedPath("");
      setLoading(false);
      return;
    }
    setLoading(true);
    setStatus(undefined);
    try {
      const nextEntries = await window.androidTool.listDeviceFiles(serial, path);
      directoryCache.set(serial, path, nextEntries);
      setEntries(nextEntries);
      setSelectedPath("");
    } catch (error) {
      if (!cached) setEntries([]);
      setStatus({
        ok: false,
        message: `${error instanceof Error ? error.message : String(error)}。该目录可能受 Android/ADB 权限限制。`
      });
    } finally {
      setLoading(false);
    }
  }, [directoryCache, serial]);

  useEffect(() => {
    void load(currentPath);
  }, [currentPath, load]);

  useEffect(() => {
    setPreviewDataUrl(undefined);
    setPreviewError(undefined);
    setPreviewLoading(false);
    if (!selected || selected.type !== "file" || !IMAGE_FILE_PATTERN.test(selected.name)) return;
    if (!isPreviewableImage(selected)) {
      setPreviewError("图片超过 20 MB，请下载后查看");
      return;
    }
    const key = `${serial}\0${selected.path}`;
    const cached = previewCache.get(key);
    if (cached) {
      setPreviewDataUrl(cached);
      return;
    }
    let active = true;
    setPreviewLoading(true);
    void window.androidTool.getDeviceImagePreview(serial, selected.path)
      .then((preview) => {
        if (!active) return;
        previewCache.set(key, preview.dataUrl);
        setPreviewDataUrl(preview.dataUrl);
      })
      .catch((error) => {
        if (active) setPreviewError(error instanceof Error ? error.message : String(error));
      })
      .finally(() => {
        if (active) setPreviewLoading(false);
      });
    return () => { active = false; };
  }, [previewCache, selected?.name, selected?.path, selected?.size, selected?.type, serial]);

  function navigate(path: string): void {
    setCurrentPath(path);
    setQuery("");
    setSelectedPath("");
  }

  async function upload(localPaths?: string[]): Promise<void> {
    if (!serial) return;
    let paths = localPaths;
    if (!paths) {
      const files = await window.androidTool.selectDeviceUploadFiles();
      paths = files.map((file) => file.path);
    }
    if (!paths.length) return;
    setOperating(true);
    const result = await window.androidTool.uploadDeviceFiles(serial, currentPath, paths);
    setStatus(result);
    setOperating(false);
    if (result.ok) {
      directoryCache.invalidate(serial, currentPath);
      await load(currentPath, true);
    }
  }

  async function createDirectory(): Promise<void> {
    const name = window.prompt("请输入新文件夹名称");
    if (!name || !serial) return;
    setOperating(true);
    const result = await window.androidTool.createDeviceDirectory(serial, currentPath, name);
    setStatus(result);
    setOperating(false);
    if (result.ok) {
      directoryCache.invalidate(serial, currentPath);
      await load(currentPath, true);
    }
  }

  async function renameSelected(): Promise<void> {
    if (!selected || !serial) return;
    const name = window.prompt("请输入新名称", selected.name);
    if (!name || name === selected.name) return;
    setOperating(true);
    const result = await window.androidTool.renameDeviceFile(serial, selected.path, name);
    setStatus(result);
    setOperating(false);
    if (result.ok) {
      directoryCache.invalidate(serial, currentPath);
      await load(currentPath, true);
    }
  }

  async function deleteSelected(): Promise<void> {
    if (!selected || !serial) return;
    if (!window.confirm(`确认删除“${selected.name}”？${selected.type === "directory" ? "文件夹内的内容也会被删除。" : ""}`)) return;
    setOperating(true);
    const result = await window.androidTool.deleteDeviceFile(serial, selected.path);
    setStatus(result);
    setOperating(false);
    if (result.ok) {
      directoryCache.invalidate(serial, currentPath);
      await load(currentPath, true);
    }
  }

  async function downloadSelected(): Promise<void> {
    if (!selected || !serial) return;
    setOperating(true);
    const result = await window.androidTool.downloadDeviceFile(serial, selected.path);
    setStatus(result.cancelled ? undefined : result);
    setOperating(false);
  }

  function handleDrop(event: DragEvent<HTMLDivElement>): void {
    event.preventDefault();
    setDragging(false);
    const paths = Array.from(event.dataTransfer.files)
      .map((file) => window.androidTool.getDroppedFilePath(file))
      .filter(Boolean);
    if (paths.length) void upload(paths);
  }

  return (
    <div className="file-manager-backdrop" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
      <section
        className={dragging ? "file-manager-shell dragging" : "file-manager-shell"}
        onDragEnter={(event) => { event.preventDefault(); setDragging(true); }}
        onDragOver={(event) => event.preventDefault()}
        onDragLeave={(event) => event.target === event.currentTarget && setDragging(false)}
        onDrop={handleDrop}
      >
        <header className="file-manager-header">
          <div className="file-manager-title">
            <HardDrives size={23} weight="duotone" />
            <div><h2>设备文件管理</h2><p>浏览和传输 Android 设备文件</p></div>
          </div>
          <label>
            <DeviceMobile size={16} />
            <select
              value={serial}
              onChange={(event) => {
                setSerial(event.target.value);
                setCurrentPath("/sdcard");
                setEntries([]);
              }}
            >
              {onlineDevices.map((device) => (
                <option key={device.serial} value={device.serial}>{deviceName(device)} · {device.serial}</option>
              ))}
            </select>
          </label>
          <button className="file-manager-close" onClick={onClose} title="关闭文件管理"><X size={18} /></button>
        </header>

        {onlineDevices.length === 0 ? (
          <div className="file-manager-no-device"><DeviceMobile size={42} weight="duotone" /><h3>没有可用设备</h3><p>连接设备并完成 USB 调试授权后再试。</p></div>
        ) : (
          <div className="file-manager-body">
            <aside className="file-manager-locations">
              <strong>常用位置</strong>
              {LOCATIONS.map((location) => (
                <button key={location.path} className={currentPath === location.path ? "active" : ""} onClick={() => navigate(location.path)}>
                  {location.path === "/" ? <HardDrives size={16} /> : <Folder size={16} />}
                  <span>{location.label}</span>
                  <code>{location.path}</code>
                </button>
              ))}
              <p>受系统保护的目录会按当前 ADB 用户权限访问。</p>
            </aside>

            <main className="file-manager-main">
              <div className="file-manager-toolbar">
                <button disabled={currentPath === "/" || loading} onClick={() => navigate(parentPath(currentPath))} title="上一级"><ArrowUp size={16} /></button>
                <button disabled={loading} onClick={() => void load(currentPath, true)} title="刷新"><ArrowClockwise className={loading ? "spinning" : ""} size={16} /></button>
                <nav className="file-breadcrumbs">
                  {breadcrumbs.map((item, index) => (
                    <span key={item.path}>
                      {index > 0 && <CaretRight size={11} />}
                      <button onClick={() => navigate(item.path)}>{item.label}</button>
                    </span>
                  ))}
                </nav>
                <label className="file-manager-search"><MagnifyingGlass size={15} /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="搜索当前目录" /></label>
                <button disabled={operating} onClick={() => void upload()}><UploadSimple size={16} />上传文件</button>
                <button disabled={operating} onClick={() => void createDirectory()}><Plus size={16} />新建文件夹</button>
              </div>

              <div className="file-manager-content">
                <div className="file-table-wrap">
                  <table className="file-table">
                    <thead><tr><th>名称</th><th>类型</th><th>大小</th><th>修改时间</th><th>权限</th></tr></thead>
                    <tbody>
                      {visibleEntries.map((entry) => (
                        <tr
                          key={entry.path}
                          className={selectedPath === entry.path ? "selected" : ""}
                          onClick={() => setSelectedPath(entry.path)}
                          onDoubleClick={() => entry.type === "directory" && navigate(entry.path)}
                        >
                          <td><span className={`file-kind file-kind--${entry.type}`}>{entry.type === "directory" ? <FolderOpen size={17} weight="duotone" /> : <File size={17} weight="duotone" />}</span><span title={entry.name}>{entry.name}</span></td>
                          <td>{typeLabel(entry.type)}</td>
                          <td>{formatSize(entry.size, entry.type)}</td>
                          <td>{entry.modifiedAt ? new Date(entry.modifiedAt).toLocaleString() : "—"}</td>
                          <td><code>{entry.mode}</code></td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  {loading && <div className="file-manager-empty"><span className="loader" /> 正在读取目录…</div>}
                  {!loading && visibleEntries.length === 0 && <div className="file-manager-empty">{query ? "没有匹配的文件" : "目录为空"}</div>}
                </div>

                <aside className="file-detail-pane">
                  {selected ? (
                    <>
                      {selected.type === "file" && IMAGE_FILE_PATTERN.test(selected.name) ? (
                        <div className="file-image-preview">
                          {previewLoading && <span><i className="loader" />正在加载预览…</span>}
                          {previewError && <span className="error">{previewError}</span>}
                          {previewDataUrl && <img src={previewDataUrl} alt={`${selected.name} 预览`} />}
                        </div>
                      ) : (
                        <span className="file-detail-icon">{selected.type === "directory" ? <FolderOpen size={34} weight="duotone" /> : <File size={34} weight="duotone" />}</span>
                      )}
                      <h3>{selected.name}</h3>
                      <dl>
                        <dt>完整路径</dt><dd><code>{selected.path}</code></dd>
                        <dt>类型</dt><dd>{typeLabel(selected.type)}</dd>
                        <dt>大小</dt><dd>{formatSize(selected.size, selected.type)}</dd>
                        <dt>修改时间</dt><dd>{selected.modifiedAt ? new Date(selected.modifiedAt).toLocaleString() : "—"}</dd>
                        <dt>权限</dt><dd><code>{selected.mode}</code></dd>
                      </dl>
                      <div className="file-detail-actions">
                        <button disabled={operating} onClick={() => void downloadSelected()}><DownloadSimple size={15} />下载</button>
                        <button disabled={operating} onClick={() => void renameSelected()}><PencilSimple size={15} />重命名</button>
                        <button className="danger" disabled={operating} onClick={() => void deleteSelected()}><Trash size={15} />删除</button>
                      </div>
                    </>
                  ) : (
                    <div className="file-detail-empty"><File size={38} weight="duotone" /><p>选择文件查看信息和操作</p></div>
                  )}
                </aside>
              </div>

              <footer className="file-manager-footer">
                <span>{entries.length} 项 · 当前路径 <code>{currentPath}</code></span>
                {status && <strong className={status.ok ? "success" : "error"}>{status.message || (status.ok ? "操作完成" : "操作失败")}</strong>}
              </footer>
            </main>
          </div>
        )}
        {dragging && <div className="file-drop-hint"><UploadSimple size={42} weight="duotone" /><strong>释放以上传到</strong><code>{currentPath}</code></div>}
      </section>
    </div>
  );
}
