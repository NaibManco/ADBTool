import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { findGeneratedBugreport } from "./bugreport-files";

const temporaryDirectories: string[] = [];

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

describe("findGeneratedBugreport", () => {
  it("returns the non-empty ZIP generated in the isolated directory", () => {
    const directory = mkdtempSync(path.join(tmpdir(), "bugreport-test-"));
    temporaryDirectories.push(directory);
    writeFileSync(path.join(directory, "progress.txt"), "done");
    writeFileSync(path.join(directory, "bugreport-device.zip"), "zip-bytes");

    expect(findGeneratedBugreport(directory)).toBe(
      path.join(directory, "bugreport-device.zip")
    );
  });

  it("rejects a completed command that did not create a usable ZIP", () => {
    const directory = mkdtempSync(path.join(tmpdir(), "bugreport-test-"));
    temporaryDirectories.push(directory);
    writeFileSync(path.join(directory, "bugreport-empty.zip"), "");

    expect(() => findGeneratedBugreport(directory)).toThrow("没有生成有效的 ZIP");
  });
});
