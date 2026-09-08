import { describe, expect, it } from "vitest";
import type { LogcatEntry } from "../shared/types";
import {
  appendQueryToken,
  matchesEntry,
  parseLevelValue,
  parseQuery,
  queryHighlightTerms,
  tokenizeQuery
} from "./logcat-query";

function entry(overrides: Partial<LogcatEntry> = {}): LogcatEntry {
  return {
    raw:
      "07-29 15:20:10.123  1234  5678 I ActivityManager: Start proc",
    timestamp: "07-29 15:20:10.123",
    pid: 1234,
    tid: 5678,
    level: "I",
    tag: "ActivityManager",
    message: "Start proc",
    ...overrides
  };
}

describe("tokenizeQuery", () => {
  it("splits on whitespace but keeps double-quoted spans together", () => {
    expect(tokenizeQuery('tag:foo message:"two words"')).toEqual([
      "tag:foo",
      'message:"two words"'
    ]);
  });

  it("keeps negated regex tokens whole", () => {
    expect(tokenizeQuery('-tag~:"a b" pid:5')).toEqual([
      '-tag~:"a b"',
      "pid:5"
    ]);
  });

  it("keeps quoted bare terms as one token and drops empty segments", () => {
    expect(tokenizeQuery('  "fatal error"  ')).toEqual(['"fatal error"']);
  });
});

describe("parseLevelValue", () => {
  it("accepts letters and full names case-insensitively", () => {
    expect(parseLevelValue("e")).toBe("E");
    expect(parseLevelValue("ERROR")).toBe("E");
    expect(parseLevelValue("Warn")).toBe("W");
    expect(parseLevelValue("warning")).toBe("W");
    expect(parseLevelValue("fatal")).toBe("F");
    expect(parseLevelValue("verbose")).toBe("V");
  });

  it("rejects unknown level names", () => {
    expect(parseLevelValue("xyz")).toBeUndefined();
  });
});

describe("parseQuery", () => {
  it("treats unknown key:value tokens as bare terms", () => {
    const query = parseQuery("http://x");
    expect(query.terms).toEqual(["http://x"]);
    expect(query.filters).toHaveLength(0);
    expect(query.errors).toHaveLength(0);
  });

  it("reports an error for empty filter values", () => {
    const query = parseQuery("tag:");
    expect(query.errors).toEqual(["tag: 缺少值"]);
  });

  it("reports errors for non-integer pid/tid values", () => {
    expect(parseQuery("pid:abc").errors).toEqual(["pid 的值必须是整数"]);
    expect(parseQuery("-tid:1.5").errors).toEqual(["tid 的值必须是整数"]);
  });

  it("rejects ~ regex on keys that do not support it", () => {
    expect(parseQuery("pid~:5").errors).toEqual(["pid 不支持 ~ 正则匹配"]);
  });

  it("rejects invalid level names", () => {
    expect(parseQuery("level:loud").errors).toEqual(["日志级别无效: loud"]);
  });

  it("rejects invalid or over-long regex patterns", () => {
    const broken = parseQuery("tag~:(");
    expect(broken.errors[0]).toContain("正则表达式无效");
    expect(broken.filters).toHaveLength(0);

    const long = parseQuery(`tag~:${"a".repeat(201)}`);
    expect(long.errors[0]).toContain("200");
  });

  it("exposes the first positive level threshold for dropdown precedence", () => {
    const query = parseQuery("level:warn -level:D");
    expect(query.levelThreshold).toBe("W");
  });

  it("marks package filters as needing the process map", () => {
    expect(parseQuery("package:com.example.app").needsPackageMap).toBe(true);
    expect(parseQuery("-package:com.example.app").needsPackageMap).toBe(true);
    expect(parseQuery("tag:foo").needsPackageMap).toBe(false);
  });

  it("strips double quotes from values and bare terms", () => {
    const query = parseQuery('tag:"My Tag" "fatal error"');
    expect(query.filters[0].value).toBe("My Tag");
    expect(query.terms).toEqual(["fatal error"]);
  });
});

