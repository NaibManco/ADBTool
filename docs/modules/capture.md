# 截图与录屏

> 父文档：[AGENTS.md](../../AGENTS.md) · 相关：[应用外壳](app-shell.md)

## 职责

设备截图（自动复制剪贴板 + 右侧预览）与录屏（计时、结束即播放），预览浮层支持另存/再复制/缩放。

## 文件

- `src/main/capture-manager.ts` — `adb exec-out screencap -p` / `screenrecord`（限长 180s/3 段自动续录）。
- `src/main/capture-media-store.ts` — 预览媒体临时文件（`temp/AndroidDevTool/capture-preview`）+ 自定义安全协议 `android-dev-capture://media/<id>`（`net.fetch` file:// 转发，仅本 store 内文件）。
- `src/renderer/CapturePreview.tsx` — 预览：图片/视频两态、另存为（对话框）、复制、信息侧栏。

## 数据流

- `capture:screenshot` → 存 store → `ActionResult.media`（`CaptureMedia{id, url: android-dev-capture://…}`）→ 渲染层 `capturePreview` state → `.ws-overlay` 浮层覆盖工作区（**不卸载**底层投屏/日志/终端会话）。
- 录屏状态渲染层自管：`recordingSerials` Set + `recordingStarts` Map（挂载时 `listScreenRecordings()` 播种 + 1s 计时 ticker）。

## 约定

- 临时媒体目录 `reset()` 于启动、`cleanup()` 于 before-quit。
- 对话框取消 = `{ok:true, cancelled:true}` 正常结果，不是错误。
- 不掩盖缺失输出：录屏结束但无文件 → 明确报错文案。

## 测试

`src/main/capture-manager.test.ts`、`src/main/capture-media-store.test.ts`、`src/renderer/CapturePreview.test.tsx`。
