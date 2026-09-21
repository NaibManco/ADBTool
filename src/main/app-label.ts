import { readStringPool } from "./apk-manifest";

/**
 * 应用显示名（label）离线解析：
 * - AndroidManifest.xml 的 <application android:label> 是字面量时直接得到名称；
 * - 多数应用是资源引用（如 0x7f1103d8），需要再解析 APK 内的 resources.arsc
 *   才能拿到默认 config 下的字符串（等价 aapt dump badging 的 application-label）。
 * 任何格式不符都返回 undefined，调用方降级为只显示包名。
 */

/** AXML 起始元素 <application android:label>：字面量 → label，资源引用 → labelRes。 */
export function parseManifestAppLabel(
  manifest: Buffer
): { label?: string; labelRes?: number } {
  if (manifest.length < 8 || manifest.readUInt16LE(0) !== 0x0003) return {};
  let pool: string[] | undefined;
  let offset = manifest.readUInt16LE(2);
  while (offset + 8 <= manifest.length) {
    const chunkType = manifest.readUInt16LE(offset);
    const chunkSize = manifest.readUInt32LE(offset + 4);
    if (chunkSize < 8 || offset + chunkSize > manifest.length) break;
    if (chunkType === 0x0001) {
      pool = readStringPool(manifest, offset);
    } else if (chunkType === 0x0102 && pool) {
      if (pool[manifest.readUInt32LE(offset + 20)] !== "application") {
        offset += chunkSize;
        continue;
      }
      const attributeStart = manifest.readUInt16LE(offset + 24);
      const attributeSize = manifest.readUInt16LE(offset + 26);
      const attributeCount = manifest.readUInt16LE(offset + 28);
      if (attributeSize < 20) return {};
      const attributesOffset = offset + 16 + attributeStart;
      for (let i = 0; i < attributeCount; i++) {
        const attribute = attributesOffset + i * attributeSize;
        if (attribute + 20 > manifest.length) break;
        if (pool[manifest.readUInt32LE(attribute + 4)] !== "label") continue;
        const dataType = manifest.readUInt8(attribute + 15);
        const data = manifest.readUInt32LE(attribute + 16);
        if (dataType === 0x03 && pool[data] !== undefined) {
          return { label: pool[data] };
        }
        if (dataType === 0x01) return { labelRes: data };
        return {};
      }
      return {};
    }
    offset += chunkSize;
  }
  return {};
}

/**
 * resources.arsc：把资源 ID 解析为默认 config 下的字符串。
 * 结构：RES_TABLE(0x0002) → 全局字符串池(0x0001) + Package(0x0200) →
 * TYPE(0x0201) 块（按 typeId 匹配，同一 typeId 可有多个 config，取第一个
 * 解析出字符串的——aapt2 先写默认 config）。支持 dense 与 sparse 偏移表。
 */
export function resolveArscString(
  arsc: Buffer,
  resourceId: number
): string | undefined {
  if (arsc.length < 8 || arsc.readUInt16LE(0) !== 0x0002) return undefined;
  const packageId = resourceId >>> 24;
  const typeId = (resourceId >>> 16) & 0xff;
  const entryId = resourceId & 0xffff;
  let globalPool: string[] | undefined;
  let offset = arsc.readUInt16LE(2);
  while (offset + 8 <= arsc.length) {
    const chunkType = arsc.readUInt16LE(offset);
    const chunkSize = arsc.readUInt32LE(offset + 4);
    if (chunkSize < 8 || offset + chunkSize > arsc.length) break;
    if (chunkType === 0x0001 && !globalPool) {
      globalPool = readStringPool(arsc, offset);
    } else if (chunkType === 0x0200 && globalPool) {
      if (arsc.readUInt32LE(offset + 8) !== packageId) {
        offset += chunkSize;
        continue;
      }
      const value = resolvePackageEntry(
        arsc,
        offset + arsc.readUInt16LE(offset + 2),
        offset + chunkSize,
        typeId,
        entryId,
        globalPool
      );
      if (value !== undefined) return value;
    }
    offset += chunkSize;
  }
  return undefined;
}

function resolvePackageEntry(
  arsc: Buffer,
  inner: number,
  innerEnd: number,
  typeId: number,
  entryId: number,
  globalPool: string[]
): string | undefined {
  while (inner + 8 <= innerEnd) {
    const innerType = arsc.readUInt16LE(inner);
    const innerSize = arsc.readUInt32LE(inner + 4);
    if (innerSize < 8 || inner + innerSize > innerEnd) break;
    if (innerType === 0x0201 && arsc.readUInt8(inner + 8) === typeId) {
      const flags = arsc.readUInt8(inner + 9);
      const entriesCount = arsc.readUInt32LE(inner + 12);
      const entriesStart = arsc.readUInt32LE(inner + 16);
      const offsetsTable = inner + arsc.readUInt16LE(inner + 2);
      let entryOffset: number | undefined;
      if (flags & 0x01) {
        // SPARSE：高 16 位 = entry 索引，低 16 位 = 偏移
        for (let i = 0; i < entriesCount; i++) {
          if (offsetsTable + i * 4 + 4 > arsc.length) break;
          const pair = arsc.readUInt32LE(offsetsTable + i * 4);
          if ((pair >>> 16) === entryId) {
            entryOffset = pair & 0xffff;
            break;
          }
        }
      } else if (entryId < entriesCount) {
        entryOffset = arsc.readUInt32LE(offsetsTable + entryId * 4);
      }
      const value = readEntryValue(arsc, inner, entriesStart, entryOffset);
      if (value !== undefined && globalPool[value] !== undefined) {
        return globalPool[value];
      }
    }
    inner += innerSize;
  }
  return undefined;
}

function readEntryValue(
  arsc: Buffer,
  inner: number,
  entriesStart: number,
  entryOffset: number | undefined
): number | undefined {
  if (entryOffset === undefined || entryOffset === 0xffffffff) return undefined;
  const entry = inner + entriesStart + entryOffset;
  if (entry + 8 > arsc.length) return undefined;
  const entrySize = arsc.readUInt16LE(entry);
  if (arsc.readUInt16LE(entry + 2) & 0x0001) return undefined; // complex 条目
  const value = entry + entrySize;
  if (value + 8 > arsc.length) return undefined;
  if (arsc.readUInt8(value + 3) !== 0x03) return undefined; // 非 STRING
  return arsc.readUInt32LE(value + 4);
}
