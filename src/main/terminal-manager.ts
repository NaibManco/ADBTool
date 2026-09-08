import {
  spawn as nodeSpawn,
  type ChildProcess,
  type SpawnOptions
} from "node:child_process";
import type { TerminalEvent } from "../shared/types";

type SpawnProcess = (
  executable: string,
  args: readonly string[],
  options: SpawnOptions
) => ChildProcess;

type TerminalSession = {
  process: ChildProcess;
};

export function buildTerminalArgs(serial: string): string[] {
  return ["-s", serial, "shell"];
}

export class TerminalManager {
  private readonly sessions = new Map<string, TerminalSession>();

  constructor(
    private readonly executable: string,
    private readonly onEvent: (event: TerminalEvent) => void,
    private readonly spawnProcess: SpawnProcess = nodeSpawn
  ) {}

  start(serial: string): boolean {
    if (this.sessions.has(serial)) {
      // 已有会话：重发状态让新面板接上（同 Logcat resync 语义）
      this.onEvent({ type: "status", serial, running: true });
      return false;
    }

    const process = this.spawnProcess(this.executable, buildTerminalArgs(serial), {
      windowsHide: true,
      stdio: ["pipe", "pipe", "pipe"]
    });
    const session: TerminalSession = { process };
    this.sessions.set(serial, session);

    process.stdout?.on("data", (chunk: Buffer | string) => {
      this.onEvent({ type: "data", serial, stream: "out", data: chunk.toString() });
    });
    process.stderr?.on("data", (chunk: Buffer | string) => {
      this.onEvent({ type: "data", serial, stream: "err", data: chunk.toString() });
    });

    process.once("error", (error) => {
      if (this.sessions.get(serial) === session) {
        this.sessions.delete(serial);
        this.onEvent({
          type: "status",
          serial,
          running: false,
          message: error.message
        });
      }
    });
    process.once("exit", (code) => {
      if (this.sessions.get(serial) === session) {
        this.sessions.delete(serial);
        this.onEvent({
          type: "status",
          serial,
          running: false,
          message:
            code && code !== 0 ? `Shell 已退出，代码 ${code}` : "Shell 会话已结束"
        });
      }
    });

    this.onEvent({ type: "status", serial, running: true });
    return true;
  }

  stop(serial: string): boolean {
    const session = this.sessions.get(serial);
    if (!session) {
      return false;
    }
    this.sessions.delete(serial);
    session.process.kill();
    this.onEvent({ type: "status", serial, running: false, message: "已关闭终端" });
    return true;
  }

  stopAll(): void {
    for (const serial of [...this.sessions.keys()]) {
      this.stop(serial);
    }
  }

  isRunning(serial: string): boolean {
    return this.sessions.has(serial);
  }

  /** 写入一行或控制字符（\x03 = Ctrl+C）。写入失败按尽力而为处理。 */
  write(serial: string, data: string): void {
    const stdin = this.sessions.get(serial)?.process.stdin;
    if (!stdin || stdin.destroyed) {
      return;
    }
    stdin.write(data, (error) => {
      if (error) {
        this.onEvent({
          type: "data",
          serial,
          stream: "err",
          data: "\n[写入失败]\n"
        });
      }
    });
  }
}