describe("matchesEntry", () => {
  it("matches everything for an empty query", () => {
    expect(matchesEntry(entry(), parseQuery(""))).toBe(true);
    expect(matchesEntry(entry(), parseQuery("   "))).toBe(true);
  });

  it("ANDs bare terms over the raw line case-insensitively", () => {
    const query = parseQuery("activitymanager start");
    expect(matchesEntry(entry(), query)).toBe(true);
    expect(matchesEntry(entry(), parseQuery("start activity"))).toBe(true);
    expect(matchesEntry(entry(), parseQuery("start zygote"))).toBe(false);
    expect(matchesEntry(entry(), parseQuery("5678"))).toBe(true);
  });

  it("matches tag and message by substring case-insensitively", () => {
    const query = parseQuery("tag:manager message:START");
    expect(matchesEntry(entry(), query)).toBe(true);
    expect(matchesEntry(entry(), parseQuery("tag:system_server"))).toBe(
      false
    );
  });

  it("matches pid and tid by integer equality", () => {
    expect(matchesEntry(entry(), parseQuery("pid:1234"))).toBe(true);
    expect(matchesEntry(entry(), parseQuery("pid:123"))).toBe(false);
    expect(matchesEntry(entry(), parseQuery("tid:5678"))).toBe(true);
  });

  it("treats entries without pid as non-matching for pid filters", () => {
    const noPid = entry({ pid: undefined, tid: undefined });
    expect(matchesEntry(noPid, parseQuery("pid:1234"))).toBe(false);
    expect(matchesEntry(noPid, parseQuery("-pid:1234"))).toBe(true);
  });

  it("applies level filters as a threshold", () => {
    const error = entry({ level: "E" });
    const fatal = entry({ level: "F" });
    const debug = entry({ level: "D" });

    expect(matchesEntry(error, parseQuery("level:E"))).toBe(true);
    expect(matchesEntry(fatal, parseQuery("level:e"))).toBe(true);
    expect(matchesEntry(debug, parseQuery("level:error"))).toBe(false);
    expect(matchesEntry(error, parseQuery("level:WARN"))).toBe(true);
  });

  it("negates level as strictly below", () => {
    const verbose = entry({ level: "V" });
    const debug = entry({ level: "D" });

    expect(matchesEntry(verbose, parseQuery("-level:D"))).toBe(true);
    expect(matchesEntry(debug, parseQuery("-level:D"))).toBe(false);
  });

  it("supports negated tag and message filters", () => {
    expect(matchesEntry(entry(), parseQuery("-tag:GMS"))).toBe(true);
    expect(matchesEntry(entry(), parseQuery("-tag:ActivityManager"))).toBe(
      false
    );
  });

  it("matches regex filters case-sensitively on tag and message", () => {
    const query = parseQuery("tag~:^Activity.*r$");
    expect(matchesEntry(entry(), query)).toBe(true);
    expect(matchesEntry(entry(), parseQuery("tag~:^activity"))).toBe(false);
    expect(
      matchesEntry(entry({ message: "Boot completed" }), parseQuery("message~:boot"))
    ).toBe(false);
    expect(matchesEntry(entry(), parseQuery("-tag~:^Activity"))).toBe(false);
  });

  it("returns false for every entry when the query has errors", () => {
    const query = parseQuery("level:loud tag:foo");
    expect(matchesEntry(entry(), query)).toBe(false);
    expect(matchesEntry(entry({ level: "E" }), query)).toBe(false);
  });

  it("resolves package filters through the pid map", () => {
    const map = new Map([[1234, "com.example.app"]]);
    const query = parseQuery("package:COM.example.APP");

    expect(matchesEntry(entry(), query, map)).toBe(true);
    expect(matchesEntry(entry(), query)).toBe(false);
    expect(
      matchesEntry(entry({ pid: 9999 }), query, map)
    ).toBe(false);
    expect(
      matchesEntry(entry({ pid: 9999 }), parseQuery("-package:com.example.app"), map)
    ).toBe(true);
    expect(
      matchesEntry(entry(), parseQuery("-package:com.other.app"), map)
    ).toBe(true);
  });
});

describe("queryHighlightTerms", () => {
  it("returns bare terms plus positive non-regex tag and message values", () => {
    const query = parseQuery("crash tag:manager message:\"app died\"");
    expect(queryHighlightTerms(query)).toEqual([
      "crash",
      "manager",
      "app died"
    ]);
  });

  it("excludes negated, regex, level, pid and package values", () => {
    const query = parseQuery(
      "-tag:noise tag~:pattern level:E pid:1 package:com.x ok"
    );
    expect(queryHighlightTerms(query)).toEqual(["ok"]);
  });
});

describe("appendQueryToken", () => {
  it("appends a simple token with a separator", () => {
    expect(appendQueryToken("", "tag:foo")).toBe("tag:foo");
    expect(appendQueryToken("level:E", "tag:foo")).toBe("level:E tag:foo");
  });

  it("quotes values containing whitespace", () => {
    expect(appendQueryToken("", "tag:My Tag")).toBe('tag:"My Tag"');
    expect(appendQueryToken("", "-tag:My Tag")).toBe('-tag:"My Tag"');
  });

  it("quotes bare tokens containing whitespace", () => {
    expect(appendQueryToken("tag:foo", "fatal error")).toBe(
      'tag:foo "fatal error"'
    );
  });

  it("preserves existing trailing whitespace without doubling", () => {
    expect(appendQueryToken("tag:foo ", "pid:5")).toBe("tag:foo pid:5");
  });
});
