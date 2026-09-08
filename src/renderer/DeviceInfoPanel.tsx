import { useCallback, useEffect, useMemo, useState } from "react";
import {
  ArrowClockwise,
  BatteryHigh,
  Cpu,
  DeviceMobile,
  HardDrives,
  Monitor,
  WifiHigh,
  X
} from "@phosphor-icons/react";
import type { AndroidDevice, DeviceInfo } from "../shared/types";

function deviceName(device: AndroidDevice): string {
  return device.model?.replaceAll("_", " ") || device.product || "Android 设备";
}

function valueOf(value: string | number | undefined): string {
  return value === undefined || value === "" ? "—" : String(value);
}

export function formatDeviceInfoBytes(bytes?: number): string {
  if (bytes === undefined) return "—";
  if (bytes < 1024 ** 3) return `${(bytes / 1024 ** 2).toFixed(1)} MB`;
  return `${(bytes / 1024 ** 3).toFixed(1)} GB`;
}

export function formatDeviceUptime(seconds?: number): string {
  if (seconds === undefined) return "—";
  const days = Math.floor(seconds / 86_400);
  const hours = Math.floor((seconds % 86_400) / 3_600);
  const minutes = Math.floor((seconds % 3_600) / 60);
  return [days ? `${days} 天` : "", hours ? `${hours} 小时` : "", `${minutes} 分钟`]
    .filter(Boolean)
    .join(" ");
}

function poweredBy(info: DeviceInfo["battery"]): string {
  const sources = [
    info.acPowered ? "交流电" : "",
    info.usbPowered ? "USB" : "",
    info.wirelessPowered ? "无线充电" : ""
  ].filter(Boolean);
  return sources.length ? sources.join("、") : "未接电源";
}

function InfoCard({
  title,
  icon: Icon,
  rows
}: {
  title: string;
  icon: typeof Cpu;
  rows: Array<[string, string]>;
}) {
  return (
    <section className="device-info-card">
      <header><Icon size={18} weight="duotone" /><h3>{title}</h3></header>
      <dl>
        {rows.map(([label, value]) => (
          <div key={label}>
            <dt>{label}</dt>
            <dd title={value}>{value}</dd>
          </div>
        ))}
      </dl>
    </section>
  );
}

