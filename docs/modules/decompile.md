# APK 反编译（jadx）

> 父文档：[AGENTS.md](../../AGENTS.md) · 相关：[APK 安装](apk-install.md)、[管理窗口](manager-windows.md)

## 职责

拖入 APK → 内置 jadx 反编译为 Java 源码 + 解码资源 → 文件树浏览 + 文本预览/复制。独立窗口（`?view=decompiler`），不依赖设备。

## 文件

- `src/main/decompile-manager.ts` — `DecompileManager`：spawn java jadx、进度事件、tree/readFile（安全读取）、cancel/cleanup；导出纯函数 `buildJadxArgs`/`buildDecompileTree`/`resolveWithinRoot`/`isPreviewableExtension`。
- `src/renderer/DecompilerWindow.tsx` — 四态视图（idle 拖放 / running 进度 / done 树+查看器 / error），树过滤与折叠，复制内容（复用 `copyLogcatText` IPC）。
- `src/main/paths.ts` — `resolveJavaExecutable`（JAVA_HOME → AS JBR 常见路径 → PATH）、`resolveJadxJarPath`（`JADX_PATH` → resources/jadx → 常见安装路径 → cwd vendor；校验 lib 下 `jadx-*-all.jar`）。
- `vendor/jadx/` — jadx 1.5.6 发行包（bin + lib/jadx-1.5.6-all.jar 76MB），extraResources 打包为 `resources/jadx`。

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
