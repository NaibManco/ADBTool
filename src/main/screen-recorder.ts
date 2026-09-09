import { execFile as execFileCallback } from "node:child_process";
import { closeSync, openSync, writeSync } from "node:fs";
import { promisify } from "node:util";
import type { ActionResult } from "../shared/types";

// 录屏链路：@yume-chan 起隐藏视频会话（绕开部分设备对 adb screenrecord 的限制，
// 如 OnePlus Android 16 上文件/流式模式均被系统封禁），h264 流在电脑侧封装 mp4。
const { AdbServerNodeJsClient } = require("@yume-chan/adb-server-node-tcp") as
  typeof import("@yume-chan/adb-server-node-tcp");
const { AdbScrcpyClient, AdbScrcpyOptions4_0 } =
  require("@yume-chan/adb-scrcpy") as typeof import("@yume-chan/adb-scrcpy");
const mediaCodec = require("@yume-chan/media-codec") as typeof import("@yume-chan/media-codec");
const { Muxer, StreamTarget } = require("mp4-muxer") as
  typeof import("mp4-muxer");

const execFileAsync = promisify(execFileCallback);
const SCRCPY_SERVER_DEVICE_PATH = "/data/local/tmp/scrcpy-server.jar";
const MAX_DURATION_HINT_US = 1_000_000;
const MIN_DURATION_HINT_US = 1_000;

/** SPS/PPS（含 NAL 头）→ avcC 描述符。纯函数，供单测。 */
export function buildAvcDecoderConfigurationRecord(
  sequenceParameterSet: Uint8Array,
  pictureParameterSet: Uint8Array
): Uint8Array {
  const record = new Uint8Array(11 + sequenceParameterSet.length + pictureParameterSet.length);
  record[0] = 0x01; // configurationVersion
  record[1] = sequenceParameterSet[1]; // profile_idc
  record[2] = sequenceParameterSet[2]; // constraint flags
  record[3] = sequenceParameterSet[3]; // level_idc
  record[4] = 0xff; // reserved + lengthSizeMinusOne = 4 字节长度前缀
  record[5] = 0xe1; // reserved + numOfSPS = 1
  record[6] = (sequenceParameterSet.length >> 8) & 0xff;
  record[7] = sequenceParameterSet.length & 0xff;
  record.set(sequenceParameterSet, 8);
  const ppsLengthAt = 8 + sequenceParameterSet.length;
  record[ppsLengthAt] = 0x01; // numOfPPS = 1
  record[ppsLengthAt + 1] = (pictureParameterSet.length >> 8) & 0xff;
  record[ppsLengthAt + 2] = pictureParameterSet.length & 0xff;
  record.set(pictureParameterSet, ppsLengthAt + 3);
  return record;
}

/** Annex-B 起始码 → 4 字节长度前缀（AVCC）。纯函数，供单测。 */
export function convertAnnexBToLengthPrefixed(data: Uint8Array): Uint8Array {
  const nalus = [...mediaCodec.annexBSplitNalu(data)];
  let total = 0;
  for (const nalu of nalus) total += 4 + nalu.length;
  const out = new Uint8Array(total);
  let cursor = 0;
  for (const nalu of nalus) {
    out[cursor] = (nalu.length >> 24) & 0xff;
    out[cursor + 1] = (nalu.length >> 16) & 0xff;
    out[cursor + 2] = (nalu.length >> 8) & 0xff;
    out[cursor + 3] = nalu.length & 0xff;
    out.set(nalu, cursor + 4);
    cursor += 4 + nalu.length;
  }
  return out;
}

interface RecorderSession {
  serial: string;
  localPath: string;
  startedAt: number;
  client: InstanceType<typeof AdbScrcpyClient>;
  close: () => Promise<void>;
  fd?: number;
  muxer?: InstanceType<typeof Muxer>;
  description?: Uint8Array;
  codecString?: string;
  width: number;
  height: number;
  lastPtsUs?: number;
  lastSample?: { data: Uint8Array; type: "key" | "delta"; timestamp: number };
  lastDurationUs: number;
  ended: boolean;
}

export type RecorderEndedListener = (result: {
  serial: string;
  ok: boolean;
  message: string;
}) => void;

export class ScreenRecorder {
  private readonly sessions = new Map<string, RecorderSession>();
  private serverClient?: InstanceType<typeof AdbServerNodeJsClient>;

