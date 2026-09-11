# Android Dev Tool 工程说明

## 项目概况

这是一个仅在本机运行的 Windows Android 调试工具，基于 Electron、React、TypeScript、ADB 和 scrcpy。目标是把常用的设备调试能力集中到一个桌面工作台中，并支持同时连接和操作多台 Android 设备。

- 应用名称：Android Dev Tool
- npm 包名：`android-dev-tool`
- 当前版本：`0.3.5`
- 目标平台：Windows x64
- 产物形式：单文件 portable EXE
- 应用 ID：`com.local.androiddevtool`
- 不依赖云服务，不上传设备数据

## 技术栈与进程边界

- Electron 主进程：执行 ADB/scrcpy、管理原生窗口、文件对话框、剪贴板和本地临时文件。
- React Renderer：实现主工作台、Logcat、安装器、管理页面和预览界面。
- Preload：通过 `contextBridge` 暴露最小化的 `window.androidTool` API；Renderer 不直接使用 Node.js API。
- Shared：维护主进程、Preload 和 Renderer 共用的 TypeScript 类型。
- Vite：构建 Renderer。
- TypeScript：构建 Electron 主进程、Preload 和共享代码。
- Vitest：覆盖确定性的解析、命令构造、状态和组件渲染逻辑。
- electron-builder：生成 Windows portable EXE。

保持 Electron 安全边界：新增系统能力时，应在主进程实现，通过 Preload 暴露明确的窄接口，并在 `src/shared/types.ts` 同步类型；不要在 Renderer 中开放通用 shell、文件系统或任意 IPC 能力。

## 目录职责

```text
D:\MyTool
├─ src\main\                 Electron 主进程与本机能力
│  ├─ main.ts                窗口、IPC、对话框和应用生命周期入口
│  ├─ adb.ts                 ADB 命令构造与设备操作（含无线 pair/connect/tcpip）
│  ├─ apk-manifest.ts        APK 包名离线识别（zip + 二进制 AXML 解析）
│  ├─ scrcpy-manager.ts      多设备外部 scrcpy 窗口进程管理
│  ├─ embedded-mirror-manager.ts  内嵌投屏：@yume-chan(scrcpy 4.0) 视频流会话与控制注入
│  ├─ terminal-manager.ts    多设备交互式 adb shell 会话
│  ├─ decompile-manager.ts   APK 反编译（jadx）会话、文件树与安全读取
│  ├─ logcat-manager.ts      多设备 Logcat 会话与解析
│  ├─ capture-manager.ts     截图和录屏
│  ├─ capture-media-store.ts 预览媒体临时文件与安全协议
│  ├─ device-files.ts        设备文件管理
│  ├─ device-info.ts         系统及硬件信息采集
│  ├─ paths.ts               ADB/scrcpy 可执行文件解析
│  └─ settings.ts            本地设置
├─ src\preload\index.ts      Renderer 可用 API 的唯一桥接入口
├─ src\renderer\             React 页面、组件和全局样式
├─ src\shared\types.ts       跨进程公共类型与 API 契约
├─ vendor\scrcpy\            打包进 EXE 的 ADB/scrcpy 运行资源
├─ vendor\jadx\              打包进 EXE 的 jadx 反编译工具（bin/lib）
├─ dist\                     构建输出，不手工修改
└─ release\                  Windows 打包输出，不手工修改
```

`.agent/` 下的内容属于原型或代理过程产物，不是正式运行路径。除非任务明确要求，不要把其中的实现复制回正式代码，也不要把它当作当前产品行为的依据。

## 模块文档（改哪个模块先读哪份）

```text
docs\modules\
├─ MAINTENANCE.md         模块文档维护规约：何时改、怎么改、怎么防过期（先读这份）
├─ app-shell.md        应用外壳与工作区：窗口/路由/布局/主题/设置
├─ adb-device.md       ADB 与设备控制：命令构造、设备发现、按键/重启
├─ mirror.md           投屏：内嵌视频流（@yume-chan）+ 外部 scrcpy 窗口
├─ clipboard-sync.md   剪贴板双向同步（PC ↔ 设备，隐藏 scrcpy 会话）
├─ logcat.md           Logcat：查询语法、缓冲区、导出、跟随滚动
├─ terminal.md         终端：每设备交互式 adb shell
├─ capture.md          截图与录屏：预览浮层与媒体协议
├─ apk-install.md      APK 安装：三入口/降级确认/失败归因
├─ manager-windows.md  管理窗口：应用/文件/设备信息
├─ decompile.md        APK 反编译（jadx）：会话/文件树/安全读取
└─ shared-types.md     共享类型与 IPC 契约（改类型必读）
```

