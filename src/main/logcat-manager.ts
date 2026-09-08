import {
  spawn as nodeSpawn,
  type ChildProcess,
  type SpawnOptions
} from "node:child_process";
import type { LogcatBuffer, LogcatEntry, LogcatEvent } from "../shared/types";
import { LOGCAT_BUFFERS } from "../shared/types";

type SpawnProcess = (
  executable: string,
  args: readonly string[],
  options: SpawnOptions
) => ChildProcess;

type LogcatSessionOptions = {
  pid?: number;
  buffer: LogcatBuffer;
};

type LogcatSession = {
  process: ChildProcess;
  options: LogcatSessionOptions;
  stdoutBuffer: string;
  stderrBuffer: string;
};

export const LOGCAT_BACKLOG = "5000";

const THREADTIME_PATTERN =
  /^(\d{2}-\d{2}\s+\d{2}:\d{2}:\d{2}\.\d+)\s+(\d+)\s+(\d+)\s+([VDIWEF])\s+([^:]+):\s?(.*)$/;

export function parseLogcatLine(line: string): LogcatEntry {
  const match = THREADTIME_PATTERN.exec(line);
  if (!match) {
    return {
      raw: line,
      level: "I",
      tag: "logcat",
      message: line
    };
  }

  return {
    raw: line,
    timestamp: match[1],
    pid: Number(match[2]),
    tid: Number(match[3]),
    level: match[4] as LogcatEntry["level"],
    tag: match[5].trim(),
    message: match[6]
  };
}

function assertBuffer(buffer: string): LogcatBuffer {
  if (!LOGCAT_BUFFERS.includes(buffer as LogcatBuffer)) {
    throw new Error(`日志缓冲区无效: ${buffer}`);
  }
  return buffer as LogcatBuffer;
}

export function buildLogcatArgs(
  serial: string,
  options: { pid?: number; buffer?: LogcatBuffer }
): string[] {
  const args = [
    "-s",
    serial,
    "logcat",
    "-b",
    options.buffer ?? "main",
    "-v",
    "threadtime",
    "-T",
    LOGCAT_BACKLOG
  ];
  if (options.pid !== undefined) {
    args.push(`--pid=${options.pid}`);
  }
  return args;
}

export class LogcatManager {
  private readonly sessions = new Map<string, LogcatSession>();
  private readonly lastOptions = new Map<string, LogcatSessionOptions>();

  constructor(
    private readonly executable: string,
    private readonly onEvent: (event: LogcatEvent) => void,
    private readonly spawnProcess: SpawnProcess = nodeSpawn
  ) {}

  start(serial: string, pid?: number, buffer?: string): boolean {
    if (this.sessions.has(serial)) {
      return false;
    }

    const effectiveBuffer = buffer
      ? assertBuffer(buffer)
      : (this.lastOptions.get(serial)?.buffer ?? "main");
    const options: LogcatSessionOptions = { pid, buffer: effectiveBuffer };
    this.lastOptions.set(serial, options);

    const process = this.spawnProcess(
      this.executable,
      buildLogcatArgs(serial, options),
      {
        windowsHide: true,
        stdio: ["ignore", "pipe", "pipe"]
      }
    );
    const session: LogcatSession = {
      process,
      options,
      stdoutBuffer: "",
      stderrBuffer: ""
    };
    this.sessions.set(serial, session);

    process.stdout?.on("data", (chunk: Buffer | string) => {
      session.stdoutBuffer = this.consumeLines(
        serial,
        session.stdoutBuffer + chunk.toString(),
        false
      );
    });
    process.stderr?.on("data", (chunk: Buffer | string) => {
      session.stderrBuffer = this.consumeLines(
        serial,
        session.stderrBuffer + chunk.toString(),
        true
      );
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
          message: code && code !== 0 ? `Logcat 已退出，代码 ${code}` : undefined
        });
      }
    });

    this.onEvent({
      type: "status",
      serial,
      running: true,
      pid: options.pid,
      buffer: options.buffer
    });
    return true;
  }

  stop(serial: string): boolean {
    const session = this.sessions.get(serial);
    if (!session) {
      return false;
    }

    this.sessions.delete(serial);
    session.process.kill();
    this.onEvent({ type: "status", serial, running: false });
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

  restart(serial: string, pid?: number, buffer?: string): boolean {
    if (this.sessions.has(serial)) {
      this.stop(serial);
    }
    const effectiveBuffer = buffer
      ? assertBuffer(buffer)
      : (this.lastOptions.get(serial)?.buffer ?? "main");
    return this.start(serial, pid, effectiveBuffer);
  }

  setBuffer(serial: string, buffer: string): boolean {
    const effectiveBuffer = assertBuffer(buffer);
    const previous = this.lastOptions.get(serial);
    this.lastOptions.set(serial, {
      pid: previous?.pid,
      buffer: effectiveBuffer
    });

    if (!this.sessions.has(serial)) {
      return false;
    }
    this.stop(serial);
    return this.start(serial, previous?.pid, effectiveBuffer);
  }

  resync(serial: string): boolean {
    const session = this.sessions.get(serial);
    if (!session) {
      return false;
    }

    this.onEvent({
      type: "status",
      serial,
      running: true,
      pid: session.options.pid,
      buffer: session.options.buffer
    });
    return true;
  }

  private consumeLines(
    serial: string,
    buffer: string,
    isError: boolean
  ): string {
    const lines = buffer.split(/\r?\n/);
    const remainder = lines.pop() ?? "";

    for (const line of lines) {
      if (!line) continue;
      const entry = parseLogcatLine(line);
      this.onEvent({
        type: "entry",
        serial,
        entry: isError
          ? { ...entry, level: "E", tag: "adb", message: line }
          : entry
      });
    }

    return remainder;
  }
}
