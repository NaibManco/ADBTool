# 管理窗口（应用/文件/设备信息）

> 父文档：[AGENTS.md](../../AGENTS.md) · 相关：[ADB](adb-device.md)、[应用外壳](app-shell.md)

## 职责

三个独立管理窗口：应用管理（信息/应用名/启动/停止/清数据/卸载）、文件管理（浏览/上传/下载/重命名/删除/图片预览）、设备信息（系统/硬件/显示/电池/网络）。

## 文件

- `src/renderer/ManagerWindow.tsx` — 路由壳：2.5s 设备轮询，按 `view` 分发到三个面板（设备断线用 `deviceKey` 强制重挂载）。
- `src/renderer/AppManager.tsx` — 应用列表 + `ManagedAppDetails`（`dumpsys package` 解析）+ 危险操作确认 + 启动按钮（`launchApp`，monkey 拉起，非危险操作无确认）。应用名**按需解析**：打开先用 localStorage 缓存（`androidDevTool.appLabels.v1`，键=序列号+包名）立即填充；未命中的只对「当前搜索结果 + 选中项 + 可视区附近（前 24 个，滚动接近底部自动扩窗）」经 `getManagedAppLabels`（`apps:labels` IPC）解析（批 8、选中优先；设备切换以 serialRef 丢弃过期轮次）。不为看不见的条目花 arsc 传输（全量 65 应用约 50MB、10s）。主行应用名、副行包名，详情头部同名，搜索同时匹配名称与包名；解析失败保持包名，不报错。
- `src/renderer/FileManager.tsx` — 设备文件树 + 传输 + 图片预览。
- `src/renderer/DeviceInfoPanel.tsx` — `DeviceInfo` 聚合展示。
- `src/main/device-files.ts` — 设备文件 adb shell 命令构造（`buildListFilesArgs` 等，**含 shellQuote/shellCommand 转义纯函数**——项目里唯一允许拼 shell 命令串的地方，远端 shell 需要）。
- `src/main/device-info.ts` — `DeviceInfoCollector`（getprop/dumpsys 多命令聚合）。
- `src/main/bugreport-files.ts` — `adb bugreport` 产物定位。

## 窗口约定

- `manager-window:open` 单例：已开则 restore+focus；`ManagerView = "apps" | "files" | "device-info" | "decompiler"`。
- 多窗口与主窗口并存；不套主工作台背景。
- 清数据有二次确认弹窗（`ClearAppDataDialog.tsx`）；危险操作（卸载/清数据）不可静默执行。

## 已知边界

- 应用名解析（app-label.ts）取 arsc 中**默认 config** 的字符串，等价 `aapt dump badging` 的 application-label；系统语言有本地化覆盖时（如 MIUI 预装英文默认名应用）显示的是默认名而非当前语言名。
- 设备端无 `unzip`（老系统）时应用名整体降级为包名，列表功能不受影响。

## 测试

`src/renderer/AppManager.test.tsx`、`src/renderer/FileManager.test.tsx`、`src/renderer/DeviceInfoPanel.test.tsx`、`src/renderer/ClearAppDataDialog.test.tsx`、`src/main/app-label.test.ts`、`src/main/device-files.test.ts`、`src/main/device-info.test.ts`、`src/main/bugreport-files.test.ts`。
