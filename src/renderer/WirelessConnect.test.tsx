import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { AndroidDevice } from "../shared/types";
import { WirelessConnect } from "./WirelessConnect";

const devices: AndroidDevice[] = [
  {
    serial: "serial-one",
    state: "device",
    model: "Pixel_One",
    mirroring: false,
    mirroringEmbedded: false
  },
  {
    serial: "192.168.1.5:5555",
    state: "device",
    model: "Pixel_Two",
    mirroring: false,
    mirroringEmbedded: false
  }
];

describe("WirelessConnect", () => {
  it("offers the USB one-click path and the pairing flow side by side", () => {
    const html = renderToStaticMarkup(
      <WirelessConnect devices={devices} onClose={() => undefined} />
    );

    expect(html).toContain("无线连接设备");
    expect(html).toContain("方式一：USB 一键转无线");
    expect(html).toContain("一键无线连接");
    expect(html).toContain("方式二：Android 11+ 无线调试");
    expect(html).toContain("配对 IP，如 192.168.1.5");
    expect(html).toContain("配对码（数字）");
    expect(html).toContain("设备 IP，如 192.168.1.5");
  });

  it("only lists USB devices for the one-click conversion", () => {
    const html = renderToStaticMarkup(
      <WirelessConnect devices={devices} onClose={() => undefined} />
    );

    expect(html).toContain("serial-one");
    expect(html).not.toContain('value="192.168.1.5:5555"');
  });

  it("explains when no USB device is connected", () => {
    const html = renderToStaticMarkup(
      <WirelessConnect devices={[]} onClose={() => undefined} />
    );

    expect(html).toContain("当前没有 USB 连接的在线设备");
  });
});
