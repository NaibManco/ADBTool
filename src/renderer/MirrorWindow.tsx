import {
  useEffect,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent
} from "react";
import { Monitor, ShieldWarning, PushPin, PushPinSlash } from "@phosphor-icons/react";
import { WebCodecsVideoDecoder } from "@yume-chan/scrcpy-decoder-webcodecs";
import type { ScrcpyVideoCodecId } from "@yume-chan/scrcpy";
import { normalizedPoint, wheelToScroll } from "./mirror-control";
import { MirrorKeyboardInput } from "./mirror-keyboard-input";

type MirrorDecoder = InstanceType<typeof WebCodecsVideoDecoder>;

// 基类 VideoFrameRenderer 未声明 canvas，默认 AutoCanvasRenderer 实际持有
function canvasOf(decoder: MirrorDecoder | null): HTMLCanvasElement | undefined {
  const canvas = (
    decoder?.renderer as unknown as
      | { canvas?: HTMLCanvasElement | OffscreenCanvas }
      | undefined
  )?.canvas;
  return canvas instanceof HTMLCanvasElement ? canvas : undefined;
}

type VideoPacket = {
  type: "configuration" | "data" | "session";
  data?: Uint8Array;
  keyframe?: boolean;
  pts?: bigint;
  width?: number;
  height?: number;
  isClientResize?: boolean;
};