  constructor(
    private readonly adbExecutable: string,
    private readonly resolveServerPath: () => string,
    private readonly onEnded: RecorderEndedListener,
    private readonly readServerBytes: () => Promise<Uint8Array>
  ) {}

  isRecording(serial: string): boolean {
    return this.sessions.has(serial);
  }

  recordingSessions(): Array<{ serial: string; startedAt: number }> {
    return Array.from(this.sessions.values(), (session) => ({
      serial: session.serial,
      startedAt: session.startedAt
    }));
  }

  async start(serial: string, localPath: string): Promise<number> {
    if (this.sessions.has(serial)) {
      throw new Error("该设备已经在录屏");
    }
    const startedAt = Date.now();

    await execFileAsync(this.adbExecutable, ["start-server"], {
      windowsHide: true,
      timeout: 15_000
    }).catch(() => undefined);

    this.serverClient ??= new AdbServerNodeJsClient();
    const adb = await this.serverClient.createAdb({ serial });

    const serverBytes = await this.readServerBytes();
    // 类型桥接：@yume-chan 的流类型与 Node 全局声明有 void/undefined 方差差异
    const serverStream = new ReadableStream({
      start(controller) {
        controller.enqueue(serverBytes);
        controller.close();
      }
    }) as unknown as Parameters<typeof AdbScrcpyClient.pushServer>[1];
    await AdbScrcpyClient.pushServer(adb, serverStream);

    const client = await AdbScrcpyClient.start(
      adb,
      SCRCPY_SERVER_DEVICE_PATH,
      new AdbScrcpyOptions4_0({
        video: true,
        audio: false,
        control: false,
        tunnelForward: true,
        videoCodec: "h264",
        videoBitRate: 8_000_000
      })
    );

    void client.output.pipeTo(
      new WritableStream({
        write() {
          /* output 必须被消费，防止 server 阻塞 */
        }
      }) as unknown as Parameters<typeof client.output.pipeTo>[0]
    );

    const session: RecorderSession = {
      serial,
      localPath,
      startedAt,
      client,
      close: () => client.close(),
      width: 0,
      height: 0,
      lastDurationUs: 33_333,
      ended: false
    };
    this.sessions.set(serial, session);

    void client.exited.then(() => {
      if (this.sessions.get(serial) === session && !session.ended) {
        this.finalizeSession(session);
        this.sessions.delete(serial);
        this.onEnded({
          serial,
          ok: true,
          message: "设备侧画面流已结束，录屏停止"
        });
      }
    });

    const video = await client.videoStream;
    if (!video) {
      await client.close().catch(() => undefined);
      this.sessions.delete(serial);
      throw new Error("设备未返回录屏视频流");
    }

    const reader = video.stream.getReader();
    void (async () => {
      try {
        for (;;) {
          const { done, value } = await reader.read();
          if (done || !value) break;
          if (value.type === "session") {
            this.handleSize(session, value.width, value.height);
            if (this.sessions.get(serial) !== session) break;
          } else if (value.type === "configuration") {
            this.handleConfiguration(session, value.data);
          } else if (value.type === "data") {
            this.handleSample(session, value);
          }
        }
      } catch {
        // 流中断由 exited 监听统一收尾
      }
    })();

    return startedAt;
  }

  async stop(serial: string): Promise<{ localPath?: string; message?: string }> {
    const session = this.sessions.get(serial);
    if (!session) {
      return { message: "该设备当前没有录屏" };
    }
    this.sessions.delete(serial);
    session.ended = true;
    await session.close().catch(() => undefined);
    // reader 循环随流关闭退出；收尾在流 loop 外由 stop 直接完成
    const result = this.finalizeSession(session);
    return result.localPath
      ? { localPath: result.localPath }
      : { message: result.message };
  }

  stopAll(): void {
    for (const serial of [...this.sessions.keys()]) {
      void this.stop(serial);
    }
  }

  private handleSize(session: RecorderSession, width: number, height: number): void {
    if (session.width === 0) {
      session.width = width;
      session.height = height;
      return;
    }
    if (width === session.width && height === session.height) return;
    // mp4 轨道尺寸固定，画面旋转（尺寸变化）时结束录制并保留已录内容
    this.sessions.delete(session.serial);
    session.ended = true;
    void session.close().catch(() => undefined);
    const result = this.finalizeSession(session);
    this.onEnded({
      serial: session.serial,
      ok: result.localPath !== undefined,
      message:
        result.localPath !== undefined
          ? "画面发生旋转，录屏已结束（已保存到旋转前内容）"
          : `画面旋转但录屏尚未写入任何帧：${result.message ?? ""}`
    });
  }

