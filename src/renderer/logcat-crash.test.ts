import { describe, expect, it } from "vitest";
import type { LogcatEntry } from "../shared/types";
import { extractCrashStack, isCrashMarker } from "./logcat-crash";

function entry(
  partial: Partial<LogcatEntry> & { message: string }
): LogcatEntry {
  return {
    raw: `08-30 12:00:00.000 ${partial.pid ?? 123}/123 E ${partial.tag ?? "AndroidRuntime"}: ${partial.message}`,
    timestamp: "08-30 12:00:00.000",
    pid: partial.pid ?? 123,
    tid: 123,
    level: partial.level ?? "E",
    tag: partial.tag ?? "AndroidRuntime",
    message: partial.message
  };
}

describe("isCrashMarker", () => {
  it("recognises FATAL EXCEPTION start lines only", () => {
    expect(isCrashMarker("FATAL EXCEPTION: main")).toBe(true);
    expect(isCrashMarker("FATAL EXCEPTION: RenderThread")).toBe(true);
    expect(isCrashMarker("Process: com.example.app, PID: 123")).toBe(false);
    expect(isCrashMarker("app died")).toBe(false);
  });
});

describe("extractCrashStack", () => {
  const crashEntries: LogcatEntry[] = [
    entry({ message: "some earlier log line", tag: "SystemUI" }),
    entry({ message: "FATAL EXCEPTION: main" }),
    entry({ message: "Process: com.example.alpha, PID: 25643" }),
    entry({ message: "java.lang.IllegalStateException: viewport is not attached" }),
    entry({ message: "\tat com.example.alpha.Main.onCreate(Main.kt:31)" }),
    entry({ message: "\tat android.app.Activity.performCreate(Activity.java:9000)" }),
    entry({ message: "Caused by: java.lang.NullPointerException: ctx is null" }),
    entry({ message: "\t... 2 more" }),
    entry({ message: "background thread stopped", tag: "SystemUI" })
  ];

  it("collects the full stack and stops at unrelated lines", () => {
    const lines = extractCrashStack(crashEntries, 1);
    expect(lines).toHaveLength(7);
    expect(lines[0]).toContain("FATAL EXCEPTION: main");
    expect(lines.at(-1)).toContain("... 2 more");
    expect(lines.join("\n")).not.toContain("background thread stopped");
  });

  it("keeps the marker line even when no continuation follows", () => {
    expect(extractCrashStack([crashEntries[1]], 0)).toHaveLength(1);
  });

  it("rejects stacks that switched tag or level", () => {
    const mixed: LogcatEntry[] = [
      entry({ message: "FATAL EXCEPTION: main" }),
      entry({ message: "java.lang.Error: boom", tag: "System.err" }),
      entry({ message: "\tat com.example.alpha.Main.run(Main.kt:5)" })
    ];
    expect(extractCrashStack(mixed, 0)).toHaveLength(1);
  });

  it("returns nothing for out-of-range indices", () => {
    expect(extractCrashStack(crashEntries, -1)).toEqual([]);
    expect(extractCrashStack(crashEntries, 99)).toEqual([]);
  });
});
