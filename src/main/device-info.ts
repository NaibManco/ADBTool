import { execFile } from "node:child_process";
import { promisify } from "node:util";
import type { DeviceInfo } from "../shared/types";

const execFileAsync = promisify(execFile);

export interface RawDeviceInfo {
  properties: string;
  cpuInfo: string;
  cpuPresent: string;
  memory: string;
  storage: string;
  display: string;
  battery: string;
  kernel: string;
  uptime: string;
  network: string;
}

function parseProperties(output: string): Map<string, string> {
  const properties = new Map<string, string>();
  for (const line of output.split(/\r?\n/)) {
    const match = /^\[([^\]]+)\]: \[(.*)\]$/.exec(line.trim());
    if (match) properties.set(match[1], match[2]);
  }
  return properties;
}

function optionalNumber(value: string | undefined): number | undefined {
  if (!value) return undefined;
  const number = Number(value);
  return Number.isFinite(number) ? number : undefined;
}

function propertyLine(output: string, name: string): string | undefined {
  const match = new RegExp(`^${name}\\s*:\\s*(.+)$`, "im").exec(output);
  return match?.[1].trim() || undefined;
}

function parseCpuModel(output: string): string | undefined {
  const namedModel = propertyLine(output, "Hardware") ??
    propertyLine(output, "model name");
  if (namedModel) return namedModel;
  const processor = /^Processor\s*:\s*(.+)$/m.exec(output);
  return processor?.[1].trim() || undefined;
}

function parseCpuCoreCount(value: string): number | undefined {
  let count = 0;
  for (const segment of value.trim().split(",")) {
    if (!segment) continue;
    const range = /^(\d+)-(\d+)$/.exec(segment);
    if (range) {
      count += Math.max(0, Number(range[2]) - Number(range[1]) + 1);
    } else if (/^\d+$/.test(segment)) {
      count += 1;
    }
  }
  return count || undefined;
}

function parseMemory(output: string): DeviceInfo["memory"] {
  const totalKb = optionalNumber(propertyLine(output, "MemTotal")?.split(/\s+/)[0]);
  const availableKb = optionalNumber(propertyLine(output, "MemAvailable")?.split(/\s+/)[0]);
  return {
    totalBytes: totalKb === undefined ? undefined : totalKb * 1024,
    availableBytes: availableKb === undefined ? undefined : availableKb * 1024
  };
}

function parseStorage(output: string): DeviceInfo["storage"] {
  const line = output.split(/\r?\n/)
    .map((value) => value.trim())
    .find((value) => value && !value.startsWith("Filesystem"));
  const parts = line?.split(/\s+/) ?? [];
  const totalKb = optionalNumber(parts[1]);
  const usedKb = optionalNumber(parts[2]);
  const availableKb = optionalNumber(parts[3]);
  return {
    totalBytes: totalKb === undefined ? undefined : totalKb * 1024,
    usedBytes: usedKb === undefined ? undefined : usedKb * 1024,
    availableBytes: availableKb === undefined ? undefined : availableKb * 1024
  };
}

function displaySize(output: string, label: string): string | undefined {
  const match = new RegExp(`${label} size:\\s*(\\d+)x(\\d+)`, "i").exec(output);
  return match ? `${match[1]} × ${match[2]}` : undefined;
}

function displayDensity(output: string, label: string): number | undefined {
  const match = new RegExp(`${label} density:\\s*(\\d+)`, "i").exec(output);
  return optionalNumber(match?.[1]);
}

function parseKeyValues(output: string): Map<string, string> {
  const values = new Map<string, string>();
  for (const line of output.split(/\r?\n/)) {
    const match = /^\s*([^:]+):\s*(.*?)\s*$/.exec(line);
    if (match) values.set(match[1].trim(), match[2]);
  }
  return values;
}

function optionalBoolean(value: string | undefined): boolean | undefined {
  if (value === "true") return true;
  if (value === "false") return false;
  return undefined;
}

const BATTERY_STATUS: Record<number, string> = {
  1: "未知",
  2: "充电中",
  3: "放电中",
  4: "未充电",
  5: "已充满"
};

const BATTERY_HEALTH: Record<number, string> = {
  1: "未知",
  2: "良好",
  3: "过热",
  4: "故障",
  5: "过压",
  6: "异常",
  7: "过冷"
};