  private handleConfiguration(session: RecorderSession, data: Uint8Array): void {
    try {
      const configuration = mediaCodec.H264.parseConfiguration(data);
      session.description = buildAvcDecoderConfigurationRecord(
        configuration.sequenceParameterSet,
        configuration.pictureParameterSet
      );
      session.codecString = mediaCodec.H264.toCodecString(configuration);
      if (session.width === 0) {
        session.width = configuration.croppedWidth;
        session.height = configuration.croppedHeight;
      }
    } catch {
      this.endWithError(session, "无法解析设备视频参数，录屏停止");
    }
  }

  private ensureMuxer(session: RecorderSession): void {
    if (session.muxer) return;
    if (!session.description || !session.codecString || !session.width || !session.height) {
      return;
    }
    const fd = openSync(session.localPath, "w");
    session.fd = fd;
    session.muxer = new Muxer({
      target: new StreamTarget({
        onData: (data, position) => {
          writeSync(fd, data, 0, data.length, position);
        }
      }),
      video: {
        codec: "avc",
        width: session.width,
        height: session.height
      },
      // scrcpy 的 pts 是流内相对时间戳，不保证首帧为 0
      firstTimestampBehavior: "offset",
      fastStart: false
    });
  }

  private handleSample(
    session: RecorderSession,
    packet: { data: Uint8Array; keyframe?: boolean; pts?: bigint }
  ): void {
    if (session.ended) return;
    this.ensureMuxer(session);
    if (!session.muxer) return;

    // scrcpy 协议的 pts 单位就是微秒，mp4-muxer 时间戳同为微秒，直接透传
    if (packet.pts === undefined) return;
    const timestamp = Number(packet.pts);

    const sample = {
      data: convertAnnexBToLengthPrefixed(packet.data),
      type: (packet.keyframe ? "key" : "delta") as "key" | "delta",
      timestamp
    };

    // 用上一帧的 pts 差作为上一帧时长（mp4 样本需要 duration）
    const pending = session.lastSample;
    session.lastSample = sample;
    if (!pending) return;
    const delta = sample.timestamp - pending.timestamp;
    session.lastDurationUs =
      delta > 0 && delta < MAX_DURATION_HINT_US
        ? Math.max(delta, MIN_DURATION_HINT_US)
        : session.lastDurationUs;
    session.muxer.addVideoChunkRaw(
      pending.data,
      pending.type,
      pending.timestamp,
      session.lastDurationUs,
      {
        decoderConfig: {
          codec: session.codecString!,
          description: session.description!
        }
      }
    );
  }

  private finalizeSession(session: RecorderSession): {
    localPath?: string;
    message?: string;
  } {
    try {
      if (session.muxer) {
        const pending = session.lastSample;
        if (pending) {
          // 静屏时设备只在画面变化时发帧，末帧时间戳会早于实际停止时刻；
          // 把最后一帧时长补齐到真实墙钟时长，否则视频时长会被截短
          const elapsedUs = (Date.now() - session.startedAt) * 1_000;
          const padded = Math.max(
            session.lastDurationUs,
            Math.min(
              elapsedUs - pending.timestamp,
              60 * 60 * 1_000_000
            )
          );
          session.muxer.addVideoChunkRaw(
            pending.data,
            pending.type,
            pending.timestamp,
            padded,
            {
              decoderConfig: {
                codec: session.codecString!,
                description: session.description!
              }
            }
          );
        }
        session.muxer.finalize();
      }
      if (session.fd !== undefined) {
        closeSync(session.fd);
        session.fd = undefined;
      }
      if (session.muxer) {
        return { localPath: session.localPath };
      }
      return { message: "录屏没有写入任何视频帧" };
    } catch (error) {
      if (session.fd !== undefined) {
        try { closeSync(session.fd); } catch { /* 已关闭 */ }
        session.fd = undefined;
      }
      return {
        message: `录屏文件收尾失败：${error instanceof Error ? error.message : String(error)}`
      };
    }
  }

  private endWithError(session: RecorderSession, message: string): void {
    if (this.sessions.get(session.serial) !== session) return;
    this.sessions.delete(session.serial);
    session.ended = true;
    void session.close().catch(() => undefined);
    this.finalizeSession(session);
    this.onEnded({ serial: session.serial, ok: false, message });
  }
}
