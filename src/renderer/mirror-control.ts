export interface NormalizedPoint {
  x: number;
  y: number;
}

export interface ElementRect {
  left: number;
  top: number;
  width: number;
  height: number;
}

/** 把指针位置归一化到 0..1（相对画布内容区），越界钳制。 */
export function normalizedPoint(
  rect: ElementRect,
  clientX: number,
  clientY: number
): NormalizedPoint {
  if (rect.width <= 0 || rect.height <= 0) {
    return { x: 0, y: 0 };
  }
  return {
    x: clamp01((clientX - rect.left) / rect.width),
    y: clamp01((clientY - rect.top) / rect.height)
  };
}

function clamp01(value: number): number {
  return Math.min(1, Math.max(0, value));
}

/**
 * DOM 滚轮增量 -> scrcpy scroll 值。
 * scrcpy 正值 = 向左/向上；DOM deltaY 正值 = 向下滚动，因此取反。
 */
export function wheelToScroll(deltaX: number, deltaY: number): {
  scrollX: number;
  scrollY: number;
} {
  const flip = (delta: number): number =>
    delta > 0 ? -1 : delta < 0 ? 1 : 0;
  return {
    scrollX: flip(deltaX),
    scrollY: flip(deltaY)
  };
}
