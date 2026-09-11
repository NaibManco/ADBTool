import {
  useEffect,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent
} from "react";
import { WebCodecsVideoDecoder } from "@yume-chan/scrcpy-decoder-webcodecs";
import type { ScrcpyVideoCodecId } from "@yume-chan/scrcpy";
import { normalizedPoint, wheelToScroll } from "./mirror-control";

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
  const hostRef = useRef<HTMLDivElement>(null);
  const decoderRef = useRef<MirrorDecoder | null>(null);
  const packetControllerRef =
    useRef<ReadableStreamDefaultController<VideoPacket> | null>(null);

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
    const packets = new ReadableStream<VideoPacket>({
      start(controller) {
        packetControllerRef.current = controller;
      }
    });

    let closeTimer = 0;
    const scheduleClose = (delay = 0): void => {
      if (closeTimer) return;
      closeTimer = window.setTimeout(() => {
        closeTimer = 0;
        void window.androidTool.stopMirror(serial);
      }, delay);
    };

    let hasRun = false;
    const unsubscribe = window.androidTool.onMirrorEvent((event) => {
      if (event.serial !== serial) return;

      if (event.type === "video") {
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
        return;
      }
      if (event.message) setStatus(event.message);
      // 会话结束：运行过就直接关窗（设备断开对齐旧 scrcpy 行为）；
      // 从未运行说明是启动失败，留 4 秒展示错误再自动关闭
      decoderRef.current?.dispose();
      decoderRef.current = null;
      setDecoder(null);
      packetControllerRef.current?.close();
      packetControllerRef.current = null;
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

    return () => {
      host?.removeEventListener("wheel", handleWheel);
      unsubscribe();
      window.clearTimeout(closeTimer);
      void window.androidTool.stopEmbeddedMirror(serial);
      decoderRef.current?.dispose();
      decoderRef.current = null;
      packetControllerRef.current?.close();
      packetControllerRef.current = null;
    };
  }, [serial]);

  // 挂载后把解码画布放进宿主
  useEffect(() => {
    const host = hostRef.current;
    const canvas = canvasOf(decoder);
    if (host && canvas && canvas.parentElement !== host) {
      canvas.className = "mirror-canvas";
      host.replaceChildren(canvas);
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
        onPointerDown={(event) => {
          // 仅左键映射为触摸；右键留给"返回"，中键/侧键忽略
          if (event.button !== 0) return;
          event.currentTarget.setPointerCapture(event.pointerId);
          sendTouch("down", event);
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
        {!decoder && (
          <div className="mirror-empty">
            <span>&gt;_</span>
            <p>{status}</p>
          </div>
        )}
      </div>
    </main>
  );
}
