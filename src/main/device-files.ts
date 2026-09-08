import { execFile } from "node:child_process";
import path from "node:path";
import { promisify } from "node:util";
import type { DeviceFileEntry } from "../shared/types";

const execFileAsync = promisify(execFile);

function assertText(value: string, label: string): void {
  if (typeof value !== "string" || /[\0\r\n]/.test(value)) {
    throw new Error(`${label}包含无效字符`);
  }
}

export function normalizeDevicePath(value: string): string {
  assertText(value, "设备路径");
  if (!value.startsWith("/")) {
    throw new Error("设备路径必须是绝对路径");
  }
  return path.posix.normalize(value);
}

export function validateDeviceFileName(value: string): string {
  assertText(value, "文件名");
  const name = value.trim();
  if (!name || name === "." || name === ".." || name.includes("/")) {
    throw new Error("文件名无效");
  }
  return name;
}

function shellQuote(value: string): string {
  return `'${value.replaceAll("'", "'\\''")}'`;
}

function shellCommand(value: string): string {
  return `"${value.replace(/["$`\\]/g, "\\$&")}"`;
}

function childPath(parent: string, name: string): string {
  return path.posix.join(
    normalizeDevicePath(parent),
    validateDeviceFileName(name)
  );
}

export function buildListFilesArgs(serial: string, directory: string): string[] {
  const target = shellQuote(normalizeDevicePath(directory));
  const command =
    `dir=${target}; ` +
    "[ -d \"$dir\" ] || { echo '目标不是目录' >&2; exit 2; }; " +
    "for item in \"$dir\"/* \"$dir\"/.[!.]* \"$dir\"/..?*; do " +
    "{ [ -e \"$item\" ] || [ -L \"$item\" ]; } || continue; " +
    "stat -c '%F\\t%s\\t%Y\\t%a\\t%n' \"$item\"; " +
    "done";
  return ["-s", serial, "shell", "sh", "-c", shellCommand(command)];
}

export function buildCreateDirectoryArgs(
  serial: string,
  parent: string,
  name: string
): string[] {
  const target = shellQuote(childPath(parent, name));
  return ["-s", serial, "shell", "sh", "-c", shellCommand(`mkdir -- ${target}`)];
}

export function buildRenameFileArgs(
  serial: string,
  source: string,
  newName: string
): string[] {
  const from = normalizeDevicePath(source);
  if (from === "/") throw new Error("不能重命名根目录");
  const destination = childPath(path.posix.dirname(from), newName);
  return [
    "-s", serial, "shell", "sh", "-c",
    shellCommand(`mv -- ${shellQuote(from)} ${shellQuote(destination)}`)
  ];
}

export function buildDeleteFileArgs(serial: string, target: string): string[] {
  const normalized = normalizeDevicePath(target);
  if (normalized === "/") throw new Error("不能删除根目录");
  return [
    "-s", serial, "shell", "sh", "-c",
    shellCommand(`rm -rf -- ${shellQuote(normalized)}`)
  ];
}

export function buildPushFileArgs(
  serial: string,
  localPath: string,
  directory: string
): string[] {
  const target = normalizeDevicePath(directory);
  return ["-s", serial, "push", localPath, target.endsWith("/") ? target : `${target}/`];
}

export function buildPullFileArgs(
  serial: string,
  remotePath: string,
  localDirectory: string
): string[] {
  return ["-s", serial, "pull", normalizeDevicePath(remotePath), localDirectory];
}

export function buildReadFileArgs(serial: string, remotePath: string): string[] {
  const command = `cat -- ${shellQuote(normalizeDevicePath(remotePath))}`;
  return ["-s", serial, "exec-out", "sh", "-c", command];
}

