# 剪贴板同步（PC ↔ 设备）

> 父文档：[AGENTS.md](../../AGENTS.md) · 相关：[投屏](mirror.md)（共用 scrcpy-server 会话链路）

## 职责

按设备开关的剪贴板双向自动同步：设备复制 → 电脑剪贴板；电脑复制 → 设备剪贴板。不依赖投屏是否开启。

## 文件

- `src/main/clipboard-sync-manager.ts` — `ClipboardSyncManager`：每设备一个隐藏 scrcpy 会话（`video:false, audio:false, control:true, tunnelForward:true, clipboardAutosync:true, sendDeviceMeta:false`）。
- 渲染层入口：设备卡头部的剪贴板图标按钮（`rail-clip-sync`），状态经 `clipboard-sync:list` 随设备轮询刷新。

## 数据流

- **设备 → 电脑**：会话 `client.clipboard` 流（autosync 推送）→ `clipboard.writeText`（Electron 主进程）。
- **电脑 → 设备**：主进程 1.5s 轮询 `clipboard.readText()`，变化时对所有开启设备 `controller.setClipboard({sequence:0n, paste:false, content})`。
- **防回环**：全局 `lastPcText` 记录最近一次同步文本；设备→电脑写入后同样更新它，电脑轮询看到相同文本不再回发；空文本不同步（不清空对端）。
- 设备拔线 → 会话 exited → 自动 disable + `clipboard-sync:event` 广播 `{serial, message}`（渲染层提示）。

## 关键坑（探针实证，勿回退）

- **`sendDeviceMeta` 必须为 `false`**：scrcpy 3.x+ 默认在首个 socket 发送 64 字节设备名（如 "PKB110"）。`video:false` 时无人消费该元数据，首字节 'P'(0x50=80) 被设备消息解析链当成未知 id 80，剪贴板流立即报错。这是排查了半天的根因。
- `setClipboard` 的 `sequence: 0n` 表示不需要 server 回 ACK；实测 ColorOS 设备上自己 set 的内容仍会经 autosync 回推（未过滤），恰好构成双向回环验证。
- yume-chan 的 `sendDummyByte` 默认 true（1_22 继承），与 scrcpy 4.0 行为一致，无需显式设置。

## IPC

- `clipboard-sync:set (serial, enabled)` → enable/disable + 中文消息
- `clipboard-sync:list` → 开启中的 serial 数组（渲染层随 2.5s 设备轮询拉取）
- 事件 `clipboard-sync:event {serial, message}`（意外断开通知）

## 测试与验证

- 纯函数 `shouldSyncClipboardText`（空文本/去重守卫）在真实模块中导出。
- 真机验证：PKB110 上 enable→3s 存活→disable 生命周期干净；双向通路经独立探针实证（setClipboard → 设备剪贴板 → autosync 回推收到同文本）。
