import { execFile as execFileCallback } from "node:child_process";
import { readFile } from "node:fs/promises";
import { promisify } from "node:util";
import type { WebContents } from "electron";
import type { MirrorControlInput, MirrorManagerEvent } from "../shared/types";

// @yume-chan 包是 ESM-only；主进程是 CommonJS 输出。
// Electron 内嵌 Node >= 22.12 支持 require(esm)，这里用 require 加载、
// `typeof import` 只取类型（类型位置不会触发 TS1479）。
// ponytail: 若未来依赖引入顶层 await 导致 require 失败，退路是
// new Function("s","return import(s)") 动态导入。
const { AdbServerNodeJsClient } = require("@yume-chan/adb-server-node-tcp") as
  typeof import("@yume-chan/adb-server-node-tcp");
const { AdbScrcpyClient, AdbScrcpyOptions4_0 } =
  require("@yume-chan/adb-scrcpy") as typeof import("@yume-chan/adb-scrcpy");
const {
  AndroidMotionEventAction,
  AndroidKeyEventAction,
  AndroidKeyCode
} = require("@yume-chan/scrcpy") as typeof import("@yume-chan/scrcpy");

const execFileAsync = promisify(execFileCallback);
const SCRCPY_SERVER_DEVICE_PATH = "/data/local/tmp/scrcpy-server.jar";
const OUTPUT_TAIL_LINES = 30;

type MirrorSession = {
  client: InstanceType<typeof AdbScrcpyClient>;
  width: number;
  height: number;
  // 供迟到的查看者（面板重开/页面刷新后）立即接上已存在的会话
  codec?: number;
  deviceName?: string;
  configuration?: Uint8Array;
  // 从最近一个关键帧起的数据包缓存：晚接入观众（内嵌↔独立窗口切换、
  // 面板重开）经 resync 补发后可立即解码出画，不必等设备侧下一个 IDR
  // （部分设备编码器无视 i-frame-interval，静态画面下 IDR 可能 15s+ 不来）
  gop?: { packets: VideoPacketCacheEntry[]; bytes: number };
};

type VideoPacketCacheEntry = {
  data: Uint8Array;
  keyframe: boolean;
  pts: bigint;
};

export class EmbeddedMirrorManager {
  // 观众切换（内嵌↔独立窗口抢占、dev StrictMode 重挂载）在停止请求后
  // 毫秒级就会出现新的 start：留一个宽限期，期内有人接入就不真正停会话，
  // 避免活跃会话被杀后立即重启（部分设备如眼镜的编码器会卡死等首帧）
  private static readonly STOP_GRACE_MS = 1_500;

  // GOP 缓存上限：超限（如长时间无 IDR 的高码率画面）则清空等下个关键帧
  private static readonly GOP_MAX_PACKETS = 300;
  private static readonly GOP_MAX_BYTES = 8 * 1024 * 1024;

  private readonly sessions = new Map<string, MirrorSession>();
  private readonly starting = new Set<string>();
  private readonly stopRequested = new Set<string>();
  private readonly pendingStops = new Map<string, NodeJS.Timeout>();
  private serverClient?: InstanceType<typeof AdbServerNodeJsClient>;
  private serverBytes?: Promise<Uint8Array>;

  constructor(
    private readonly adbExecutable: string,
    private readonly resolveServerPath: () => string,
    private readonly onEvent: (
      event: MirrorManagerEvent,
      target?: WebContents
    ) => void
  ) {}

  isRunning(serial: string): boolean {
    return this.sessions.has(serial);
  }

  /** 当前会话的视频尺寸（session 包到达后有效）；供独立窗口按比例自适应。 */
  getVideoSize(serial: string): { width: number; height: number } | undefined {
    const session = this.sessions.get(serial);
    if (!session || !session.width || !session.height) {
      return undefined;
    }
    return { width: session.width, height: session.height };
  }

