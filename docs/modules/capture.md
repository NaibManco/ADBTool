# 截图与录屏

> 父文档：[AGENTS.md](../../AGENTS.md) · 相关：[投屏](mirror.md)（录屏复用其 scrcpy-server 链路）

## 职责

设备截图（adb screencap，自动复制剪贴板 + 预览）与录屏（scrcpy-server 隐藏会话 → 电脑侧 mp4 封装，计时、结束即播放）。

## 录屏策略（v3，2026-09-09）

**先 adb screenrecord（轻量、多数设备可用），启动校验失败自动回退 scrcpy 兼容链路**：

1. **adb 路径**（`capture-manager.ts`）：`sh -c "screenrecord --time-limit 180 … & echo $!"`，启动后 1.5s 用 `shell test -e` 校验远端文件已生成——screenrecord 错误被重定向，受限设备（如 OnePlus PKB110/Android 16：文件模式 Permission denied、exec-out 流式挂死）也会返回 PID，必须靠文件出现与否判定真实启动。失败则杀 PID 清会话抛错 → 触发回退。限制：180s（screenrecord 硬限）。
2. **scrcpy 兼容链路**（`screen-recorder.ts` 的 `ScreenRecorder`，永不受设备 screenrecord 策略影响）：@yume-chan 隐藏视频会话（`video:true, audio:false, control:false`，h264/8Mbps，与内嵌投屏同 server 独立连接、可与投屏并存）→ `session` 包取宽高、`configuration` 包经 `@yume-chan/media-codec` 解 SPS/PPS → avcC；`data` 包起始码转长度前缀喂 `mp4-muxer`（StreamTarget 流式写盘、`fastStart:false`、`firstTimestampBehavior:'offset'`，时长用相邻 pts 差）。停止正常收尾写 moov，**无时长限制**。
3. 回退发生时开始消息会注明"设备限制 screenrecord，已用兼容链路"。两条链路停止/list 逻辑在 main.ts handler 按 `isRecording` 分派，统一写 `captureMedia`。

已知边界：`scrcpy.exe`（外部投屏）在本机曾因 SDL 段错误不可用，与录屏无关（录屏不经过 scrcpy.exe）。

## 截图

`src/main/capture-manager.ts` 另含 `captureScreenshotBuffer`（`adb exec-out screencap -p` + PNG 魔数校验）。

## 预览与媒体

- `capture-media-store.ts`：临时文件（`temp/AndroidDevTool/capture-preview`）+ 安全协议 `android-dev-capture://media/<id>`；`reset()` 启动、`cleanup()` before-quit。
- `CapturePreview.tsx`：图片/视频预览、另存为、复制。`.ws-overlay` 浮层覆盖工作区，不卸载底层会话。
- 录屏状态：App `recordingSerials`/`recordingStarts`（`listScreenRecordings()` 播种 + 1s ticker）。

## 约定（历史坑，勿回退）

- **停止必清理**：主进程与 App 停止路径无论成败都清会话/状态，否则永久卡"录制中"。
- 录屏 mp4 收尾失败时保留真实错误（如 muxer 抛出的首帧时间戳问题），不静默。
- 对话框取消 = 正常结果。

## 测试

`src/main/screen-recorder.test.ts`（avcC 构造、Annex-B→AVCC 纯函数）、`src/main/capture-manager.test.ts`（截图参数）、`src/main/capture-media-store.test.ts`、`src/renderer/CapturePreview.test.tsx`。真机链路靠 PKB110 实测（5s 录制 → ftyp/mdat/moov 结构完整）。
