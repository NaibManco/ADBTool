import { describe, expect, it } from "vitest";
import { resolveKeyInjection } from "./mirror-keyboard";

function key(
  keyValue: string,
  modifiers: Partial<
    Pick<KeyboardEvent, "ctrlKey" | "altKey" | "metaKey">
  > = {}
) {
  return { key: keyValue, ctrlKey: false, altKey: false, metaKey: false, ...modifiers };
}

describe("resolveKeyInjection", () => {
  it("maps control keys to Android key codes", () => {
    expect(resolveKeyInjection(key("Enter"))).toEqual({
      kind: "key",
      keyCode: 66
    });
    expect(resolveKeyInjection(key("Backspace"))).toEqual({
      kind: "key",
      keyCode: 67
    });
    expect(resolveKeyInjection(key("ArrowLeft"))).toEqual({
      kind: "key",
      keyCode: 21
    });
    expect(resolveKeyInjection(key("NumpadEnter"))).toEqual({
      kind: "key",
      keyCode: 66
    });
  });

  it("routes printable characters to text injection", () => {
    expect(resolveKeyInjection(key("a"))).toEqual({ kind: "text", text: "a" });
    expect(resolveKeyInjection(key("5"))).toEqual({ kind: "text", text: "5" });
    expect(resolveKeyInjection(key(" "))).toEqual({ kind: "text", text: " " });
    // 中文输入法提交后的字符同样走文本（主进程走剪贴板粘贴链路）
    expect(resolveKeyInjection(key("你"))).toEqual({
      kind: "text",
      text: "你"
    });
  });

  it("keeps modifier combos and unknown keys for the host app", () => {
    expect(resolveKeyInjection(key("c", { ctrlKey: true }))).toBeUndefined();
    expect(resolveKeyInjection(key("Enter", { altKey: true }))).toBeUndefined();
    expect(resolveKeyInjection(key("c", { metaKey: true }))).toBeUndefined();
    expect(resolveKeyInjection(key("F5"))).toBeUndefined();
    expect(resolveKeyInjection(key("Shift"))).toBeUndefined();
  });
});
