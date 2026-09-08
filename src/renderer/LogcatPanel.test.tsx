import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { AndroidDevice } from "../shared/types";
import { LogcatWorkspace } from "./LogcatPanel";

const devices: AndroidDevice[] = [
  {
    serial: "serial-one",
    state: "device",
    model: "Pixel_One",
    mirroring: false, mirroringEmbedded: false
  },
  {
    serial: "serial-two",
    state: "device",
    model: "Pixel_Two",
    mirroring: false, mirroringEmbedded: false
  }
];

describe("LogcatWorkspace", () => {
  it("keeps every device session mounted but shows one tab at a time", () => {
    const html = renderToStaticMarkup(
      <LogcatWorkspace
        devices={devices}
        availableDevices={devices}
        onAdd={() => undefined}
        onRemove={() => undefined}
        onClose={() => undefined}
      />
    );

    expect(html.match(/logcat-device-pane/g)).toHaveLength(2);
    expect(html.match(/class="logcat-device-pane"/g)).toHaveLength(1);
    expect(html.match(/class="logcat-device-pane pane-hidden"/g)).toHaveLength(1);
    expect(html.match(/role="tab"/g)).toHaveLength(2);
    expect(html).toContain('aria-selected="true"');
    expect(html).toContain('aria-selected="false"');
    expect(html).toContain("2 台设备正在采集");
    expect(html).toContain("应用进程");
    expect(html).toContain("Pixel One");
    expect(html).toContain("serial-one");
    expect(html).toContain("Pixel Two");
    expect(html).toContain("serial-two");
    expect(html).not.toContain("logcat-grid");
    expect(html).toContain("logcat-embedded");
    expect(html).not.toContain("logcat-overlay");
  });

  it("renders the query-driven toolbar affordances for the active pane", () => {
    const html = renderToStaticMarkup(
      <LogcatWorkspace
        devices={devices}
        availableDevices={devices}
        onAdd={() => undefined}
        onRemove={() => undefined}
        onClose={() => undefined}
      />
    );

    expect(html).toContain('aria-label="日志缓冲区"');
    expect(html).toContain("主缓冲");
    expect(html).toContain("系统");
    expect(html).toContain("崩溃");
    expect(html).toContain("无线电");
    expect(html).toContain("事件");
    expect(html).toContain('aria-label="日志等级"');
    expect(html).toContain("最近查询");
    expect(html).toContain('title="导出日志到文本文件"');
    expect(html).toContain('title="执行 adb logcat -c，仅清空当前所选缓冲区"');
    expect(html).toContain("清空显示");
    expect(html).toContain("跟随中");
    expect(html).toContain("支持 tag:/message:/pid:/tid:/level:/package:");
  });
});
