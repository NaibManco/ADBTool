import type { LogcatEntry } from "../shared/types";

/** Java 崩溃标记：AndroidRuntime 输出的 "FATAL EXCEPTION: <thread>" 首行。 */
export function isCrashMarker(message: string): boolean {
  return /^FATAL EXCEPTION\b/.test(message);
}

// 崩溃堆栈行形态：Process 行、异常类行（必含点号）、at 行、Caused by、... N more、Suppressed。
// 普通英文句子（含空格）不会命中，避免把无关错误日志吸进堆栈。
const STACK_LINE_PATTERN =
  /^(?:Process:[\s\S]*PID:\s*\d+|Caused by:|Suppressed:|\s*at\s|\s*\.\.\.|[\w$.]*\.[\w$.]+(?::|$))/;

/**
 * 从 crashStartIndex（FATAL EXCEPTION 行）起收集完整堆栈的 raw 行，
 * 直到出现不属于该堆栈的日志行为止。
 * 堆栈行全部来自同一 tag（AndroidRuntime）且等级为 E/F。
 */
export function extractCrashStack(
  entries: readonly LogcatEntry[],
  crashStartIndex: number
): string[] {
  if (crashStartIndex < 0 || crashStartIndex >= entries.length) return [];
  const lines: string[] = [];
  const startTag = entries[crashStartIndex].tag;
  for (let index = crashStartIndex; index < entries.length; index++) {
    const entry = entries[index];
    if (index > crashStartIndex) {
      const isContinuation =
        entry.tag === startTag &&
        (entry.level === "E" || entry.level === "F") &&
        STACK_LINE_PATTERN.test(entry.message);
      if (!isContinuation) break;
    }
    lines.push(entry.raw);
  }
  return lines;
}
