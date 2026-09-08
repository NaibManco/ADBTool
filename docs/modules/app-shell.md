# 应用外壳与工作区

> 父文档：[AGENTS.md](../../AGENTS.md) · 相关：[ADB 与设备控制](adb-device.md)、[投屏](mirror.md)、[Logcat](logcat.md)、[终端](terminal.md)

## 职责

Electron 应用生命周期、主窗口/独立窗口的创建与路由、主界面布局（设备栏 + 右侧工作区）、主题与本地设置。

## 文件

- `src/main/main.ts` — 应用入口：窗口创建（主窗口 1180×760）、`registerIpc()` 全部 IPC 注册、各服务实例化、退出清理（`window-all-closed`：scrcpy/embeddedMirror/logcat/terminal 全停）。
- `src/renderer/App.tsx` — 主界面：`App`（当前实现）与 `LegacyApp`（旧版保留但不再入口使用）、`DeviceRailCard` 设备卡、右侧工作区三视图。
- `src/renderer/main.tsx` — 按 URL `?view=` 路由：无 view=主界面，`logcat`/`decompiler`/`apps`/`files`/`device-info` 各自窗口。
- `src/main/settings.ts` — `SettingsStore`（`userData/settings.json`，目前仅 `theme`；未知字段读取时丢弃，加字段需同步 `parseSettings`）。
- `src/renderer/theme.ts` — `useTheme`，订阅 `settings:theme-changed` 广播同步所有窗口。

## 布局结构（App.tsx）

- `.unified-workbench` 三列 grid：设备栏（`--rail-width` 可拖 270–520px，可折叠 60px）| 6px resizer | 右侧工作区。
- 右侧工作区 `workspaceView: "mirror" | "log" | "terminal"` 整页切换：
  - 切换钮仅当 ≥2 个视图有内容时显示（`availableViews` 派生，`effectiveView` 在偏好指向空视图时回落）。
  - 切走的视图保持挂载（`.pane-hidden`），会话保活：投屏暂停解码、日志/终端继续采集。
  - 偏好持久化 localStorage：`androidDevTool.workspace.view`。
- 截图/录屏预览 `.ws-overlay`（absolute 覆盖层），不卸载底层工作区。
- 镜像面板死而复点用 `nonce` 换 key 强制重挂载（`MirrorEntry = AndroidDevice & { nonce }`）。

## IPC

- `settings:theme-get` / `settings:theme-set`（写盘 + `nativeTheme.themeSource` + 广播 `settings:theme-changed` 到全部窗口）。
- `manager-window:open`（view ∈ apps/files/device-info/decompiler，单例窗口，已开则聚焦）。

## 约定

- 全部窗口 `contextIsolation: true, nodeIntegration: false`，preload 统一 `../preload/index.js`。
- 渲染层绝不直用 Node API，一律走 `window.androidTool` 窄接口（见 `src/shared/types.ts` 的 `AndroidToolApi`）。
- 主进程状态按 serial 隔离，禁止用单个全局布尔代表所有设备。
- 开发模式注意：多次重启 `npm run dev` 会残留僵尸 vite 进程占用 5173 端口，Electron 加载写死 5173 → 白屏；发现白屏先查端口。

## 测试

`src/renderer/App.test.tsx`（布局标记、录制计时）、`src/main/settings.test.ts`、`src/main/window-placement.test.ts`。
