import { open } from "node:fs/promises";
import { inflateRawSync } from "node:zlib";

/**
 * 从 APK 本地识别包名：解 zip 读取 AndroidManifest.xml（二进制 AXML），
 * 提取 <manifest package="...">。任何格式不符都返回 undefined，调用方降级。
 * 只读尾部 EOCD/中央目录和 manifest 条目，不加载整个 APK。
 */

const MANIFEST_ENTRY = "AndroidManifest.xml";
const EOCD_SIGNATURE = 0x06054b50;
const CENTRAL_SIGNATURE = 0x02014b50;
const LOCAL_SIGNATURE = 0x04034b50;
const ZIP_METHOD_STORE = 0;
const ZIP_METHOD_DEFLATE = 8;
const MAX_MANIFEST_BYTES = 32 * 1024 * 1024;
const PACKAGE_PATTERN = /^[A-Za-z0-9_]+(?:\.[A-Za-z0-9_]+)+$/;

interface ZipEntryInfo {
  method: number;
  compressedSize: number;
  localHeaderOffset: number;
}

async function readBytes(
  handle: import("node:fs/promises").FileHandle,
  position: number,
  length: number
): Promise<Buffer> {
  const buffer = Buffer.alloc(length);
  let read = 0;
  while (read < length) {
    const { bytesRead } = await handle.read(
      buffer,
      read,
      length - read,
      position + read
    );
    if (bytesRead === 0) throw new Error("APK 文件意外结束");
    read += bytesRead;
  }
  return buffer;
}

/** 在完整 zip 字节里按名查找条目（非 ZIP64）。供单测直接构造 zip 验证。 */
export function findZipEntry(
  centralDirectory: Buffer,
  entryCount: number,
  entryName: string
): ZipEntryInfo | undefined {
  let offset = 0;
  for (let i = 0; i < entryCount; i++) {
    if (offset + 46 > centralDirectory.length) return undefined;
    if (centralDirectory.readUInt32LE(offset) !== CENTRAL_SIGNATURE) {
      return undefined;
    }
    const method = centralDirectory.readUInt16LE(offset + 10);
    const compressedSize = centralDirectory.readUInt32LE(offset + 20);
    const nameLength = centralDirectory.readUInt16LE(offset + 28);
    const extraLength = centralDirectory.readUInt16LE(offset + 30);
    const commentLength = centralDirectory.readUInt16LE(offset + 32);
    const localHeaderOffset = centralDirectory.readUInt32LE(offset + 42);
    const nameStart = offset + 46;
    const name = centralDirectory.toString(
      "utf8",
      nameStart,
      nameStart + nameLength
    );
    if (name === entryName) {
      return { method, compressedSize, localHeaderOffset };
    }
    offset = nameStart + nameLength + extraLength + commentLength;
  }
  return undefined;
}

/** 读取 zip 条目数据。供单测直接构造 zip 验证。 */
export function readZipEntryData(
  handle: import("node:fs/promises").FileHandle,
  entry: ZipEntryInfo
): Promise<Buffer | undefined> {
  return (async () => {
    if (
      entry.compressedSize === 0 ||
      entry.compressedSize > MAX_MANIFEST_BYTES
    ) {
      return undefined;
    }
    const localHeader = await readBytes(handle, entry.localHeaderOffset, 30);
    if (localHeader.readUInt32LE(0) !== LOCAL_SIGNATURE) return undefined;
    const nameLength = localHeader.readUInt16LE(26);
    const extraLength = localHeader.readUInt16LE(28);
    const dataStart =
      entry.localHeaderOffset + 30 + nameLength + extraLength;
    const stored = await readBytes(handle, dataStart, entry.compressedSize);
    if (entry.method === ZIP_METHOD_STORE) return stored;
    if (entry.method === ZIP_METHOD_DEFLATE) {
      return inflateRawSync(stored);
    }
    return undefined;
  })();
}

function decodeString(
  buffer: Buffer,
  position: number,
  utf8: boolean
): string {
  if (position < 0 || position >= buffer.length) return "";
  try {
    if (utf8) {
      let cursor = position;
      let first = buffer.readUInt8(cursor);
      cursor += 1;
      if (first & 0x80) {
        first = ((first & 0x7f) << 8) | buffer.readUInt8(cursor);
        cursor += 1;
      }
      let second = buffer.readUInt8(cursor);
      cursor += 1;
      if (second & 0x80) {
        second = ((second & 0x7f) << 8) | buffer.readUInt8(cursor);
        cursor += 1;
      }
      return buffer.toString("utf8", cursor, Math.min(cursor + second, buffer.length));
    }
    let length = buffer.readUInt16LE(position);
    let cursor = position + 2;
    if (length & 0x8000) {
      length = ((length & 0x7fff) << 16) | buffer.readUInt16LE(cursor);
      cursor += 2;
    }
    return buffer.toString(
      "utf16le",
      cursor,
      Math.min(cursor + length * 2, buffer.length)
    );
  } catch {
    return "";
  }
}

