import {
  forwardRef,
  type CompositionEvent as ReactCompositionEvent,
  type FormEvent as ReactFormEvent,
  type KeyboardEvent as ReactKeyboardEvent
} from "react";
import type { MirrorControlInput } from "../shared/types";
import { resolveKeyInjection } from "./mirror-keyboard";

/**
 * 隐形输入框：承担投屏画面的键盘输入。
 *
 * 直接监听 div 的 keydown 拿不到 IME 组合的中文（输入法只对可编辑元素
 * 组合），所以放一个 1px 隐形 input 接焦点：
 * - 控制键（回车/退格/方向键等）在 keydown 拦截并注入 Android 键码
 * - 可打印字符经 input 事件统一发送（不拦截 keydown，避免双发）
 * - 中文等组合输入在 compositionend 一次性提交
 */
export const MirrorKeyboardInput = forwardRef<
  HTMLInputElement,
  { serial: string }
>(function MirrorKeyboardInput({ serial }, ref) {
  function send(input: MirrorControlInput): void {
    window.androidTool.sendMirrorControl(serial, input);
  }

  function handleKeyDown(
    event: ReactKeyboardEvent<HTMLInputElement>
  ): void {
    // IME 组合期间（Windows Chromium 的 key 为 "Process" 或 keyCode 229）
    // Enter 是确认候选词，不能注入给设备
    if (event.nativeEvent.isComposing || event.keyCode === 229) return;
    const injection = resolveKeyInjection(event.nativeEvent);
    if (!injection || injection.kind !== "key") return;
    event.preventDefault();
    send({ type: "key", keyCode: injection.keyCode ?? 0 });
  }

  function handleInput(event: ReactFormEvent<HTMLInputElement>): void {
    const native = event.nativeEvent as InputEvent;
    // 组合中的增量不发送，等 compositionend 提交全文
    if (native.isComposing) return;
    // 组合提交后 Chromium 会补一条 insertFromComposition，已由
    // compositionend 处理，这里只认直接键入
    if (native.inputType !== "insertText" || !native.data) return;
    send({ type: "text", text: native.data });
    event.currentTarget.value = "";
  }

  function handleCompositionEnd(
    event: ReactCompositionEvent<HTMLInputElement>
  ): void {
    const data = event.data;
    event.currentTarget.value = "";
    if (!data) return;
    send({ type: "text", text: data });
  }

  return (
    <input
      ref={ref}
      className="mirror-keyboard-input"
      autoCapitalize="off"
      autoCorrect="off"
      autoComplete="off"
      spellCheck={false}
      onKeyDown={handleKeyDown}
      onInput={handleInput}
      onCompositionEnd={handleCompositionEnd}
    />
  );
});