各模块文档包含：职责、文件清单、数据流/关键链路、模块级约定、已知边界与测试。本文件只保留全局约定；模块细节以模块文档为准，两者冲突时以模块文档为准（并回改这里）。

**何时修改这些文档**：文档与代码同次变更完成，不留欠账——具体触发点、写作规则与防过期方式见 [docs/modules/MAINTENANCE.md](docs/modules/MAINTENANCE.md)。

## 当前主要功能

- 多设备发现、刷新和在线状态展示。
- 无线调试连接：设备栏「无线」入口（空设备状态也可直达）。USB 一键转无线（读设备 Wi-Fi IP → `adb tcpip 5555` → `connect`，wlan 接口优先）；Android 11+ 无线调试配对码流程（`adb pair` 一次 + `adb connect`）。失败中文归因（端口未开放/配对码过期/网络不通等）。
- 两种投屏形态：「启动投屏」内嵌到主窗口右侧工作区（@yume-chan 3.0.0-beta.2 + 内置 scrcpy-server 4.0，WebCodecs 硬解，画布支持点击/拖动/滚轮、右键=返回）；投屏面板头部的「弹出」切换到外部 scrcpy 独立窗口，弹出时自动关闭内嵌投屏。
- 右侧工作区在「投屏」「日志」「终端」整页视图间切换，切换钮仅在有多个内容时显示（切走的会话保活），偏好持久化在 localStorage；截图/录屏预览以浮层覆盖，不中断底层会话。
- Logcat 查询语法过滤（tag:/message:/pid:/tid:/level:/package:、~ 正则、- 取反、引号短语，对齐 Android Studio）、缓冲区切换（main/system/crash/radio/events）、导出/复制、渲染窗口与跟随滚动、查询历史。
- Logcat 崩溃自动提示：流中出现 `FATAL EXCEPTION` 时工具栏红色角标计数，一键复制最近一次崩溃的完整堆栈；清空显示时提醒同步消失。
- 每设备交互式 Shell 终端（`adb -s <serial> shell` 持久会话）：从设备卡打开即针对该设备，输出实时流（ANSI 清理），输入行带本地历史（↑↓）与 Ctrl+C 发送；vi/top 等全屏交互程序不支持。
- 剪贴板双向同步（按设备开关，设备卡头部图标）：设备复制自动到电脑、电脑复制自动到设备，防回环；基于隐藏 scrcpy 会话，不依赖投屏。
- Back、Home、最近任务、电源和重启等设备操作。
- scrcpy 启动参数必须保留 `--no-audio`，避免电脑接管设备音频输出。
- 应用进程过滤会展示包名/进程列表，由用户选择，不要擅自只取第一个前台进程。
- APK 安装支持文件选择、拖入文件和输入本机 APK 绝对路径，三种入口共用主进程文件校验及同一安装链路。安装失败时解析 adb 输出并展示中文原因（保留原始错误）；检测到降级安装（`INSTALL_FAILED_VERSION_DOWNGRADE`）时提供"强制降级安装"选择，确认后带 `-d` 重试。可选「安装成功后启动应用」：离线解析 APK 包名（`apk-manifest.ts`，识别失败不自动启动并提示）。
- 应用管理独立窗口：应用信息、启动应用（monkey 拉起入口 Activity，无需 Activity 名）、停止运行、清除数据和卸载。
- 文件管理独立窗口：目录浏览、缓存、上传、下载、新建目录、重命名、删除和图片预览。
- 设备信息独立窗口：Android/SDK/安全补丁/构建版本、CPU、内存、存储、显示、电池和网络信息。
- 截图后自动复制到剪贴板，并在主工作台右侧预览；支持另存为、再次复制、缩放和图片信息。
- 录屏显示计时，结束后直接在右侧播放器打开；播放器使用视频原始尺寸并支持另存为。
- 通过 `adb bugreport` 导出真实、非空的 ZIP 文件。
- APK 反编译独立窗口：拖入或选择 APK 后用内置 jadx 反编译为 Java 源码与解码资源，文件树浏览、文本预览与复制；输出在临时目录，窗口关闭或取消即清理。依赖本机 Java 运行时（JAVA_HOME 或 Android Studio JBR），缺失时仅该功能不可用。
- Dark/Light 主题设置，并同步到所有应用窗口。

