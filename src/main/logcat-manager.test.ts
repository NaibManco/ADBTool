import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import { describe, expect, it, vi } from "vitest";
import { LogcatManager, parseLogcatLine } from "./logcat-manager";

class FakeLogcatProcess extends EventEmitter {
  stdout = new PassThrough();
  stderr = new PassThrough();
  killed = false;

  kill(): boolean {
    this.killed = true;
    return true;
  }
}

describe("parseLogcatLine", () => {
  it("parses threadtime output into searchable fields", () => {
    expect(
      parseLogcatLine(
        "07-29 15:20:10.123  1234  5678 I ActivityManager: Start proc"
      )
    ).toEqual({
      raw: "07-29 15:20:10.123  1234  5678 I ActivityManager: Start proc",
      timestamp: "07-29 15:20:10.123",
      pid: 1234,
      tid: 5678,
      level: "I",
      tag: "ActivityManager",
      message: "Start proc"
    });
  });

  it("preserves unstructured lines", () => {
    expect(parseLogcatLine("--------- beginning of system")).toEqual({
      raw: "--------- beginning of system",
      level: "I",
      tag: "logcat",
      message: "--------- beginning of system"
    });
  });
});

describe("LogcatManager", () => {
  it("starts one isolated stream per serial and reconstructs chunked lines", () => {
    const process = new FakeLogcatProcess();
    const spawn = vi.fn(() => process as never);
    const onEvent = vi.fn();
    const manager = new LogcatManager("C:\\adb.exe", onEvent, spawn);

    expect(manager.start("serial-1")).toBe(true);
    expect(manager.start("serial-1")).toBe(false);
    expect(spawn).toHaveBeenCalledWith(
      "C:\\adb.exe",
      ["-s", "serial-1", "logcat", "-b", "main", "-v", "threadtime", "-T", "5000"],
      expect.objectContaining({ windowsHide: true })
    );
    expect(onEvent).toHaveBeenCalledWith({
      type: "status",
      serial: "serial-1",
      running: true,
      pid: undefined,
      buffer: "main"
    });

    process.stdout.write("07-29 15:20:10.123  1234  5678 I Demo: hel");
    process.stdout.write("lo\r\n--------- beginning of main\r\n");

    expect(onEvent).toHaveBeenCalledWith({
      type: "entry",
      serial: "serial-1",
      entry: expect.objectContaining({
        tag: "Demo",
        message: "hello"
      })
    });
    expect(onEvent).toHaveBeenCalledWith({
      type: "entry",
      serial: "serial-1",
      entry: expect.objectContaining({
        message: "--------- beginning of main"
      })
    });
  });

  it("stops the selected device without touching another session", () => {
    const first = new FakeLogcatProcess();
    const second = new FakeLogcatProcess();
    const spawn = vi
      .fn()
      .mockReturnValueOnce(first as never)
      .mockReturnValueOnce(second as never);
    const manager = new LogcatManager("adb", vi.fn(), spawn);

    manager.start("serial-1");
    manager.start("serial-2");
    expect(manager.stop("serial-1")).toBe(true);
    expect(first.killed).toBe(true);
    expect(second.killed).toBe(false);
    expect(manager.isRunning("serial-2")).toBe(true);
  });

  it("restarts one device stream with a selected application PID", () => {
    const first = new FakeLogcatProcess();
    const filtered = new FakeLogcatProcess();
    const spawn = vi
      .fn()
      .mockReturnValueOnce(first as never)
      .mockReturnValueOnce(filtered as never);
    const manager = new LogcatManager("adb", vi.fn(), spawn);

    manager.start("serial-1");
    expect(manager.restart("serial-1", 25647)).toBe(true);
    expect(first.killed).toBe(true);
    expect(spawn).toHaveBeenLastCalledWith(
      "adb",
      [
        "-s",
        "serial-1",
        "logcat",
        "-b",
        "main",
        "-v",
        "threadtime",
        "-T",
        "5000",
        "--pid=25647"
      ],
      expect.any(Object)
    );
  });

  it("keeps the selected buffer sticky while a pid restart clears the pid filter", () => {
    const first = new FakeLogcatProcess();
    const pidStream = new FakeLogcatProcess();
    const cleared = new FakeLogcatProcess();
    const spawn = vi
      .fn()
      .mockReturnValueOnce(first as never)
      .mockReturnValueOnce(pidStream as never)
      .mockReturnValueOnce(cleared as never);
    const manager = new LogcatManager("adb", vi.fn(), spawn);

    manager.start("serial-1", 100, "system");
    manager.restart("serial-1", 25647);
    expect(spawn).toHaveBeenLastCalledWith(
      "adb",
      [
        "-s",
        "serial-1",
        "logcat",
        "-b",
        "system",
        "-v",
        "threadtime",
        "-T",
        "5000",
        "--pid=25647"
      ],
      expect.any(Object)
    );

    manager.restart("serial-1");
    expect(spawn).toHaveBeenLastCalledWith(
      "adb",
      ["-s", "serial-1", "logcat", "-b", "system", "-v", "threadtime", "-T", "5000"],
      expect.any(Object)
    );
  });

  it("setBuffer restarts a running session with the stored pid", () => {
    const first = new FakeLogcatProcess();
    const restarted = new FakeLogcatProcess();
    const spawn = vi
      .fn()
      .mockReturnValueOnce(first as never)
      .mockReturnValueOnce(restarted as never);
    const manager = new LogcatManager("adb", vi.fn(), spawn);

    manager.start("serial-1", 4242);
    expect(manager.setBuffer("serial-1", "crash")).toBe(true);
    expect(first.killed).toBe(true);
    expect(spawn).toHaveBeenLastCalledWith(
      "adb",
      [
        "-s",
        "serial-1",
        "logcat",
        "-b",
        "crash",
        "-v",
        "threadtime",
        "-T",
        "5000",
        "--pid=4242"
      ],
      expect.any(Object)
    );
  });

  it("setBuffer stores the choice when no session is running", () => {
    const process = new FakeLogcatProcess();
    const spawn = vi.fn(() => process as never);
    const manager = new LogcatManager("adb", vi.fn(), spawn);

    expect(manager.setBuffer("serial-1", "radio")).toBe(false);
    expect(manager.isRunning("serial-1")).toBe(false);

    manager.start("serial-1", 7);
    expect(spawn).toHaveBeenCalledWith(
      "adb",
      [
        "-s",
        "serial-1",
        "logcat",
        "-b",
        "radio",
        "-v",
        "threadtime",
        "-T",
        "5000",
        "--pid=7"
      ],
      expect.any(Object)
    );
  });

  it("rejects unknown buffers", () => {
    const manager = new LogcatManager("adb", vi.fn(), vi.fn());

    expect(() => manager.start("serial-1", undefined, "all")).toThrow(
      "日志缓冲区无效: all"
    );
    expect(() => manager.setBuffer("serial-1", "kernel")).toThrow(
      "日志缓冲区无效: kernel"
    );
  });

  it("resync re-emits the running status with session options", () => {
    const process = new FakeLogcatProcess();
    const spawn = vi.fn(() => process as never);
    const onEvent = vi.fn();
    const manager = new LogcatManager("adb", onEvent, spawn);

    manager.start("serial-1", 99, "events");
    onEvent.mockClear();

    expect(manager.resync("serial-1")).toBe(true);
    expect(onEvent).toHaveBeenCalledWith({
      type: "status",
      serial: "serial-1",
      running: true,
      pid: 99,
      buffer: "events"
    });

    manager.stop("serial-1");
    onEvent.mockClear();
    expect(manager.resync("serial-1")).toBe(false);
    expect(onEvent).not.toHaveBeenCalled();
  });
});
