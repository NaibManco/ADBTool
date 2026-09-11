# Android Dev Tool

仅在本机运行的 Windows Android 调试工具（Electron + React + TypeScript + ADB + scrcpy），把常用设备调试能力集中到一个桌面工作台，支持多设备同时操作。

## 功能一览

- **多设备发现**与状态展示（USB/无线，序列号隔离）
- **无线调试**：USB 一键转无线（`tcpip 5555` + 自动取 Wi-Fi IP），或 Android 11+ 配对码配对/连接，失败中文归因
- **投屏**：内嵌到主工作区的视频流投屏（WebCodecs 硬解，画布触摸/滚轮/右键=返回），或弹出独立 scrcpy 窗口
- **Logcat**：Android Studio 风格查询语法（`tag:`/`message:`/`pid:`/`level:`/`package:`、`~` 正则、`-` 取反、引号短语）、缓冲区切换（main/system/crash/radio/events）、导出/复制、跟随滚动、查询历史、`FATAL EXCEPTION` 崩溃角标与一键复制堆栈
- **终端**：每设备交互式 adb shell（持久会话、输入历史、Ctrl+C）
- **截图/录屏**：自动复制剪贴板、预览浮层、另存为
- **APK 安装**：文件选择/拖入/路径三种入口，失败中文归因，降级安装二次确认，可选安装后自动启动（离线解析包名）
- **APK 反编译**：内置 jadx，拖入 APK 即看 Java 源码与解码资源
- **管理窗口**：应用管理（含一键启动）、文件管理、设备信息
- **Bugreport** 导出、Dark/Light 主题

## 环境要求

- Windows x64
- Node.js 22+
- **APK 反编译**需要本机 Java 运行时（JAVA_HOME 或 Android Studio JBR）
- 真机需开启 USB 调试并授权；USB 驱动由设备厂商提供

## 准备 vendor 二进制（首次运行前）

`vendor/` 不入库（第三方二进制），需自行放置：

```
vendor\scrcpy\   ← adb.exe、scrcpy.exe、scrcpy-server、AdbWinApi.dll、AdbWinUsbApi.dll（scrcpy 4.0 发行包）
vendor\jadx\     ← jadx 1.5.6 发行包（bin\ + lib\jadx-1.5.6-all.jar）
```

也可不放置：应用会按 `ADB_PATH`/`SCRCPY_PATH`/`JADX_PATH`/`JAVA_HOME` 环境变量与本机常见安装路径解析（见 `src/main/paths.ts`）。

## 开发

```powershell
npm install
npm run dev        # 开发运行（Vite + tsc watch + Electron）
npm test           # Vitest 全量测试
npm run build      # 生产构建
npm run package    # 打包 Windows x64 portable EXE 到 release\
```

## 工程文档

- [AGENTS.md](AGENTS.md)——项目概况、全局约定、模块索引
- [docs/modules/](docs/modules/)——按功能模块拆分的架构文档（投屏/Logcat/终端/反编译等），维护规约见 [docs/modules/MAINTENANCE.md](docs/modules/MAINTENANCE.md)