主窗口、应用管理、文件管理和设备信息窗口需要能够同时使用。不要给独立管理窗口再套一层主工作台背景。主工作台右侧区域在媒体预览和 Logcat 之间切换；不要恢复强制拆分多个 Logcat 面板的布局。

## ADB 与 scrcpy 解析

打包版本优先使用 `resources\scrcpy` 中内置的工具。开发环境还支持：

- `ADB_PATH`
- `SCRCPY_PATH`
- `ANDROID_HOME\platform-tools\adb.exe`
- `ANDROID_SDK_ROOT\platform-tools\adb.exe`
- 工程中 `src/main/paths.ts` 列出的本机候选路径
- 最后回退到 `PATH` 中的 `adb` 或 `scrcpy`

所有针对设备的 ADB 命令必须显式带设备序列号（`adb -s <serial>`）。继续使用 `execFile`/参数数组或现有命令构造函数，不要拼接未经校验的 shell 字符串。设备序列号、包名、本地绝对路径和远端文件路径应通过现有边界校验。

## 开发命令

在工程根目录使用 PowerShell：

```powershell
npm install
npm run dev
```

常用命令：

```powershell
npm run build           # 主进程 + Renderer 生产构建
npm run build:main      # TypeScript 主进程/Preload 构建
npm run build:renderer  # Vite Renderer 构建
npm test                # 运行 src 下全部 Vitest 测试
npm run test:watch      # 测试监听模式
npm start               # 运行已经构建的 Electron 应用
npm run package         # 构建 Windows x64 portable EXE
```

打包产物位于：

```text
release\Android-Dev-Tool-0.3.5-portable.exe
```

版本号变化时，产物文件名跟随 `package.json` 中的 `version`。

## 修改约定

1. 修改前先检查现有组件、IPC 和主进程服务，优先扩展现有完整链路，避免重复实现。
2. 修改前先读目标模块的 `docs/modules/<module>.md`；改动完成后、宣告完成之前，按 [docs/modules/MAINTENANCE.md](docs/modules/MAINTENANCE.md) 的触发点表同步对应文档。
3. UI 文案以中文为主；按钮高度、文字居中、字号和 Dark/Light 对比度应与现有组件一致。
4. 新增 UI 必须能随窗口尺寸合理伸缩；列表、日志、原始尺寸媒体等内容应在自己的区域滚动，不能撑破整个窗口。
5. 多设备状态以序列号为键隔离。不要使用单个全局布尔值代表所有设备的投屏、Logcat、录屏或忙碌状态。
6. 长时间 ADB 操作需要返回清晰状态，并在失败时保留真实错误；不要用假进度或成功提示掩盖缺失的输出文件。
7. 文件选择取消属于正常结果，不应显示为错误。
8. 不手工编辑 `dist/`、`release/`、`node_modules/` 或 `vendor/` 中的第三方文件。
9. 未经明确要求，不自动启动设备操作、不安装 APK、不清除数据、不卸载应用，也不重新打包 EXE。

## 验证原则

- 纯解析、参数构造、路径校验和稳定状态逻辑使用聚焦的 Vitest 测试。
- React 布局和交互至少运行相关组件测试与生产构建；明显的响应式或视觉改动还应实际打开窗口检查 Dark/Light 和常见窗口尺寸。
- ADB、scrcpy、Logcat、截图、录屏、文件传输、APK 安装和 Bugreport 属于系统/设备集成能力。单元测试或构建通过不能证明真实设备行为；相关修改应尽可能在已连接设备上验证，并明确记录未验证的边界。
- 打包后确认 EXE 存在且非空，并检查 SHA-256、签名状态以及以下内置资源：`adb.exe`、`scrcpy.exe`、`scrcpy-server`、`AdbWinApi.dll`、`AdbWinUsbApi.dll`。
- portable EXE 正在运行时会锁住同名输出文件。重新打包前只定位并关闭 `ExecutablePath` 精确等于目标 EXE 的旧启动进程，不要按模糊进程名批量结束其他 Electron 或终端进程。

## 已知发布状态

- 当前输出是未签名的 Windows portable EXE，Windows 可能显示安全提醒。
- `vendor\scrcpy` 通过 electron-builder 的 `extraResources` 打包，因此正常分享单个 portable EXE 时不要求接收方另装 ADB 或 scrcpy。
- 真实 Android 设备仍需启用 USB 调试并完成电脑授权；USB 驱动属于目标电脑和设备厂商环境，不由本工具内置。
