import { useMemo, useState } from "react";
import type { ActionResult, AndroidDevice } from "../shared/types";

function deviceName(device: AndroidDevice): string {
  return device.model?.replaceAll("_", " ") || device.product || "Android 设备";
}

type BusyKind = "usb" | "pair" | "connect";

export function WirelessConnect({
  devices,
  onClose
}: {
  devices: AndroidDevice[];
  onClose: () => void;
}) {
  const usbDevices = useMemo(
    () =>
      devices.filter(
        (device) => device.state === "device" && !device.serial.includes(":")
      ),
    [devices]
  );
  const [usbSerial, setUsbSerial] = useState(usbDevices[0]?.serial ?? "");
  const [pairHost, setPairHost] = useState("");
  const [pairPort, setPairPort] = useState("");
  const [pairCode, setPairCode] = useState("");
  const [connectHost, setConnectHost] = useState("");
  const [connectPort, setConnectPort] = useState("");
  const [busy, setBusy] = useState<BusyKind>();
  const [status, setStatus] = useState<ActionResult>();

  async function run(
    kind: BusyKind,
    operation: () => Promise<ActionResult>
  ): Promise<void> {
    setBusy(kind);
    setStatus(undefined);
    try {
      setStatus(await operation());
    } catch (error) {
      setStatus({
        ok: false,
        message: error instanceof Error ? error.message : String(error)
      });
    } finally {
      setBusy(undefined);
    }
  }

  function connectViaUsb(): void {
    if (!usbSerial) return;
    void run("usb", () => window.androidTool.connectWirelessViaUsb(usbSerial));
  }

  function pair(): void {
    if (!pairHost.trim() || !pairPort.trim() || !pairCode.trim()) {
      setStatus({ ok: false, message: "请填写配对 IP、端口和配对码" });
      return;
    }
    void run("pair", () =>
      window.androidTool.pairWireless(
        pairHost.trim(),
        Number(pairPort),
        pairCode.trim()
      )
    );
  }

  function connect(): void {
    if (!connectHost.trim() || !connectPort.trim()) {
      setStatus({ ok: false, message: "请填写设备 IP 和端口" });
      return;
    }
    void run("connect", () =>
      window.androidTool.connectWireless(
        connectHost.trim(),
        Number(connectPort)
      )
    );
  }

  return (
    <div className="settings-overlay" role="presentation">
      <section
        className="settings-panel wireless-panel"
        role="dialog"
        aria-modal="true"
        aria-labelledby="wireless-title"
      >
        <header>
          <div>
            <h2 id="wireless-title">无线连接设备</h2>
            <p>通过 Wi-Fi 使用 ADB 调试，摆脱 USB 线</p>
          </div>
          <button className="settings-close" onClick={onClose} title="关闭">
            ×
          </button>
        </header>

        <div className="settings-group">
          <h3>方式一：USB 一键转无线</h3>
          <p className="wireless-hint">
            适合手机正用 USB 线连着电脑的场景：自动读取设备 Wi-Fi 地址并切换到无线，成功后即可拔线。
          </p>
          <div className="wireless-row">
            {usbDevices.length === 0 ? (
              <p className="wireless-empty">当前没有 USB 连接的在线设备</p>
            ) : (
              <select
                value={usbSerial}
                onChange={(event) => setUsbSerial(event.target.value)}
                aria-label="选择 USB 设备"
              >
                {usbDevices.map((device) => (
                  <option key={device.serial} value={device.serial}>
                    {deviceName(device)} · {device.serial}
                  </option>
                ))}
              </select>
            )}
            <button
              className="wireless-primary"
              disabled={!usbSerial || busy !== undefined}
              onClick={connectViaUsb}
            >
              {busy === "usb" ? "正在连接…" : "一键无线连接"}
            </button>
          </div>
        </div>

        <div className="settings-group">
          <h3>方式二：Android 11+ 无线调试</h3>
          <p className="wireless-hint">
            在手机「开发者选项 → 无线调试 → 使用配对码配对设备」中查看配对地址与配对码；每台新设备首次连接前需配对一次。
          </p>
          <div className="wireless-fields">
            <input
              value={pairHost}
              onChange={(event) => setPairHost(event.target.value)}
              placeholder="配对 IP，如 192.168.1.5"
              spellCheck={false}
              disabled={busy !== undefined}
            />
            <input
              value={pairPort}
              onChange={(event) => setPairPort(event.target.value)}
              placeholder="配对端口"
              inputMode="numeric"
              spellCheck={false}
              disabled={busy !== undefined}
            />
            <input
              value={pairCode}
              onChange={(event) => setPairCode(event.target.value)}
              placeholder="配对码（数字）"
              inputMode="numeric"
              spellCheck={false}
              disabled={busy !== undefined}
            />
            <button disabled={busy !== undefined} onClick={pair}>
              {busy === "pair" ? "正在配对…" : "配对"}
            </button>
          </div>
          <p className="wireless-hint">
            配对成功后，用无线调试主界面显示的「IP 地址和端口」连接（不是配对端口）：
          </p>
          <div className="wireless-fields">
            <input
              value={connectHost}
              onChange={(event) => setConnectHost(event.target.value)}
              placeholder="设备 IP，如 192.168.1.5"
              spellCheck={false}
              disabled={busy !== undefined}
            />
            <input
              value={connectPort}
              onChange={(event) => setConnectPort(event.target.value)}
              placeholder="端口"
              inputMode="numeric"
              spellCheck={false}
              disabled={busy !== undefined}
            />
            <button disabled={busy !== undefined} onClick={connect}>
              {busy === "connect" ? "正在连接…" : "连接"}
            </button>
          </div>
        </div>

        {status && (
          <div
            className={
              status.ok ? "wireless-status success" : "wireless-status error"
            }
          >
            {status.message || (status.ok ? "操作完成" : "操作失败")}
          </div>
        )}
      </section>
    </div>
  );
}
