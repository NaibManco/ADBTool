# 投屏（内嵌 + 独立窗口）

> 父文档：[AGENTS.md](../../AGENTS.md) · 相关：[应用外壳](app-shell.md)、[ADB](adb-device.md)

## 职责

两种投屏形态，**共用同一套 yume-chan 会话**（每设备一个会话，事件广播到全部窗口）：内嵌到主窗口右侧工作区的视频流投屏（主形态），与独立 BrowserWindow 大屏窗口（辅形态）。两者互斥切换（弹出时自动关闭内嵌，反之亦然）。

## 文件

- `src/main/embedded-mirror-manager.ts` — 会话核心：@yume-chan（scrcpy 4.0）会话管理、视频包广播、控制注入。内嵌面板与独立窗口都是它的消费者。
- `src/main/main.ts` — `mirrorWindows`（serial → BrowserWindow）：`createMirrorWindow`（420×780 起始，`?view=mirror&serial=&label=`，label 用于窗口标题）、`fitMirrorWindowToVideo`（session 包/活会话弹出时按视频宽高比自适应）、`closeMirrorWindow`（幂等：删表 → close → 停会话）、`mirror:start`/`mirror:stop`/`mirror:embedded-start` handler 的互斥编排。
- `src/renderer/MirrorPane.tsx` — 内嵌解码面板：WebCodecsVideoDecoder、canvas 挂载、指针/滚轮/右键交互。
- `src/renderer/MirrorWindow.tsx` — 独立窗口页面：同一套解码/交互逻辑，无面板装饰；会话结束（运行过）立即自动关窗，启动失败展示错误 4 秒后关窗。
- `src/renderer/mirror-control.ts` — 纯坐标映射（`normalizedPoint` 归一化钳制、`wheelToScroll` 滚轮方向翻转，-0 已修）。
- `src/main/paths.ts` — `resolveScrcpyServerPath`（惰性：server 缺失只禁投屏，不阻断应用启动）。

## 历史：scrcpy.exe 已移除

外部窗口曾是 spawn 官方 scrcpy.exe（`ScrcpyManager`）。其 SDL 3 显示层在部分机器（含开发机）必然段错误 0xC0000005，且解码/显示层与协议无关——已整体删除，独立窗口改为 yume-chan 会话渲染到独立 BrowserWindow。`vendor/scrcpy` 只随包分发 `adb.exe`、`AdbWinApi.dll`、`AdbWinUsbApi.dll`、`scrcpy-server`（extraResources filter），scrcpy.exe/SDL/ffmpeg DLL 不再打包（约省 31MB）。

## 会话链路（两种形态共用）

1. `mirror:embedded-start` → `EmbeddedMirrorManager.start(serial, sender)`：
   - `adb start-server` 预热 → `AdbServerNodeJsClient().createAdb({serial})`（连本机 adb server 5037，与 adb CLI 无冲突）→ `AdbScrcpyClient.pushServer`（内置 scrcpy-server 4.0 字节，读取失败清缓存可重试）→ `AdbScrcpyClient.start(adb, "/data/local/tmp/scrcpy-server.jar", new AdbScrcpyOptions4_0({audio:false, control:true, tunnelForward:true, videoCodec:"h264", videoBitRate:8M, maxSize:1600, videoCodecOptions:"i-frame-interval=2"}))`。
   - **CJS 主进程加载 ESM-only 依赖**：顶部 `require("@yume-chan/...") as typeof import(...)`（Electron Node ≥22.12 支持 require(esm)；类型桥接用 `as unknown as Parameters<...>` 解决 stream void/undefined 方差）。
