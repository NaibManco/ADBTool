import { randomUUID } from "node:crypto";
import {
  spawn as nodeSpawn,
  type ChildProcess,
  type SpawnOptions
} from "node:child_process";
import {
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync
} from "node:fs";
import os from "node:os";
import path from "node:path";
import type { DecompileEvent, DecompileFileNode } from "../shared/types";

type SpawnProcess = (
  executable: string,
  args: readonly string[],
  options: SpawnOptions
) => ChildProcess;

type DecompileJob = {
  id: string;
  process: ChildProcess;
  outputDir: string;
  apkName: string;
  finished: boolean;
};

const MAX_TREE_NODES = 30_000;
const MAX_READ_BYTES = 2 * 1024 * 1024;
const PROGRESS_TAIL_LINES = 40;

// jadx exit 3 = 完成但有部分类反编译失败，结果仍可用
const JADX_PARTIAL_FAILURE_CODE = 3;

const TEXT_EXTENSIONS = new Set([
  ".java", ".kt", ".xml", ".json", ".html", ".htm", ".js", ".css", ".txt",
  ".md", ".yml", ".yaml", ".properties", ".gradle", ".kts", ".pro", ".cfg",
  ".ini", ".sql", ".smali", ".csv", ".proto", ".aidl", ".c", ".h", ".cpp"
]);

export function isPreviewableExtension(name: string): boolean {
  return TEXT_EXTENSIONS.has(path.extname(name).toLowerCase());
}

/** 把相对路径安全解析到 job 根目录内；越界（绝对路径/..穿越）返回 null。 */
export function resolveWithinRoot(root: string, relPath: string): string | null {
  if (!relPath || relPath.includes("\0")) return null;
  const normalizedRoot = path.resolve(root);
  const target = path.resolve(normalizedRoot, relPath);
  const rootWithSep = normalizedRoot.endsWith(path.sep)
    ? normalizedRoot
    : normalizedRoot + path.sep;
  if (target !== normalizedRoot && !target.startsWith(rootWithSep)) {
    return null;
  }
  return target;
}

export function buildJadxArgs(
  jarPath: string,
  apkPath: string,
  outputDir: string
): string[] {
  return [
    "-XX:+IgnoreUnrecognizedVMOptions",
    "-Xms256M",
    "--enable-native-access=ALL-UNNAMED",
    "-cp",
    jarPath,
    "jadx.cli.JadxCLI",
    "-d",
    outputDir,
    apkPath
  ];
}

export function buildDecompileTree(
  outputDir: string,
  maxNodes = MAX_TREE_NODES
): { nodes: DecompileFileNode[]; truncated: boolean } {
  const nodes: DecompileFileNode[] = [];
  let truncated = false;

  const walk = (absoluteDir: string, relDir: string): void => {
    if (truncated) return;
    let entries: import("node:fs").Dirent[];
    try {
      entries = readdirSync(absoluteDir, { withFileTypes: true });
    } catch {
      return;
    }
    entries.sort((left, right) => {
      if (left.isDirectory() !== right.isDirectory()) {
        return left.isDirectory() ? -1 : 1;
      }
      return left.name.localeCompare(right.name);
    });
    for (const entry of entries) {
      if (nodes.length >= maxNodes) {
        truncated = true;
        return;
      }
      const relPath = relDir ? `${relDir}/${entry.name}` : entry.name;
      if (entry.isDirectory()) {
        nodes.push({ name: entry.name, relPath, type: "dir", size: 0 });
        walk(path.join(absoluteDir, entry.name), relPath);
      } else {
        let size = 0;
        try {
          size = statSync(path.join(absoluteDir, entry.name)).size;
        } catch {
          // 无法取大小的文件仍显示
        }
        nodes.push({ name: entry.name, relPath, type: "file", size });
      }
    }
  };

  walk(outputDir, "");
  return { nodes, truncated };
}

export class DecompileManager {
  private readonly jobs = new Map<string, DecompileJob>();

  constructor(
    private readonly javaExecutable: string,
    private readonly jadxJarPath: string,
    private readonly onEvent: (event: DecompileEvent) => void,
    private readonly spawnProcess: SpawnProcess = nodeSpawn
  ) {}

