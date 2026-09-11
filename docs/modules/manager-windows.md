# 管理窗口（应用/文件/设备信息）

> 父文档：[AGENTS.md](../../AGENTS.md) · 相关：[ADB](adb-device.md)、[应用外壳](app-shell.md)

## 职责

三个独立管理窗口：应用管理（信息/启动/停止/清数据/卸载）、文件管理（浏览/上传/下载/重命名/删除/图片预览）、设备信息（系统/硬件/显示/电池/网络）。

## 文件

- `src/renderer/ManagerWindow.tsx` — 路由壳：2.5s 设备轮询，按 `view` 分发到三个面板（设备断线用 `deviceKey` 强制重挂载）。
- `src/renderer/AppManager.tsx` — 应用列表 + `ManagedAppDetails`（`dumpsys package` 解析）+ 危险操作确认 + 启动按钮（`launchApp`，monkey 拉起，非危险操作无确认）。
- `src/renderer/FileManager.tsx` — 设备文件树 + 传输 + 图片预览。
- `src/renderer/DeviceInfoPanel.tsx` — `DeviceInfo` 聚合展示。
- `src/main/device-files.ts` — 设备文件 adb shell 命令构造（`buildListFilesArgs` 等，**含 shellQuote/shellCommand 转义纯函数**——项目里唯一允许拼 shell 命令串的地方，远端 shell 需要）。
- `src/main/device-info.ts` — `DeviceInfoCollector`（getprop/dumpsys 多命令聚合）。
- `src/main/bugreport-files.ts` — `adb bugreport` 产物定位。

## 窗口约定

- `manager-window:open` 单例：已开则 restore+focus；`ManagerView = "apps" | "files" | "device-info" | "decompiler"`。
- 多窗口与主窗口并存；不套主工作台背景。
- 清数据有二次确认弹窗（`ClearAppDataDialog.tsx`）；危险操作（卸载/清数据）不可静默执行。

## 测试

`src/renderer/AppManager.test.tsx`、`src/renderer/FileManager.test.tsx`、`src/renderer/DeviceInfoPanel.test.tsx`、`src/renderer/ClearAppDataDialog.test.tsx`、`src/main/device-files.test.ts`、`src/main/device-info.test.ts`、`src/main/bugreport-files.test.ts`。
