import { EventEmitter } from "node:events";
import { describe, expect, it, vi } from "vitest";
import { ScrcpyManager } from "./scrcpy-manager";

class FakeProcess extends EventEmitter {
  killed = false;

  kill(): boolean {
    this.killed = true;
    return true;
  }
}

describe("ScrcpyManager", () => {
  it("starts at most one scrcpy process per device", () => {
    const process = new FakeProcess();
    const spawn = vi.fn(() => process as never);
    const manager = new ScrcpyManager("C:\\scrcpy\\scrcpy.exe", spawn);

    expect(manager.start("serial-1", "Pixel 9")).toBe(true);
    expect(manager.start("serial-1", "Pixel 9")).toBe(false);
    expect(spawn).toHaveBeenCalledOnce();
    expect(spawn).toHaveBeenCalledWith(
      "C:\\scrcpy\\scrcpy.exe",
      [
        "--serial=serial-1",
        "--no-audio",
        "--window-title=Android Dev Tool - Pixel 9 [serial-1]"
      ],
      expect.objectContaining({ windowsHide: true })
    );
  });

  it("removes exited processes and can stop a running device", () => {
    const first = new FakeProcess();
    const second = new FakeProcess();
    const spawn = vi
      .fn()
      .mockReturnValueOnce(first as never)
      .mockReturnValueOnce(second as never);
    const manager = new ScrcpyManager("scrcpy", spawn);

    manager.start("serial-1", "Device");
    first.emit("exit", 0);
    expect(manager.isRunning("serial-1")).toBe(false);

    manager.start("serial-1", "Device");
    expect(manager.stop("serial-1")).toBe(true);
    expect(second.killed).toBe(true);
    expect(manager.isRunning("serial-1")).toBe(false);
  });
});
