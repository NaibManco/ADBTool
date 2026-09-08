# Logcat

> 父文档：[AGENTS.md](../../AGENTS.md) · 相关：[终端](terminal.md)、[ADB](adb-device.md)

## 职责

多设备实时日志：adb logcat 会话、查询语法过滤（渲染层）、缓冲区切换、导出/复制、跟随滚动、查询历史。

## 文件

- `src/main/logcat-manager.ts` — 会话管理：spawn `adb -s <s> logcat -b <buffer> -v threadtime -T 5000 [--pid=N]`；`LOGCAT_BACKLOG="5000"`；`lastOptions`（pid 权威、buffer 粘滞）；`setBuffer`/`resync`；`THREADTIME_PATTERN` 解析。
- `src/renderer/LogcatPanel.tsx` — `LogcatWorkspace`（设备 Tab）+ `LogcatDevicePane`（全部 UI 状态按 serial 隔离在 pane 内）。
- `src/renderer/logcat-query.ts` — 查询语法引擎（纯函数，无 React/Electron 依赖）。
- `src/renderer/HighlightText.tsx` — 命中词高亮切分（最早命中优先，段数上限 200）。
- `src/main/adb.ts` — `buildClearLogcatArgs`（`-b <buffer> -c`，顺序敏感）+ `clearLogcatBuffer`。

## 查询语法（对齐 Android Studio）

| 形式 | 语义 |
|---|---|
| 裸词 | raw 大小写不敏感子串，多词 AND |
| `tag:v` `message:v` | 子串（不区分大小写） |
| `tag~:p` `message~:p` | 正则（区分大小写，无 flags，≤200 字符） |
| `pid:n` `tid:n` | 整数相等 |
| `level:X` | 阈值：X 及以上（字母或 verbose/debug/info/warn/warning/error/fatal） |
| `package:name` | pid→包名映射精确匹配（渲染层懒加载 `listAppProcesses`，60s 刷新） |
| `-` 前缀 | 取反（`-level:D` = 严格低于） |
| `"a b"` | 引号防切分 |

未知 `word:value` 当裸词（比 AS 宽容）；解析错误内联红字显示且 `matchesEntry` 恒 false 不崩溃。

## 数据流

- 事件 `logcat:event`（逐行广播全部窗口，`LogcatEvent = entry | status{running, pid?, buffer?}`）。
- 渲染层 100ms 批量 flush 进 `entries`（上限 50k，`seq` 做 key）；查询输入 150ms 防抖后 `parseQuery` → `useMemo` 过滤（`!active` 或有错误直接空）。
- pid→包名 map：`parsed.needsPackageMap` 为真才拉取，失败提示「package: 过滤暂不可用」，到位后 memo 回溯重算。
- 缓冲区/进程切换 → `setLogcatBuffer`/`setLogcatProcess`（重启 adb 会话）+ **必须 `clearDisplay()`**（`-T 5000` 重灌会重叠重复）。

## 渲染性能

- 渲染窗口 `renderLimit`（默认 5000，滚到顶部 +2000，scrollAnchor 反向恢复不跳）；跟随滚动距底 >40px 自动脱离，「回到最新」浮动按钮。
- 点击 tag/PID 追加查询 token（`appendQueryToken`，值含空白自动加引号）；右键 tag = 隐藏（`-tag:`）。
- 等级下拉是精确基线，查询含 `level:` 时查询优先（下拉 `data-overridden` 置灰）。

## 其他要点

- `logcat:start` 对已存在会话返回 ok + resync（两窗口/刷新后面板接上真实状态）。
- 导出 20MB / 复制 2M 字符上限；保存对话框复用 bugreport 模式，取消是正常结果。
- 查询历史 localStorage `androidDevTool.logcat.queryHistory.v1`（≤15，全局共享）。
- 双窗口同 serial：共享主进程会话，靠 status 事件 reconcile。

## 测试

`src/renderer/logcat-query.test.ts`（31 用例，最大套件）、`src/renderer/HighlightText.test.tsx`、`src/main/logcat-manager.test.ts`（spawn 参数/缓冲粘滞/resync）、`src/renderer/LogcatPanel.test.tsx`（宽松标记断言）。
