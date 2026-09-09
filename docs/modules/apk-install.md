# APK 安装

> 父文档：[AGENTS.md](../../AGENTS.md) · 相关：[ADB](adb-device.md)、[APK 反编译](decompile.md)

## 职责

APK 安装：文件选择/拖入/手输路径三种入口，主进程校验，失败中文归因，降级安装二次确认。

## 文件

- `src/renderer/ApkInstaller.tsx` — 安装弹窗：拖放区 + 路径输入 + 设备单选 + 进度；`ApkFailurePrompt`（降级确认）；`fileFromDrop`。
- `src/main/adb.ts` — `buildInstallArgs`（`adb -s <s> install [-d] -r <path>`）、`parseInstallFailure`（`ApkInstallFailure{code, reason, canForceDowngrade, raw}`，中文归因）。
- `src/main/main.ts` — `apk:select`/`apk:resolve-path`/`apk:install` handler；`readApkFile` 边界校验（绝对路径 + .apk 后缀 + statSync 非空文件）。

## 要点

- 降级：`INSTALL_FAILED_VERSION_DOWNGRADE` → `canForceDowngrade=true` → 用户确认后带 `-d` 重试。
- 三个入口共用同一条 install IPC 链路；拖拽文件路径经 `webUtils.getPathForFile`（preload `getDroppedFilePath`）。
- **最近安装**：成功安装后记入 localStorage `androidDevTool.apk.recent.v1`（按路径去重、新的在前、上限 5 条，`mergeRecentApk` 纯函数 + 单测）。弹窗内"最近安装"区块点击即校验路径（`resolveApkPath`，文件被删则报"历史文件已不可用"）并预选上次目标设备；失败安装不记录。
- 失败保留原始 adb 输出（title 悬停可见），不吞真实错误。
- 全局拖 APK 到主窗口任意位置也能唤起安装（`.apk-global-drop` 遮罩）。

## 测试

`src/main/adb.test.ts`（install 参数/失败解析）、`src/renderer/ApkInstaller.test.tsx`。