export function DeviceInfoPanel({
  devices,
  initialInfo,
  onClose
}: {
  devices: AndroidDevice[];
  initialInfo?: DeviceInfo;
  onClose: () => void;
}) {
  const onlineDevices = useMemo(
    () => devices.filter((device) => device.state === "device"),
    [devices]
  );
  const [serial, setSerial] = useState(
    initialInfo?.serial ?? onlineDevices[0]?.serial ?? ""
  );
  const [info, setInfo] = useState<DeviceInfo | undefined>(initialInfo);
  const [loading, setLoading] = useState(initialInfo === undefined);
  const [error, setError] = useState<string>();

  const loadInfo = useCallback(async (targetSerial: string) => {
    if (!targetSerial) return;
    setLoading(true);
    setError(undefined);
    try {
      setInfo(await window.androidTool.getDeviceInfo(targetSerial));
    } catch (loadError) {
      setInfo(undefined);
      setError(loadError instanceof Error ? loadError.message : String(loadError));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!serial) {
      setInfo(undefined);
      setLoading(false);
      return;
    }
    if (initialInfo?.serial === serial) return;
    void loadInfo(serial);
  }, [initialInfo, loadInfo, serial]);

  const selectedDevice = onlineDevices.find((device) => device.serial === serial);

  return (
    <section className="device-info-page">
      <header className="device-info-header">
        <div className="device-info-heading">
          <span><Cpu size={22} weight="duotone" /></span>
          <div><h2>设备信息</h2><p>系统、硬件与运行状态</p></div>
        </div>
        <label>
          <DeviceMobile size={16} />
          <select
            value={serial}
            onChange={(event) => {
              setSerial(event.target.value);
              setInfo(undefined);
            }}
            disabled={loading || onlineDevices.length === 0}
          >
            {onlineDevices.map((device) => (
              <option key={device.serial} value={device.serial}>
                {deviceName(device)} · {device.serial}
              </option>
            ))}
          </select>
        </label>
        <button
          className="device-info-refresh"
          disabled={!serial || loading}
          onClick={() => void loadInfo(serial)}
        >
          <ArrowClockwise className={loading ? "spinning" : ""} size={16} />
          刷新信息
        </button>
        <button className="device-info-close" onClick={onClose} title="关闭设备信息">
          <X size={18} />
        </button>
      </header>

      {onlineDevices.length === 0 ? (
        <div className="device-info-empty">
          <DeviceMobile size={38} weight="duotone" />
          <h3>没有可读取的设备</h3>
          <p>连接设备并完成 USB 调试授权后再试。</p>
        </div>
      ) : loading && !info ? (
        <div className="device-info-empty">
          <span className="loader" />
          <h3>正在读取设备信息</h3>
          <p>正在查询系统属性和硬件状态…</p>
        </div>
      ) : error ? (
        <div className="device-info-empty error">
          <h3>设备信息读取失败</h3>
          <p>{error}</p>
          <button onClick={() => void loadInfo(serial)}>重新读取</button>
        </div>
      ) : info ? (
        <div className="device-info-content">
          <section className="device-info-summary">
            <span><DeviceMobile size={31} weight="duotone" /></span>
            <div>
              <p>{info.hardware.manufacturer || "Android"}</p>
              <h3>{info.hardware.model || (selectedDevice ? deviceName(selectedDevice) : "Android 设备")}</h3>
              <code>{info.serial}</code>
            </div>
            <dl>
              <div><dt>系统</dt><dd>Android {valueOf(info.system.androidVersion)}</dd></div>
              <div><dt>处理器</dt><dd>{valueOf(info.hardware.soc || info.hardware.cpuModel)}</dd></div>
              <div><dt>内存</dt><dd>{formatDeviceInfoBytes(info.memory.totalBytes)}</dd></div>
              <div><dt>电量</dt><dd>{info.battery.level === undefined ? "—" : `${info.battery.level}%`}</dd></div>
            </dl>
          </section>

          <div className="device-info-grid">
            <InfoCard title="系统信息" icon={DeviceMobile} rows={[
              ["Android 版本", valueOf(info.system.androidVersion)],
              ["SDK 级别", valueOf(info.system.sdkLevel)],
              ["安全补丁", valueOf(info.system.securityPatch)],
              ["构建 ID", valueOf(info.system.buildId)],
              ["系统构建版本", valueOf(info.system.displayBuildVersion)],
              ["增量版本", valueOf(info.system.incrementalBuildVersion)],
              ["构建类型", valueOf(info.system.buildType)],
              ["Bootloader", valueOf(info.system.bootloader)],
              ["运行时间", formatDeviceUptime(info.system.uptimeSeconds)],
              ["内核", valueOf(info.system.kernel)],
              ["构建指纹", valueOf(info.system.fingerprint)]
            ]} />
            <InfoCard title="硬件信息" icon={Cpu} rows={[
              ["制造商", valueOf(info.hardware.manufacturer)],
              ["品牌", valueOf(info.hardware.brand)],
              ["型号", valueOf(info.hardware.model)],
              ["设备代号", valueOf(info.hardware.device)],
              ["产品名", valueOf(info.hardware.product)],
              ["主板", valueOf(info.hardware.board)],
              ["硬件平台", valueOf(info.hardware.hardware)],
              ["SoC", valueOf(info.hardware.soc)],
              ["CPU", valueOf(info.hardware.cpuModel)],
              ["核心数", info.hardware.cpuCores === undefined ? "—" : `${info.hardware.cpuCores} 核`],
              ["ABI", info.hardware.cpuAbis.join("、") || "—"]
            ]} />
            <InfoCard title="内存与存储" icon={HardDrives} rows={[
              ["总内存", formatDeviceInfoBytes(info.memory.totalBytes)],
              ["可用内存", formatDeviceInfoBytes(info.memory.availableBytes)],
              ["数据分区", formatDeviceInfoBytes(info.storage.totalBytes)],
              ["已使用", formatDeviceInfoBytes(info.storage.usedBytes)],
              ["可用空间", formatDeviceInfoBytes(info.storage.availableBytes)]
            ]} />
            <InfoCard title="屏幕与电池" icon={Monitor} rows={[
              ["物理分辨率", valueOf(info.display.physicalSize)],
              ["当前分辨率", valueOf(info.display.overrideSize || info.display.physicalSize)],
              ["物理密度", info.display.physicalDensity === undefined ? "—" : `${info.display.physicalDensity} dpi`],
              ["当前密度", info.display.overrideDensity === undefined ? valueOf(info.display.physicalDensity) : `${info.display.overrideDensity} dpi`],
              ["电量", info.battery.level === undefined ? "—" : `${info.battery.level}%`],
              ["状态", valueOf(info.battery.status)],
              ["健康", valueOf(info.battery.health)],
              ["温度", info.battery.temperatureCelsius === undefined ? "—" : `${info.battery.temperatureCelsius.toFixed(1)} °C`],
              ["电压", info.battery.voltageMillivolts === undefined ? "—" : `${info.battery.voltageMillivolts} mV`],
              ["供电", poweredBy(info.battery)],
              ["电池技术", valueOf(info.battery.technology)]
            ]} />
            <InfoCard title="网络与连接" icon={WifiHigh} rows={[
              ["ADB 连接", info.network.connectionType],
              ["IPv4 地址", info.network.ipv4Addresses.join("、") || "—"],
              ["设备 SN", valueOf(info.deviceSn)],
              ["设备序列号", info.serial],
              ["采集时间", new Date(info.collectedAt).toLocaleString()]
            ]} />
            <InfoCard title="电池概览" icon={BatteryHigh} rows={[
              ["当前电量", info.battery.level === undefined ? "—" : `${info.battery.level}%`],
              ["充放电状态", valueOf(info.battery.status)],
              ["健康状态", valueOf(info.battery.health)],
              ["当前电源", poweredBy(info.battery)]
            ]} />
          </div>
        </div>
      ) : null}
    </section>
  );
}
