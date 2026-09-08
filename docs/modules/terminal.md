# 终端（交互式 Shell）

> 父文档：[AGENTS.md](../../AGENTS.md) · 相关：[Logcat](logcat.md)、[ADB](adb-device.md)

## 职责

每设备一个持久 `adb -s <serial> shell` 会话：cd/环境变量/su 保留，输出实时流，输入行带本地历史，可发 Ctrl+C。

## 文件

- `src/main/terminal-manager.ts` — `TerminalManager`：会话 spawn（stdio pipe）、`write`（stdin 写入，失败仅提示不抛）、start 对已存在会话 resync（重发 status 让新面板接上）。
- `src/renderer/TerminalPane.tsx` — 面板：100ms 批量输出（上限 200k 字符）、输入行（Enter 提交、↑↓ 历史 50 条）、^C 按钮（发 `\x03`）、清屏、关窗即 stop。
- 主窗口集成见 [应用外壳](app-shell.md)（工作区第三视图）。

## 数据流

- `terminal:event`：`data{stream: out|err, data}`（stdout/stderr 都进同一条流，渲染层混排）+ `status{running, message}`。
- `terminal:input`（ipcMain.on，fire-and-forget）：串校验 + 长度 ≤4096 + 写 stdin。
- 输入行回车 → 本地回显 `$ cmd`（echo）+ 发送 `cmd\n`；↑↓ 换入历史时 index -1 表示“新输入”。

## 限制（有意）

- 无 PTY：`vi`/`top` 等全屏交互程序不可用（输出是纯文本流）。
- 输出剥离 ANSI 转义序列（`ANSI_PATTERN`）保持纯文本。
- Ctrl+C 只能中断前台命令；无 Tab 补全、无 Ctrl+D 挂起等控制键支持（只回车和 ^C）。

## 测试

`src/main/terminal-manager.test.ts`（参数构造、流转发、resync、stdin 写、退出上报、按设备隔离停止）。
