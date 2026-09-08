import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { AndroidDevice } from "../shared/types";
import { ClearAppDataDialog } from "./ClearAppDataDialog";

const device: AndroidDevice = {
  serial: "serial-one",
  state: "device",
  model: "Pixel_One",
  mirroring: false, mirroringEmbedded: false
};

describe("ClearAppDataDialog", () => {
  it("shows a searchable package list and destructive action warning", () => {
    const html = renderToStaticMarkup(
      <ClearAppDataDialog
        device={device}
        initialPackages={["com.example.alpha", "com.example.beta"]}
        onClose={() => undefined}
      />
    );

    expect(html).toContain("清除应用数据");
    expect(html).toContain("com.example.alpha");
    expect(html).toContain("com.example.beta");
    expect(html).toContain("此操作无法撤销");
    expect(html).toContain("选择应用后清除");
  });
});
