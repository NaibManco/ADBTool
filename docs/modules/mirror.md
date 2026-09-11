# 投屏（内嵌 + 独立窗口）

> 父文档：[AGENTS.md](../../AGENTS.md) · 相关：[应用外壳](app-shell.md)、[ADB](adb-device.md)

## 职责

两种投屏形态，**共用同一套 yume-chan 会话**（每设备一个会话，事件广播到全部窗口）：内嵌到主窗口右侧工作区的视频流投屏（主形态），与独立 BrowserWindow 大屏窗口（辅形态）。两者互斥切换（弹出时自动关闭内嵌，反之亦然）。

## 文件

- `src/main/embedded-mirror-manager.ts` — 会话核心：@yume-chan（scrcpy 4.0）会话管理、视频包广播、控制注入。内嵌面板与独立窗口都是它的消费者。
- `src/main/main.ts` — `mirrorWindows`（serial → BrowserWindow）：`createMirrorWindow`（420×780，`?view=mirror&serial=&label=`，label 用于窗口标题）、`closeMirrorWindow`（幂等：删表 → close → 停会话）、`mirror:start`/`mirror:stop`/`mirror:embedded-start` handler 的互斥编排。
- `src/renderer/MirrorPane.tsx` — 内嵌解码面板：WebCodecsVideoDecoder、canvas 挂载、指针/滚轮/右键交互。
- `src/renderer/MirrorWindow.tsx` — 独立窗口页面：同一套解码/交互逻辑，无面板装饰；会话结束（运行过）立即自动关窗，启动失败展示错误 4 秒后关窗。
- `src/renderer/mirror-control.ts` — 纯坐标映射（`normalizedPoint` 归一化钳制、`wheelToScroll` 滚轮方向翻转，-0 已修）。
- `src/main/paths.ts` — `resolveScrcpyServerPath`（惰性：server 缺失只禁投屏，不阻断应用启动）。

## 历史：scrcpy.exe 已移除

外部窗口曾是 spawn 官方 scrcpy.exe（`ScrcpyManager`）。其 SDL 3 显示层在部分机器（含开发机）必然段错误 0xC0000005，且解码/显示层与协议无关——已整体删除，独立窗口改为 yume-chan 会话渲染到独立 BrowserWindow。`vendor/scrcpy` 只随包分发 `adb.exe`、`AdbWinApi.dll`、`AdbWinUsbApi.dll`、`scrcpy-server`（extraResources filter），scrcpy.exe/SDL/ffmpeg DLL 不再打包（约省 31MB）。

## 会话链路（两种形态共用）

1. `mirror:embedded-start` → `EmbeddedMirrorManager.start(serial)`：
   - `adb start-server` 预热 → `AdbServerNodeJsClient().createAdb({serial})`（连本机 adb server 5037，与 adb CLI 无冲突）→ `AdbScrcpyClient.pushServer`（内置 scrcpy-server 4.0 字节，读取失败清缓存可重试）→ `AdbScrcpyClient.start(adb, "/data/local/tmp/scrcpy-server.jar", new AdbScrcpyOptions4_0({audio:false, control:true, tunnelForward:true, videoCodec:"h264", videoBitRate:8M, maxSize:1600}))`。
   - **CJS 主进程加载 ESM-only 依赖**：顶部 `require("@yume-chan/...") as typeof import(...)`（Electron Node ≥22.12 支持 require(esm)；类型桥接用 `as unknown as Parameters<...>` 解决 stream void/undefined 方差）。
