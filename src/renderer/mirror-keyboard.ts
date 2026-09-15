/**
 * PC 键盘事件 -> Android 键码 / 文本注入的映射。
 *
 * 可打印字符走 text 注入（由主进程区分 ASCII injectText 与中文剪贴板
 * 粘贴）；控制键映射为 Android 键码 Down+Up；F1-F12、字母/数字直通
 * 模式等暂不覆盖——常用调试场景（回车确认、退格删除、方向键、Tab、
 * ESC 返回）已够用。
 */
export const ANDROID_KEY_CODES = {
  enter: 66,
  backspace: 67,
  tab: 61,
  escape: 111,
  delete: 112,
  home: 122,
  end: 123,
  pageUp: 92,
  pageDown: 93,
  dpadUp: 19,
  dpadDown: 20,
  dpadLeft: 21,
  dpadRight: 22,
  volumeUp: 24,
  volumeDown: 25
} as const;

/** 能注入的 Android 键码集合（白名单，防止未知键乱发）。 */
const INJECTABLE_KEY_CODES = new Set<number>(
  Object.values(ANDROID_KEY_CODES)
);

/** DOM KeyboardEvent.key -> Android 键码（仅单键映射，无修饰键组合）。 */
const KEY_TO_ANDROID: Record<string, number> = {
  Enter: ANDROID_KEY_CODES.enter,
  NumpadEnter: ANDROID_KEY_CODES.enter,
  Backspace: ANDROID_KEY_CODES.backspace,
  Tab: ANDROID_KEY_CODES.tab,
  Escape: ANDROID_KEY_CODES.escape,
  Delete: ANDROID_KEY_CODES.delete,
  Home: ANDROID_KEY_CODES.home,
  End: ANDROID_KEY_CODES.end,
  PageUp: ANDROID_KEY_CODES.pageUp,
  PageDown: ANDROID_KEY_CODES.pageDown,
  ArrowUp: ANDROID_KEY_CODES.dpadUp,
  ArrowDown: ANDROID_KEY_CODES.dpadDown,
  ArrowLeft: ANDROID_KEY_CODES.dpadLeft,
  ArrowRight: ANDROID_KEY_CODES.dpadRight
};

export interface KeyInjection {
  kind: "key" | "text";
  keyCode?: number;
  text?: string;
}

/**
 * 把一次按键解析为注入指令。
 * 返回 undefined 表示该键不需要注入（修饰键本身、快捷键组合、未知键）。
 */
export function resolveKeyInjection(event: {
  key: string;
  ctrlKey: boolean;
  altKey: boolean;
  metaKey: boolean;
}): KeyInjection | undefined {
  // 修饰键组合保留给宿主应用（Ctrl+C 复制等），不透传设备
  if (event.ctrlKey || event.altKey || event.metaKey) {
    return undefined;
  }
  const androidKey = KEY_TO_ANDROID[event.key];
  if (androidKey !== undefined && INJECTABLE_KEY_CODES.has(androidKey)) {
    return { kind: "key", keyCode: androidKey };
  }
  // 单个可打印字符（含中文输入法提交后的字符）走文本注入
  if (event.key.length === 1) {
    return { kind: "text", text: event.key };
  }
  return undefined;
}