2. 视频包广播（`mirror:event`，发全部窗口）：`meta{codec,deviceName}` → `video{kind: configuration|data|session}` → `status{running,message}`。会话已存在时 start 走 **resync**：把缓存的 meta/configuration/**GOP 数据包**（见下）**定向**补发给请求方 webContents，再发 status:true（广播闭包带 target 参数；GOP 重放绝不能广播，否则已有观众的流里会混入重复包）。
3. 渲染层解码（MirrorPane 与 MirrorWindow 相同模式）：`WebCodecsVideoDecoder`，packets ReadableStream 在 meta 前先建好（不丢包）pipe 进 `decoder.writable`；canvas 用 `replaceChildren` 挂进宿主。**晚接入门控**：订阅瞬间数据流已在广播，裸 data 包可能抢在 configuration 之前到达——解码管道未配置就收到 data 会抛错并关闭整条流（表现：永久黑屏 + console 刷 "Cannot enqueue into closed stream"）。监听器丢弃 configuration 之前的 data、配置后等首个关键帧再喂（标准 scrcpy 播放器语义）。
4. 控制回流：`sendMirrorControl`（fire-and-forget `ipcRenderer.send`）→ 主进程 `control()`：渲染层只发归一化坐标，主进程按**当前视频尺寸**换算像素（旋转后尺寸过期也不丢指令），touch 有 clamp01、scroll 有 ±16 钳制、back = injectKeyCode(AndroidBack) Down+Up（beta.2 无 pressBackOrTurnOnScreen）。全部写入 `.catch(()=>undefined)`（断连窗口期不产生 unhandledRejection）。

## GOP 缓存（晚接入观众秒出画）

设备编码器对 `i-frame-interval` 的服从度参差（实测眼镜 ~2.2s 一个 IDR，某 OPPO 手机静态画面 15s+ 甚至不出）。晚接入观众若只能等线上 IDR，首帧可能十几秒不来。主进程为每个会话缓存**自最近一个关键帧起的数据包**（`session.gop`，上限 300 包 / 8MB，超限或收到新 configuration 即整段重建），resync 时定向重放——新观众拿到完整可解码前缀立即出画，老观众无感。缓存段必须以关键帧开头（重建期内的散帧不进缓存）。

## 互斥编排（main.ts，会话连续设计）

形态切换**不重启会话**：观众来来去去，会话尽量活着（部分设备——如眼镜——编码器被活跃会话占用后立即重启会卡死等首帧，实测 3/3 复现）。

- **弹出独立窗口** `mirror:start`：**不停会话**，开/聚焦窗口；窗口页面挂载后自己走 `mirror:embedded-start`（sender=自己，不会关自己）→ resync + GOP 重放接上，秒出画。内嵌面板随后卸载，其清理 stop 被下述守卫吞掉。
- **内嵌抢占** `mirror:embedded-start`：`closeMirrorWindowOnly`（删表 → close，**不动会话**）后 `start(serial, sender)` resync 接上。表先删使窗口 closed handler 跳过兜底 stop。**例外**：发送方就是该 serial 的独立窗口时跳过关窗（否则窗口把自己关掉）。
- **停止宽限期**（EmbeddedMirrorManager）：`stop()` 不立即销毁会话，挂 1.5s 计时器；期内新观众 `start()` 则撤销销毁走 resync，到点无人接才真正停。覆盖抢占/StrictMode 重挂载等毫秒级观众抖动——守卫（`mirrorWindows.has`）只保护长窗口场景（独立窗口页面加载 2-3s），宽限期补上短抖动场景。
- **窗口关闭**：closed handler 兜底 `embeddedMirror.stop(serial)`（宽限语义）——窗口销毁时渲染层 React 清理不会执行，主进程是唯一可靠清理点。`mirror:stop`（显式停止）与 closed 双路径幂等。
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
- 面板 `[decoder, active]` 效果里 resume/pause 需 try/catch：停止投屏的事件回调会同步 dispose 解码器，而效果闭包可能还持着旧实例，对已释放实例 resume 会抛 "Attempt to resume a closed decoder" 并炸掉整棵组件树（无 error boundary，整窗白屏）。
- 独立窗口 StrictMode 安全性：StrictMode 的 stop 不广播 status:false（`stopRequested` 路径静默），不会误触发自动关窗。

## 已知边界

- H.265/AV1 未启用（固定 h264，WebCodecs 能力有但未开选项）。
- 独立窗口 420×780 起始（适合手机竖屏）；视频首个 session 包到达后 `fitMirrorWindowToVideo` 按宽高比自适应内容区（适配 70%×75% 工作区、不放大超过原视频分辨率），首次 fit 居中。同比例重复触发（<5% 偏差）跳过，不与用户手动改窗打架；手机横竖屏切换会重 fit。视频本体始终等比缩放居中（max-width/max-height）。
- 无键盘输入注入（旧 scrcpy.exe 有；内嵌面板本就没有，为保持一致未做）。需要敲字用终端或真机输入法。
- GOP 缓存超限（300 包/8MB，长时间无 IDR 的高码率动态画面）时降级为等线上关键帧，晚接入首帧变慢但不失败。
- `videoCodecOptions` 用字符串形式 `"i-frame-interval=2"`（@yume-chan/scrcpy 根入口不导出 CodecOptions 类）；部分设备编码器无视该参数，GOP 缓存兜底。

## 测试

`src/renderer/mirror-control.test.ts`（坐标/滚轮纯函数）。会话与窗口生命周期重依赖真机/Electron，无 mock 单测（testing-policy：平台集成行为在真实环境验证），靠真机手工验证清单。
