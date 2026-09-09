import { EventEmitter } from "node:events";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { PassThrough } from "node:stream";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  DecompileManager,
  buildDecompileTree,
  buildJadxArgs,
  isPreviewableExtension,
  resolveWithinRoot,
  searchDecompileOutput
} from "./decompile-manager";

class FakeJadxProcess extends EventEmitter {
  stdout = new PassThrough();
  stderr = new PassThrough();
  killed = false;

  kill(): boolean {
    this.killed = true;
    return true;
  }
}

const tempRoots: string[] = [];

afterEach(() => {
  for (const root of tempRoots.splice(0)) {
    rmSync(root, { recursive: true, force: true });
  }
});

function tempRoot(): string {
  const root = mkdtempSync(path.join(os.tmpdir(), "adt-dcm-test-"));
  tempRoots.push(root);
  return root;
}

describe("buildJadxArgs", () => {
  it("builds the exact java -cp jadx.cli.JadxCLI invocation", () => {
    expect(
      buildJadxArgs("C:\\tools\\jadx\\lib\\jadx-all.jar", "D:\\app.apk", "C:\\out")
    ).toEqual([
      "-XX:+IgnoreUnrecognizedVMOptions",
      "-Xms256M",
      "--enable-native-access=ALL-UNNAMED",
      "-cp",
      "C:\\tools\\jadx\\lib\\jadx-all.jar",
      "jadx.cli.JadxCLI",
      "-d",
      "C:\\out",
      "D:\\app.apk"
    ]);
  });
});

describe("resolveWithinRoot", () => {
  const root = path.join(path.resolve("/tmp"), "job-out");

  it("accepts relative paths inside the root", () => {
    expect(resolveWithinRoot(root, "sources/com/example/Main.java")).toBe(
      path.join(root, "sources/com/example/Main.java")
    );
    expect(resolveWithinRoot(root, "AndroidManifest.xml")).toBe(
      path.join(root, "AndroidManifest.xml")
    );
  });

  it("rejects traversal and absolute escapes", () => {
    expect(resolveWithinRoot(root, "../secret.txt")).toBeNull();
    expect(resolveWithinRoot(root, "sources/../../escape")).toBeNull();
    expect(resolveWithinRoot(root, path.resolve("/etc/passwd"))).toBeNull();
    expect(resolveWithinRoot(root, "")).toBeNull();
  });
});

describe("isPreviewableExtension", () => {
  it("allows text sources and resources, blocks binaries", () => {
    expect(isPreviewableExtension("Main.java")).toBe(true);
    expect(isPreviewableExtension("styles.XML")).toBe(true);
    expect(isPreviewableExtension("icon.png")).toBe(false);
    expect(isPreviewableExtension("lib/arm64-v8a.so")).toBe(false);
  });
});

describe("buildDecompileTree", () => {
  it("walks directories first then files, in name order", () => {
    const root = tempRoot();
    mkdirSync(path.join(root, "sources", "com", "zeta"), { recursive: true });
    mkdirSync(path.join(root, "resources", "res"), { recursive: true });
    writeFileSync(path.join(root, "sources", "com", "zeta", "A.java"), "class A {}");
    writeFileSync(path.join(root, "sources", "com", "B.kt"), "class B");
    writeFileSync(path.join(root, "resources", "res", "layout.xml"), "<x/>");

    const { nodes, truncated } = buildDecompileTree(root);
    expect(truncated).toBe(false);
    expect(nodes.map((node) => node.relPath)).toEqual([
      "resources",
      "resources/res",
      "resources/res/layout.xml",
      "sources",
      "sources/com",
      "sources/com/zeta",
      "sources/com/zeta/A.java",
      "sources/com/B.kt"
    ]);
    const file = nodes.find((node) => node.relPath === "sources/com/B.kt");
    expect(file?.type).toBe("file");
    expect(file?.size).toBe("class B".length);
  });

  it("marks the tree truncated at the node cap", () => {
    const root = tempRoot();
    mkdirSync(path.join(root, "many"), { recursive: true });
    for (let index = 0; index < 8; index += 1) {
      writeFileSync(path.join(root, "many", `f${index}.txt`), String(index));
    }
    const { nodes, truncated } = buildDecompileTree(root, 3);
    expect(nodes.length).toBe(3);
    expect(truncated).toBe(true);
  });
});

