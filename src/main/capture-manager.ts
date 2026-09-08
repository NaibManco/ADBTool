import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

interface RecordingSession {
  pid: number;
  remotePath: string;
  localPath: string;
  startedAt: number;
}

export function buildScreenshotArgs(serial: string): string[] {
  return ["-s", serial, "exec-out", "screencap", "-p"];
}

export function buildStartRecordingArgs(
  serial: string,
  remotePath: string
): string[] {
  return [
    "-s",
    serial,
    "shell",
    "sh",
    "-c",
    `"screenrecord --time-limit 180 ${remotePath} >/dev/null 2>&1 & echo \\$!"`
  ];
}

export function buildStopRecordingArgs(serial: string, pid: number): string[] {
  return ["-s", serial, "shell", "kill", "-2", String(pid)];
}

export function buildPullRecordingArgs(
  serial: string,
  remotePath: string,
  localPath: string
): string[] {
  return ["-s", serial, "pull", remotePath, localPath];
}

export function buildDeleteRecordingArgs(
  serial: string,
  remotePath: string
): string[] {
  return ["-s", serial, "shell", "rm", "-f", remotePath];
}

export function parseRecordingPid(output: string): number {
  const pid = Number(output.trim());
  if (!Number.isInteger(pid) || pid <= 0) {
    throw new Error("设备未返回有效的录屏进程 PID");
  }
  return pid;
}

function isPng(buffer: Buffer): boolean {
  return buffer.length >= 8 &&
    buffer.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
}

export class CaptureManager {
  private readonly recordings = new Map<string, RecordingSession>();

  constructor(private readonly executable: string) {}

  isRecording(serial: string): boolean {
    return this.recordings.has(serial);
  }

  recordingSessions(): Array<{ serial: string; startedAt: number }> {
    return Array.from(this.recordings, ([serial, session]) => ({
      serial,
      startedAt: session.startedAt
    }));
  }

  async captureScreenshotBuffer(serial: string): Promise<Buffer> {
    const image = await this.execBuffer(buildScreenshotArgs(serial));
    if (!isPng(image)) {
      throw new Error("设备返回的截图不是有效 PNG 文件");
    }
    return image;
  }

  async startRecording(serial: string, localPath: string): Promise<number | undefined> {
    if (this.recordings.has(serial)) return undefined;
    const startedAt = Date.now();
    const remotePath = `/sdcard/AndroidDevTool-${startedAt}.mp4`;
    const { stdout } = await execFileAsync(
      this.executable,
      buildStartRecordingArgs(serial, remotePath),
      { windowsHide: true, timeout: 20_000 }
    );
    this.recordings.set(serial, {
      pid: parseRecordingPid(stdout),
      remotePath,
      localPath,
      startedAt
    });
    return startedAt;
  }

  async stopRecording(serial: string): Promise<string | undefined> {
    const session = this.recordings.get(serial);
    if (!session) return undefined;

    try {
      await execFileAsync(
        this.executable,
        buildStopRecordingArgs(serial, session.pid),
        { windowsHide: true, timeout: 10_000 }
      );
    } catch {
      // screenrecord may already have reached Android's time limit; pull its output anyway.
    }

    await new Promise((resolve) => setTimeout(resolve, 1_000));
    await execFileAsync(
      this.executable,
      buildPullRecordingArgs(serial, session.remotePath, session.localPath),
      { windowsHide: true, timeout: 5 * 60_000, maxBuffer: 4 * 1024 * 1024 }
    );

    try {
      await execFileAsync(
        this.executable,
        buildDeleteRecordingArgs(serial, session.remotePath),
        { windowsHide: true, timeout: 10_000 }
      );
    } catch {
      // The recording is already saved locally; remote cleanup can fail on disconnect.
    } finally {
      this.recordings.delete(serial);
    }
    return session.localPath;
  }

  private execBuffer(args: string[]): Promise<Buffer> {
    return new Promise((resolve, reject) => {
      execFile(
        this.executable,
        args,
        {
          windowsHide: true,
          timeout: 30_000,
          maxBuffer: 32 * 1024 * 1024,
          encoding: "buffer"
        },
        (error, stdout, stderr) => {
          if (error) {
            const detail = stderr.toString().trim();
            reject(new Error(detail || error.message));
            return;
          }
          resolve(stdout);
        }
      );
    });
  }
}
