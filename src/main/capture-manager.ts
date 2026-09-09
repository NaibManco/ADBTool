import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

interface AdbRecordingSession {
  pid: number;
  remotePath: string;
  localPath: string;
  startedAt: number;
}

const ADB_SCREENRECORD_LIMIT_SECONDS = 180;
const START_VERIFICATION_DELAY_MS = 1_500;

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
    `"screenrecord --time-limit ${ADB_SCREENRECORD_LIMIT_SECONDS} ${remotePath} >/dev/null 2>&1 & echo \\$!"`
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

export function buildRemoteFileExistsArgs(
  serial: string,
  remotePath: string
): string[] {
  return ["-s", serial, "shell", "test", "-e", remotePath];
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

const delay = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));

export class CaptureManager {
  private readonly recordings = new Map<string, AdbRecordingSession>();

  constructor(private readonly executable: string) {}

  isRecording(serial: string): boolean {
    return this.recordings.has(serial);
  }

  adbRecordingSessions(): Array<{ serial: string; startedAt: number }> {
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

  /** adb screenrecord 路径；启动失败（如设备封禁）抛错，由调用方回退兼容链路。 */
  async startRecording(
    serial: string,
    localPath: string
  ): Promise<number> {
    if (this.recordings.has(serial)) {
      throw new Error("该设备已经在录屏");
    }
    const startedAt = Date.now();
    const remotePath = `/sdcard/AndroidDevTool-${startedAt}.mp4`;
    const { stdout } = await execFileAsync(
      this.executable,
      buildStartRecordingArgs(serial, remotePath),
      { windowsHide: true, timeout: 20_000 }
    );
    const pid = parseRecordingPid(stdout);
    this.recordings.set(serial, { pid, remotePath, localPath, startedAt });

    // 启动校验：screenrecord 经 & 启动且错误重定向，立即失败也返回 PID；
    // 等文件出现再确认（否则受限设备会假装在录，停止时才暴雷）
    await delay(START_VERIFICATION_DELAY_MS);
    try {
      await execFileAsync(
        this.executable,
        buildRemoteFileExistsArgs(serial, remotePath),
        { windowsHide: true, timeout: 10_000 }
      );
    } catch {
      this.recordings.delete(serial);
      try {
        await execFileAsync(
          this.executable,
          buildStopRecordingArgs(serial, pid),
          { windowsHide: true, timeout: 10_000 }
        );
      } catch {
        // 进程可能已自行退出
      }
      throw new Error("设备端 screenrecord 不可用");
    }
    return startedAt;
  }

  async stopRecording(serial: string): Promise<string> {
    const session = this.recordings.get(serial);
    if (!session) {
      throw new Error("该设备当前没有录屏");
    }

    try {
      await execFileAsync(
        this.executable,
        buildStopRecordingArgs(serial, session.pid),
        { windowsHide: true, timeout: 10_000 }
      );
    } catch {
      // screenrecord 可能已达时限自行结束，直接拉取
    }

    await delay(1_000);
    // 无论成败都结束会话，绝不留在"停止不了"的状态
    try {
      await execFileAsync(
        this.executable,
        buildPullRecordingArgs(serial, session.remotePath, session.localPath),
        { windowsHide: true, timeout: 5 * 60_000, maxBuffer: 4 * 1024 * 1024 }
      );
    } catch (error) {
      this.recordings.delete(serial);
      const detail = error instanceof Error ? error.message : String(error);
      throw new Error(
        /No such file/.test(detail)
          ? "设备上的录屏文件不存在（可能已被系统清理）"
          : `拉取录屏失败：${detail}`
      );
    }

    try {
      await execFileAsync(
        this.executable,
        buildDeleteRecordingArgs(serial, session.remotePath),
        { windowsHide: true, timeout: 10_000 }
      );
    } catch {
      // 本地已有文件，远端清理失败可忽略
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
