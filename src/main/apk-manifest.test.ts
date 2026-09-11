import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { deflateRawSync } from "node:zlib";
import {
  findZipEntry,
  parseManifestPackage,
  readApkPackageName
} from "./apk-manifest";

/** 构造最小二进制 AXML：字符串池 + <manifest package="..."> 起始元素。 */
function buildAxml(
  packageName: string,
  options?: { utf8?: boolean; omitRawValue?: boolean }
): Buffer {
  const strings = ["manifest", "package", packageName];
  const utf8 = options?.utf8 ?? false;

  const encoded = strings.map((value) => {
    if (utf8) {
      const bytes = Buffer.from(value, "utf8");
      return Buffer.concat([
        Buffer.from([value.length, bytes.length]),
        bytes,
        Buffer.from([0])
      ]);
    }
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
  pool.writeUInt32LE(utf8 ? 0x100 : 0, 16);
  pool.writeUInt32LE(stringsStart, 20);
  pool.writeUInt32LE(0, 24);
  let cursor = stringsStart;
  for (let index = 0; index < encoded.length; index++) {
    pool.writeUInt32LE(cursor - stringsStart, offsetsStart + index * 4);
    encoded[index].copy(pool, cursor);
    cursor += encoded[index].length;
  }

  const rawValue = options?.omitRawValue ? 0xffffffff : 2;
  const attributeCount = 1;
  const elementSize = 36 + attributeCount * 20;
  const element = Buffer.alloc(elementSize);
  element.writeUInt16LE(0x0102, 0);
  element.writeUInt16LE(16, 2);
  element.writeUInt32LE(elementSize, 4);
  element.writeUInt32LE(1, 8); // lineNumber
  element.writeUInt32LE(0xffffffff, 12); // comment
  element.writeUInt32LE(0xffffffff, 16); // ns
  element.writeUInt32LE(0, 20); // name -> "manifest"
  // attributeStart 相对 attrExt 结构（chunk+16），与真实 aapt2 产物一致为 20
  element.writeUInt16LE(20, 24);
  element.writeUInt16LE(20, 26); // attributeSize
  element.writeUInt16LE(attributeCount, 28);
  element.writeUInt32LE(0xffffffff, 36); // attr ns
  element.writeUInt32LE(1, 40); // attr name -> "package"
  element.writeUInt32LE(rawValue, 44);
  element.writeUInt16LE(8, 48); // typedValue size
  element.writeUInt8(0, 50);
  element.writeUInt8(0x03, 51); // dataType STRING
  element.writeUInt32LE(2, 52); // data -> package name index

  const header = Buffer.alloc(8);
  header.writeUInt16LE(0x0003, 0);
  header.writeUInt16LE(8, 2);
  header.writeUInt32LE(8 + poolSize + elementSize, 4);
  return Buffer.concat([header, pool, element]);
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

/** 构造单条目的最小 zip（默认 STORED，可选 DEFLATE）。 */
function buildZip(
  name: string,
  data: Buffer,
  options?: { deflate?: boolean }
): Buffer {
  const nameBuffer = Buffer.from(name, "utf8");
  const stored = options?.deflate
    ? deflateRawSync(data)
    : data;
  const method = options?.deflate ? 8 : 0;
  const localOffset = 0;

  const localHeader = Buffer.concat([
    u32(0x04034b50),
    u16(20),
    u16(0),
    u16(method),
    u16(0),
    u16(0),
    u32(0),
    u32(stored.length),
    u32(data.length),
    u16(nameBuffer.length),
    u16(0)
  ]);
  const local = Buffer.concat([localHeader, nameBuffer, stored]);
  const centralHeader = Buffer.concat([
    u32(0x02014b50),
    u16(20),
    u16(20),
    u16(0),
    u16(method),
    u16(0),
    u16(0),
    u32(0),
    u32(stored.length),
    u32(data.length),
    u16(nameBuffer.length),
    u16(0),
    u16(0),
    u16(0),
    u16(0),
    u32(0),
    u32(localOffset)
  ]);
  const central = Buffer.concat([centralHeader, nameBuffer]);
  const eocd = Buffer.concat([
    u32(0x06054b50),
    u16(0),
    u16(0),
    u16(1),
    u16(1),
    u32(central.length),
    u32(local.length),
    u16(0)
  ]);
  return Buffer.concat([local, central, eocd]);
}

describe("parseManifestPackage", () => {
  it("reads the package attribute from a UTF-16 string pool", () => {
    expect(parseManifestPackage(buildAxml("com.example.alpha"))).toBe(
      "com.example.alpha"
    );
  });

  it("reads the package attribute from a UTF-8 string pool", () => {
    expect(
      parseManifestPackage(buildAxml("com.example.beta", { utf8: true }))
    ).toBe("com.example.beta");
  });

  it("falls back to the typed value when rawValue is absent", () => {
    expect(
      parseManifestPackage(buildAxml("com.example.gamma", { omitRawValue: true }))
    ).toBe("com.example.gamma");
  });

  it("returns undefined for garbage input", () => {
    expect(parseManifestPackage(Buffer.from([0, 0, 0, 0]))).toBeUndefined();
    expect(parseManifestPackage(Buffer.alloc(64, 0xff))).toBeUndefined();
  });
});

describe("readApkPackageName", () => {
  const tempDir = mkdtempSync(path.join(tmpdir(), "apk-manifest-test-"));
  afterAll(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  async function writeApk(
    zip: Buffer,
    fileName = "app.apk"
  ): Promise<string> {
    const filePath = path.join(tempDir, fileName);
    writeFileSync(filePath, zip);
    return filePath;
  }

  it("finds the manifest entry in a stored zip", async () => {
    const apkPath = await writeApk(
      buildZip("AndroidManifest.xml", buildAxml("com.example.alpha"))
    );
    expect(await readApkPackageName(apkPath)).toBe("com.example.alpha");
  });

  it("finds the manifest entry in a deflated zip", async () => {
    const apkPath = await writeApk(
      buildZip("AndroidManifest.xml", buildAxml("com.example.delta"), {
        deflate: true
      })
    );
    expect(await readApkPackageName(apkPath)).toBe("com.example.delta");
  });

  it("returns undefined when the zip has no manifest entry", async () => {
    const apkPath = await writeApk(
      buildZip("classes.dex", Buffer.from("dex"))
    );
    expect(await readApkPackageName(apkPath)).toBeUndefined();
  });

  it("finds the entry via the central directory helper", () => {
    const zip = buildZip("AndroidManifest.xml", buildAxml("com.example.eps"));
    const centralOffset = zip.length - 22 - 46 - "AndroidManifest.xml".length;
    const central = zip.subarray(centralOffset);
    const entry = findZipEntry(central, 1, "AndroidManifest.xml");
    expect(entry?.method).toBe(0);
    expect(entry?.localHeaderOffset).toBe(0);
    expect(findZipEntry(central, 1, "missing.txt")).toBeUndefined();
  });
});
