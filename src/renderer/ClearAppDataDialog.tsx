import { useEffect, useMemo, useState } from "react";
import {
  DeviceMobile,
  MagnifyingGlass,
  Trash,
  Warning,
  X
} from "@phosphor-icons/react";
import type { AndroidDevice } from "../shared/types";

function deviceName(device: AndroidDevice): string {
  return device.model?.replaceAll("_", " ") || device.product || "Android 设备";
}

export function ClearAppDataDialog({
  device,
  initialPackages,
  onClose
}: {
  device: AndroidDevice;
  initialPackages?: string[];
  onClose: () => void;
}) {
  const [packages, setPackages] = useState<string[]>(initialPackages ?? []);
  const [selectedPackage, setSelectedPackage] = useState("");
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(initialPackages === undefined);
  const [clearing, setClearing] = useState(false);
  const [status, setStatus] = useState<{ ok: boolean; message: string }>();

  useEffect(() => {
    if (initialPackages !== undefined) return;

    let active = true;
    setLoading(true);
    void window.androidTool.listInstalledPackages(device.serial)
      .then((nextPackages) => {
        if (active) setPackages(nextPackages);
      })
      .catch((loadError) => {
        if (active) {
          setStatus({
            ok: false,
            message: loadError instanceof Error ? loadError.message : String(loadError)
          });
        }
      })
      .finally(() => {
        if (active) setLoading(false);
      });

    return () => {
      active = false;
    };
  }, [device.serial, initialPackages]);

  const visiblePackages = useMemo(() => {
    const keyword = query.trim().toLocaleLowerCase();
    return packages
      .filter((packageName) => !keyword || packageName.toLocaleLowerCase().includes(keyword))
      .sort((left, right) => left.localeCompare(right));
  }, [packages, query]);

  async function clearSelectedPackage(): Promise<void> {
    if (!selectedPackage || clearing) return;
    const confirmed = window.confirm(
      `确认清除 ${selectedPackage} 的全部应用数据？\n\n此操作无法撤销。`
    );
    if (!confirmed) return;

    setClearing(true);
    setStatus(undefined);
    try {
      const result = await window.androidTool.clearAppData(device.serial, selectedPackage);
      setStatus({
        ok: result.ok,
        message: result.ok
          ? `${selectedPackage} 的应用数据已清除`
          : result.message || "清除应用数据失败"
      });
    } catch (clearError) {
      setStatus({
        ok: false,
        message: clearError instanceof Error ? clearError.message : String(clearError)
      });
    } finally {
      setClearing(false);
    }
  }

  return (
    <div className="clear-data-overlay" role="presentation">
      <section
        className="clear-data-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="clear-data-title"
      >
        <header className="clear-data-header">
          <div className="clear-data-title-mark"><Trash size={20} weight="duotone" /></div>
          <div>
            <h2 id="clear-data-title">清除应用数据</h2>
            <p><DeviceMobile size={13} /> {deviceName(device)} · {device.serial}</p>
          </div>
          <button className="clear-data-close" onClick={onClose} title="关闭">
            <X size={17} />
          </button>
        </header>

        <div className="clear-data-warning">
          <Warning size={20} weight="fill" />
          <span>
            <strong>此操作无法撤销</strong>
            将删除所选应用的账号、设置、数据库和缓存，效果等同于系统设置中的“清除存储”。
          </span>
        </div>

        <label className="clear-data-search">
          <MagnifyingGlass size={16} />
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="搜索包名"
            aria-label="搜索包名"
          />
        </label>

        <div className="clear-data-package-list" role="radiogroup" aria-label="选择应用">
          {loading ? (
            <div className="clear-data-empty"><span className="loader" /> 正在读取应用列表…</div>
          ) : visiblePackages.length === 0 ? (
            <div className="clear-data-empty">
              {query ? "没有匹配的应用" : "设备上没有可清除的第三方应用"}
            </div>
          ) : (
            visiblePackages.map((packageName) => (
              <label
                key={packageName}
                className={selectedPackage === packageName ? "clear-data-package selected" : "clear-data-package"}
              >
                <input
                  type="radio"
                  name="clear-data-package"
                  value={packageName}
                  checked={selectedPackage === packageName}
                  onChange={() => {
                    setSelectedPackage(packageName);
                    setStatus(undefined);
                  }}
                />
                <span>{packageName}</span>
              </label>
            ))
          )}
        </div>

        {status && (
          <div className={status.ok ? "clear-data-status success" : "clear-data-status error"}>
            {status.message}
          </div>
        )}

        <footer className="clear-data-footer">
          <span>{packages.length} 个第三方应用</span>
          <button className="clear-data-cancel" onClick={onClose}>取消</button>
          <button
            className="clear-data-submit"
            disabled={!selectedPackage || clearing}
            onClick={() => void clearSelectedPackage()}
          >
            <Trash size={15} />
            {clearing ? "正在清除…" : selectedPackage ? "清除所选应用数据" : "选择应用后清除"}
          </button>
        </footer>
      </section>
    </div>
  );
}