function readStringPool(buffer: Buffer, start: number): string[] | undefined {
  const headerSize = buffer.readUInt16LE(start + 2);
  const stringCount = buffer.readUInt32LE(start + 8);
  const flags = buffer.readUInt32LE(start + 16);
  const stringsStart = buffer.readUInt32LE(start + 20);
  const utf8 = (flags & 0x100) !== 0;
  if (stringCount === 0 || stringCount > 100_000) return undefined;
  const offsetsStart = start + headerSize;
  const strings: string[] = [];
  for (let i = 0; i < stringCount; i++) {
    const offsetField = offsetsStart + i * 4;
    if (offsetField + 4 > buffer.length) return undefined;
    const offset = buffer.readUInt32LE(offsetField);
    strings.push(decodeString(buffer, start + stringsStart + offset, utf8));
  }
  return strings;
}

function validPackageName(value: string): string | undefined {
  const trimmed = value.trim();
  return PACKAGE_PATTERN.test(trimmed) ? trimmed : undefined;
}

/**
 * 解析二进制 AndroidManifest.xml，返回 package 属性值。
 * 供单测直接构造 AXML 字节验证。
 */
export function parseManifestPackage(manifest: Buffer): string | undefined {
  if (manifest.length < 8 || manifest.readUInt16LE(0) !== 0x0003) {
    return undefined;
  }
  let pool: string[] | undefined;
  let offset = manifest.readUInt16LE(2);
  while (offset + 8 <= manifest.length) {
    const chunkType = manifest.readUInt16LE(offset);
    const chunkSize = manifest.readUInt32LE(offset + 4);
    if (chunkSize < 8 || offset + chunkSize > manifest.length) break;
    if (chunkType === 0x0001) {
      pool = readStringPool(manifest, offset);
    } else if (chunkType === 0x0102 && pool) {
      // Start Element：找到第一个 <manifest> 元素即停止
      const nameIndex = manifest.readUInt32LE(offset + 20);
      if (pool[nameIndex] !== "manifest") {
        offset += chunkSize;
        continue;
      }
      const attributeStart = manifest.readUInt16LE(offset + 24);
      const attributeSize = manifest.readUInt16LE(offset + 26);
      const attributeCount = manifest.readUInt16LE(offset + 28);
      if (attributeSize < 20) return undefined;
      // attributeStart 相对 attrExt 结构（chunk+16），真实文件为 20
      const attributesOffset = offset + 16 + attributeStart;
      for (let i = 0; i < attributeCount; i++) {
        const attribute =
          attributesOffset + i * attributeSize;
        if (attribute + 20 > manifest.length) break;
        const attributeName = pool[manifest.readUInt32LE(attribute + 4)];
        if (attributeName !== "package") continue;
        const rawValue = manifest.readUInt32LE(attribute + 8);
        if (rawValue !== 0xffffffff) {
          const value = validPackageName(pool[rawValue] ?? "");
          if (value) return value;
        }
        const dataType = manifest.readUInt8(attribute + 15);
        const data = manifest.readUInt32LE(attribute + 16);
        if (dataType === 0x03) {
          const value = validPackageName(pool[data] ?? "");
          if (value) return value;
        }
      }
      return undefined;
    }
    offset += chunkSize;
  }
  return undefined;
}

export async function readApkPackageName(
  apkPath: string
): Promise<string | undefined> {
  const handle = await open(apkPath, "r");
  try {
    const { size } = await handle.stat();
    const tailLength = Math.min(size, 0xffff + 22);
    const tail = await readBytes(handle, size - tailLength, tailLength);
    for (let i = tail.length - 22; i >= 0; i--) {
      if (tail.readUInt32LE(i) !== EOCD_SIGNATURE) continue;
      const entryCount = tail.readUInt16LE(i + 10);
      const directorySize = tail.readUInt32LE(i + 12);
      const directoryOffset = tail.readUInt32LE(i + 16);
      if (directoryOffset === 0xffffffff) return undefined; // ZIP64 不支持
      const centralDirectory = await readBytes(
        handle,
        directoryOffset,
        directorySize
      );
      const entry = findZipEntry(centralDirectory, entryCount, MANIFEST_ENTRY);
      if (!entry) return undefined;
      const manifest = await readZipEntryData(handle, entry);
      return manifest ? parseManifestPackage(manifest) : undefined;
    }
    return undefined;
  } finally {
    await handle.close();
  }
}
