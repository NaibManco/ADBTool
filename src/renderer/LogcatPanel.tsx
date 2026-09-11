import {
  memo,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState
} from "react";
import type { UIEvent } from "react";
import type {
  AndroidDevice,
  AppProcess,
  LogcatBuffer,
  LogcatEntry,
  LogcatLevel
} from "../shared/types";
import { LOGCAT_BUFFERS } from "../shared/types";
import {
  appendQueryToken,
  matchesEntry,
  parseQuery,
  queryHighlightTerms
} from "./logcat-query";
import { extractCrashStack, isCrashMarker } from "./logcat-crash";
import { HighlightText } from "./HighlightText";

const MAX_ENTRIES = 50_000;
const RENDER_WINDOW_DEFAULT = 5_000;
const RENDER_WINDOW_STEP = 2_000;
const QUERY_APPLY_DELAY_MS = 150;
const PACKAGE_MAP_REFRESH_MS = 60_000;
const QUERY_HISTORY_KEY = "androidDevTool.logcat.queryHistory.v1";
const QUERY_HISTORY_CAP = 15;
const FOLLOW_DISENGAGE_DISTANCE = 40;
const EXTEND_THRESHOLD_PX = 200;
const LEVELS: Array<LogcatLevel | "ALL"> = [
  "ALL",
  "V",
  "D",
  "I",
  "W",
  "E",
  "F"
];
const BUFFER_LABELS: Record<LogcatBuffer, string> = {
  main: "主缓冲",
  system: "系统",
  crash: "崩溃",
  radio: "无线电",
  events: "事件"
};

type BufferedEntry = LogcatEntry & { seq: number };

function deviceLabel(device: AndroidDevice): string {
  return device.model?.replaceAll("_", " ") || device.product || device.serial;
}

function readQueryHistory(): string[] {
  try {
    const raw = window.localStorage.getItem(QUERY_HISTORY_KEY);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter((item): item is string => typeof item === "string")
      .slice(0, QUERY_HISTORY_CAP);
  } catch {
    return [];
  }
}

function writeQueryHistory(items: string[]): void {
  try {
    window.localStorage.setItem(QUERY_HISTORY_KEY, JSON.stringify(items));
  } catch {
    // 存储不可用时历史仅保留在当前窗口内存中。
  }
}

function pushQueryHistory(current: string[], query: string): string[] {
  const trimmed = query.trim();
  if (!trimmed) return current;
  return [trimmed, ...current.filter((item) => item !== trimmed)].slice(
    0,
    QUERY_HISTORY_CAP
  );
}

const LogLine = memo(function LogLine({
  entry,
  lineNo,
  terms,
  onTagClick,
  onTagExclude,
  onPidClick
}: {
  entry: BufferedEntry;
  lineNo: number;
  terms: readonly string[];
  onTagClick: (tag: string) => void;
  onTagExclude: (tag: string) => void;
  onPidClick: (pid: number) => void;
}) {
  return (
    <div className="log-line">
      <span className="log-index">{lineNo}</span>
      <time>{entry.timestamp || "--"}</time>
      <b className={`level level-${entry.level}`}>{entry.level}</b>
      {entry.pid !== undefined ? (
        <button
          className="log-pid log-clickable"
          onClick={() => onPidClick(entry.pid as number)}
          title="点击按 PID 过滤"
        >
          {entry.tid !== undefined ? `${entry.pid}:${entry.tid}` : entry.pid}
        </button>
      ) : (
        <span className="log-pid">--</span>
      )}
      <strong
        className="log-tag log-clickable"
        title="点击：仅看此 Tag；右键：隐藏此 Tag"
        onClick={() => onTagClick(entry.tag)}
        onContextMenu={(event) => {
          event.preventDefault();
          onTagExclude(entry.tag);
        }}
      >
        <HighlightText text={entry.tag} terms={terms} />
      </strong>
      <span className="log-message">
        <HighlightText text={entry.message} terms={terms} />
      </span>
    </div>
  );
});

