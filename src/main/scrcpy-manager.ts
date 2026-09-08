import { spawn as nodeSpawn, type ChildProcess, type SpawnOptions } from "node:child_process";

type SpawnProcess = (
  executable: string,
  args: readonly string[],
  options: SpawnOptions
) => ChildProcess;

export class ScrcpyManager {
  private readonly processes = new Map<string, ChildProcess>();

  constructor(
    private readonly executable: string,
    private readonly spawnProcess: SpawnProcess = nodeSpawn
  ) {}

  start(serial: string, label: string): boolean {
    if (this.processes.has(serial)) {
      return false;
    }

    const process = this.spawnProcess(
      this.executable,
      [
        `--serial=${serial}`,
        "--no-audio",
        `--window-title=Android Dev Tool - ${label} [${serial}]`
      ],
      {
        windowsHide: true,
        stdio: "ignore"
      }
    );

    this.processes.set(serial, process);
    const remove = () => {
      if (this.processes.get(serial) === process) {
        this.processes.delete(serial);
      }
    };
    process.once("exit", remove);
    process.once("error", remove);
    return true;
  }

  stop(serial: string): boolean {
    const process = this.processes.get(serial);
    if (!process) {
      return false;
    }

    this.processes.delete(serial);
    process.kill();
    return true;
  }

  stopAll(): void {
    for (const serial of [...this.processes.keys()]) {
      this.stop(serial);
    }
  }

  isRunning(serial: string): boolean {
    return this.processes.has(serial);
  }
}
