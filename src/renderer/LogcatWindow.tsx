import { useCallback, useEffect, useState } from "react";
import type { AndroidDevice } from "../shared/types";
import { LogcatWorkspace } from "./LogcatPanel";
import { useTheme } from "./theme";

function appendDevice(
  devices: AndroidDevice[],
  device: AndroidDevice
): AndroidDevice[] {
  return devices.some((item) => item.serial === device.serial)
    ? devices.map((item) => (item.serial === device.serial ? device : item))
    : [...devices, device];
}

export function LogcatWindow() {
  useTheme();
  const [devices, setDevices] = useState<AndroidDevice[]>([]);
  const [availableDevices, setAvailableDevices] = useState<AndroidDevice[]>([]);

  const refreshAvailableDevices = useCallback(async () => {
    try {
      setAvailableDevices(await window.androidTool.listDevices());
    } catch {
      // Device discovery errors remain visible in the main dashboard.
    }
  }, []);

  useEffect(() => {
    let active = true;
    const unsubscribe = window.androidTool.onLogcatDeviceAdd((device) => {
      if (active) setDevices((current) => appendDevice(current, device));
    });

    void window.androidTool.getLogcatWindowDevices().then((initialDevices) => {
      if (active) setDevices(initialDevices);
    });
    void refreshAvailableDevices();
    const timer = window.setInterval(
      () => void refreshAvailableDevices(),
      2_500
    );

    return () => {
      active = false;
      unsubscribe();
      window.clearInterval(timer);
    };
  }, [refreshAvailableDevices]);

  async function addDevice(device: AndroidDevice): Promise<void> {
    setDevices((current) => appendDevice(current, device));
    await window.androidTool.openLogcatWindow(device);
  }

  function removeDevice(serial: string): void {
    const next = devices.filter((device) => device.serial !== serial);
    if (next.length === 0) {
      window.close();
      return;
    }
    setDevices(next);
    void window.androidTool.removeLogcatWindowDevice(serial);
  }

  if (devices.length === 0) {
    return (
      <main className="logcat-window-loading">
        <span className="loader" />
        <p>正在打开 Logcat…</p>
      </main>
    );
  }

  return (
    <LogcatWorkspace
      devices={devices}
      availableDevices={availableDevices}
      onAdd={(device) => void addDevice(device)}
      onRemove={removeDevice}
      onClose={() => window.close()}
    />
  );
}