function LogcatDevicePane({
  device,
  onClose,
  active
}: {
  device: AndroidDevice;
  onClose: () => void;
  active: boolean;
}) {
  const [entries, setEntries] = useState<BufferedEntry[]>([]);
  const [running, setRunning] = useState(false);
  const [statusMessage, setStatusMessage] = useState("正在启动 Logcat…");
  const [selectedProcess, setSelectedProcess] = useState<AppProcess>();
  const [processes, setProcesses] = useState<AppProcess[]>([]);
  const [processPickerOpen, setProcessPickerOpen] = useState(false);
  const [processSearch, setProcessSearch] = useState("");
  const [loadingProcesses, setLoadingProcesses] = useState(false);
  const [query, setQuery] = useState("");
  const [appliedQuery, setAppliedQuery] = useState("");
  const [history, setHistory] = useState<string[]>(() => readQueryHistory());
  const [historyOpen, setHistoryOpen] = useState(false);
  const [exportMenuOpen, setExportMenuOpen] = useState(false);
  const [buffer, setBuffer] = useState<LogcatBuffer>("main");
  const [sessionPid, setSessionPid] = useState<number>();
  const [follow, setFollow] = useState(true);
  const [level, setLevel] = useState<LogcatLevel | "ALL">("ALL");
  const [renderLimit, setRenderLimit] = useState(RENDER_WINDOW_DEFAULT);
  const [packageByPid, setPackageByPid] = useState(
    () => new Map<number, string>()
  );
  // 检测到的崩溃（FATAL EXCEPTION）所在 entry 的 seq，最新在末尾
  const [crashSeqs, setCrashSeqs] = useState<number[]>([]);

  const pendingEntries = useRef<BufferedEntry[]>([]);
  const seqRef = useRef(0);
  const output = useRef<HTMLDivElement>(null);
  const scrollAnchor = useRef<{ height: number; top: number } | null>(null);
  const packageMapInFlight = useRef(false);

  useEffect(() => {
    const unsubscribe = window.androidTool.onLogcatEvent((event) => {
      if (event.serial !== device.serial) return;

      if (event.type === "entry") {
        const seq = seqRef.current++;
        pendingEntries.current.push({
          ...event.entry,
          seq
        });
        if (isCrashMarker(event.entry.message)) {
          setCrashSeqs((current) => [...current, seq]);
        }
      } else {
        setRunning(event.running);
        if (event.running) {
          setSessionPid(event.pid);
          if (event.buffer) {
            setBuffer(event.buffer);
          }
        }
        setStatusMessage(
          event.message || (event.running ? "正在实时采集" : "采集已停止")
        );
      }
    });

    const flushTimer = window.setInterval(() => {
      if (pendingEntries.current.length === 0) return;
      const batch = pendingEntries.current.splice(0);
      setEntries((current) => [...current, ...batch].slice(-MAX_ENTRIES));
    }, 100);

    void window.androidTool.startLogcat(device.serial).then((result) => {
      if (!result.ok) {
        setStatusMessage(result.message || "Logcat 启动失败");
      }
    });

    return () => {
      window.clearInterval(flushTimer);
      unsubscribe();
      void window.androidTool.stopLogcat(device.serial);
    };
  }, [device.serial]);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      scrollAnchor.current = null;
      setRenderLimit(RENDER_WINDOW_DEFAULT);
      setAppliedQuery(query);
    }, QUERY_APPLY_DELAY_MS);
    return () => window.clearTimeout(timer);
  }, [query]);

  const parsed = useMemo(() => parseQuery(appliedQuery), [appliedQuery]);
  const queryError = parsed.errors[0];
  const levelBaselineActive =
    level !== "ALL" && parsed.levelThreshold === undefined;

  const filteredEntries = useMemo(() => {
    if (!active || parsed.errors.length > 0) return [];
    return entries.filter(
      (entry) =>
        (!levelBaselineActive || entry.level === level) &&
        matchesEntry(entry, parsed, packageByPid)
    );
  }, [active, entries, parsed, packageByPid, levelBaselineActive, level]);

  const visibleEntries = useMemo(
    () => filteredEntries.slice(-renderLimit),
    [filteredEntries, renderLimit]
  );

  const highlightTerms = useMemo(
    () => queryHighlightTerms(parsed),
    [parsed]
  );

  useEffect(() => {
    if (!parsed.needsPackageMap || !active) return;
    let cancelled = false;

    const load = (): void => {
      if (packageMapInFlight.current) return;
      packageMapInFlight.current = true;
      setStatusMessage("正在读取设备进程…");
      window.androidTool
        .listAppProcesses(device.serial)
        .then((list) => {
          if (cancelled) return;
          setPackageByPid(
            new Map(list.map((process) => [process.pid, process.packageName]))
          );
        })
        .catch(() => {
          if (cancelled) return;
          setStatusMessage("无法读取设备进程，package: 过滤暂不可用");
        })
        .finally(() => {
          packageMapInFlight.current = false;
        });
    };

    load();
    const timer = window.setInterval(load, PACKAGE_MAP_REFRESH_MS);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [active, parsed.needsPackageMap, device.serial]);

  useEffect(() => {
    if (!active || !follow) return;
    const container = output.current;
    if (container) {
      container.scrollTop = container.scrollHeight;
    }
  }, [active, visibleEntries, follow]);

  useLayoutEffect(() => {
    const anchor = scrollAnchor.current;
    if (!anchor) return;
    const container = output.current;
    if (container) {
      container.scrollTop = container.scrollHeight - anchor.height + anchor.top;
    }
    scrollAnchor.current = null;
  }, [visibleEntries]);

  const handleTagClick = useCallback((tag: string) => {
    setQuery((current) => appendQueryToken(current, `tag:${tag}`));
  }, []);

  const handleTagExclude = useCallback((tag: string) => {
    setQuery((current) => appendQueryToken(current, `-tag:${tag}`));
  }, []);

  const handlePidClick = useCallback((pid: number) => {
    setQuery((current) => appendQueryToken(current, `pid:${pid}`));
  }, []);

  const visibleProcesses = useMemo(() => {
    const queryText = processSearch.trim().toLocaleLowerCase();
    if (!queryText) return processes;
    return processes.filter((process) =>
      [process.packageName, process.processName, String(process.pid)].some(
        (value) => value.toLocaleLowerCase().includes(queryText)
      )
    );
  }, [processSearch, processes]);

  function clearDisplay(): void {
    pendingEntries.current = [];
    scrollAnchor.current = null;
    setRenderLimit(RENDER_WINDOW_DEFAULT);
    setEntries([]);
    setCrashSeqs([]);
  }

  async function copyCrashStack(): Promise<void> {
    const lastCrashSeq = crashSeqs[crashSeqs.length - 1];
    const crashIndex = entries.findIndex(
      (entry) => entry.seq === lastCrashSeq
    );
    if (crashIndex < 0) {
      setStatusMessage("崩溃日志已被清出缓存，无法复制堆栈");
      return;
    }
    const lines = extractCrashStack(entries, crashIndex);
    const result = await window.androidTool.copyLogcatText(lines.join("\n"));
    setStatusMessage(
      result.ok
        ? `已复制崩溃堆栈（${lines.length} 行）`
        : result.message || "复制失败"
    );
  }

  function handleOutputScroll(event: UIEvent<HTMLDivElement>): void {
    const el = event.currentTarget;
    const distance = el.scrollHeight - el.scrollTop - el.clientHeight;
    if (distance > FOLLOW_DISENGAGE_DISTANCE && follow) {
      setFollow(false);
    }
    if (
      el.scrollTop < EXTEND_THRESHOLD_PX &&
      filteredEntries.length > renderLimit
    ) {
      scrollAnchor.current = { height: el.scrollHeight, top: el.scrollTop };
      setRenderLimit((limit) => limit + RENDER_WINDOW_STEP);
    }
  }

  function jumpToLatest(): void {
    setFollow(true);
    const container = output.current;
    if (container) {
      container.scrollTop = container.scrollHeight;
    }
  }

  async function toggleCapture(): Promise<void> {
    const result = running
      ? await window.androidTool.stopLogcat(device.serial)
      : await window.androidTool.startLogcat(
          device.serial,
          selectedProcess?.pid
        );
    if (!result.ok) {
      setStatusMessage(result.message || "操作失败");
    }
  }

  async function changeBuffer(next: LogcatBuffer): Promise<void> {
    if (next === buffer) return;
    const result = await window.androidTool.setLogcatBuffer(
      device.serial,
      next
    );
    if (!result.ok) {
      setStatusMessage(result.message || "切换缓冲区失败");
      return;
    }
    setBuffer(next);
    clearDisplay();
  }

  async function clearDeviceBuffer(): Promise<void> {
    const result = await window.androidTool.clearLogcatBuffer(
      device.serial,
      buffer
    );
    if (!result.ok) {
      setStatusMessage(result.message || "清空设备缓冲失败");
      return;
    }
    clearDisplay();
    setStatusMessage(result.message || "设备日志缓冲区已清空");
  }

  async function copyVisibleLines(): Promise<void> {
    if (visibleEntries.length === 0) {
      setStatusMessage("没有可复制的日志");
      return;
    }
    const result = await window.androidTool.copyLogcatText(
      visibleEntries.map((entry) => entry.raw).join("\n")
    );
    setStatusMessage(
      result.ok ? `已复制 ${visibleEntries.length} 行` : result.message || "复制失败"
    );
  }

  async function exportLogs(scope: "filtered" | "all"): Promise<void> {
    setExportMenuOpen(false);
    const source = scope === "all" ? entries : filteredEntries;
    if (source.length === 0) {
      setStatusMessage("没有可导出的日志");
      return;
    }
    const result = await window.androidTool.exportLogcatText(
      device.serial,
      source.map((entry) => entry.raw).join("\n")
    );
    if (result.cancelled) return;
    setStatusMessage(
      result.ok ? `已导出 ${source.length} 行` : result.message || "导出失败"
    );
  }

  function submitQuery(): void {
    const next = pushQueryHistory(history, query);
    setHistory(next);
    writeQueryHistory(next);
    setHistoryOpen(false);
  }

  async function toggleProcessPicker(): Promise<void> {
    if (processPickerOpen) {
      setProcessPickerOpen(false);
      return;
    }

    setProcessPickerOpen(true);
    setLoadingProcesses(true);
    setProcessSearch("");
    try {
      setProcesses(await window.androidTool.listAppProcesses(device.serial));
    } catch (error) {
      setStatusMessage(
        error instanceof Error ? error.message : "无法读取设备进程"
      );
      setProcesses([]);
    } finally {
      setLoadingProcesses(false);
    }
  }

  async function applyProcess(process: AppProcess): Promise<void> {
    const result = await window.androidTool.setLogcatProcess(
      device.serial,
      process.pid
    );
    if (!result.ok) {
      setStatusMessage(result.message || "进程过滤失败");
      return;
    }

    clearDisplay();
    setSelectedProcess(process);
    setSessionPid(process.pid);
    setProcessPickerOpen(false);
    setStatusMessage(`仅显示 ${process.processName} · PID ${process.pid}`);
  }

  async function showAllLogs(): Promise<void> {
    const result = await window.androidTool.setLogcatProcess(device.serial);
    if (!result.ok) {
      setStatusMessage(result.message || "取消进程过滤失败");
      return;
    }

    clearDisplay();
    setSelectedProcess(undefined);
    setSessionPid(undefined);
    setStatusMessage("正在显示全部日志");
  }

  if (!active) {
    return (
      <section
        className="logcat-device-pane pane-hidden"
        aria-hidden="true"
      />
    );
  }

  return (
    <section className="logcat-device-pane">
      <header className="logcat-header">
        <div>
          <div className="logcat-title">
            <span className="terminal-mark">&gt;_</span>
            <h2>Logcat</h2>
            <span className={running ? "capture-state running" : "capture-state"}>
              <i />
              {running ? "采集中" : "已停止"}
            </span>
          </div>
          <p>
            {deviceLabel(device)} <code>{device.serial}</code>
          </p>
        </div>
        <button className="logcat-close" onClick={onClose} title="关闭">
          ×
        </button>
      </header>

      <div className="logcat-toolbar">
        <div className="log-search">
          <span>⌕</span>
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") submitQuery();
            }}
            placeholder='如 tag:Camera level:E -tag:GMS "关键词"'
            spellCheck={false}
            title="支持 tag:/message:/pid:/tid:/level:/package:，~ 正则，- 取反（如 -tag:xxx 隐藏指定 Tag），多个条件取交集"
          />
          {query && (
            <button onClick={() => setQuery("")} title="清空查询">
              ×
            </button>
          )}
          <button
            className={historyOpen ? "history-button active" : "history-button"}
            onClick={() => setHistoryOpen((value) => !value)}
            title="最近查询"
          >
            历史
          </button>

          {historyOpen && (
            <div className="query-history-popover">
              <header>
                <strong>最近查询</strong>
                <button onClick={() => setHistoryOpen(false)}>×</button>
              </header>
              {history.length === 0 ? (
                <p className="history-empty">暂无历史，输入查询后按 Enter 保存</p>
              ) : (
                history.map((item) => (
                  <button
                    key={item}
                    className="query-history-item"
                    onClick={() => {
                      setQuery(item);
                      setHistoryOpen(false);
                    }}
                  >
                    {item}
                  </button>
                ))
              )}
            </div>
          )}
        </div>

        <select
          value={level}
          onChange={(event) =>
            setLevel(event.target.value as LogcatLevel | "ALL")
          }
          aria-label="日志等级"
          data-overridden={
            parsed.levelThreshold !== undefined ? "true" : undefined
          }
          title={
            parsed.levelThreshold !== undefined
              ? "查询中已包含 level: 条件，等级以查询为准"
              : "按等级精确过滤；也可在查询中使用 level:"
          }
        >
          {LEVELS.map((item) => (
            <option key={item} value={item}>
              {item === "ALL" ? "全部等级" : item}
            </option>
          ))}
        </select>

        <select
          value={buffer}
          onChange={(event) => void changeBuffer(event.target.value as LogcatBuffer)}
          aria-label="日志缓冲区"
          title="切换 adb logcat 缓冲区，切换会重启采集"
        >
          {LOGCAT_BUFFERS.map((item) => (
            <option key={item} value={item}>
              {BUFFER_LABELS[item]}
            </option>
          ))}
        </select>

        <div className="process-filter">
          <button
            className={selectedProcess ? "process-button active" : "process-button"}
            onClick={() => void toggleProcessPicker()}
            title={selectedProcess?.processName}
          >
            {selectedProcess?.processName || "应用进程"}
          </button>

          {processPickerOpen && (
            <div className="process-popover">
              <header>
                <div>
                  <strong>选择应用进程</strong>
                  <span>前台应用优先显示</span>
                </div>
                <button onClick={() => setProcessPickerOpen(false)}>×</button>
              </header>
              <input
                value={processSearch}
                onChange={(event) => setProcessSearch(event.target.value)}
                placeholder="搜索包名、进程或 PID"
                autoFocus
                spellCheck={false}
              />
              <div className="process-list">
                {loadingProcesses ? (
                  <p>正在读取设备进程…</p>
                ) : visibleProcesses.length === 0 ? (
                  <p>没有找到运行中的应用进程</p>
                ) : (
                  visibleProcesses.slice(0, 120).map((process) => (
                    <button
                      key={`${process.pid}-${process.processName}`}
                      onClick={() => void applyProcess(process)}
                    >
                      <span className="process-main">
                        <strong>{process.packageName}</strong>
                        {process.processName !== process.packageName && (
                          <small>
                            {process.processName.slice(process.packageName.length)}
                          </small>
                        )}
                      </span>
                      {process.foreground && <b>前台</b>}
                      <code>PID {process.pid}</code>
                    </button>
                  ))
                )}
              </div>
            </div>
          )}
        </div>

        {selectedProcess && (
          <button
            className="all-logs-button"
            onClick={() => void showAllLogs()}
          >
            全部日志
          </button>
        )}

        <button
          className={follow ? "follow-button active" : "follow-button"}
          onClick={() => (follow ? setFollow(false) : jumpToLatest())}
          title={
            follow ? "新日志到达时自动滚动到底部，点击暂停跟随" : "点击回到最新日志"
          }
        >
          {follow ? "⇣ 跟随中" : "⇣ 已停跟随"}
        </button>
        {crashSeqs.length > 0 && (
          <div
            className="crash-alert"
            title="检测到应用崩溃（FATAL EXCEPTION）。点击复制最近一次崩溃的完整堆栈"
          >
            <button className="crash-alert-copy" onClick={() => void copyCrashStack()}>
              ⚠ 崩溃 ×{crashSeqs.length}
            </button>
            <button
              className="crash-alert-dismiss"
              onClick={() => setCrashSeqs([])}
              title="清除崩溃提醒（不影响日志内容）"
            >
              ×
            </button>
          </div>
        )}
        <button onClick={() => void copyVisibleLines()} title="复制当前显示的日志行">
          复制
        </button>

        <div className="toolbar-menu">
          <button
            onClick={() => setExportMenuOpen((value) => !value)}
            title="导出日志到文本文件"
          >
            导出
          </button>
          {exportMenuOpen && (
            <div className="export-menu">
              <button onClick={() => void exportLogs("filtered")}>
                导出筛选结果（{filteredEntries.length} 行）
              </button>
              <button onClick={() => void exportLogs("all")}>
                导出全部缓存（{entries.length} 行）
              </button>
            </div>
          )}
        </div>

        <button onClick={clearDisplay} title="清空当前显示，不影响设备缓冲">
          ⌫ 清空显示
        </button>
        <button
          onClick={() => void clearDeviceBuffer()}
          title="执行 adb logcat -c，仅清空当前所选缓冲区"
        >
          清空缓冲
        </button>
        <button
          className={running ? "capture-button stop" : "capture-button"}
          onClick={() => void toggleCapture()}
        >
          {running ? "■ 停止采集" : "● 开始采集"}
        </button>
      </div>

      {queryError && <p className="logcat-query-error">{queryError}</p>}

      <div className="logcat-statusbar">
        <span>{statusMessage}</span>
        {selectedProcess && (
          <span className="active-process">
            PID {selectedProcess.pid} · {selectedProcess.packageName}
          </span>
        )}
        {!selectedProcess && sessionPid !== undefined && (
          <span className="active-process">仅 PID {sessionPid}</span>
        )}
        <span className="buffer-chip">{BUFFER_LABELS[buffer]}</span>
        <span>
          显示 {visibleEntries.length} / 筛选 {filteredEntries.length} / 缓存{" "}
          {entries.length}
          {filteredEntries.length > renderLimit ? " · 顶部已截断" : ""}
        </span>
      </div>

      <div className="logcat-output" ref={output} onScroll={handleOutputScroll}>
        {visibleEntries.length === 0 ? (
          <div className="logcat-empty">
            <span>&gt;_</span>
            <p>
              {running
                ? queryError
                  ? "查询条件有误，请检查语法"
                  : "等待匹配的设备日志…"
                : "启动采集以查看设备日志"}
            </p>
          </div>
        ) : (
          visibleEntries.map((entry, index) => (
            <LogLine
              key={entry.seq}
              entry={entry}
              lineNo={index + 1}
              terms={highlightTerms}
              onTagClick={handleTagClick}
              onTagExclude={handleTagExclude}
              onPidClick={handlePidClick}
            />
          ))
        )}
        {!follow && visibleEntries.length > 0 && (
          <button className="jump-latest" onClick={jumpToLatest}>
            ↓ 回到最新
          </button>
        )}
      </div>
    </section>
  );
}

