import {
  useEffect,
  useRef,
  useState,
  type SyntheticEvent,
  type WheelEvent
} from "react";
import {
  ArrowsOutSimple,
  Copy,
  FloppyDisk,
  ImageSquare,
  MagnifyingGlassMinus,
  MagnifyingGlassPlus,
  VideoCamera,
  X
} from "@phosphor-icons/react";
import type { ActionResult, CaptureMedia } from "../shared/types";

const MIN_ZOOM = 25;
const MAX_ZOOM = 400;
const ZOOM_STEP = 25;

export function clampImageZoom(zoom: number): number {
  return Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, Math.round(zoom)));
}

export function calculateFitImageZoom(
  viewportWidth: number,
  viewportHeight: number,
  imageWidth: number,
  imageHeight: number
): number {
  if (viewportWidth <= 0 || viewportHeight <= 0 || imageWidth <= 0 || imageHeight <= 0) {
    return 100;
  }
  return clampImageZoom(
    Math.min(1, viewportWidth / imageWidth, viewportHeight / imageHeight) * 100
  );
}

export function nextWheelZoom(current: number, deltaY: number): number {
  if (deltaY === 0) return clampImageZoom(current);
  return clampImageZoom(current + (deltaY < 0 ? ZOOM_STEP : -ZOOM_STEP));
}

export function formatMediaSize(bytes: number): string {
  if (bytes < 1_024) return `${bytes} B`;
  if (bytes < 1_024 ** 2) return `${(bytes / 1_024).toFixed(2)} KB`;
  if (bytes < 1_024 ** 3) return `${(bytes / 1_024 ** 2).toFixed(2)} MB`;
  return `${(bytes / 1_024 ** 3).toFixed(2)} GB`;
}

function formatVideoDuration(seconds?: number): string {
  if (seconds === undefined || !Number.isFinite(seconds)) return "正在读取…";
  const total = Math.max(0, Math.floor(seconds));
  const hours = Math.floor(total / 3_600);
  const minutes = Math.floor((total % 3_600) / 60);
  const remaining = total % 60;
  return hours > 0
    ? `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}:${String(remaining).padStart(2, "0")}`
    : `${String(minutes).padStart(2, "0")}:${String(remaining).padStart(2, "0")}`;
}

