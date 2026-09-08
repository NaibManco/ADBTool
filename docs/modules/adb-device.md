# ADB 与设备控制

> 父文档：[AGENTS.md](../../AGENTS.md) · 相关：[投屏](mirror.md)、[Logcat](logcat.md)、[终端](terminal.md)、[截图录屏](capture.md)

## 职责

adb 可执行文件解析、设备发现轮询、按键/重启等设备控制命令、应用进程列表。

## 文件

- `src/main/adb.ts` — `AdbClient`：所有一次性 adb 命令（execFile + 参数数组，显式 `-s <serial>`）。导出纯函数 `buildXxxArgs` 家族（键事件/音量/重启/安装/卸载/清数据/force-stop/清 logcat 缓冲/bugreport 等）与解析函数（`parseAdbDevices`、`parseInstallFailure`、`parseRunningAppProcesses` 等）。
- `src/main/paths.ts` — 可执行文件解析：`resolveAdbPath`（内置 resources → env → SDK → PATH），同样导出 `buildAdbCandidates` 等纯函数供测试。

## 关键命令构造（纯函数，均有单测）

- 按键：`adb -s <s> shell input keyevent <code>`（back=4 home=3 recents=187 power=26）。
- 音量：`shell cmd media_session volume --stream 3 --adj raise|lower`（注意：音量已从设备卡 UI 移除，DeviceAction 类型与命令仍保留）。
- 重启：`adb -s <s> reboot`。
- 进程列表：并行 `dumpsys activity activities` + `ps -A -o PID,NAME` + `pm list packages`，`parseRunningAppProcesses` 合成 `{pid, processName, packageName, foreground}`（前台优先排序）。

## 设备状态流

- 渲染层 `App.refresh()` 每 2.5s 调 `devices:list`；`mirroring` = 外部 scrcpy ∥ 内嵌投屏任一运行，`mirroringEmbedded` 单列内嵌态。
- 投屏/终端/日志的状态事件会即时触发一次 refresh，不等轮询。
- `AndroidDevice` 类型新增字段时：`parseAdbDevices` 的 `Omit<...>` 返回类型、全部渲染层测试夹具、`devices:list` handler 的 map 都要同步。

## 约定

- 永远 `execFile` + 参数数组，禁止拼接 shell 字符串；serial 经 `assertSerial`（`SERIAL_PATTERN`）校验。
- 设备序列号、包名、路径都有边界校验（`assertPackageName`/`readApkFile`/`normalizeDevicePath`）。
- 长命令带超时（8–60s），失败保留真实 adb 错误文本，不静默吞。

## 测试

`src/main/adb.test.ts`（全部 buildXxxArgs/解析纯函数）、`src/main/paths.test.ts`。