export function detectImageMime(buffer: Buffer): string | undefined {
  if (buffer.length >= 8 && buffer.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) {
    return "image/png";
  }
  if (buffer.length >= 3 && buffer[0] === 255 && buffer[1] === 216 && buffer[2] === 255) {
    return "image/jpeg";
  }
  const signature = buffer.subarray(0, 6).toString("ascii");
  if (signature === "GIF87a" || signature === "GIF89a") return "image/gif";
  if (
    buffer.length >= 12 &&
    buffer.subarray(0, 4).toString("ascii") === "RIFF" &&
    buffer.subarray(8, 12).toString("ascii") === "WEBP"
  ) return "image/webp";
  if (buffer.length >= 2 && buffer.subarray(0, 2).toString("ascii") === "BM") {
    return "image/bmp";
  }
  return undefined;
}

function fileType(rawType: string): DeviceFileEntry["type"] {
  if (rawType === "directory") return "directory";
  if (rawType === "regular file") return "file";
  if (rawType === "symbolic link") return "link";
  return "other";
}

export function parseDeviceFileList(output: string): DeviceFileEntry[] {
  const entries: DeviceFileEntry[] = [];
  for (const rawLine of output.split(/\r?\n/)) {
    if (!rawLine.trim()) continue;
    const fields = rawLine.includes("\t")
      ? rawLine.split("\t")
      : rawLine.split("\\t");
    if (fields.length < 5) continue;
    const entryPath = fields.slice(4).join("\t");
    const size = Number(fields[1]);
    const modifiedSeconds = Number(fields[2]);
    entries.push({
      name: path.posix.basename(entryPath),
      path: entryPath,
      type: fileType(fields[0]),
      size: Number.isFinite(size) ? size : 0,
      modifiedAt: Number.isFinite(modifiedSeconds) ? modifiedSeconds * 1000 : 0,
      mode: fields[3]
    });
  }
  const order: Record<DeviceFileEntry["type"], number> = {
    directory: 0,
    link: 1,
    file: 2,
    other: 3
  };
  return entries.sort((left, right) =>
    order[left.type] - order[right.type] ||
    left.name.localeCompare(right.name, undefined, { sensitivity: "base" })
  );
}

export class DeviceFileManager {
  constructor(private readonly executable: string) {}

  async list(serial: string, directory: string): Promise<DeviceFileEntry[]> {
    const { stdout } = await execFileAsync(
      this.executable,
      buildListFilesArgs(serial, directory),
      { windowsHide: true, timeout: 30_000, maxBuffer: 16 * 1024 * 1024 }
    );
    return parseDeviceFileList(stdout);
  }

  async createDirectory(serial: string, parent: string, name: string): Promise<void> {
    await this.run(buildCreateDirectoryArgs(serial, parent, name));
  }

  async rename(serial: string, source: string, newName: string): Promise<void> {
    await this.run(buildRenameFileArgs(serial, source, newName));
  }

  async delete(serial: string, target: string): Promise<void> {
    await this.run(buildDeleteFileArgs(serial, target));
  }

  async push(serial: string, localPath: string, directory: string): Promise<void> {
    await this.run(buildPushFileArgs(serial, localPath, directory), 5 * 60_000);
  }

  async pull(serial: string, remotePath: string, localDirectory: string): Promise<void> {
    await this.run(buildPullFileArgs(serial, remotePath, localDirectory), 5 * 60_000);
  }

  readFile(serial: string, remotePath: string): Promise<Buffer> {
    return new Promise((resolve, reject) => {
      execFile(
        this.executable,
        buildReadFileArgs(serial, remotePath),
        {
          windowsHide: true,
          timeout: 30_000,
          maxBuffer: 21 * 1024 * 1024,
          encoding: "buffer"
        },
        (error, stdout, stderr) => {
          if (error) {
            reject(new Error(stderr?.toString().trim() || error.message));
            return;
          }
          resolve(stdout);
        }
      );
    });
  }

  private async run(args: string[], timeout = 30_000): Promise<void> {
    await execFileAsync(this.executable, args, {
      windowsHide: true,
      timeout,
      maxBuffer: 16 * 1024 * 1024
    });
  }
}