// 独立投屏窗口：与内嵌 MirrorPane 共用主进程的 yume-chan 会话（事件广播到全部窗口），
// 这里只负责解码显示与控制输入，无面板装饰。
// 会话结束（设备断开等）自动关窗，对齐旧 scrcpy.exe 的行为。
export function MirrorWindow(): React.ReactElement {
  const params = new URLSearchParams(window.location.search);
  const serial = params.get("serial") ?? "";
  const label = params.get("label") ?? serial;
  const [status, setStatus] = useState("正在连接…");
  const [decoder, setDecoder] = useState<MirrorDecoder | null>(null);
  const [running, setRunning] = useState(false);
  const [screenOff, setScreenOff] = useState(false);
  const [alwaysOnTop, setAlwaysOnTop] = useState(false);
  const hostRef = useRef<HTMLDivElement>(null);
  const canvasHostRef = useRef<HTMLDivElement>(null);
  const keyboardRef = useRef<HTMLInputElement>(null);
  const decoderRef = useRef<MirrorDecoder | null>(null);
  const packetControllerRef =
    useRef<ReadableStreamDefaultController<VideoPacket> | null>(null);

  async function toggleScreenOff(): Promise<void> {
    const next = !screenOff;
    const result = await window.androidTool.setMirrorScreenPower(
      serial,
      !next
    );
    if (result.ok) {
      setScreenOff(next);
      setStatus(next ? "设备已息屏（画面仍在投屏）" : "设备屏幕已点亮");
    } else {
      setStatus(result.message || "息屏控制失败");
    }
  }

  async function toggleAlwaysOnTop(): Promise<void> {
    const next = !alwaysOnTop;
    const result = await window.androidTool.setMirrorWindowAlwaysOnTop(
      serial,
      next
    );
    if (result.ok) {
      setAlwaysOnTop(next);
    } else {
      setStatus(result.message || "置顶失败");
    }
  }

  useEffect(() => {
    if (!serial) {
      setStatus("缺少设备序列号参数");
      return;
    }
    if (!WebCodecsVideoDecoder.isSupported) {
      setStatus("当前环境不支持 WebCodecs 视频解码");
      return;
    }

    // React 的 onWheel 是被动监听，preventDefault 无效；用原生非被动监听
    const host = hostRef.current;
    const handleWheel = (event: WheelEvent): void => {
      event.preventDefault();
      const canvas = canvasOf(decoderRef.current);
      if (!canvas) return;
      const point = normalizedPoint(
        canvas.getBoundingClientRect(),
        event.clientX,
        event.clientY
      );
      window.androidTool.sendMirrorControl(serial, {
        type: "scroll",
        x: point.x,
        y: point.y,
        ...wheelToScroll(event.deltaX, event.deltaY)
      });
    };
    host?.addEventListener("wheel", handleWheel, { passive: false });

    // 先建好包队列，meta 到达前到达的视频包也不丢
    const createPackets = (): ReadableStream<VideoPacket> =>
      new ReadableStream<VideoPacket>({
        start(controller) {
          packetControllerRef.current = controller;
        }
      });
    let packets = createPackets();

    // 释放当前解码管线（画质瞬断软重建/真停止共用）
    const releasePipeline = (): void => {
      decoderRef.current?.dispose();
      decoderRef.current = null;
      setDecoder(null);
      packetControllerRef.current?.close();
      packetControllerRef.current = null;
      packets = createPackets();
      configured = false;
    };

    let closeTimer = 0;
    const scheduleClose = (delay = 0): void => {
      if (closeTimer) return;
      closeTimer = window.setTimeout(() => {
        closeTimer = 0;
        void window.androidTool.stopMirror(serial);
      }, delay);
    };

    let hasRun = false;
    // 晚接入观众（本窗口经 resync 接入活跃会话）订阅瞬间数据流已在广播，
    // 裸 data 包可能抢在 configuration 之前入队：解码管道未配置就收到
    // data 会报错并关闭整条流（表现为永久黑屏）。这里按 scrcpy 播放器
    // 语义门控——配置未到丢弃 data，配置后等首个关键帧再喂数据
    // （i-frame-interval=2，最坏 ~2s 出画）。
    let configured = false;
    let awaitingKeyframe = false;
    const unsubscribe = window.androidTool.onMirrorEvent((event) => {
      if (event.serial !== serial) return;

      if (event.type === "video") {
        if (event.kind === "configuration") {
          configured = true;
          awaitingKeyframe = true;
        } else if (event.kind === "data") {
          if (!configured) return;
          if (awaitingKeyframe && !event.keyframe) return;
          awaitingKeyframe = false;
        }
        packetControllerRef.current?.enqueue({
          type: event.kind,
          data: event.data,
          keyframe: event.keyframe,
          pts: event.pts,
          width: event.width,
          height: event.height,
          isClientResize: event.isClientResize
        });
        return;
      }

      if (event.type === "meta") {
        // 画质瞬断软清理后 decoderRef 已空，新 meta 在此全新建管线
        if (decoderRef.current) return;
        const created = new WebCodecsVideoDecoder({
          codec: event.codec as ScrcpyVideoCodecId
        });
        decoderRef.current = created;
        // 包结构与 scrcpy 流包逐字段对应，做一次类型桥接
        void packets.pipeTo(
          created.writable as unknown as Parameters<typeof packets.pipeTo>[0]
        ).catch(() => undefined);
        setDecoder(created);
        setStatus("投屏中");
        return;
      }

      if (event.running) {
        hasRun = true;
        setRunning(true);
        setStatus("投屏中");
        return;
      }
      // 画质切换的瞬断：软清理解码管线等新 meta，重连由主进程统一调度
      if (event.reason === "quality-change") {
        setRunning(false);
        setStatus(event.message || "正在按新画质重连…");
        releasePipeline();
        return;
      }
      setRunning(false);
      if (event.message) setStatus(event.message);
      // 会话结束：运行过就直接关窗（设备断开对齐旧 scrcpy 行为）；
      // 从未运行说明是启动失败，留 4 秒展示错误再自动关闭
      releasePipeline();
      scheduleClose(hasRun ? 0 : 4_000);
    });

    void window.androidTool
      .startEmbeddedMirror(serial)
      .then((result) => {
        if (!result.ok) {
          setStatus(result.message || "投屏启动失败");
          scheduleClose(4_000);
        }
      });
    // 窗口打开即聚焦隐形输入框：键盘（含中文 IME）输入直接进设备
    keyboardRef.current?.focus();

    return () => {
      host?.removeEventListener("wheel", handleWheel);
      unsubscribe();
      window.clearTimeout(closeTimer);
      void window.androidTool.stopEmbeddedMirror(serial);
      releasePipeline();
    };
  }, [serial]);

  // 挂载后把解码画布放进宿主（专用空容器，React 不往里渲染，
  // 避免绕过 React 改 DOM 导致 diff 崩树，同 MirrorPane 注释）
  useEffect(() => {
    const canvasHost = canvasHostRef.current;
    const canvas = canvasOf(decoder);
    if (canvasHost && canvas && canvas.parentElement !== canvasHost) {
      canvas.className = "mirror-canvas";
      canvasHost.replaceChildren(canvas);
    }
  }, [decoder]);

  // 页面 document.title 会覆盖 BrowserWindow 的 title 选项，这里补上设备标识
  useEffect(() => {
    document.title = `Android Dev Tool - ${label} [${serial}]`;
  }, [label, serial]);

  function sendTouch(
    action: "down" | "move" | "up",
    event: ReactPointerEvent<HTMLDivElement>
  ): void {
    const canvas = canvasOf(decoderRef.current);
    if (!canvas) return;
    const point = normalizedPoint(
      canvas.getBoundingClientRect(),
      event.clientX,
      event.clientY
    );
    window.androidTool.sendMirrorControl(serial, {
      type: "touch",
      action,
      pointerId: event.pointerId,
      x: point.x,
      y: point.y
    });
  }

  return (
    <main className="mirror-window">
      <div
        className="mirror-window-host"
        ref={hostRef}
        tabIndex={-1}
        onPointerDown={(event) => {
          // 仅左键映射为触摸；右键留给"返回"，中键/侧键忽略
          if (event.button !== 0) return;
          // 阻止 mousedown 默认把焦点抢到本 div，否则 focus() 在同一次
          // 点击内被默认动作覆盖，键盘输入全部落空
          event.preventDefault();
          keyboardRef.current?.focus();
          event.currentTarget.setPointerCapture(event.pointerId);
          sendTouch("down", event);
        }}
        onMouseDown={(event) => {
          // 双保险：pointerdown 的取消在个别 Chromium 版本不抑制兼容鼠标
          // 事件的默认动作，这里再拦一次焦点抢占
          if (event.button === 0) event.preventDefault();
        }}
        onPointerMove={(event) => {
          if (event.buttons & 1) sendTouch("move", event);
        }}
        onPointerUp={(event) => {
          if (event.button !== 0) return;
          sendTouch("up", event);
        }}
        onPointerCancel={(event) => {
          // pointercancel 的 button 恒为 -1，这里必须无条件发送抬起，
          // 否则设备端触摸会卡在按下状态
          sendTouch("up", event);
        }}
        onContextMenu={(event) => {
          event.preventDefault();
          window.androidTool.sendMirrorControl(serial, { type: "back" });
        }}
      >
        {/* canvas 专用空容器：子节点由解码 effect 全权管理 */}
        <div className="mirror-canvas-host" ref={canvasHostRef} />
        <div className="mirror-window-tools">
          <button
            className={alwaysOnTop ? "mirror-tool on" : "mirror-tool"}
            onClick={() => void toggleAlwaysOnTop()}
            title={alwaysOnTop ? "取消窗口置顶" : "窗口置顶"}
          >
            {alwaysOnTop ? <PushPin size={15} weight="fill" /> : <PushPinSlash size={15} />}
          </button>
          <button
            className={screenOff ? "mirror-tool on" : "mirror-tool"}
            onClick={() => void toggleScreenOff()}
            disabled={!running}
            title={screenOff ? "点亮设备屏幕" : "设备息屏（画面继续投屏）"}
          >
            {screenOff ? <ShieldWarning size={15} /> : <Monitor size={15} />}
          </button>
        </div>
        {!decoder && (
          <div className="mirror-empty">
            <span>&gt;_</span>
            <p>{status}</p>
          </div>
        )}
        <MirrorKeyboardInput ref={keyboardRef} serial={serial} />
      </div>
    </main>
  );
}
