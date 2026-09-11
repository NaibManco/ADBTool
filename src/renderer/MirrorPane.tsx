import {
  useEffect,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent
} from "react";
import { ArrowSquareOut } from "@phosphor-icons/react";
import { WebCodecsVideoDecoder } from "@yume-chan/scrcpy-decoder-webcodecs";
import type { ScrcpyVideoCodecId } from "@yume-chan/scrcpy";
import type { AndroidDevice } from "../shared/types";
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

function deviceLabel(device: AndroidDevice): string {
  return device.model?.replaceAll("_", " ") || device.product || device.serial;
}

export function MirrorPane({
  device,
  active,
  onMirrorWindow,
  onClose
}: {
  device: AndroidDevice;
  active: boolean;
  onMirrorWindow: () => Promise<void>;
  onClose: () => void;
}) {
  const [status, setStatus] = useState("正在连接…");
  const [running, setRunning] = useState(false);
  const [decoder, setDecoder] = useState<MirrorDecoder | null>(null);
  const externalWindow =
    device.mirroring && !device.mirroringEmbedded;
  const hostRef = useRef<HTMLDivElement>(null);
  const decoderRef = useRef<MirrorDecoder | null>(null);
  const packetControllerRef =
    useRef<ReadableStreamDefaultController<VideoPacket> | null>(null);

  useEffect(() => {
    if (!WebCodecsVideoDecoder.isSupported) {
      setStatus("当前环境不支持 WebCodecs 视频解码，无法内嵌投屏");
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
      window.androidTool.sendMirrorControl(device.serial, {
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

    // 晚接入观众（页面刷新后面板重开，经 resync 接入活跃会话）可能拿到
    // 先于 configuration 的裸 data 包：解码管道未配置就收到 data 会报错
    // 并关闭整条流（黑屏）。配置未到丢弃 data，配置后等首个关键帧再喂。
    let configured = false;
    let awaitingKeyframe = false;
    const unsubscribe = window.androidTool.onMirrorEvent((event) => {
      if (event.serial !== device.serial) return;

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

      setRunning(event.running);
      if (event.message) setStatus(event.message);
      if (!event.running) {
        decoderRef.current?.dispose();
        decoderRef.current = null;
        setDecoder(null);
        packetControllerRef.current?.close();
        packetControllerRef.current = null;
        configured = false;
      }
    });

    void window.androidTool
      .startEmbeddedMirror(device.serial)
      .then((result) => {
        if (!result.ok) setStatus(result.message || "内嵌投屏启动失败");
      });

    return () => {
      host?.removeEventListener("wheel", handleWheel);
      unsubscribe();
      void window.androidTool.stopEmbeddedMirror(device.serial);
      decoderRef.current?.dispose();
      decoderRef.current = null;
      packetControllerRef.current?.close();
      packetControllerRef.current = null;
    };
  }, [device.serial]);

  // 挂载/切换可见性时把解码画布放进宿主，并按激活状态暂停/恢复解码
  useEffect(() => {
    const host = hostRef.current;
    const canvas = canvasOf(decoder);
    if (host && canvas && canvas.parentElement !== host) {
      canvas.className = "mirror-canvas";
      host.replaceChildren(canvas);
    }
    if (!decoder) return;
    // 停止投屏的事件回调会同步 dispose 解码器，而这里的闭包可能还持着
    // 旧实例（状态更新尚未重跑本效果）；对已释放实例 resume/pause 会抛
    // "Attempt to resume/pause a closed decoder" 并炸掉整棵组件树
    if (active) {
      try {
        decoder.resume();
      } catch {
        // 已释放，忽略
      }
    } else {
      try {
        decoder.pause();
      } catch {
        // 已释放，忽略
      }
    }
  }, [decoder, active]);

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
    window.androidTool.sendMirrorControl(device.serial, {
      type: "touch",
      action,
      pointerId: event.pointerId,
      x: point.x,
      y: point.y
    });
  }

  return (
    <section className={active ? "mirror-pane" : "mirror-pane pane-hidden"}>
      <header className="mirror-header">
        <div>
          <strong>{deviceLabel(device)}</strong>
          <code>{device.serial}</code>
        </div>
        <span className={running ? "mirror-state on" : "mirror-state"}>
          {status}
        </span>
        <button
          className={externalWindow ? "mirror-popout on" : "mirror-popout"}
          onClick={() => void onMirrorWindow()}
          title={externalWindow ? "关闭外部投屏窗口" : "弹出独立投屏窗口"}
        >
          <ArrowSquareOut size={14} />
        </button>
        <button className="mirror-close" onClick={onClose} title="关闭投屏">
          ×
        </button>
      </header>
      <div
        className="mirror-host"
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
          window.androidTool.sendMirrorControl(device.serial, { type: "back" });
        }}
      >
        {!decoder && (
          <div className="mirror-empty">
            <span>&gt;_</span>
            <p>{status}</p>
          </div>
        )}
      </div>
    </section>
  );
}
