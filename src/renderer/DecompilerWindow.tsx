import { useEffect, useMemo, useRef, useState, type DragEvent as ReactDragEvent } from "react";
import {
  ArrowClockwise,
  CopySimple,
  FileCode,
  Folder,
  FolderOpen,
  MagnifyingGlass,
  X
} from "@phosphor-icons/react";
import type {
  DecompileFileNode,
  DecompileReadResult
} from "../shared/types";
import { useTheme } from "./theme";

type Phase = "idle" | "running" | "done" | "error";

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
  const [dragOver, setDragOver] = useState(false);
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
          void window.androidTool
            .getDecompileTree(event.jobId)
            .then((result) => {
              setTreeNodes(result.nodes);
              setTruncated(result.truncated);
              setExpanded(
                new Set(result.nodes.filter((n) => n.type === "dir" && n.relPath.split("/").length === 1).map((n) => n.relPath))
              );
            });
        } else {
          setPhase("error");
          setMessage(event.message);
        }
      }
    });
  }, [jobId]);

  useEffect(() => {
    if (codeRef.current) {
      codeRef.current.scrollTop = 0;
    }
  }, [fileContent]);

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

  async function openNode(node: DecompileFileNode): Promise<void> {
    if (node.type === "dir" || !jobId) return;
    setSelected(node);
    setFileContent(undefined);
    setFileLoading(true);
    try {
      setFileContent(
        await window.androidTool.readDecompileFile(jobId, node.relPath)
      );
    } finally {
      setFileLoading(false);
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

      {phase === "running" && (
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

      {phase === "done" && (
        <div className="decompiler-body">
          <aside className="decompiler-tree">
            <div className="decompiler-tree-filter">
              <MagnifyingGlass size={13} />
              <input
                value={filter}
                onChange={(event) => setFilter(event.target.value)}
                placeholder="过滤文件路径…"
                spellCheck={false}
              />
            </div>
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
            {truncated && (
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
                  <button
                    onClick={() => void copyContent()}
                    disabled={!fileContent?.content}
                    title="复制文件内容"
                  >
                    <CopySimple size={14} />
                    复制
                  </button>
                </header>
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
                    <pre>{fileContent.content}</pre>
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
