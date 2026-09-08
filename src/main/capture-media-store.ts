import { randomUUID } from "node:crypto";
import {
  copyFileSync,
  mkdirSync,
  rmSync,
  statSync,
  writeFileSync
} from "node:fs";
import path from "node:path";
import type { CaptureMedia, CaptureMediaKind } from "../shared/types";

export const CAPTURE_MEDIA_SCHEME = "android-dev-capture";

export interface StoredCaptureMedia {
  descriptor: CaptureMedia;
  localPath: string;
}

function safeSerial(serial: string): string {
  return serial.replace(/[^A-Za-z0-9._-]/g, "-");
}

export function captureMediaFileName(
  kind: CaptureMediaKind,
  serial: string,
  createdAt: number
): string {
  const timestamp = new Date(createdAt).toISOString().replace(/[:.]/g, "-");
  const prefix = kind === "image" ? "Screenshot" : "ScreenRecording";
  const extension = kind === "image" ? "png" : "mp4";
  return `${prefix}-${safeSerial(serial)}-${timestamp}.${extension}`;
}

export class CaptureMediaStore {
  private readonly entries = new Map<string, StoredCaptureMedia>();
  private readonly resolvedRoot: string;

  constructor(private readonly root: string) {
    this.resolvedRoot = path.resolve(root);
  }

  reset(): void {
    rmSync(this.resolvedRoot, { recursive: true, force: true });
    mkdirSync(this.resolvedRoot, { recursive: true });
    this.entries.clear();
  }

  cleanup(): void {
    rmSync(this.resolvedRoot, { recursive: true, force: true });
    this.entries.clear();
  }

  createVideoPath(serial: string, createdAt = Date.now()): string {
    this.ensureRoot();
    return path.join(
      this.resolvedRoot,
      captureMediaFileName("video", serial, createdAt)
    );
  }

  addScreenshot(
    serial: string,
    bytes: Buffer,
    width: number,
    height: number,
    createdAt = Date.now()
  ): CaptureMedia {
    this.ensureRoot();
    const id = randomUUID();
    const localPath = path.join(this.resolvedRoot, `${id}.png`);
    writeFileSync(localPath, bytes);
    return this.add({
      id,
      kind: "image",
      name: captureMediaFileName("image", serial, createdAt),
      mimeType: "image/png",
      size: bytes.length,
      createdAt,
      deviceSerial: serial,
      url: `${CAPTURE_MEDIA_SCHEME}://media/${id}`,
      width,
      height
    }, localPath);
  }

  addVideo(serial: string, localPath: string, createdAt: number): CaptureMedia {
    const resolvedPath = path.resolve(localPath);
    this.assertOwnedPath(resolvedPath);
    const info = statSync(resolvedPath);
    if (!info.isFile()) throw new Error("录屏文件不存在");
    const id = randomUUID();
    return this.add({
      id,
      kind: "video",
      name: captureMediaFileName("video", serial, createdAt),
      mimeType: "video/mp4",
      size: info.size,
      createdAt,
      deviceSerial: serial,
      url: `${CAPTURE_MEDIA_SCHEME}://media/${id}`
    }, resolvedPath);
  }

  get(id: string): StoredCaptureMedia {
    const entry = this.entries.get(id);
    if (!entry) throw new Error("预览文件已失效，请重新截图或录屏");
    return entry;
  }

  copyTo(id: string, destination: string): void {
    copyFileSync(this.get(id).localPath, destination);
  }

  private add(descriptor: CaptureMedia, localPath: string): CaptureMedia {
    this.entries.set(descriptor.id, { descriptor, localPath });
    return descriptor;
  }

  private ensureRoot(): void {
    mkdirSync(this.resolvedRoot, { recursive: true });
  }

  private assertOwnedPath(localPath: string): void {
    const prefix = `${this.resolvedRoot}${path.sep}`;
    if (!localPath.startsWith(prefix)) {
      throw new Error("录屏临时文件不在受控目录中");
    }
  }
}