  async start(serial: string, target?: WebContents): Promise<void> {
    // 宽限期内有人接入：撤销挂起的销毁，走下面的 resync 路径接上
    const pendingStop = this.pendingStops.get(serial);
    if (pendingStop) {
      clearTimeout(pendingStop);
      this.pendingStops.delete(serial);
    }

    const existing = this.sessions.get(serial);
    if (existing) {
      // 会话已存在（如渲染端刷新后面板重开）：补发缓存信息让新面板接上。
      // 定向发给请求方——GOP 重放不能广播，否则已有观众的流里会混入重复包
      if (existing.codec !== undefined) {
        this.onEvent(
          {
            type: "meta",
            serial,
            codec: existing.codec,
            deviceName: existing.deviceName
          },
          target
        );
        if (existing.configuration) {
          this.onEvent(
            {
              type: "video",
              serial,
              kind: "configuration",
              data: existing.configuration
            },
            target
          );
        }
        if (existing.gop?.packets.length) {
          for (const packet of existing.gop.packets) {
            this.onEvent(
              {
                type: "video",
                serial,
                kind: "data",
                data: packet.data,
                keyframe: packet.keyframe,
                pts: packet.pts
              },
              target
            );
          }
        }
      }
      this.onEvent({ type: "status", serial, running: true }, target);
      return;
    }
    if (this.starting.has(serial)) {
      // 连接窗口期内再次请求启动（如 dev StrictMode 重挂载）：
      // 撤销挂起的停止请求，让进行中的连接正常完成并复用
      this.stopRequested.delete(serial);
      return;
    }
    this.starting.add(serial);
    const outputTail: string[] = [];
    let client: InstanceType<typeof AdbScrcpyClient> | undefined;

    try {
      // adb server 幂等启动（已运行时立即返回）
      await execFileAsync(this.adbExecutable, ["start-server"], {
        windowsHide: true,
        timeout: 15_000
      }).catch(() => undefined);

      this.serverClient ??= new AdbServerNodeJsClient();
      const adb = await this.serverClient.createAdb({ serial });

      // 读取失败时清除缓存，避免一次瞬时错误永久禁用内嵌投屏
      this.serverBytes ??= readFile(this.resolveServerPath()).then(
        (buffer) => new Uint8Array(buffer),
        (error) => {
          this.serverBytes = undefined;
          throw error;
        }
      );
      const bytes = await this.serverBytes;
      // @yume-chan 的全局 stream 类型与 Node 全局声明存在 void/undefined 方差差异，
      // 运行时是同一套标准 Web Streams API（探针已真机验证），这里做一次类型桥接。
      const serverStream = new ReadableStream({
        start(controller) {
          controller.enqueue(bytes);
          controller.close();
        }
      }) as unknown as Parameters<typeof AdbScrcpyClient.pushServer>[1];
      await AdbScrcpyClient.pushServer(adb, serverStream);

      const options = new AdbScrcpyOptions4_0({
        audio: false,
        control: true,
        tunnelForward: true,
        videoCodec: "h264",
        videoBitRate: 8_000_000,
        maxSize: 1600,
        // 关键帧间隔压到 2s（默认 10s）：内嵌↔独立窗口切换时新观众接入
        // 同一活跃会话，最坏 2s 内拿到 IDR 出画，不用等满一个长 GOP
        videoCodecOptions: "i-frame-interval=2"
      });
      client = await AdbScrcpyClient.start(
        adb,
        SCRCPY_SERVER_DEVICE_PATH,
        options
      );

      // start 期间收到 stop：直接关闭，不注册会话
      if (this.stopRequested.delete(serial)) {
        await client.close().catch(() => undefined);
        this.onEvent({
          type: "status",
          serial,
          running: false,
          message: "已停止投屏"
        });
        return;
      }

      // output 流必须被消费，否则 server 可能阻塞；保留尾部用于报错
      client.output.pipeTo(
        new WritableStream<string>({
          write(line) {
            outputTail.push(String(line));
            if (outputTail.length > OUTPUT_TAIL_LINES) {
              outputTail.shift();
            }
          }
          // 同上：类型桥接
        }) as unknown as Parameters<typeof client.output.pipeTo>[0]
      ).catch(() => {
        // 断连等异常结束由 exited 事件统一上报
      });

      const session: MirrorSession = { client, width: 0, height: 0 };
      this.sessions.set(serial, session);

      void client.exited.then(() => {
        // 会话已没了，挂起的宽限销毁没有意义
        const pendingStop = this.pendingStops.get(serial);
        if (pendingStop) {
          clearTimeout(pendingStop);
          this.pendingStops.delete(serial);
        }
        if (this.sessions.get(serial) === session) {
          this.sessions.delete(serial);
          this.onEvent({
            type: "status",
            serial,
            running: false,
            message: "投屏已结束"
          });
        }
      });

      const video = await client.videoStream;
      if (!video) {
        throw new Error("设备未返回视频流");
      }

      session.codec = Number(video.metadata.codec);
      session.deviceName = video.metadata.deviceName;
      this.onEvent({
        type: "meta",
        serial,
        codec: session.codec,
        deviceName: session.deviceName
      });

      const reader = video.stream.getReader();
      void (async () => {
        try {
          for (;;) {
            const { done, value } = await reader.read();
            if (done || !value) break;
            if (value.type === "session") {
              session.width = value.width;
              session.height = value.height;
              this.onEvent({
                type: "video",
                serial,
                kind: "session",
                width: value.width,
                height: value.height,
                isClientResize: value.isClientResize
              });
            } else if (value.type === "configuration") {
              session.configuration = value.data;
              // 编码参数变了，旧 GOP 不再可解码
              session.gop = { packets: [], bytes: 0 };
              this.onEvent({
                type: "video",
                serial,
                kind: "configuration",
                data: value.data
              });
            } else {
              // 维护 GOP 缓存：关键帧重开一段，普通帧追加，超限整段丢弃
              // （丢弃后等下个关键帧重建，晚接入观众暂时退化为等 IDR）
              if (value.keyframe) {
                session.gop = { packets: [], bytes: 0 };
              }
              const gop = (session.gop ??= { packets: [], bytes: 0 });
              // 缓存段必须以关键帧开头：重建期内的散帧无处挂靠，不进缓存
              if (
                (value.keyframe || gop.packets.length > 0) &&
                gop.packets.length < EmbeddedMirrorManager.GOP_MAX_PACKETS &&
                gop.bytes + value.data.byteLength <=
                  EmbeddedMirrorManager.GOP_MAX_BYTES
              ) {
                gop.packets.push({
                  data: value.data,
                  keyframe: value.keyframe ?? false,
                  pts: value.pts ?? 0n
                });
                gop.bytes += value.data.byteLength;
              } else {
                session.gop = { packets: [], bytes: 0 };
              }
              this.onEvent({
                type: "video",
                serial,
                kind: "data",
                data: value.data,
                keyframe: value.keyframe,
                pts: value.pts
              });
            }
          }
        } catch {
          // 流结束/断开由 exited 事件统一上报
        }
      })();

      this.onEvent({ type: "status", serial, running: true });
    } catch (error) {
      this.sessions.delete(serial);
      // 半途失败也要关闭 client，避免设备端 server 进程残留
      if (client) {
        await client.close().catch(() => undefined);
      }
      const detail = error instanceof Error ? error.message : String(error);
      const tail = outputTail.length
        ? `：${outputTail.slice(-3).join(" | ")}`
        : "";
      this.onEvent({
        type: "status",
        serial,
        running: false,
        message: `内嵌投屏启动失败 ${detail}${tail}`
      });
      throw error;
    } finally {
      this.starting.delete(serial);
      // start 失败时可能残留未消费的 stop 请求，避免污染下一次启动
      this.stopRequested.delete(serial);
    }
  }