  start(apkPath: string, apkName: string): string {
    const jobId = randomUUID();
    const outputDir = path.join(
      mkdtempSync(path.join(os.tmpdir(), "adt-decompile-")),
      "out"
    );
    mkdirSync(outputDir, { recursive: true });

    const process = this.spawnProcess(
      this.javaExecutable,
      buildJadxArgs(this.jadxJarPath, apkPath, outputDir),
      {
        windowsHide: true,
        stdio: ["ignore", "pipe", "pipe"]
      }
    );

    const job: DecompileJob = {
      id: jobId,
      process,
      outputDir,
      apkName,
      finished: false
    };
    this.jobs.set(jobId, job);

    const tail: string[] = [];
    const consume = (chunk: Buffer | string, isError: boolean): void => {
      for (const line of chunk.toString().split(/\r?\n/)) {
        if (!line) continue;
        tail.push(`${isError ? "" : ""}${line}`);
        if (tail.length > PROGRESS_TAIL_LINES) tail.shift();
        this.onEvent({ type: "progress", jobId, line });
      }
    };
    process.stdout?.on("data", (chunk: Buffer | string) =>
      consume(chunk, false)
    );
    process.stderr?.on("data", (chunk: Buffer | string) =>
      consume(chunk, true)
    );

    const finish = (ok: boolean, message: string): void => {
      job.finished = true;
      this.onEvent({ type: "done", jobId, ok, message });
    };

    process.once("error", (error) => {
      if (this.jobs.get(jobId) === job) {
        this.jobs.delete(jobId);
        rmSync(outputDir, { recursive: true, force: true });
        finish(false, `jadx 启动失败: ${error.message}`);
      }
    });

    process.once("exit", (code) => {
      if (this.jobs.get(jobId) === job) {
        if (code === 0) {
          finish(true, "反编译完成");
        } else if (code === JADX_PARTIAL_FAILURE_CODE) {
          finish(
            true,
            "反编译完成（部分类失败，属正常现象，可查看已生成代码）"
          );
        } else {
          // 彻底失败：结果不可用，清理目录并丢弃任务
          this.jobs.delete(jobId);
          rmSync(outputDir, { recursive: true, force: true });
          const detail = tail.slice(-5).join("\n");
          finish(
            false,
            `jadx 退出，代码 ${code}${detail ? `：\n${detail}` : ""}`
          );
        }
      }
    });

    return jobId;
  }

  isRunning(jobId: string): boolean {
    const job = this.jobs.get(jobId);
    return job !== undefined && !job.finished;
  }

  hasResult(jobId: string): boolean {
    const job = this.jobs.get(jobId);
    return job !== undefined && job.finished;
  }

  getJobName(jobId: string): string | undefined {
    return this.jobs.get(jobId)?.apkName;
  }

  cancel(jobId: string): boolean {
    const job = this.jobs.get(jobId);
    if (!job || job.finished) {
      return false;
    }
    this.jobs.delete(jobId);
    job.process.kill();
    rmSync(job.outputDir, { recursive: true, force: true });
    this.onEvent({ type: "done", jobId, ok: false, message: "已取消反编译" });
    return true;
  }

  /** 进程结束后仍保留结果目录供读取；丢弃则删除。 */
  discard(jobId: string): boolean {
    const job = this.jobs.get(jobId);
    if (!job) {
      return false;
    }
    this.jobs.delete(jobId);
    if (!job.finished) {
      job.process.kill();
    }
    rmSync(job.outputDir, { recursive: true, force: true });
    return true;
  }

  tree(jobId: string): { nodes: DecompileFileNode[]; truncated: boolean } {
    const job = this.jobs.get(jobId);
    if (!job) {
      throw new Error("反编译任务不存在或已被清理");
    }
    return buildDecompileTree(job.outputDir);
  }

  readFile(
    jobId: string,
    relPath: string
  ): { ok: boolean; content?: string; binary?: boolean; message?: string } {
    const job = this.jobs.get(jobId);
    if (!job) {
      return { ok: false, message: "反编译任务不存在或已被清理" };
    }
    const target = resolveWithinRoot(job.outputDir, relPath);
    if (!target) {
      return { ok: false, message: "文件路径无效" };
    }
    let info;
    try {
      info = statSync(target);
    } catch {
      return { ok: false, message: "文件不存在" };
    }
    if (info.isDirectory()) {
      return { ok: false, message: "该路径是目录" };
    }
    if (info.size > MAX_READ_BYTES) {
      return { ok: false, message: `文件过大（${info.size} 字节），不支持预览` };
    }
    if (!isPreviewableExtension(target)) {
      return { ok: true, binary: true };
    }
    const content = readFileSync(target, "utf8");
    // BOM 清理
    return {
      ok: true,
      content: content.charCodeAt(0) === 0xfeff ? content.slice(1) : content
    };
  }

  cleanup(): void {
    for (const jobId of [...this.jobs.keys()]) {
      this.discard(jobId);
    }
  }
}
