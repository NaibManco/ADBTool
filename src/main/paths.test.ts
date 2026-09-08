import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  buildAdbCandidates,
  buildJadxCandidates,
  buildJavaCandidates,
  buildScrcpyCandidates
} from "./paths";

describe("packaged executable paths", () => {
  it("prefers ADB and scrcpy bundled under Electron resources", () => {
    const resourcesPath = "C:\\Temp\\Android Dev Tool\\resources";

    expect(buildAdbCandidates(resourcesPath, {} as NodeJS.ProcessEnv)[0]).toBe(
      path.join(resourcesPath, "scrcpy", "adb.exe")
    );
    expect(buildScrcpyCandidates(resourcesPath, {} as NodeJS.ProcessEnv)[0]).toBe(
      path.join(resourcesPath, "scrcpy", "scrcpy.exe")
    );
  });

  it("keeps explicit environment overrides ahead of development fallbacks", () => {
    const environment = {
      ADB_PATH: "C:\\custom\\adb.exe",
      SCRCPY_PATH: "C:\\custom\\scrcpy.exe"
    } as NodeJS.ProcessEnv;

    expect(buildAdbCandidates(undefined, environment)[0]).toBe(environment.ADB_PATH);
    expect(buildScrcpyCandidates(undefined, environment)[0]).toBe(
      environment.SCRCPY_PATH
    );
  });

  it("resolves jadx from bundled resources first and honors JADX_PATH", () => {
    const resourcesPath = "C:\\Temp\\Android Dev Tool\\resources";
    expect(buildJadxCandidates(resourcesPath, {} as NodeJS.ProcessEnv)[0]).toBe(
      path.join(resourcesPath, "jadx")
    );
    const environment = { JADX_PATH: "D:\\tools\\jadx" } as NodeJS.ProcessEnv;
    expect(buildJadxCandidates(undefined, environment)[0]).toBe(
      environment.JADX_PATH
    );
  });

  it("resolves java from JAVA_HOME first, then Android Studio JBR", () => {
    const withHome = {
      JAVA_HOME: "D:\\jdk-21"
    } as NodeJS.ProcessEnv;
    expect(buildJavaCandidates(withHome)[0]).toBe(
      path.join("D:\\jdk-21", "bin", "java.exe")
    );

    const noHome = {} as NodeJS.ProcessEnv;
    expect(buildJavaCandidates(noHome)[0]).toBe(
      "D:\\Android\\Android Studio\\jbr\\bin\\java.exe"
    );
    expect(buildJavaCandidates(noHome).at(-1)).toBe("java");
  });
});
