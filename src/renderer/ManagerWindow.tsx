import { useCallback, useEffect, useMemo, useState } from "react";
import type { AndroidDevice } from "../shared/types";
import { AppManager } from "./AppManager";
import { FileManager } from "./FileManager";
import { DeviceInfoPanel } from "./DeviceInfoPanel";
import { useTheme } from "./theme";

export function ManagerWindow({ view }: { view: "apps" | "files" | "device-info" }) {
  useTheme();
  const [devices, setDevices] = useState<AndroidDevice[]>([]);
  const [loading, setLoading] = useState(true);

  const refreshDevices = useCallback(async () => {
    try {
      setDevices(await window.androidTool.listDevices());
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refreshDevices();
    const timer = window.setInterval(() => void refreshDevices(), 2_500);
    return () => window.clearInterval(timer);
  }, [refreshDevices]);

  const deviceKey = useMemo(
    () => devices.map((device) => `${device.serial}:${device.state}`).join("|"),
    [devices]
  );

  if (loading) {
    return (
      <div className="manager-window-root logcat-window-loading">
        <span className="loader" />
        <p>正在读取设备...</p>
      </div>
    );
  }

  return (
    <div className="manager-window-root">
      {view === "apps" ? (
        <AppManager key={deviceKey} devices={devices} onClose={() => window.close()} />
      ) : view === "files" ? (
        <FileManager key={deviceKey} devices={devices} onClose={() => window.close()} />
      ) : (
        <DeviceInfoPanel key={deviceKey} devices={devices} onClose={() => window.close()} />
      )}
    </div>
  );
}
