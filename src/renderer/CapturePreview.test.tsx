import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { CaptureMedia } from "../shared/types";
import {
  CapturePreview,
  calculateFitImageZoom,
  clampImageZoom,
  formatMediaSize,
  nextWheelZoom
} from "./CapturePreview";

const image: CaptureMedia = {
  id: "image-one",
  kind: "image",
  name: "Screenshot-serial-one.png",
  mimeType: "image/png",
  size: 2_048,
  createdAt: 1_000,
  deviceSerial: "serial-one",
  url: "android-dev-capture://media/image-one",
  width: 1080,
  height: 2400
};

const video: CaptureMedia = {
  ...image,
  id: "video-one",
  kind: "video",
  name: "ScreenRecording-serial-one.mp4",
  mimeType: "video/mp4",
  url: "android-dev-capture://media/video-one",
  width: undefined,
  height: undefined
};

describe("CapturePreview", () => {
  it("renders image actions, zoom controls, and image information", () => {
    const html = renderToStaticMarkup(
      <CapturePreview media={image} onClose={() => undefined} />
    );

    expect(html).toContain("截图预览");
    expect(html).toContain("复制");
    expect(html).toContain("另存为");
    expect(html).toContain("适应窗口");
    expect(html).toContain("图片信息");
    expect(html).toContain("1080 × 2400");
    expect(html).toContain('class="capture-image-canvas"');
    expect(html).toContain('src="android-dev-capture://media/image-one"');
  });

  it("renders a standard video player with zoom toolbar and save action", () => {
    const html = renderToStaticMarkup(
      <CapturePreview media={video} onClose={() => undefined} />
    );

    expect(html).toContain("录屏预览");
    expect(html).toContain("<video");
    expect(html).toContain('capture-video-stage fit');
    expect(html).toContain("controls");
    expect(html).toContain("另存为");
    expect(html).toContain("视频信息");
    // 视频与图片共用缩放工具栏：默认适应窗口，可缩放/还原 100%
    expect(html).toContain("适应窗口");
    expect(html).toContain("100%");
    expect(html).not.toContain(">复制<");
  });

  it("keeps zoom and file-size formatting within readable bounds", () => {
    expect(clampImageZoom(5)).toBe(25);
    expect(clampImageZoom(175)).toBe(175);
    expect(clampImageZoom(800)).toBe(400);
    expect(formatMediaSize(2_048)).toBe("2.00 KB");
  });

  it("starts wheel zoom from the fitted size and follows wheel direction", () => {
    expect(calculateFitImageZoom(800, 600, 1080, 2400)).toBe(25);
    expect(calculateFitImageZoom(1200, 2600, 1080, 2400)).toBe(100);
    expect(nextWheelZoom(50, -120)).toBe(75);
    expect(nextWheelZoom(50, 120)).toBe(25);
    expect(nextWheelZoom(50, 0)).toBe(50);
  });
});
