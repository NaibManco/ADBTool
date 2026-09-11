# 共享类型与 IPC 契约

> 父文档：[AGENTS.md](../../AGENTS.md)

## 职责

`src/shared/types.ts` 是主进程 / preload / 渲染层三方唯一契约：跨进程数据类型 + `AndroidToolApi`（`window.androidTool` 的全部方法签名）。任何新 IPC 必须先在这里加类型，再在 preload 桥接、main.ts handler，三处同步。

## AndroidToolApi 分区（按模块）

| 分区 | 方法 |
|---|---|
| 设置 | getTheme/setTheme/onThemeChanged |
| 设备 | listDevices/sendAction |
| 窗口 | openAppManagerWindow/openFileManagerWindow/openDeviceInfoWindow/openDecompilerWindow/openLogcatWindow(+getLogcatWindowDevices/removeLogcatWindowDevice) |
| APK | selectApkFile/resolveApkPath/getDroppedFilePath/installApk |
| 文件 | listDeviceFiles/selectDeviceUploadFiles/uploadDeviceFiles/downloadDeviceFile/getDeviceImagePreview/createDeviceDirectory/renameDeviceFile/deleteDeviceFile |
| 应用 | listInstalledPackages/clearAppData/listManagedApps/getManagedAppDetails/uninstallApp/forceStopApp/launchApp |
| 无线调试 | pairWireless/connectWireless/connectWirelessViaUsb |
| 采集 | captureScreenshot/copyCaptureMedia/saveCaptureMediaAs/startScreenRecording/stopScreenRecording/listScreenRecordings |
| 投屏 | startMirror/stopMirror（外部窗口）/startEmbeddedMirror/stopEmbeddedMirror/sendMirrorControl/onMirrorEvent |
| 日志 | startLogcat/stopLogcat/setLogcatProcess/setLogcatBuffer/clearLogcatBuffer/exportLogcatText/copyLogcatText/listAppProcesses/onLogcatEvent/onLogcatDeviceAdd |
| 终端 | startTerminal/stopTerminal/sendTerminalInput/onTerminalEvent |
| 反编译 | startDecompile/cancelDecompile/discardDecompile/getDecompileTree/readDecompileFile/onDecompileEvent |
| Bugreport | exportBugreport |
| 设备信息 | getDeviceInfo |

## 事件通道（webContents.send 广播）

`logcat:event`、`mirror:event`、`terminal:event`、`decompile:event`、`settings:theme-changed`、`logcat:device-add`——全部广播到所有窗口，渲染层按 serial/jobId/theme 自行过滤。

## 改类型时的检查清单

- `ApkFile.packageName` 为可选字段：文件选择/路径解析时由主进程 `readApkPackageName` 尽力填充，解析失败保持 undefined（渲染层据此降级，不阻断选择/安装）。

- `AndroidDevice` 加必填字段：同步 `parseAdbDevices` 的 `Omit<...>` 返回类型、`devices:list` handler、**全部渲染层测试夹具**（历史教训：`mirroringEmbedded` 加字段时 9 个测试文件要补）。
- 事件 union 加变体：可选字段向后兼容优先；两侧（发送方/消费方）都要处理 unknown 兜底。
- preload 是一对一桥接，不写逻辑。

## Preload 安全边界

`contextBridge.exposeInMainWorld("androidTool", api)` 唯一暴露；不暴露 ipcRenderer 本体、通用文件/shell/路径能力；fire-and-forget 用 `ipcRenderer.send`（`sendMirrorControl`/`sendTerminalInput`），请求-响应用 `invoke`。