export function CapturePreview({
  media,
  onClose
}: {
  media: CaptureMedia;
  onClose: () => void;
}) {
  const stageRef = useRef<HTMLDivElement>(null);
  const [zoom, setZoom] = useState(100);
  const [fitMedia, setFitMedia] = useState(true);
  const [operating, setOperating] = useState(false);
  const [status, setStatus] = useState<ActionResult>();
  const [videoInfo, setVideoInfo] = useState<{
    duration: number;
    width: number;
    height: number;
  }>();

  useEffect(() => {
    setZoom(100);
    setFitMedia(true);
    setOperating(false);
    setStatus(undefined);
    setVideoInfo(undefined);
  }, [media.id]);

  async function run(action: () => Promise<ActionResult>): Promise<void> {
    setOperating(true);
    setStatus(undefined);
    try {
      const result = await action();
      if (!result.cancelled) setStatus(result);
    } catch (error) {
      setStatus({
        ok: false,
        message: error instanceof Error ? error.message : String(error)
      });
    } finally {
      setOperating(false);
    }
  }

  function currentFitZoom(): number {
    const stage = stageRef.current;
    const width = isImage ? media.width : videoInfo?.width;
    const height = isImage ? media.height : videoInfo?.height;
    if (!stage || !width || !height) return 100;
    return calculateFitImageZoom(
      stage.clientWidth,
      stage.clientHeight,
      width,
      height
    );
  }

  function centerAfterRender(): void {
    window.requestAnimationFrame(() => {
      window.requestAnimationFrame(() => {
        const stage = stageRef.current;
        if (!stage) return;
        stage.scrollLeft = Math.max(0, (stage.scrollWidth - stage.clientWidth) / 2);
        stage.scrollTop = Math.max(0, (stage.scrollHeight - stage.clientHeight) / 2);
      });
    });
  }

  function changeZoom(delta: number): void {
    const baseZoom = fitMedia ? currentFitZoom() : zoom;
    setFitMedia(false);
    setZoom(clampImageZoom(baseZoom + delta));
    centerAfterRender();
  }

  function handleStageWheel(event: WheelEvent<HTMLDivElement>): void {
    event.preventDefault();
    if (event.deltaY === 0) return;
    const baseZoom = fitMedia ? currentFitZoom() : zoom;
    setFitMedia(false);
    setZoom(nextWheelZoom(baseZoom, event.deltaY));
    centerAfterRender();
  }

  function readVideoInfo(event: SyntheticEvent<HTMLVideoElement>): void {
    const video = event.currentTarget;
    setVideoInfo({
      duration: video.duration,
      width: video.videoWidth,
      height: video.videoHeight
    });
  }

  const isImage = media.kind === "image";
  const previewTitle = isImage ? "截图预览" : "录屏预览";
  const MediaIcon = isImage ? ImageSquare : VideoCamera;
  const width = isImage ? media.width : videoInfo?.width;
  const height = isImage ? media.height : videoInfo?.height;
  const mediaWidth = isImage ? media.width : videoInfo?.width;

  return (
    <section className="capture-preview" aria-label={previewTitle}>
      <header className="capture-preview-header">
        <div className="capture-preview-title">
          <span><MediaIcon size={20} weight="duotone" /></span>
          <div>
            <h2>{previewTitle}</h2>
            <p title={media.name}>{media.name}</p>
          </div>
        </div>
        <div className="capture-preview-actions">
          {isImage && (
            <button
              disabled={operating}
              onClick={() => void run(() => window.androidTool.copyCaptureMedia(media.id))}
            >
              <Copy size={15} />
              复制
            </button>
          )}
          <button
            disabled={operating}
            onClick={() => void run(() => window.androidTool.saveCaptureMediaAs(media.id))}
          >
            <FloppyDisk size={15} />
            另存为
          </button>
          <button className="capture-preview-close" onClick={onClose} title="关闭预览">
            <X size={17} />
          </button>
        </div>
      </header>

      <div className="capture-preview-body">
        <main className="capture-preview-stage">
          {isImage ? (
            <div
              ref={stageRef}
              className={fitMedia ? "capture-image-stage fit" : "capture-image-stage"}
              onWheel={handleStageWheel}
            >
              <div className="capture-image-canvas">
                <img
                  src={media.url}
                  alt={`${media.name} 预览`}
                  draggable={false}
                  style={fitMedia || !media.width
                    ? undefined
                    : { width: `${media.width * zoom / 100}px` }}
                />
              </div>
            </div>
          ) : (
            <div
              ref={stageRef}
              className={fitMedia ? "capture-video-stage fit" : "capture-video-stage"}
              onWheel={handleStageWheel}
            >
              <video
                key={media.id}
                src={media.url}
                controls
                preload="metadata"
                onLoadedMetadata={readVideoInfo}
                style={fitMedia || !mediaWidth
                  ? undefined
                  : { width: `${mediaWidth * zoom / 100}px` }}
              >
                当前系统无法播放该录屏文件。
              </video>
            </div>
          )}
        </main>

        <aside className="capture-preview-info">
          <h3>{isImage ? "图片信息" : "视频信息"}</h3>
          <dl>
            <dt>文件名</dt><dd title={media.name}>{media.name}</dd>
            <dt>格式</dt><dd>{isImage ? "PNG" : "MP4"}</dd>
            <dt>大小</dt><dd>{formatMediaSize(media.size)}</dd>
            <dt>分辨率</dt><dd>{width && height ? `${width} × ${height}` : "正在读取…"}</dd>
            {!isImage && <><dt>时长</dt><dd>{formatVideoDuration(videoInfo?.duration)}</dd></>}
            <dt>设备</dt><dd><code>{media.deviceSerial}</code></dd>
            <dt>创建时间</dt><dd>{new Date(media.createdAt).toLocaleString()}</dd>
          </dl>
          {status && (
            <p className={status.ok ? "capture-preview-status success" : "capture-preview-status error"}>
              {status.message || (status.ok ? "操作完成" : "操作失败")}
            </p>
          )}
        </aside>
      </div>

      <footer className="capture-zoom-toolbar">
        <button onClick={() => changeZoom(-ZOOM_STEP)} disabled={!fitMedia && zoom <= MIN_ZOOM}>
          <MagnifyingGlassMinus size={15} />
          缩小
        </button>
        <strong>{fitMedia ? "适应" : `${zoom}%`}</strong>
        <button onClick={() => changeZoom(ZOOM_STEP)} disabled={!fitMedia && zoom >= MAX_ZOOM}>
          <MagnifyingGlassPlus size={15} />
          放大
        </button>
        <i />
        <button onClick={() => setFitMedia(true)} className={fitMedia ? "active" : ""}>
          <ArrowsOutSimple size={15} />
          适应窗口
        </button>
        <button onClick={() => {
          setFitMedia(false);
          setZoom(100);
          centerAfterRender();
        }}>
          100%
        </button>
      </footer>
    </section>
  );
}