export function parseDeviceInfo(
  serial: string,
  raw: RawDeviceInfo,
  collectedAt = Date.now()
): DeviceInfo {
  const properties = parseProperties(raw.properties);
  const battery = parseKeyValues(raw.battery);
  const batteryStatus = optionalNumber(battery.get("status"));
  const batteryHealth = optionalNumber(battery.get("health"));
  const temperature = optionalNumber(battery.get("temperature"));
  const socManufacturer = properties.get("ro.soc.manufacturer");
  const socModel = properties.get("ro.soc.model");
  const soc = [socManufacturer, socModel].filter(Boolean).join(" ") || undefined;
  const uptime = optionalNumber(raw.uptime.trim().split(/\s+/)[0]);
  const cpuAbis = (properties.get("ro.product.cpu.abilist") ?? "")
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);
  const ipv4Addresses = Array.from(
    raw.network.matchAll(/\binet\s+(\d+(?:\.\d+){3})\/\d+/g),
    (match) => match[1]
  );

  return {
    serial,
    deviceSn:
      properties.get("ro.serialno") || properties.get("ro.boot.serialno") || undefined,
    collectedAt,
    system: {
      androidVersion: properties.get("ro.build.version.release"),
      sdkLevel: optionalNumber(properties.get("ro.build.version.sdk")),
      securityPatch: properties.get("ro.build.version.security_patch"),
      buildId: properties.get("ro.build.id"),
      displayBuildVersion: properties.get("ro.build.display.id"),
      incrementalBuildVersion: properties.get("ro.build.version.incremental"),
      buildType: properties.get("ro.build.type"),
      fingerprint: properties.get("ro.build.fingerprint"),
      kernel: raw.kernel.trim() || undefined,
      uptimeSeconds: uptime === undefined ? undefined : Math.floor(uptime),
      bootloader: properties.get("ro.bootloader")
    },
    hardware: {
      manufacturer: properties.get("ro.product.manufacturer"),
      brand: properties.get("ro.product.brand"),
      model: properties.get("ro.product.model"),
      device: properties.get("ro.product.device"),
      product: properties.get("ro.product.name"),
      board: properties.get("ro.product.board"),
      hardware: properties.get("ro.hardware"),
      soc,
      cpuModel: parseCpuModel(raw.cpuInfo),
      cpuCores: parseCpuCoreCount(raw.cpuPresent),
      cpuAbis
    },
    memory: parseMemory(raw.memory),
    storage: parseStorage(raw.storage),
    display: {
      physicalSize: displaySize(raw.display, "Physical"),
      overrideSize: displaySize(raw.display, "Override"),
      physicalDensity: displayDensity(raw.display, "Physical"),
      overrideDensity: displayDensity(raw.display, "Override")
    },
    battery: {
      level: optionalNumber(battery.get("level")),
      status: batteryStatus === undefined ? undefined : BATTERY_STATUS[batteryStatus] ?? "未知",
      health: batteryHealth === undefined ? undefined : BATTERY_HEALTH[batteryHealth] ?? "未知",
      temperatureCelsius: temperature === undefined ? undefined : temperature / 10,
      voltageMillivolts: optionalNumber(battery.get("voltage")),
      technology: battery.get("technology") || undefined,
      acPowered: optionalBoolean(battery.get("AC powered")),
      usbPowered: optionalBoolean(battery.get("USB powered")),
      wirelessPowered: optionalBoolean(battery.get("Wireless powered"))
    },
    network: {
      connectionType: serial.includes(":") ? "网络 ADB" : "USB ADB",
      ipv4Addresses: Array.from(new Set(ipv4Addresses))
    }
  };
}

export class DeviceInfoCollector {
  constructor(private readonly executable: string) {}

  async collect(serial: string): Promise<DeviceInfo> {
    const run = async (args: string[], optional = false): Promise<string> => {
      try {
        const { stdout } = await execFileAsync(
          this.executable,
          ["-s", serial, "shell", ...args],
          { windowsHide: true, timeout: 15_000, maxBuffer: 4 * 1024 * 1024 }
        );
        return stdout;
      } catch (error) {
        if (optional) return "";
        throw error;
      }
    };

    const [
      properties,
      cpuInfo,
      cpuPresent,
      memory,
      storage,
      size,
      density,
      battery,
      kernel,
      uptime,
      network
    ] = await Promise.all([
      run(["getprop"]),
      run(["cat", "/proc/cpuinfo"], true),
      run(["cat", "/sys/devices/system/cpu/present"], true),
      run(["cat", "/proc/meminfo"], true),
      run(["df", "-k", "/data"], true),
      run(["wm", "size"], true),
      run(["wm", "density"], true),
      run(["dumpsys", "battery"], true),
      run(["uname", "-a"], true),
      run(["cat", "/proc/uptime"], true),
      run(["ip", "-o", "-4", "addr", "show", "scope", "global"], true)
    ]);

    return parseDeviceInfo(serial, {
      properties,
      cpuInfo,
      cpuPresent,
      memory,
      storage,
      display: `${size}\n${density}`,
      battery,
      kernel,
      uptime,
      network
    });
  }
}