2. 视频包广播（`mirror:event`，发全部窗口）：`meta{codec,deviceName}` → `video{kind: configuration|data|session}` → `status{running,message}`。会话已存在时 start 补发缓存的 meta/configuration/status（面板/窗口重开即接上，resync 语义）。
3. 渲染层解码（MirrorPane 与 MirrorWindow 相同模式）：`WebCodecsVideoDecoder`，packets ReadableStream 在 meta 前先建好（不丢包）pipe 进 `decoder.writable`；canvas 用 `replaceChildren` 挂进宿主。
4. 控制回流：`sendMirrorControl`（fire-and-forget `ipcRenderer.send`）→ 主进程 `control()`：渲染层只发归一化坐标，主进程按**当前视频尺寸**换算像素（旋转后尺寸过期也不丢指令），touch 有 clamp01、scroll 有 ±16 钳制、back = injectKeyCode(AndroidBack) Down+Up（beta.2 无 pressBackOrTurnOnScreen）。全部写入 `.catch(()=>undefined)`（断连窗口期不产生 unhandledRejection）。

## 互斥编排（main.ts，幂等设计）

- **弹出独立窗口** `mirror:start`：先 `await embeddedMirror.stop(serial)`（确定性先停，避免与内嵌面板卸载清理的 stop 时序竞争），再开/聚焦窗口；窗口加载后渲染层自建新会话（弹出过程有 ~1s 重连间隙，与旧 scrcpy.exe 冷启动相当）。
- **内嵌抢占** `mirror:embedded-start`：先 `closeMirrorWindow(serial)`（删表 → close → 停会话）再 `start`。表先删使窗口 closed handler 跳过二次 stop，顺序完全确定。**例外**：独立窗口挂载时也走这条 IPC 启动自己的会话，按 `BrowserWindow.fromWebContents(event.sender)` 判断——发送方就是该 serial 的独立窗口时跳过关窗（否则窗口会把自己关掉，再留下一个无人观看的孤儿会话）。
- **窗口关闭**：closed handler 兜底 `embeddedMirror.stop(serial)`——窗口销毁时渲染层 React 清理不会执行，主进程是唯一可靠清理点。`mirror:stop` 与 closed 双路径都幂等。
- 渲染层 `device.mirroring = mirrorWindows.has(serial) || embeddedMirror.isRunning(serial)`。

## 交互语义（scrcpy 对齐）

- 画布左键按下/拖动/抬起 = 触摸；**仅左键**（右键/中键不注入）。
- `pointercancel` 无条件发 touch up（其 `button` 恒为 -1，不能加门禁——否则触摸卡死在按下）。
- 右键 = 返回键；滚轮 = injectScroll；wheel 用**原生非被动监听**（React onWheel 是 passive，preventDefault 无效）。
- 面板头部「⇗」弹窗按钮：切到独立投屏窗口并自动关闭内嵌（`toggleMirrorWindow`）。

## 生命周期竞争（已修，勿回退）

- start 期间 stop：`stopRequested` Set 登记，start 在 `sessions.set` 前消费；start 中途再 start 会撤销挂起的 stop（dev StrictMode 双挂载靠这个活着）。
- start 半途失败：catch 关闭 client（防设备端 server 进程残留）+ 清 sessions + starting。
- 隐藏 Tab `decoder.pause()`：内存有界于一个 GOP（≈10MB），pipeTo 持续消费，队列不涨。
- 独立窗口 StrictMode 安全性：StrictMode 的 stop 不广播 status:false（`stopRequested` 路径静默），不会误触发自动关窗。

## 已知边界

- 中途接上的流要等下一个关键帧才出画面（GOP 默认 ~10s）。
- H.265/AV1 未启用（固定 h264，WebCodecs 能力有但未开选项）。
- 独立窗口固定 420×780 起始尺寸，视频等比缩放居中（`object-fit` 语义由 max-width/max-height 实现）；不随视频比例自适应窗口大小。
- 无键盘输入注入（旧 scrcpy.exe 有；内嵌面板本就没有，为保持一致未做）。需要敲字用终端或真机输入法。
- 弹出/收回瞬间设备侧 server 重启，有 ~1s 黑屏间隙。

## 测试

`src/renderer/mirror-control.test.ts`（坐标/滚轮纯函数）。会话与窗口生命周期重依赖真机/Electron，无 mock 单测（testing-policy：平台集成行为在真实环境验证），靠真机手工验证清单。
