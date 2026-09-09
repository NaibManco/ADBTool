import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type DragEvent as ReactDragEvent,
  type MutableRefObject,
  type ReactNode
} from "react";
import {
  ArrowClockwise,
  ArrowDown,
  ArrowUp,
  CopySimple,
  FileCode,
  Folder,
  FolderOpen,
  MagnifyingGlass,
  X
} from "@phosphor-icons/react";
import type {
  DecompileFileNode,
  DecompileReadResult,
  DecompileSearchHit
} from "../shared/types";
import { useTheme } from "./theme";

type Phase = "idle" | "running" | "done" | "error";

/** 在 text 中查找 query（大小写不敏感）的所有起始位置，上限 2000 个。 */
export function findAllIndices(text: string, query: string, cap = 2000): number[] {
  const indices: number[] = [];
  if (!query) return indices;
  const lowerText = text.toLowerCase();
  const lowerQuery = query.toLowerCase();
  let at = lowerText.indexOf(lowerQuery);
  while (at >= 0 && indices.length < cap) {
    indices.push(at);
    at = lowerText.indexOf(lowerQuery, at + lowerQuery.length);
  }
  return indices;
}

/** 把文本切成普通段 + <mark> 命中段；当前命中加 current 类并登记 ref 供滚动定位。 */
function renderWithFindHighlights(
  text: string,
  query: string,
  indices: readonly number[],
  currentIndex: number,
  hitRefs: MutableRefObject<Map<number, HTMLSpanElement>>
): ReactNode {
  if (!query || indices.length === 0) {
    return text;
  }
  const nodes: ReactNode[] = [];
  let cursor = 0;
  indices.forEach((at, position) => {
    if (at > cursor) {
      nodes.push(text.slice(cursor, at));
    }
    nodes.push(
      <span
        key={at}
        ref={
          position === currentIndex
            ? (node) => {
                if (node) hitRefs.current.set(position, node);
                else hitRefs.current.delete(position);
              }
            : undefined
        }
        className={
          position === currentIndex
            ? "decompiler-find-mark current"
            : "decompiler-find-mark"
        }
      >
        {text.slice(at, at + query.length)}
      </span>
    );
    cursor = at + query.length;
  });
  if (cursor < text.length) {
    nodes.push(text.slice(cursor));
  }
  return nodes;
}

function formatSize(size: number): string {
  if (size < 1024) return `${size} B`;
  if (size < 1024 * 1024) return `${Math.max(1, Math.round(size / 1024))} KB`;
  return `${(size / 1024 / 1024).toFixed(1)} MB`;
}

function apkFromDrop(file: File): { path: string; name: string } {
  const path = window.androidTool.getDroppedFilePath(file);
  if (!path || !file.name.toLowerCase().endsWith(".apk")) {
    throw new Error("请拖入有效的 APK 文件");
  }
  return { path, name: file.name };
}

interface TreeNodeProps {
  node: DecompileFileNode;
  depth: number;
  expanded: ReadonlySet<string>;
  nodesByDir: ReadonlyMap<string, DecompileFileNode[]>;
  filter: string;
  selectedPath: string;
  onToggle: (relPath: string) => void;
  onSelect: (node: DecompileFileNode) => void;
}

const TreeNode = ({
  node,
  depth,
  expanded,
  nodesByDir,
  filter,
  selectedPath,
  onToggle,
  onSelect
}: TreeNodeProps) => {
  const isDir = node.type === "dir";
  const isOpen = expanded.has(node.relPath);
  const children = isDir && isOpen ? nodesByDir.get(node.relPath) : undefined;

  return (
    <>
      <button
        className={
          node.relPath === selectedPath
            ? "decompiler-tree-row selected"
            : "decompiler-tree-row"
        }
        style={{ paddingLeft: 8 + depth * 14 }}
        onClick={() => (isDir ? onToggle(node.relPath) : onSelect(node))}
        title={node.relPath}
      >
        {isDir ? (
          <>
            {isOpen ? <FolderOpen size={13} /> : <Folder size={13} />}
            <span className="decompiler-tree-name">{node.name}</span>
          </>
        ) : (
          <>
            <FileCode size={13} />
            <span className="decompiler-tree-name">{node.name}</span>
            <small>{formatSize(node.size)}</small>
          </>
        )}
      </button>
      {children?.map((child) => (
        <TreeNode
          key={child.relPath}
          node={child}
          depth={depth + 1}
          expanded={expanded}
          nodesByDir={nodesByDir}
          filter={filter}
          selectedPath={selectedPath}
          onToggle={onToggle}
          onSelect={onSelect}
        />
      ))}
    </>
  );
};

