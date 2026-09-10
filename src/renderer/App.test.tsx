import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { AndroidDevice } from "../shared/types";
import {
  App,
  DeviceCard,
  DeviceRailCard,
  SettingsPanel,
  formatRecordingDuration
} from "./App";

describe("App", () => {
  it("keeps device controls and Logcat in one workbench", () => {
    const device: AndroidDevice = {
      serial: "serial-one",
      state: "device",
      model: "Pixel_One",
      mirroring: false, mirroringEmbedded: false
    };
    const card = renderToStaticMarkup(
      <DeviceCard
        device={device}
        busy={false}
        onMirror={async () => undefined}
        onAction={async () => undefined}
        onLogs={async () => undefined}
      />
    );
    const app = renderToStaticMarkup(<App />);
    const railCard = renderToStaticMarkup(
      <DeviceRailCard
        device={device}
        busy={false}
        selected={false}
        collapsed={false}
        recording={false}
        recordingSeconds={0}
        bugreporting={false}
        clipboardSync={false}
        onMirror={() => undefined}
        onTerminal={() => undefined}
        onClipboardSync={() => undefined}
        onAction={async () => undefined}
        onScreenshot={async () => undefined}
        onRecording={async () => undefined}
        onBugreport={async () => undefined}
        onLogs={() => undefined}
      />
    );

    expect(card).toContain("打开日志");
    expect(app).toContain("unified-workbench");
    expect(app).toContain("device-rail");
    expect(app).toContain("logcat-home");
    expect(app).toContain("应用管理");
    expect(app).toContain("文件管理");
    expect(app).toContain("设备信息");
    expect(railCard).toContain("重启设备");
    expect(railCard).not.toContain("清除应用数据");
    expect(railCard).toContain("屏幕截图");
    expect(railCard).not.toContain("保存截图");
    expect(railCard).not.toContain("复制截图");
    expect(railCard).toContain("开始录屏");
    expect(railCard).toContain("导出 Bugreport");
    expect(app).not.toContain('role="dialog"');
  });

  it("formats per-device recording elapsed time", () => {
    expect(formatRecordingDuration(0)).toBe("00:00");
    expect(formatRecordingDuration(65)).toBe("01:05");
  });

  it("offers dark and light choices in settings", () => {
    const html = renderToStaticMarkup(
      <SettingsPanel
        theme="dark"
        onThemeChange={() => undefined}
        onClose={() => undefined}
      />
    );

    expect(html).toContain("外观设置");
    expect(html).toContain("深色模式");
    expect(html).toContain("浅色模式");
    expect(html).toContain('aria-checked="true"');
    expect(html).toContain('aria-checked="false"');
  });
});
