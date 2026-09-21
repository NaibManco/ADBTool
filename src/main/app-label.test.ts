import { describe, expect, it } from "vitest";
import { parseManifestAppLabel, resolveArscString } from "./app-label";

/** 构造最小二进制 AXML：字符串池 + <manifest> + <application android:label>。 */
function buildManifestWithLabel(
  label: { literal: string } | { reference: number } | undefined
): Buffer {
  const strings = ["manifest", "application", "label", "示例应用"];
  const encoded = strings.map((value) => {
    const bytes = Buffer.from(value, "utf16le");
    const header = Buffer.alloc(2);
    header.writeUInt16LE(value.length, 0);
    const terminator = Buffer.alloc(2);
    return Buffer.concat([header, bytes, terminator]);
  });
  const stringData = Buffer.concat(encoded);
  const offsetsStart = 28;
  const stringsStart = offsetsStart + strings.length * 4;
  const poolSize = stringsStart + stringData.length;
  const pool = Buffer.alloc(poolSize);
  pool.writeUInt16LE(0x0001, 0);
  pool.writeUInt16LE(28, 2);
  pool.writeUInt32LE(poolSize, 4);
  pool.writeUInt32LE(strings.length, 8);
  pool.writeUInt32LE(0, 12);
  pool.writeUInt32LE(0, 16); // UTF-16
  pool.writeUInt32LE(stringsStart, 20);
  pool.writeUInt32LE(0, 24);
  let cursor = stringsStart;
  for (let index = 0; index < encoded.length; index++) {
    pool.writeUInt32LE(cursor - stringsStart, offsetsStart + index * 4);
    encoded[index].copy(pool, cursor);
    cursor += encoded[index].length;
  }

  function startElement(
    nameIndex: number,
    attributes: { nameIndex: number; dataType: number; data: number }[]
  ): Buffer {
    const elementSize = 36 + attributes.length * 20;
    const element = Buffer.alloc(elementSize);
    element.writeUInt16LE(0x0102, 0);
    element.writeUInt16LE(16, 2);
    element.writeUInt32LE(elementSize, 4);
    element.writeUInt32LE(1, 8);
    element.writeUInt32LE(0xffffffff, 12);
    element.writeUInt32LE(0xffffffff, 16);
    element.writeUInt32LE(nameIndex, 20);
    element.writeUInt16LE(20, 24);
    element.writeUInt16LE(20, 26);
    element.writeUInt16LE(attributes.length, 28);
    attributes.forEach((attribute, i) => {
      const base = 36 + i * 20;
      element.writeUInt32LE(0xffffffff, base); // ns
      element.writeUInt32LE(attribute.nameIndex, base + 4);
      element.writeUInt32LE(0xffffffff, base + 8); // rawValue
      element.writeUInt16LE(8, base + 12);
      element.writeUInt8(0, base + 14);
      element.writeUInt8(attribute.dataType, base + 15);
      element.writeUInt32LE(attribute.data, base + 16);
    });
    return element;
  }

  const manifestElement = startElement(0, []);
  const labelAttribute =
    label === undefined
      ? []
      : [
          {
            nameIndex: 2,
            dataType: "literal" in label ? 0x03 : 0x01,
            data: "literal" in label ? 3 : label.reference
          }
        ];
  const applicationElement = startElement(1, labelAttribute);

  const header = Buffer.alloc(8);
  header.writeUInt16LE(0x0003, 0);
  header.writeUInt16LE(8, 2);
  header.writeUInt32LE(8 + poolSize + manifestElement.length + applicationElement.length, 4);
  return Buffer.concat([header, pool, manifestElement, applicationElement]);
}

function u16(value: number): Buffer {
  const buffer = Buffer.alloc(2);
  buffer.writeUInt16LE(value, 0);
  return buffer;
}

function u32(value: number): Buffer {
  const buffer = Buffer.alloc(4);
  buffer.writeUInt32LE(value >>> 0, 0);
  return buffer;
}