export function LogcatWorkspace({
  devices,
  availableDevices = devices,
  onAdd = () => undefined,
  onRemove,
  onClose
}: {
  devices: AndroidDevice[];
  availableDevices?: AndroidDevice[];
  onAdd?: (device: AndroidDevice) => void;
  onRemove: (serial: string) => void;
  onClose: () => void;
}) {
  const [activeSerial, setActiveSerial] = useState(
    devices[0]?.serial ?? ""
  );
  const selectedSerials = new Set(devices.map((device) => device.serial));
  const addableDevices = availableDevices.filter(
    (device) =>
      device.state === "device" && !selectedSerials.has(device.serial)
  );

  useEffect(() => {
    if (!devices.some((device) => device.serial === activeSerial)) {
      setActiveSerial(devices[0]?.serial ?? "");
    }
  }, [activeSerial, devices]);

  function addDevice(device: AndroidDevice): void {
    setActiveSerial(device.serial);
    onAdd(device);
  }

  return (
    <div className="logcat-embedded" aria-label="多设备 Logcat">
      <section className="logcat-workspace">
        <header className="logcat-workspace-header">
          <div className="workspace-heading">
            <span className="terminal-mark">&gt;_</span>
            <div>
              <h2>多设备 Logcat</h2>
              <p>{devices.length} 台设备正在采集</p>
            </div>
          </div>

          <div className="logcat-tabs" role="tablist" aria-label="Logcat 设备">
            {devices.map((device) => {
              const active = device.serial === activeSerial;
              return (
                <button
                  key={device.serial}
                  role="tab"
                  aria-selected={active}
                  className={active ? "active" : ""}
                  onClick={() => setActiveSerial(device.serial)}
                  title={device.serial}
                >
                  <i />
                  {deviceLabel(device)}
                </button>
              );
            })}
          </div>

          {addableDevices.length > 0 && (
            <div className="logcat-device-picker">
              <span>添加</span>
              {addableDevices.map((device) => (
                <button
                  key={device.serial}
                  onClick={() => addDevice(device)}
                  title={device.serial}
                >
                  + {deviceLabel(device)}
                </button>
              ))}
            </div>
          )}

          <button className="workspace-close" onClick={onClose}>
            关闭全部
          </button>
        </header>

        <div className="logcat-tab-stage">
          {devices.map((device) => (
            <LogcatDevicePane
              key={device.serial}
              device={device}
              onClose={() => onRemove(device.serial)}
              active={device.serial === activeSerial}
            />
          ))}
        </div>
      </section>
    </div>
  );
}
