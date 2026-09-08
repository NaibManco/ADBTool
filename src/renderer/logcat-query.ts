import type { LogcatEntry, LogcatLevel } from "../shared/types";

export type QueryFilterKey =
  | "tag"
  | "pid"
  | "tid"
  | "level"
  | "message"
  | "package";

export interface QueryFilter {
  key: QueryFilterKey;
  negated: boolean;
  regex: boolean;
  value: string;
  valueLower: string;
  levelValue?: LogcatLevel;
  numberValue?: number;
  pattern?: RegExp;
}

export interface ParsedQuery {
  terms: string[];
  filters: QueryFilter[];
  errors: string[];
  needsPackageMap: boolean;
  levelThreshold?: LogcatLevel;
}

export const LEVEL_ORDER: Record<LogcatLevel, number> = {
  V: 0,
  D: 1,
  I: 2,
  W: 3,
  E: 4,
  F: 5
};

const LEVEL_NAMES: Record<string, LogcatLevel> = {
  v: "V",
  verbose: "V",
  d: "D",
  debug: "D",
  i: "I",
  info: "I",
  w: "W",
  warn: "W",
  warning: "W",
  e: "E",
  error: "E",
  f: "F",
  fatal: "F"
};

const KNOWN_KEYS = new Set<string>([
  "tag",
  "pid",
  "tid",
  "level",
  "message",
  "package"
]);
const REGEX_KEYS = new Set<string>(["tag", "message"]);
const MAX_REGEX_LENGTH = 200;
const FILTER_TOKEN_PATTERN = /^(-?)([A-Za-z]+)(~)?:(.*)$/;

export function parseLevelValue(value: string): LogcatLevel | undefined {
  return LEVEL_NAMES[value.trim().toLowerCase()];
}

export function tokenizeQuery(input: string): string[] {
  const tokens: string[] = [];
  let current = "";
  let inQuotes = false;

  for (const char of input) {
    if (char === '"') {
      inQuotes = !inQuotes;
      current += char;
    } else if (!inQuotes && /\s/.test(char)) {
      if (current) {
        tokens.push(current);
        current = "";
      }
    } else {
      current += char;
    }
  }

  if (current) {
    tokens.push(current);
  }
  return tokens;
}

function unquote(value: string): string {
  if (value.length >= 2 && value.startsWith('"') && value.endsWith('"')) {
    return value.slice(1, -1);
  }
  return value;
}

function buildRegex(
  key: QueryFilterKey,
  value: string,
  errors: string[]
): RegExp | undefined {
  if (value.length > MAX_REGEX_LENGTH) {
    errors.push(`正则表达式无效: 长度不能超过 ${MAX_REGEX_LENGTH} 字符`);
    return undefined;
  }
  try {
    return new RegExp(value);
  } catch (error) {
    errors.push(
      `正则表达式无效: ${error instanceof Error ? error.message : String(error)}`
    );
    return undefined;
  }
}

export function parseQuery(input: string): ParsedQuery {
  const terms: string[] = [];
  const filters: QueryFilter[] = [];
  const errors: string[] = [];
  let needsPackageMap = false;
  let levelThreshold: LogcatLevel | undefined;

  for (const token of tokenizeQuery(input)) {
    const match = FILTER_TOKEN_PATTERN.exec(token);
    if (!match || !KNOWN_KEYS.has(match[2].toLowerCase())) {
      terms.push(unquote(token).toLowerCase());
      continue;
    }

    const negated = match[1] === "-";
    const key = match[2].toLowerCase() as QueryFilterKey;
    const isRegex = match[3] === "~";
    const value = unquote(match[4]);

    if (!value) {
      errors.push(`${key}: 缺少值`);
      continue;
    }

    if (isRegex && !REGEX_KEYS.has(key)) {
      errors.push(`${key} 不支持 ~ 正则匹配`);
      continue;
    }

    const filter: QueryFilter = {
      key,
      negated,
      regex: isRegex,
      value,
      valueLower: value.toLowerCase()
    };

    if (isRegex) {
      const pattern = buildRegex(key, value, errors);
      if (!pattern) {
        continue;
      }
      filter.pattern = pattern;
      filters.push(filter);
      continue;
    }

    if (key === "pid" || key === "tid") {
      if (!/^\d+$/.test(value)) {
        errors.push(`${key} 的值必须是整数`);
        continue;
      }
      filter.numberValue = Number(value);
      filters.push(filter);
      continue;
    }

    if (key === "level") {
      const level = parseLevelValue(value);
      if (!level) {
        errors.push(`日志级别无效: ${value}`);
        continue;
      }
      filter.levelValue = level;
      filters.push(filter);
      if (!negated && levelThreshold === undefined) {
        levelThreshold = level;
      }
      continue;
    }

    if (key === "package") {
      needsPackageMap = true;
    }

    filters.push(filter);
  }

  return { terms, filters, errors, needsPackageMap, levelThreshold };
}

function matchesFilter(
  entry: LogcatEntry,
  filter: QueryFilter,
  packageByPid?: ReadonlyMap<number, string>
): boolean {
  let matched: boolean;

  switch (filter.key) {
    case "tag":
      matched = filter.regex
        ? (filter.pattern?.test(entry.tag) ?? false)
        : entry.tag.toLowerCase().includes(filter.valueLower);
      break;
    case "message":
      matched = filter.regex
        ? (filter.pattern?.test(entry.message) ?? false)
        : entry.message.toLowerCase().includes(filter.valueLower);
      break;
    case "pid":
      matched =
        entry.pid !== undefined && entry.pid === filter.numberValue;
      break;
    case "tid":
      matched =
        entry.tid !== undefined && entry.tid === filter.numberValue;
      break;
    case "level":
      matched =
        LEVEL_ORDER[entry.level] >= LEVEL_ORDER[filter.levelValue ?? "V"];
      break;
    case "package": {
      const packageName =
        entry.pid !== undefined
          ? packageByPid?.get(entry.pid)
          : undefined;
      matched =
        packageName !== undefined &&
        packageName.toLowerCase() === filter.valueLower;
      break;
    }
  }

  return filter.negated ? !matched : matched;
}

export function matchesEntry(
  entry: LogcatEntry,
  query: ParsedQuery,
  packageByPid?: ReadonlyMap<number, string>
): boolean {
  if (query.errors.length > 0) {
    return false;
  }

  const rawLower = entry.raw.toLowerCase();
  for (const term of query.terms) {
    if (!rawLower.includes(term)) {
      return false;
    }
  }

  for (const filter of query.filters) {
    if (!matchesFilter(entry, filter, packageByPid)) {
      return false;
    }
  }

  return true;
}

export function queryHighlightTerms(query: ParsedQuery): string[] {
  const terms = [...query.terms];
  for (const filter of query.filters) {
    if (
      !filter.negated &&
      !filter.regex &&
      (filter.key === "tag" || filter.key === "message")
    ) {
      terms.push(filter.value);
    }
  }
  return terms;
}

export function appendQueryToken(current: string, token: string): string {
  const separator = current.trim() ? " " : "";
  const colon = token.indexOf(":");
  let quoted = token;
  if (colon > 0) {
    const key = token.slice(0, colon);
    const value = token.slice(colon + 1);
    if (/\s/.test(value)) {
      quoted = `${key}:"${value}"`;
    }
  } else if (/\s/.test(token)) {
    quoted = `"${token}"`;
  }
  return `${current.trimEnd()}${separator}${quoted}`;
}