/** 构造最小 resources.arsc：表头 + 全局字符串池 + 单 Package 单 TYPE 块。 */
function buildArsc(
  options?: { sparse?: boolean; emptyEntry?: boolean; poolStringCount?: number }
): Buffer {
  // 全局字符串池：["示例应用"]；poolStringCount 可虚报条数（大应用 arsc 池
  // 超 10 万条的真实形态，锁 readStringPool 上限回归）
  const declaredCount = options?.poolStringCount ?? 1;
  const value = "示例应用";
  const bytes = Buffer.from(value, "utf16le");
  const encoded = Buffer.concat([
    (() => {
      const b = Buffer.alloc(2);
      b.writeUInt16LE(value.length, 0);
      return b;
    })(),
    bytes,
    Buffer.alloc(2)
  ]);
  const offsetsStart = 28;
  const stringsStart = offsetsStart + declaredCount * 4;
  const poolSize = stringsStart + encoded.length;
  const pool = Buffer.alloc(poolSize);
  pool.writeUInt16LE(0x0001, 0);
  pool.writeUInt16LE(28, 2);
  pool.writeUInt32LE(poolSize, 4);
  pool.writeUInt32LE(declaredCount, 8);
  pool.writeUInt32LE(0, 12);
  pool.writeUInt32LE(0, 16);
  pool.writeUInt32LE(stringsStart, 20);
  pool.writeUInt32LE(0, 24);
  pool.writeUInt32LE(0, offsetsStart);
  encoded.copy(pool, stringsStart);

  // TYPE 块（0x0201）：typeId=1，dense 偏移表 + 单条目 STRING 值
  const headerSize = 20 + 8; // 20 字节固定头 + 最小 config（size=8）
  const offsets = options?.sparse
    ? [u32((1 << 16) | 0)] // 高 16 位 entryId=1，低 16 位偏移 0
    : [u32(0), u32(0)];
  const entryOffsetCount = options?.sparse ? 1 : 2; // dense 表按 entryId 索引
  const entry = Buffer.alloc(8);
  entry.writeUInt16LE(8, 0); // entrySize
  entry.writeUInt16LE(0, 2); // flags：非 complex
  entry.writeUInt32LE(0, 4); // keyString index
  const typedValue = Buffer.alloc(8);
  typedValue.writeUInt16LE(8, 0);
  typedValue.writeUInt8(0, 2);
  typedValue.writeUInt8(0x03, 3); // STRING
  typedValue.writeUInt32LE(0, 4); // 全局池索引 0
  const entriesStart = headerSize + entryOffsetCount * 4;
  const entryData = options?.emptyEntry ? Buffer.alloc(0) : Buffer.concat([entry, typedValue]);
  const typeChunkSize = entriesStart + entryData.length;
  const typeChunk = Buffer.alloc(typeChunkSize);
  typeChunk.writeUInt16LE(0x0201, 0);
  typeChunk.writeUInt16LE(headerSize, 2);
  typeChunk.writeUInt32LE(typeChunkSize, 4);
  typeChunk.writeUInt8(1, 8); // typeId=1
  typeChunk.writeUInt8(options?.sparse ? 0x01 : 0x00, 9); // FLAG_SPARSE
  typeChunk.writeUInt32LE(entryOffsetCount, 12);
  typeChunk.writeUInt32LE(entriesStart, 16);
  typeChunk.writeUInt32LE(8, 20); // config.size
  let cursor = headerSize;
  for (const offset of offsets) {
    offset.copy(typeChunk, cursor);
    cursor += 4;
  }
  entryData.copy(typeChunk, cursor);

  // Package 块（0x0200）：id=0x7f，headerSize 288（与 aapt2 一致）
  const packageHeaderSize = 288;
  const packageChunk = Buffer.alloc(packageHeaderSize + typeChunkSize);
  packageChunk.writeUInt16LE(0x0200, 0);
  packageChunk.writeUInt16LE(packageHeaderSize, 2);
  packageChunk.writeUInt32LE(packageChunk.length, 4);
  packageChunk.writeUInt32LE(0x7f, 8);
  typeChunk.copy(packageChunk, packageHeaderSize);

  const tableSize = 12 + poolSize + packageChunk.length;
  const table = Buffer.alloc(tableSize);
  table.writeUInt16LE(0x0002, 0);
  table.writeUInt16LE(12, 2);
  table.writeUInt32LE(tableSize, 4);
  table.writeUInt32LE(1, 8); // packageCount
  pool.copy(table, 12);
  packageChunk.copy(table, 12 + poolSize);
  return table;
}

describe("parseManifestAppLabel", () => {
  it("reads a literal application label", () => {
    expect(
      parseManifestAppLabel(buildManifestWithLabel({ literal: "示例应用" }))
    ).toEqual({ label: "示例应用" });
  });

  it("returns the resource reference when the label is @string", () => {
    expect(
      parseManifestAppLabel(buildManifestWithLabel({ reference: 0x7f010001 }))
    ).toEqual({ labelRes: 0x7f010001 });
  });

  it("returns empty when the application element has no label", () => {
    expect(parseManifestAppLabel(buildManifestWithLabel(undefined))).toEqual({});
  });

  it("returns empty for garbage input", () => {
    expect(parseManifestAppLabel(Buffer.from([0, 0, 0, 0]))).toEqual({});
    expect(parseManifestAppLabel(Buffer.alloc(64, 0xff))).toEqual({});
  });
});

describe("resolveArscString", () => {
  it("resolves a resource id through a dense offsets table", () => {
    expect(resolveArscString(buildArsc(), 0x7f010001)).toBe("示例应用");
  });

  it("resolves a resource id through a sparse offsets table", () => {
    expect(resolveArscString(buildArsc({ sparse: true }), 0x7f010001)).toBe(
      "示例应用"
    );
  });

  it("resolves when the global string pool holds 100k+ strings", () => {
    // Edge/MX 播放器等大型应用的 resources.arsc 全局池超过 10 万条
    expect(
      resolveArscString(buildArsc({ poolStringCount: 150_000 }), 0x7f010001)
    ).toBe("示例应用");
  });

  it("returns undefined when the entry has no value", () => {
    expect(resolveArscString(buildArsc({ emptyEntry: true }), 0x7f010001)).toBeUndefined();
  });

  it("returns undefined for a foreign package or entry", () => {
    const arsc = buildArsc();
    expect(resolveArscString(arsc, 0x10010001)).toBeUndefined();
    expect(resolveArscString(arsc, 0x7f020001)).toBeUndefined();
  });

  it("returns undefined for garbage input", () => {
    expect(resolveArscString(Buffer.from([0, 0, 0, 0]), 0x7f010001)).toBeUndefined();
  });
});
