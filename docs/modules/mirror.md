# 投屏（内嵌 + 外部窗口）

> 父文档：[AGENTS.md](../../AGENTS.md) · 相关：[应用外壳](app-shell.md)、[ADB](adb-device.md)

## 职责

两种投屏形态：内嵌到主窗口右侧工作区的视频流投屏（主形态），与外部独立 scrcpy 窗口（辅形态）。两者互斥切换（弹出时自动关闭内嵌）。

## 文件

- `src/main/embedded-mirror-manager.ts` — 内嵌投屏核心：@yume-chan（scrcpy 4.0）会话管理、视频包广播、控制注入。
- `src/main/scrcpy-manager.ts` — 外部 scrcpy.exe 窗口进程管理（spawn `--serial= --no-audio --window-title=`）。
- `src/renderer/MirrorPane.tsx` — 解码面板：WebCodecsVideoDecoder、canvas 挂载、指针/滚轮/右键交互。
- `src/renderer/mirror-control.ts` — 纯坐标映射（`normalizedPoint` 归一化钳制、`wheelToScroll` 滚轮方向翻转，-0 已修）。
- `src/main/paths.ts` — `resolveScrcpyPath` / `resolveScrcpyServerPath`（惰性：server 缺失只禁内嵌投屏，不阻断应用启动）。

## 内嵌投屏链路

1. `mirror:embedded-start` → `EmbeddedMirrorManager.start(serial)`：
   - `adb start-server` 预热 → `AdbServerNodeJsClient().createAdb({serial})`（连本机 adb server 5037，与 adb CLI 无冲突）→ `AdbScrcpyClient.pushServer`（内置 scrcpy-server 4.0 字节，读取失败清缓存可重试）→ `AdbScrcpyClient.start(adb, "/data/local/tmp/scrcpy-server.jar", new AdbScrcpyOptions4_0({audio:false, control:true, tunnelForward:true, videoCodec:"h264", videoBitRate:8M, maxSize:1600}))`。
   - **CJS 主进程加载 ESM-only 依赖**：顶部 `require("@yume-chan/...") as typeof import(...)`（Electron Node ≥22.12 支持 require(esm)；类型桥接用 `as unknown as Parameters<...>` 解决 stream void/undefined 方差）。
2. 视频包广播（`mirror:event`，发全部窗口）：`meta{codec,deviceName}` → `video{kind: configuration|data|session}` → `status{running,message}`。会话已存在时 start 补发缓存的 meta/configuration/status（面板重开即接上，resync 语义）。
3. 渲染层解码：`WebCodecsVideoDecoder`，packets ReadableStream 在 meta 前先建好（不丢包）pipe 进 `decoder.writable`；canvas 用 `replaceChildren` 挂进宿主（decoder 失效时 React 只管 mirror-empty，残留 canvas 无害——dispose 已置 0×0）。
4. 控制回流：`sendMirrorControl`（fire-and-forget `ipcRenderer.send`）→ 主进程 `control()`：渲染层只发归一化坐标，主进程按**当前视频尺寸**换算像素（旋转后尺寸过期也不丢指令），touch 有 clamp01、scroll 有 ±16 钳制、back = injectKeyCode(AndroidBack) Down+Up（beta.2 无 pressBackOrTurnOnScreen）。全部写入 `.catch(()=>undefined)`（断连窗口期不产生 unhandledRejection）。

## 交互语义（scrcpy 对齐）

- 画布左键按下/拖动/抬起 = 触摸；**仅左键**（右键/中键不注入）。
- `pointercancel` 无条件发 touch up（其 `button` 恒为 -1，不能加门禁——否则触摸卡死在按下）。
- 右键 = 返回键；滚轮 = injectScroll；wheel 用**原生非被动监听**（React onWheel 是 passive，preventDefault 无效）。
- 面板头部「⇗」弹窗按钮：切到外部 scrcpy 窗口并自动关闭内嵌（`toggleMirrorWindow`）。

## 生命周期竞争（已修，勿回退）

- start 期间 stop：`stopRequested` Set 登记，start 在 `sessions.set` 前消费；start 中途再 start 会撤销挂起的 stop（dev StrictMode 双挂载靠这个活着）。
- start 半途失败：catch 关闭 client（防设备端 server 进程残留）+ 清 sessions + starting。
- 隐藏 Tab `decoder.pause()`：内存有界于一个 GOP（≈10MB），pipeTo 持续消费，队列不涨。

## 已知边界

- 中途接上的流要等下一个关键帧才出画面（GOP 默认 ~10s）。
- H.265/AV1 未启用（固定 h264，WebCodecs 能力有但未开选项）。
- 同一 serial 两个窗口同开内嵌：共享一个主进程会话，一窗停止会断另一窗解码（当前无多主窗口场景，理论限制）。

## 测试

`src/renderer/mirror-control.test.ts`（坐标/滚轮纯函数）、`src/main/scrcpy-manager.test.ts`。嵌入式管理器无独立单测（重依赖真机），靠真机手工验证清单。
