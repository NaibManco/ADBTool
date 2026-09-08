import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import { describe, expect, it, vi } from "vitest";
import { TerminalManager, buildTerminalArgs } from "./terminal-manager";

class FakeShellProcess extends EventEmitter {
  stdin = new PassThrough();
  stdout = new PassThrough();
  stderr = new PassThrough();
  written: string[] = [];
  killed = false;

  constructor() {
    super();
    this.stdin.on("data", (chunk: Buffer) => {
      this.written.push(chunk.toString());
    });
  }

  kill(): boolean {
    this.killed = true;
    return true;
  }
}

describe("buildTerminalArgs", () => {
  it("targets exactly one device shell", () => {
    expect(buildTerminalArgs("serial-one")).toEqual([
      "-s",
      "serial-one",
      "shell"
    ]);
  });
});

describe("TerminalManager", () => {
  it("streams stdout and stderr chunks per serial", () => {
    const process = new FakeShellProcess();
    const spawn = vi.fn(() => process as never);
    const onEvent = vi.fn();
    const manager = new TerminalManager("adb", onEvent, spawn);

    expect(manager.start("serial-1")).toBe(true);
    expect(spawn).toHaveBeenCalledWith(
      "adb",
      ["-s", "serial-1", "shell"],
      expect.objectContaining({ windowsHide: true })
    );

    process.stdout.write("hello ");
    process.stdout.write("world\n");
    process.stderr.write("warn\n");

    expect(onEvent).toHaveBeenCalledWith({
      type: "data",
      serial: "serial-1",
      stream: "out",
      data: "hello "
    });
    expect(onEvent).toHaveBeenCalledWith({
      type: "data",
      serial: "serial-1",
      stream: "out",
      data: "world\n"
    });
    expect(onEvent).toHaveBeenCalledWith({
      type: "data",
      serial: "serial-1",
      stream: "err",
      data: "warn\n"
    });
  });

  it("resyncs an existing session instead of spawning twice", () => {
    const process = new FakeShellProcess();
    const spawn = vi.fn(() => process as never);
    const onEvent = vi.fn();
    const manager = new TerminalManager("adb", onEvent, spawn);

    manager.start("serial-1");
    onEvent.mockClear();

    expect(manager.start("serial-1")).toBe(false);
    expect(spawn).toHaveBeenCalledTimes(1);
    expect(onEvent).toHaveBeenCalledWith({
      type: "status",
      serial: "serial-1",
      running: true
    });
  });

  it("writes command lines and control bytes to stdin", () => {
    const process = new FakeShellProcess();
    const manager = new TerminalManager("adb", vi.fn(), () => process as never);

    manager.start("serial-1");
    manager.write("serial-1", "ls /data\n");
    manager.write("serial-1", "\x03");

    expect(process.written).toEqual(["ls /data\n", "\x03"]);
  });

  it("reports session end once on process exit", () => {
    const process = new FakeShellProcess();
    const onEvent = vi.fn();
    const manager = new TerminalManager("adb", onEvent, () => process as never);

    manager.start("serial-1");
    onEvent.mockClear();

    process.emit("exit", 0);
    expect(onEvent).toHaveBeenCalledWith({
      type: "status",
      serial: "serial-1",
      running: false,
      message: "Shell 会话已结束"
    });
    expect(manager.isRunning("serial-1")).toBe(false);
  });

  it("stop kills only the targeted session", () => {
    const first = new FakeShellProcess();
    const second = new FakeShellProcess();
    const spawn = vi
      .fn()
      .mockReturnValueOnce(first as never)
      .mockReturnValueOnce(second as never);
    const manager = new TerminalManager("adb", vi.fn(), spawn);

    manager.start("serial-1");
    manager.start("serial-2");
    expect(manager.stop("serial-1")).toBe(true);
    expect(first.killed).toBe(true);
    expect(second.killed).toBe(false);
    expect(manager.isRunning("serial-2")).toBe(true);
  });
});
