# APK 反编译（jadx）

> 父文档：[AGENTS.md](../../AGENTS.md) · 相关：[APK 安装](apk-install.md)、[管理窗口](manager-windows.md)

## 职责

拖入 APK → 内置 jadx 反编译为 Java 源码 + 解码资源 → 文件树浏览 + 文本预览/复制。独立窗口（`?view=decompiler`），不依赖设备。

## 文件

- `src/main/decompile-manager.ts` — `DecompileManager`：spawn java jadx、进度事件、tree/readFile（安全读取）、cancel/cleanup；导出纯函数 `buildJadxArgs`/`buildDecompileTree`/`resolveWithinRoot`/`isPreviewableExtension`。
- `src/renderer/DecompilerWindow.tsx` — 四态视图（idle 拖放 / running 进度 / done 树+查看器 / error），树过滤与折叠，复制内容（复用 `copyLogcatText` IPC）。
- `src/main/paths.ts` — `resolveJavaExecutable`（JAVA_HOME → AS JBR 常见路径 → PATH）、`resolveJadxJarPath`（`JADX_PATH` → resources/jadx → 常见安装路径 → cwd vendor；校验 lib 下 `jadx-*-all.jar`）。
- `vendor/jadx/` — jadx 1.5.6 发行包（bin + lib/jadx-1.5.6-all.jar 76MB），extraResources 打包为 `resources/jadx`。

## 交互模型：渐进浏览（懒加载的落地方式）

拖入后**不是等全量完成**才能看：jadx 是渐进写盘的（实测 27MB APK：2.8s 起文件开始落地、4s 已 656 个、14s 全量 5362 个）。渲染层利用这一点：

- running 阶段每 2s 轮询 `getDecompileTree`，树里出现文件即切换为「树+查看器」视图，顶部绿色角标显示「正在反编译 · 已生成 N 项，可直接浏览」。
- 渐进刷新**不重置**用户已展开的目录与选中（仅首次设置默认展开）。
- `tree()`/`readFile()` 主进程侧不检查运行状态，天然支持进行中读取——不要加"完成才可读"的门禁。
- 曾评估的替代方案及否决原因：`--single-class` 按需解单类（每次 ~3s JVM 冷启动，点 10 个类 30s，不可接受）；Node 自解析 dex 类清单（重写 dex 解析器，复杂度不成比例）。

## 搜索（两个层次，别混）

1. **文件内查找**（Ctrl+F，用户主用）：查看器头部「查找」按钮或快捷键唤起查找栏；输入即高亮当前文件全部命中（≤2000 个，大小写不敏感，纯渲染层 `findAllIndices` + `renderWithFindHighlights` 切分，`mark` 段），计数 N/M，Enter/↓↓ 跳转（Shift+Enter 上一个）并滚动居中，Esc 关闭。内容在渲染层内存里，不涉及 IPC。
2. **产物全文搜索**（树顶「路径 | 全文」模式切换）：搜整个反编译产物（文件名 + 文本内容）。

全文搜索语义：文件名匹配或**文本文件内容**包含关键词（大小写不敏感）；二进制后缀跳过内容、单文件采样 ≤2MB、结果上限 500 条（`searchDecompileOutput` 纯函数 + 单测）。

- 全文搜索渲染层 300ms 防抖；点结果自动切回树视图、展开父目录链并打开文件；渐进阶段文件未入树时按路径直读（兜底）。
- 反编译进行中两者都可用（搜/看的是已落盘部分）。

## 调用链（探针实证）

```
java -XX:+IgnoreUnrecognizedVMOptions -Xms256M --enable-native-access=ALL-UNNAMED \
     -cp <jadx-all.jar> jadx.cli.JadxCLI -d <outDir> <apk>
```

- **无 `--threads` 选项**（1.5.6 会报 Unknown option 直接退出）。
- 退出码语义：0 = 完成；**3 = 完成但部分类失败（常态，按成功处理并提示）**；其他 = 失败（保留 tail 输出 + 清理目录）。
- 实测：27MB APK 约 14s、3803 类；progress 行 `INFO - progress: N of M (P%)`。

## IPC

- `decompile:start`（readApkFile 校验 → mkdtemp `adt-decompile-*/out` → 返回 jobId；Java/jadx 缺失时启动即报错，其余功能不受影响）。
- `decompile:cancel` / `decompile:discard`（kill + rmSync）、`decompile:tree`（上限 30k 节点 + truncated 标记）、`decompile:read`。
- 事件 `decompile:event`：`progress{line}`（tail 保留 40 行）/ `done{ok, message}`，广播全部窗口但渲染层按 jobId 过滤。

## 安全边界（勿删）

- `resolveWithinRoot`：`path.resolve` 后必须仍在 job 输出根内，拒绝 `../` 与绝对路径穿越（单测覆盖）。
- 读文件 ≤2MB；非文本后缀白名单（`isPreviewableExtension`）返回 `binary:true` 占位，不读内容。
- 输出目录在系统 temp；窗口「重新开始」、cancel、before-quit 均清理。

## 已知边界

- 无进度百分比 UI（jadx 只输出日志行，渲染层显示尾部滚动）。
- 超 30k 文件的 APK 树截断。
- 依赖本机 Java 运行时（不随 EXE 内置，体积考虑；错误信息列出探测路径）。

## 测试

`src/main/decompile-manager.test.ts`（14 用例：参数构造、路径守卫、树遍历/排序/截断、进度流、退出码语义、取消、读取守卫）。
