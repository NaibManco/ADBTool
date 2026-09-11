# ADB 与设备控制

> 父文档：[AGENTS.md](../../AGENTS.md) · 相关：[投屏](mirror.md)、[Logcat](logcat.md)、[终端](terminal.md)、[截图录屏](capture.md)

## 职责

adb 可执行文件解析、设备发现轮询、按键/重启等设备控制命令、应用启动、无线调试连接（pair/connect/tcpip）、应用进程列表。

## 文件

- `src/main/adb.ts` — `AdbClient`：所有一次性 adb 命令（execFile + 参数数组，显式 `-s <serial>`）。导出纯函数 `buildXxxArgs` 家族（键事件/音量/重启/安装/卸载/清数据/force-stop/启动应用/清 logcat 缓冲/bugreport/pair/connect/tcpip 等）与解析函数（`parseAdbDevices`、`parseInstallFailure`、`parseRunningAppProcesses`、`parsePairResult`/`parseConnectResult`/`parseDeviceIpv4Addresses` 等，后三者返回 `WirelessResult{ok, message}` 中文归因）。
- `src/main/paths.ts` — 可执行文件解析：`resolveAdbPath`（内置 resources → env → SDK → PATH），同样导出 `buildAdbCandidates` 等纯函数供测试。

## 关键命令构造（纯函数，均有单测）

- 按键：`adb -s <s> shell input keyevent <code>`（back=4 home=3 recents=187 power=26）。
- 音量：`shell cmd media_session volume --stream 3 --adj raise|lower`（注意：音量已从设备卡 UI 移除，DeviceAction 类型与命令仍保留）。
- 重启：`adb -s <s> reboot`。
- 启动应用：`shell monkey -p <pkg> -c android.intent.category.LAUNCHER 1`（免知道 Activity 名）。`AdbClient.launchApp` 归因输出：`No activities found to run` → 缺 LAUNCHER 入口；`monkey aborted` → 包不存在等（monkey 失败常以退出码 0 结束，成功也可能非零，stdout/stderr 合并判断）。
- 无线配对/连接：`adb pair <ip:port> <code>` / `adb connect <ip:port>`；USB 一键转无线 = `adb -s <s> tcpip 5555` + `adb connect <ip>:5555`（handler 内 1.5s 后失败重试一次，adbd 切换需要时间）。
- **连接失败网段诊断**（main.ts `withSubnetDiagnosis` + adb.ts `findLocalSubnetMatch`）：目标 IPv4 不落在任何本机网卡子网时，附加「设备 X 不在本机任何网段（本机 IPv4：…）」指引。真机案例：手机 wlan0 在 192.168.137.x、电脑只有 172.16.x/10.41.x，TCP 层不可达、重试必然超时——ColorOS 并不封 5555（adbd 照常 `tcp6 [::]:5555 LISTEN`），先查两边是否同网段再怀疑设备。
- 设备 IP：`shell ip -o -4 addr show scope global`，`parseDeviceIpv4Addresses` **wlan 接口优先**排序（真机上 rmnet/vgate 等虚拟接口也会出现）。
- 进程列表：并行 `dumpsys activity activities` + `ps -A -o PID,NAME` + `pm list packages`，`parseRunningAppProcesses` 合成 `{pid, processName, packageName, foreground}`（前台优先排序）。

## 设备状态流

- 渲染层 `App.refresh()` 每 2.5s 调 `devices:list`；`mirroring` = 外部 scrcpy ∥ 内嵌投屏任一运行，`mirroringEmbedded` 单列内嵌态。
- 投屏/终端/日志的状态事件会即时触发一次 refresh，不等轮询。
- `AndroidDevice` 类型新增字段时：`parseAdbDevices` 的 `Omit<...>` 返回类型、全部渲染层测试夹具、`devices:list` handler 的 map 都要同步。

## 约定

- 永远 `execFile` + 参数数组，禁止拼接 shell 字符串；serial 经 `assertSerial`（`SERIAL_PATTERN`）校验。
- 设备序列号、包名、路径都有边界校验（`assertPackageName`/`readApkFile`/`normalizeDevicePath`）；无线地址在 main.ts 经 `assertWirelessAddress`（host 模式 + 端口 1–65535）、配对码 `^\d{4,8}$` 校验。
- 无线 IPC：`adb:pair`（host, port, code）/ `adb:connect`（host, port）/ `adb:connect-via-usb`（serial，拒绝已是 `ip:port` 形态的设备）。
- 长命令带超时（8–60s），失败保留真实 adb 错误文本，不静默吞。

## 测试

`src/main/adb.test.ts`（全部 buildXxxArgs/解析纯函数）、`src/main/paths.test.ts`。
