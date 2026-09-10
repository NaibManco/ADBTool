import { execFile as execFileCallback } from "node:child_process";
import { promisify } from "node:util";
import { clipboard } from "electron";

// 剪贴板双向同步：专用隐藏 scrcpy 会话（video:false, control:true, clipboardAutosync）。
// 关键点（探针实证）：sendDeviceMeta 必须为 false——scrcpy 3.x+ 默认在首个 socket
// 发送 64 字节设备名，video:false 时无人消费该元数据，首字节 'P'(0x50) 会被设备消息
// 解析链当成未知消息 id 80 直接把剪贴板流打死。
const { AdbServerNodeJsClient } = require("@yume-chan/adb-server-node-tcp") as
  typeof import("@yume-chan/adb-server-node-tcp");
const { AdbScrcpyClient, AdbScrcpyOptions4_0 } =
  require("@yume-chan/adb-scrcpy") as typeof import("@yume-chan/adb-scrcpy");

const execFileAsync = promisify(execFileCallback);
const SCRCPY_SERVER_DEVICE_PATH = "/data/local/tmp/scrcpy-server.jar";
const PC_CLIPBOARD_POLL_MS = 1_500;

type SyncSession = {
  serial: string;
  client: InstanceType<typeof AdbScrcpyClient>;
  unsubscribe: () => void;
};

/** 判断是否应该把文本同步到对端：空文本不清空对端，与上次相同不重发。纯函数。 */
export function shouldSyncClipboardText(
  text: string,
  lastSynced: string | undefined
): boolean {
  return text.length > 0 && text !== lastSynced;
}

export class ClipboardSyncManager {
  private readonly sessions = new Map<string, SyncSession>();
  private serverClient?: InstanceType<typeof AdbServerNodeJsClient>;
  private pollTimer?: NodeJS.Timeout;
  private lastPcText: string | undefined;

  constructor(
    private readonly adbExecutable: string,
    private readonly resolveServerPath: () => string,
    private readonly readServerBytes: () => Promise<Uint8Array>,
    private readonly onError: (serial: string, message: string) => void
  ) {}

  isRunning(serial: string): boolean {
    return this.sessions.has(serial);
  }

  runningSerials(): string[] {
    return [...this.sessions.keys()];
  }

  async enable(serial: string): Promise<void> {
    if (this.sessions.has(serial)) return;

    await execFileAsync(this.adbExecutable, ["start-server"], {
      windowsHide: true,
      timeout: 15_000
    }).catch(() => undefined);

    this.serverClient ??= new AdbServerNodeJsClient();
    const adb = await this.serverClient.createAdb({ serial });
    const serverBytes = await this.readServerBytes();
    const serverStream = new ReadableStream({
      start(controller) {
        controller.enqueue(serverBytes);
        controller.close();
      }
      // 类型桥接：流声明方差差异
    }) as unknown as Parameters<typeof AdbScrcpyClient.pushServer>[1];
    await AdbScrcpyClient.pushServer(adb, serverStream);

    const client = await AdbScrcpyClient.start(
      adb,
      SCRCPY_SERVER_DEVICE_PATH,
      new AdbScrcpyOptions4_0({
        video: false,
        audio: false,
        control: true,
        tunnelForward: true,
        clipboardAutosync: true,
        sendDeviceMeta: false
      })
    );

    void client.output.pipeTo(
      new WritableStream({
        write() {
          /* output 必须被消费，防止 server 阻塞 */
        }
      }) as unknown as Parameters<typeof client.output.pipeTo>[0]
    );

    const session: SyncSession = { serial, client, unsubscribe: () => undefined };
    this.sessions.set(serial, session);

    // 设备 → 电脑：autosync 推送的剪贴板变化写入系统剪贴板
    const reader = client.clipboard.getReader();
    const deviceLoop = (async () => {
      try {
        for (;;) {
          const { done, value } = await reader.read();
          if (done || value === undefined) break;
          if (shouldSyncClipboardText(value, this.lastPcText)) {
            clipboard.writeText(value);
          }
          // 记录为最近同步文本，阻止电脑侧轮询把它再发回设备（回环）
          this.lastPcText = value;
        }
      } catch {
        // 会话关闭
      }
    })();
    session.unsubscribe = () => {
      void reader.cancel().catch(() => undefined);
      void deviceLoop;
    };

    // 会话意外退出（拔线等）→ 清理并通知
    void client.exited.then(() => {
      if (this.sessions.get(serial) === session) {
        this.disable(serial);
        this.onError(serial, "剪贴板同步已断开（设备连接中断）");
      }
    });

    this.ensurePoll();
  }

  disable(serial: string): boolean {
    const session = this.sessions.get(serial);
    if (!session) return false;
    this.sessions.delete(serial);
    session.unsubscribe();
    void session.client.close().catch(() => undefined);
    if (this.sessions.size === 0) {
      this.stopPoll();
    }
    return true;
  }

  disableAll(): void {
    for (const serial of [...this.sessions.keys()]) {
      this.disable(serial);
    }
  }

  private ensurePoll(): void {
    if (this.pollTimer) return;
    this.pollTimer = setInterval(() => {
      void this.pollPcClipboard();
    }, PC_CLIPBOARD_POLL_MS);
    this.pollTimer.unref?.();
  }

  private stopPoll(): void {
    if (this.pollTimer) {
      clearInterval(this.pollTimer);
      this.pollTimer = undefined;
    }
  }

  /** 电脑 → 设备：轮询系统剪贴板，变化推送到所有开启同步的设备。 */
  private async pollPcClipboard(): Promise<void> {
    let text: string;
    try {
      text = clipboard.readText();
    } catch {
      return;
    }
    if (!shouldSyncClipboardText(text, this.lastPcText)) return;
    this.lastPcText = text;
    for (const session of this.sessions.values()) {
      void session.client.controller
        ?.setClipboard({ sequence: 0n, paste: false, content: text })
        .catch(() => undefined);
    }
  }
}