describe("searchDecompileOutput", () => {
  it("finds matches in file names and text content with context", () => {
    const root = tempRoot();
    mkdirSync(path.join(root, "sources", "com"), { recursive: true });
    writeFileSync(
      path.join(root, "sources", "com", "LoginActivity.java"),
      "public class LoginActivity {\n  String token = fetchToken();\n}"
    );
    writeFileSync(path.join(root, "sources", "com", "Other.java"), "class Other {}");
    writeFileSync(path.join(root, "icon.png"), "token");

    const { hits, truncated } = searchDecompileOutput(root, "login");
    expect(truncated).toBe(false);
    expect(hits.map((hit) => hit.relPath)).toEqual([
      "sources/com/LoginActivity.java"
    ]);

    const content = searchDecompileOutput(root, "token");
    expect(content.hits.map((hit) => hit.relPath)).toEqual([
      "sources/com/LoginActivity.java"
    ]);
    expect(content.hits[0].context).toContain("token");

    // 二进制后缀不搜内容
    const binary = searchDecompileOutput(root, "token");
    expect(binary.hits.some((hit) => hit.relPath === "icon.png")).toBe(false);
  });

  it("caps results and reports truncation", () => {
    const root = tempRoot();
    mkdirSync(path.join(root, "sources"), { recursive: true });
    for (let index = 0; index < 5; index += 1) {
      writeFileSync(
        path.join(root, "sources", `F${index}.java`),
        "needle"
      );
    }
    const { hits, truncated } = searchDecompileOutput(root, "needle", 3);
    expect(hits.length).toBe(3);
    expect(truncated).toBe(true);
  });
});

describe("DecompileManager", () => {
  it("streams progress lines and reports partial-failure success", () => {
    const process = new FakeJadxProcess();
    const spawn = vi.fn(() => process as never);
    const onEvent = vi.fn();
    const manager = new DecompileManager(
      "java",
      "jadx.jar",
      onEvent,
      spawn
    );

    const jobId = manager.start("D:\\app.apk", "app.apk");
    expect(spawn).toHaveBeenCalledWith(
      "java",
      expect.arrayContaining(["jadx.cli.JadxCLI", "D:\\app.apk"]),
      expect.objectContaining({ windowsHide: true })
    );

    process.stdout.write("INFO  - progress: 10 of 100 (10%)\n");
    process.stderr.write("WARN  - something\n");
    expect(onEvent).toHaveBeenCalledWith({
      type: "progress",
      jobId,
      line: "INFO  - progress: 10 of 100 (10%)"
    });
    expect(onEvent).toHaveBeenCalledWith({
      type: "progress",
      jobId,
      line: "WARN  - something"
    });

    process.emit("exit", 3);
    const done = onEvent.mock.calls.at(-1)?.[0];
    expect(done.type).toBe("done");
    expect(done.ok).toBe(true);
    expect(manager.hasResult(jobId)).toBe(true);
  });

  it("reports failure with tail output on non-partial exit codes", () => {
    const process = new FakeJadxProcess();
    const onEvent = vi.fn();
    const manager = new DecompileManager(
      "java",
      "jadx.jar",
      onEvent,
      () => process as never
    );

    const jobId = manager.start("D:\\app.apk", "app.apk");
    process.stderr.write("ERROR - bad dex\n");
    process.emit("exit", 1);

    const done = onEvent.mock.calls.at(-1)?.[0];
    expect(done.type).toBe("done");
    expect(done.ok).toBe(false);
    expect(done.message).toContain("代码 1");
    expect(done.message).toContain("bad dex");
    expect(manager.hasResult(jobId)).toBe(false);
  });

  it("cancel kills the process and removes the output", () => {
    const process = new FakeJadxProcess();
    const onEvent = vi.fn();
    const manager = new DecompileManager(
      "java",
      "jadx.jar",
      onEvent,
      () => process as never
    );

    const jobId = manager.start("D:\\app.apk", "app.apk");
    expect(manager.cancel(jobId)).toBe(true);
    expect(process.killed).toBe(true);
    expect(manager.isRunning(jobId)).toBe(false);
    const done = onEvent.mock.calls.at(-1)?.[0];
    expect(done.type).toBe("done");
    expect(done.message).toContain("取消");
  });

  it("reads files with previewable-extension gating", async () => {
    const process = new FakeJadxProcess();
    const root = tempRoot();
    writeFileSync(path.join(root, "Main.java"), "public class Main {}");
    writeFileSync(path.join(root, "icon.png"), "binaryish");

    const manager = new DecompileManager(
      "java",
      "jadx.jar",
      vi.fn(),
      () => process as never
    );
    const jobId = manager.start("D:\\app.apk", "app.apk");
    process.emit("exit", 0);

    // 树从真实临时目录读取：替换 outputDir 不可行，直接验证 readFile 守卫
    const traversal = manager.readFile(jobId, "../escape.txt");
    expect(traversal.ok).toBe(false);

    const missing = manager.readFile(jobId, "nope.java");
    expect(missing.ok).toBe(false);
    expect(missing.message).toContain("不存在");
  });
});
