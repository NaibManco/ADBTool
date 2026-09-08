import fs from "node:fs";
import path from "node:path";

function firstExisting(paths: Array<string | undefined>): string | undefined {
  return paths.find((candidate) => candidate && fs.existsSync(candidate));
}

export function buildAdbCandidates(
  resourcesPath: string | undefined,
  environment: NodeJS.ProcessEnv
): string[] {
  return [
    environment.ADB_PATH,
    resourcesPath
      ? path.join(resourcesPath, "scrcpy", "adb.exe")
      : undefined,
    environment.ANDROID_HOME
      ? path.join(environment.ANDROID_HOME, "platform-tools", "adb.exe")
      : undefined,
    environment.ANDROID_SDK_ROOT
      ? path.join(environment.ANDROID_SDK_ROOT, "platform-tools", "adb.exe")
      : undefined,
    "D:\\Android\\SDK\\platform-tools\\adb.exe"
  ].filter((candidate): candidate is string => Boolean(candidate));
}

export function buildScrcpyCandidates(
  resourcesPath: string | undefined,
  environment: NodeJS.ProcessEnv
): string[] {
  return [
    environment.SCRCPY_PATH,
    resourcesPath
      ? path.join(resourcesPath, "scrcpy", "scrcpy.exe")
      : undefined,
    "D:\\scrcpy-win64-v4.0\\scrcpy.exe",
    "C:\\Program Files\\scrcpy\\scrcpy.exe"
  ].filter((candidate): candidate is string => Boolean(candidate));
}

export function buildScrcpyServerCandidates(
  resourcesPath: string | undefined,
  environment: NodeJS.ProcessEnv
): string[] {
  return [
    environment.SCRCPY_SERVER_PATH,
    resourcesPath
      ? path.join(resourcesPath, "scrcpy", "scrcpy-server")
      : undefined,
    "D:\\scrcpy-win64-v4.0\\scrcpy-server",
    "C:\\Program Files\\scrcpy\\scrcpy-server",
    path.join(process.cwd(), "vendor", "scrcpy", "scrcpy-server")
  ].filter((candidate): candidate is string => Boolean(candidate));
}

export function buildJadxCandidates(
  resourcesPath: string | undefined,
  environment: NodeJS.ProcessEnv
): string[] {
  return [
    environment.JADX_PATH,
    resourcesPath ? path.join(resourcesPath, "jadx") : undefined,
    "D:\\jadx",
    "C:\\Program Files\\jadx",
    path.join(process.cwd(), "vendor", "jadx")
  ].filter((candidate): candidate is string => Boolean(candidate));
}

export function buildJavaCandidates(
  environment: NodeJS.ProcessEnv
): string[] {
  return [
    environment.JAVA_HOME
      ? path.join(environment.JAVA_HOME, "bin", "java.exe")
      : undefined,
    "D:\\Android\\Android Studio\\jbr\\bin\\java.exe",
    "C:\\Program Files\\Android\\Android Studio\\jbr\\bin\\java.exe",
    "C:\\Program Files\\Java\\jre\\bin\\java.exe",
    "java"
  ].filter((candidate): candidate is string => Boolean(candidate));
}

function electronResourcesPath(): string | undefined {
  return (process as NodeJS.Process & { resourcesPath?: string }).resourcesPath;
}

export function resolveAdbPath(): string {
  return (
    firstExisting(buildAdbCandidates(electronResourcesPath(), process.env)) ?? "adb"
  );
}

export function resolveScrcpyPath(): string {
  return (
    firstExisting(buildScrcpyCandidates(electronResourcesPath(), process.env)) ??
    "scrcpy"
  );
}

export function resolveScrcpyServerPath(): string {
  const found = firstExisting(
    buildScrcpyServerCandidates(electronResourcesPath(), process.env)
  );
  if (!found) {
    throw new Error("找不到 scrcpy-server，无法使用内嵌投屏");
  }
  return found;
}

function firstJavaExecutable(paths: string[]): string {
  return paths.find((candidate) => candidate !== "java") ?? "java";
}

export function resolveJavaExecutable(): string {
  return firstJavaExecutable(
    buildJavaCandidates(process.env).filter(
      (candidate) => candidate === "java" || fs.existsSync(candidate)
    )
  );
}

export function resolveJadxJarPath(): string {
  const root =
    firstExisting(buildJadxCandidates(electronResourcesPath(), process.env)) ??
    "jadx";
  if (root === "jadx") {
    throw new Error(
      "找不到 jadx（反编译工具）。请设置 JADX_PATH 或安装 jadx 到默认路径"
    );
  }
  const libDir = path.join(root, "lib");
  if (!fs.existsSync(libDir)) {
    throw new Error(`jadx 目录无效（缺少 lib）: ${root}`);
  }
  const jar = fs
    .readdirSync(libDir)
    .find((name) => /^jadx-.*-all\.jar$/.test(name));
  if (!jar) {
    throw new Error(`jadx 目录无效（缺少 jadx-*-all.jar）: ${root}`);
  }
  return path.join(libDir, jar);
}

export function hasJavaRuntime(): boolean {
  const candidates = buildJavaCandidates(process.env).filter(
    (candidate) => candidate === "java" || fs.existsSync(candidate)
  );
  return candidates.length > 0;
}