  async stop(serial: string): Promise<boolean> {
    const session = this.sessions.get(serial);
    if (!session) {
      // start 尚未完成：登记请求，由 start() 在注册会话前处理
      if (this.starting.has(serial)) {
        this.stopRequested.add(serial);
        return true;
      }
      return false;
    }
    // 不是最后一个停止路径说了算：先挂宽限计时器，期内新观众接入则作废
    if (!this.pendingStops.has(serial)) {
      this.pendingStops.set(
        serial,
        setTimeout(() => {
          this.pendingStops.delete(serial);
          void this.stopNow(serial);
        }, EmbeddedMirrorManager.STOP_GRACE_MS)
      );
    }
    return true;
  }

  /** 立即销毁会话（宽限期到点 / 退出清理路径专用）。 */
  private async stopNow(serial: string): Promise<void> {
    const session = this.sessions.get(serial);
    if (!session) return;
    this.sessions.delete(serial);
    const pendingStop = this.pendingStops.get(serial);
    if (pendingStop) {
      clearTimeout(pendingStop);
      this.pendingStops.delete(serial);
    }
    await session.client.close().catch(() => undefined);
    this.onEvent({
      type: "status",
      serial,
      running: false,
      message: "已停止投屏"
    });
  }

  async stopAll(): Promise<void> {
    for (const serial of [...this.pendingStops.keys()]) {
      const timer = this.pendingStops.get(serial);
      clearTimeout(timer);
      this.pendingStops.delete(serial);
    }
    for (const serial of [...this.sessions.keys()]) {
      await this.stopNow(serial);
    }
  }

  control(serial: string, input: MirrorControlInput): void {
    const session = this.sessions.get(serial);
    const controller = session?.client.controller;
    if (!session || !controller || !session.width || !session.height) {
      return;
    }
    const { width, height } = session;
    const clamp01 = (value: number): number =>
      Math.min(1, Math.max(0, value));

    // 写入失败（断连窗口期）按尽力而为处理，统一吞掉避免 unhandledRejection
    const write = (promise: Promise<void>): void => {
      void promise.catch(() => undefined);
    };

    if (input.type === "back") {
      write(
        controller.injectKeyCode({
          action: AndroidKeyEventAction.Down,
          keyCode: AndroidKeyCode.AndroidBack,
          repeat: 0,
          metaState: 0
        })
      );
      write(
        controller.injectKeyCode({
          action: AndroidKeyEventAction.Up,
          keyCode: AndroidKeyCode.AndroidBack,
          repeat: 0,
          metaState: 0
        })
      );
      return;
    }

    if (input.type === "touch") {
      const action =
        input.action === "down"
          ? AndroidMotionEventAction.Down
          : input.action === "up"
            ? AndroidMotionEventAction.Up
            : AndroidMotionEventAction.Move;
      write(
        controller.injectTouch({
          action,
          pointerId: BigInt(input.pointerId),
          pointerX: Math.round(clamp01(input.x) * width),
          pointerY: Math.round(clamp01(input.y) * height),
          videoWidth: width,
          videoHeight: height,
          pressure: input.action === "up" ? 0 : 1,
          actionButton: input.action === "up" ? 0 : 1,
          buttons: input.action === "up" ? 0 : 1
        })
      );
      return;
    }

    write(
      controller.injectScroll({
        pointerX: Math.round(clamp01(input.x) * width),
        pointerY: Math.round(clamp01(input.y) * height),
        videoWidth: width,
        videoHeight: height,
        scrollX: Math.max(-16, Math.min(16, input.scrollX)),
        scrollY: Math.max(-16, Math.min(16, input.scrollY)),
        buttons: 0
      })
    );
  }
}
