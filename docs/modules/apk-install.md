# APK 安装与提取

> 父文档：[AGENTS.md](../../AGENTS.md) · 相关：[ADB](adb-device.md)、[APK 反编译](decompile.md)、[应用管理](manager-windows.md)

## 职责

APK 安装：文件选择/拖入/手输路径三种入口，主进程校验，失败中文归因，降级安装二次确认，安装后可选自动启动。APK 提取：把设备端已装应用的 base.apk 拉回本机备份。

## 文件

- `src/renderer/ApkInstaller.tsx` — 安装弹窗：拖放区 + 路径输入 + 设备单选 + 进度 + 「安装成功后启动应用」勾选；`ApkFailurePrompt`（降级确认）；`fileFromDrop`。
- `src/main/adb.ts` — `buildInstallArgs`（`adb -s <s> install [-d] -r <path>`）、`parseInstallFailure`（`ApkInstallFailure{code, reason, canForceDowngrade, raw}`，中文归因）、`launchApp`（monkey 拉起，见 [ADB](adb-device.md)）。
- `src/main/apk-manifest.ts` — **离线包名识别**：解 zip 读 AndroidManifest.xml（二进制 AXML），取 `<manifest package>`。只读尾部 EOCD/中央目录和 manifest 条目，不加载整个 APK；STORED/DEFLATE 均支持；任何格式不符返回 undefined（调用方降级，不阻断）。不支持 ZIP64（>4GB APK，实际不存在）。
- `src/main/main.ts` — `apk:select`/`apk:resolve-path`/`apk:install` handler；`readApkFile` 边界校验（绝对路径 + .apk 后缀 + statSync 非空文件）；`withPackageName` 给前两个 handler 的返回值尽力补 `packageName`。

## 要点

- 降级：`INSTALL_FAILED_VERSION_DOWNGRADE` → `canForceDowngrade=true` → 用户确认后带 `-d` 重试。
- 三个入口共用同一条 install IPC 链路；拖拽文件路径经 `webUtils.getPathForFile`（preload `getDroppedFilePath`）。
- **安装后启动**：勾选（首次默认关）后，成功安装即对所选设备 `launchApp`。包名来自 `ApkFile.packageName`；拖入文件不经过主进程，缺包名时安装前补一次 `resolveApkPath`；识别失败不自动启动，提示改用应用管理。勾选状态持久化 localStorage `androidDevTool.apk.launchAfterInstall.v1`（"1"/"0"），关闭弹窗后保留上次选择。
- **最近安装**：成功安装后记入 localStorage `androidDevTool.apk.recent.v1`（按路径去重、新的在前、上限 5 条，`mergeRecentApk` 纯函数 + 单测）。弹窗内"最近安装（N）"**默认收起**（`recentOpen` 状态），点击标题条展开/收起（箭头随旋转）；点击条目即校验路径（`resolveApkPath`，文件被删则报"历史文件已不可用"）并预选上次目标设备；失败安装不记录。
- 失败保留原始 adb 输出（title 悬停可见），不吞真实错误。
- 全局拖 APK 到主窗口任意位置也能唤起安装（`.apk-global-drop` 遮罩）。

## APK 提取（应用管理 → 提取 APK）

- `apps:pull-apk` handler（main.ts）：校验 serial/packageName/设备端路径（须 `.apk` 结尾）→ 保存对话框（默认下载目录、文件名 `<包名>.apk`）→ `DeviceFileManager.pullFileTo`（`adb -s <s> pull <remote> <local>`，拉到具体文件路径而非目录）→ 空文件校验 → `showItemInFolder`。
- 入口在应用管理详情页操作区（`AppManager.tsx` 的"提取 APK"按钮），用 `ManagedApp.apkPath`（`pm list packages -f` 给出的 base.apk 路径）。
- **split APK 只拉 base.apk**：`pm path` 显示多个 split 的应用（语言/ABI 分包），其余 split 不拉——单独安装 base 会缺资源，需要完整备份时看设备端路径手动操作文件管理。
- 真机验证：PKB110 拉取 179MB Settings.apk 成功（34.7 MB/s）。

## AXML 解析边界（apk-manifest.ts）

- start 元素的 `attributeStart` 字段**相对 attrExt 结构（chunk+16）**，真实 aapt2 产物为 20（即属性区在 chunk+36）——自造 fixture 时曾因把 36 写进该字段掩盖过这个偏移 bug，已用两台真机厂商 APK 验证。
- 字符串池支持 UTF-16 与 UTF-8（flags 0x100）两种编码；package 属性优先取 `rawValue` 字符串索引，缺省时回落 `typedValue`（dataType=0x03）。
- 解析出的包名还要过 `PACKAGE_PATTERN` 才返回。

## 测试

`src/main/adb.test.ts`（install 参数/失败解析/启动与无线命令）、`src/main/apk-manifest.test.ts`（自造 zip+AXML fixture）、`src/renderer/ApkInstaller.test.tsx`。