export function DecompilerWindow() {
  useTheme();
  const [phase, setPhase] = useState<Phase>("idle");
  const [jobId, setJobId] = useState("");
  const [apkName, setApkName] = useState("");
  const [message, setMessage] = useState("");
  const [progressTail, setProgressTail] = useState<string[]>([]);
  const [treeNodes, setTreeNodes] = useState<DecompileFileNode[]>([]);
  const [truncated, setTruncated] = useState(false);
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(new Set());
  const [selected, setSelected] = useState<DecompileFileNode | undefined>();
  const [fileContent, setFileContent] = useState<DecompileReadResult | undefined>();
  const [fileLoading, setFileLoading] = useState(false);
  const [filter, setFilter] = useState("");
  const [searchMode, setSearchMode] = useState<"tree" | "text">("tree");
  const [searchHits, setSearchHits] = useState<DecompileSearchHit[]>([]);
  const [searchTruncated, setSearchTruncated] = useState(false);
  const [searching, setSearching] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  // 文件内查找（Ctrl+F）
  const [findOpen, setFindOpen] = useState(false);
  const [findQuery, setFindQuery] = useState("");
  const [findIndex, setFindIndex] = useState(0);
  const findInputRef = useRef<HTMLInputElement>(null);
  const hitRefs = useRef<Map<number, HTMLSpanElement>>(new Map());
  const codeRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    return window.androidTool.onDecompileEvent((event) => {
      if (event.jobId !== jobId) return;
      if (event.type === "progress") {
        setProgressTail((current) =>
          [...current, event.line].slice(-40)
        );
      } else {
        if (event.ok) {
          setPhase("done");
          setMessage(event.message);
          void refreshTree();
        } else {
          setPhase("error");
          setMessage(event.message);
        }
      }
    });
  }, [jobId]);

  // 反编译是渐进写盘的：进行中每 2s 刷新树，让用户提前浏览已生成的文件
  useEffect(() => {
    if (phase !== "running" || !jobId) {
      return;
    }
    let cancelled = false;
    const poll = (): void => {
      if (cancelled) return;
      void refreshTree();
      timer = window.setTimeout(poll, 2_000);
    };
    let timer = window.setTimeout(poll, 2_000);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [phase, jobId]);

  async function refreshTree(): Promise<void> {
    if (!jobId) return;
    const result = await window.androidTool.getDecompileTree(jobId);
    setTreeNodes((current) => {
      // 渐进阶段保留用户手动展开的目录，不重置展开状态
      if (current.length > 0) return result.nodes;
      setExpanded(
        new Set(
          result.nodes
            .filter(
              (n) => n.type === "dir" && n.relPath.split("/").length === 1
            )
            .map((n) => n.relPath)
        )
      );
      return result.nodes;
    });
    setTruncated(result.truncated);
  }

  useEffect(() => {
    if (codeRef.current) {
      codeRef.current.scrollTop = 0;
    }
  }, [fileContent]);

  // 文件内查找：命中位置（大小写不敏感）
  const currentText = fileContent?.content ?? "";
  const findIndices = useMemo(
    () => findAllIndices(currentText, findQuery),
    [currentText, findQuery]
  );

  // 跳到第 findIndex 个命中并滚动到可见
  useEffect(() => {
    if (!findOpen || findIndices.length === 0) return;
    const node = hitRefs.current.get(findIndex);
    node?.scrollIntoView({ block: "center" });
  }, [findOpen, findIndex, findIndices]);

  // Ctrl+F 打开 / Esc 关闭
  useEffect(() => {
    const onKey = (event: KeyboardEvent): void => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "f") {
        event.preventDefault();
        setFindOpen(true);
        window.setTimeout(() => findInputRef.current?.select(), 0);
      }
      if (event.key === "Escape" && findOpen) {
        setFindOpen(false);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [findOpen]);

  function stepFind(delta: 1 | -1): void {
    if (findIndices.length === 0) return;
    setFindIndex((current) => (current + delta + findIndices.length) % findIndices.length);
  }

  const filteredNodes = useMemo(() => {
    const query = filter.trim().toLowerCase();
    if (!query) return treeNodes;
    return treeNodes.filter(
      (node) =>
        node.relPath.toLowerCase().includes(query) ||
        (node.type === "dir" &&
          treeNodes.some(
            (child) =>
              child.relPath.startsWith(node.relPath + "/") &&
              child.relPath.toLowerCase().includes(query)
          ))
    );
  }, [treeNodes, filter]);

  const nodesByDir = useMemo(() => {
    const map = new Map<string, DecompileFileNode[]>();
    for (const node of filteredNodes) {
      const parent = node.relPath.includes("/")
        ? node.relPath.slice(0, node.relPath.lastIndexOf("/"))
        : "";
      const bucket = map.get(parent);
      if (bucket) bucket.push(node);
      else map.set(parent, [node]);
    }
    return map;
  }, [filteredNodes]);

  const roots = nodesByDir.get("") ?? [];

  async function startDecompile(apkPath: string, name: string): Promise<void> {
    setPhase("running");
    setApkName(name);
    setMessage("正在反编译…");
    setProgressTail([]);
    setTreeNodes([]);
    setSelected(undefined);
    setFileContent(undefined);
    const result = await window.androidTool.startDecompile(apkPath);
    if (!result.ok || !result.jobId) {
      setPhase("error");
      setMessage(result.message || "反编译启动失败");
      return;
    }
    setJobId(result.jobId);
  }

  async function chooseFile(): Promise<void> {
    const selectedApk = await window.androidTool.selectApkFile();
    if (selectedApk) {
      await startDecompile(selectedApk.path, selectedApk.name);
    }
  }

  function handleDrop(event: ReactDragEvent): void {
    event.preventDefault();
    setDragOver(false);
    const dropped = event.dataTransfer.files[0];
    if (!dropped) return;
    try {
      const apk = apkFromDrop(dropped);
      void startDecompile(apk.path, apk.name);
    } catch (error) {
      setPhase("error");
      setMessage(error instanceof Error ? error.message : String(error));
    }
  }

  // 全文搜索：300ms 防抖，切到搜索模式或输入变化时执行
  useEffect(() => {
    if (searchMode !== "text" || !jobId) {
      return;
    }
    const query = filter.trim();
    if (!query) {
      setSearchHits([]);
      setSearchTruncated(false);
      return;
    }
    const timer = window.setTimeout(() => {
      setSearching(true);
      void window.androidTool
        .searchDecompile(jobId, query)
        .then((result) => {
          setSearchHits(result.hits);
          setSearchTruncated(result.truncated);
        })
        .finally(() => setSearching(false));
    }, 300);
    return () => window.clearTimeout(timer);
  }, [searchMode, filter, jobId]);

  async function openNode(node: DecompileFileNode): Promise<void> {
    if (node.type === "dir" || !jobId) return;
    setSelected(node);
    setFileContent(undefined);
    setFileLoading(true);
    setFindIndex(0);
    try {
      setFileContent(
        await window.androidTool.readDecompileFile(jobId, node.relPath)
      );
    } finally {
      setFileLoading(false);
    }
  }

  async function openSearchHit(hit: DecompileSearchHit): Promise<void> {
    const node = treeNodes.find(
      (candidate) => candidate.relPath === hit.relPath
    );
    if (node) {
      // 展开父目录链，让该文件在树里可见
      setExpanded((current) => {
        const next = new Set(current);
        let parent = hit.relPath.includes("/")
          ? hit.relPath.slice(0, hit.relPath.lastIndexOf("/"))
          : "";
        while (parent) {
          next.add(parent);
          parent = parent.includes("/")
            ? parent.slice(0, parent.lastIndexOf("/"))
            : "";
        }
        return next;
      });
      await openNode(node);
    } else {
      // 渐进阶段文件可能刚生成而树未刷新：直接按路径读取
      setSelected({ name: hit.relPath.split("/").pop() ?? hit.relPath, relPath: hit.relPath, type: "file", size: 0 });
      setFileContent(undefined);
      setFileLoading(true);
      try {
        setFileContent(
          await window.androidTool.readDecompileFile(jobId, hit.relPath)
        );
      } finally {
        setFileLoading(false);
      }
    }
  }

  async function copyContent(): Promise<void> {
    if (fileContent?.content) {
      await window.androidTool.copyLogcatText(fileContent.content);
      setMessage("已复制文件内容");
    }
  }

  function reset(): void {
    if (jobId) {
      window.androidTool.discardDecompile(jobId);
    }
    setPhase("idle");
    setJobId("");
    setApkName("");
    setMessage("");
    setTreeNodes([]);
    setSelected(undefined);
    setFileContent(undefined);
    setProgressTail([]);
    setSearchHits([]);
    setSearchMode("tree");
    setFilter("");
  }

  return (
    <main className="decompiler-root">
      <header className="decompiler-header">
        <div>
          <h1>APK 反编译</h1>
          <p>
            {phase === "done" || phase === "running"
              ? `${apkName}${message ? ` · ${message}` : ""}`
              : "拖入 APK，查看反编译后的 Java 源码与资源"}
          </p>
        </div>
        {phase !== "idle" && (
          <div className="decompiler-header-actions">
            {phase === "running" && jobId && (
              <button
                className="decompiler-cancel"
                onClick={() => void window.androidTool.cancelDecompile(jobId)}
              >
                取消
              </button>
            )}
            <button onClick={reset} title="重新选择 APK">
              <ArrowClockwise size={15} />
              重新开始
            </button>
            <button onClick={() => window.close()} title="关闭窗口">
              <X size={15} />
            </button>
          </div>
        )}
      </header>

      {phase === "idle" && (
        <div
          className={dragOver ? "decompiler-drop active" : "decompiler-drop"}
          onDragOver={(event) => {
            event.preventDefault();
            setDragOver(true);
          }}
          onDragLeave={() => setDragOver(false)}
          onDrop={handleDrop}
        >
          <FileCode size={44} weight="duotone" />
          <strong>把 APK 拖到这里</strong>
          <span>反编译为 Java 源码 + 解码资源（jadx）</span>
          <button onClick={() => void chooseFile()}>选择 APK 文件</button>
        </div>
      )}

      {phase === "running" && treeNodes.length === 0 && (
        <div className="decompiler-progress">
          <span className="loader" />
          <p>{message}</p>
          <pre>
            {progressTail.join("\n") || "等待 jadx 输出…"}
          </pre>
        </div>
      )}

      {phase === "error" && (
        <div className="decompiler-error">
          <strong>反编译失败</strong>
          <pre>{message}</pre>
          {progressTail.length > 0 && <pre>{progressTail.slice(-15).join("\n")}</pre>}
          <button onClick={reset}>重新选择 APK</button>
        </div>
      )}

      {(phase === "done" || (phase === "running" && treeNodes.length > 0)) && (
        <div className="decompiler-body">
          <aside className="decompiler-tree">
            {phase === "running" && searchMode === "tree" && (
              <div className="decompiler-tree-live">
                <span className="loader" />
                正在反编译 · 已生成 {treeNodes.length} 项，可直接浏览
              </div>
            )}
            <div className="decompiler-tree-filter">
              <MagnifyingGlass size={13} />
              <input
                value={filter}
                onChange={(event) => setFilter(event.target.value)}
                placeholder={
                  searchMode === "tree"
                    ? "过滤文件路径…"
                    : "全文搜索类名/字符串/资源…"
                }
                spellCheck={false}
              />
              {filter && (
                <button
                  className="decompiler-filter-clear"
                  onClick={() => setFilter("")}
                  title="清空"
                >
                  <X size={11} />
                </button>
              )}
              <div
                className={
                  searchMode === "text"
                    ? "decompiler-filter-mode active"
                    : "decompiler-filter-mode"
                }
                title={
                  searchMode === "tree"
                    ? "当前：过滤文件树。点击切换为全文搜索"
                    : "当前：全文搜索。点击切换为过滤文件树"
                }
              >
                <button
                  className={searchMode === "tree" ? "active" : ""}
                  onClick={() => setSearchMode("tree")}
                  title="按路径过滤文件树"
                >
                  路径
                </button>
                <button
                  className={searchMode === "text" ? "active" : ""}
                  onClick={() => setSearchMode("text")}
                  title="在反编译产物全文中搜索"
                >
                  全文
                </button>
              </div>
            </div>

            {searchMode === "text" ? (
              <div className="decompiler-search-list">
                {searching && searchHits.length === 0 ? (
                  <p className="decompiler-tree-empty">
                    <span className="loader" /> 正在搜索…
                  </p>
                ) : !filter.trim() ? (
                  <p className="decompiler-tree-empty">
                    输入关键词，在文件名与文件内容中搜索
                  </p>
                ) : searchHits.length === 0 ? (
                  <p className="decompiler-tree-empty">没有匹配结果</p>
                ) : (
                  <>
                    {searchHits.map((hit) => (
                      <button
                        key={hit.relPath}
                        className={
                          hit.relPath === selected?.relPath
                            ? "decompiler-search-hit selected"
                            : "decompiler-search-hit"
                        }
                        onClick={() => void openSearchHit(hit)}
                        title={hit.relPath}
                      >
                        <code>{hit.relPath}</code>
                        {hit.context && <small>{hit.context}</small>}
                      </button>
                    ))}
                    {searchTruncated && (
                      <p className="decompiler-tree-truncated">
                        结果过多，仅显示前 500 条
                      </p>
                    )}
                  </>
                )}
              </div>
            ) : (
              <div className="decompiler-tree-list">
                {roots.length === 0 ? (
                  <p className="decompiler-tree-empty">没有匹配的文件</p>
                ) : (
                  roots.map((node) => (
                    <TreeNode
                      key={node.relPath}
                      node={node}
                      depth={0}
                      expanded={expanded}
                      nodesByDir={nodesByDir}
                      filter={filter}
                      selectedPath={selected?.relPath ?? ""}
                      onToggle={(relPath) =>
                        setExpanded((current) => {
                          const next = new Set(current);
                          if (next.has(relPath)) next.delete(relPath);
                          else next.add(relPath);
                          return next;
                        })
                      }
                      onSelect={(node) => void openNode(node)}
                    />
                  ))
                )}
              </div>
            )}
            {searchMode === "tree" && truncated && (
              <p className="decompiler-tree-truncated">
                文件过多，仅显示前 30000 项
              </p>
            )}
          </aside>
          <section className="decompiler-viewer">
            {selected ? (
              <>
                <header className="decompiler-viewer-header">
                  <code>{selected.relPath}</code>
                  <div className="decompiler-viewer-actions">
                    <button
                      onClick={() => {
                        setFindOpen((open) => !open);
                        window.setTimeout(
                          () => findInputRef.current?.select(),
                          0
                        );
                      }}
                      disabled={!fileContent?.content}
                      title="在当前文件中查找（Ctrl+F）"
                    >
                      <MagnifyingGlass size={14} />
                      查找
                    </button>
                    <button
                      onClick={() => void copyContent()}
                      disabled={!fileContent?.content}
                      title="复制文件内容"
                    >
                      <CopySimple size={14} />
                      复制
                    </button>
                  </div>
                </header>
                {findOpen && (
                  <div className="decompiler-find">
                    <MagnifyingGlass size={13} />
                    <input
                      ref={findInputRef}
                      value={findQuery}
                      onChange={(event) => {
                        setFindQuery(event.target.value);
                        setFindIndex(0);
                      }}
                      onKeyDown={(event) => {
                        if (event.key === "Enter") {
                          event.preventDefault();
                          stepFind(event.shiftKey ? -1 : 1);
                        }
                      }}
                      placeholder="在当前文件中查找…"
                      spellCheck={false}
                      autoFocus
                    />
                    <span className="decompiler-find-count">
                      {findQuery
                        ? findIndices.length === 0
                          ? "无结果"
                          : `${findIndex + 1} / ${findIndices.length}`
                        : ""}
                    </span>
                    <button
                      onClick={() => stepFind(-1)}
                      disabled={findIndices.length === 0}
                      title="上一个（Shift+Enter）"
                    >
                      <ArrowUp size={13} />
                    </button>
                    <button
                      onClick={() => stepFind(1)}
                      disabled={findIndices.length === 0}
                      title="下一个（Enter）"
                    >
                      <ArrowDown size={13} />
                    </button>
                    <button
                      className="decompiler-find-close"
                      onClick={() => setFindOpen(false)}
                      title="关闭（Esc）"
                    >
                      <X size={13} />
                    </button>
                  </div>
                )}
                {fileLoading ? (
                  <div className="decompiler-viewer-loading">
                    <span className="loader" />
                  </div>
                ) : fileContent?.binary ? (
                  <div className="decompiler-viewer-empty">
                    <p>二进制文件，不支持预览</p>
                    <small>{formatSize(selected.size)}</small>
                  </div>
                ) : fileContent?.ok && fileContent.content !== undefined ? (
                  <div className="decompiler-code" ref={codeRef}>
                    <pre>
                      {renderWithFindHighlights(
                        currentText,
                        findQuery,
                        findIndices,
                        findOpen ? findIndex : -1,
                        hitRefs
                      )}
                    </pre>
                  </div>
                ) : (
                  <div className="decompiler-viewer-empty">
                    <p>{fileContent?.message || "无法读取该文件"}</p>
                  </div>
                )}
              </>
            ) : (
              <div className="decompiler-viewer-empty">
                <FileCode size={30} weight="duotone" />
                <p>从左侧选择文件查看内容</p>
              </div>
            )}
          </section>
        </div>
      )}
    </main>
  );
}
