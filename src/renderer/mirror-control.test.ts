import { describe, expect, it } from "vitest";
import { normalizedPoint, wheelToScroll } from "./mirror-control";

describe("normalizedPoint", () => {
  const rect = { left: 100, top: 50, width: 400, height: 200 };

  it("maps client coordinates into 0..1 over the canvas rect", () => {
    expect(normalizedPoint(rect, 100, 50)).toEqual({ x: 0, y: 0 });
    expect(normalizedPoint(rect, 500, 250)).toEqual({ x: 1, y: 1 });
    expect(normalizedPoint(rect, 300, 150)).toEqual({ x: 0.5, y: 0.5 });
  });

  it("clamps out-of-rect coordinates", () => {
    expect(normalizedPoint(rect, 0, 0)).toEqual({ x: 0, y: 0 });
    expect(normalizedPoint(rect, 9999, 9999)).toEqual({ x: 1, y: 1 });
  });

  it("returns origin for an empty rect", () => {
    expect(
      normalizedPoint({ left: 0, top: 0, width: 0, height: 0 }, 10, 10)
    ).toEqual({ x: 0, y: 0 });
  });
});

describe("wheelToScroll", () => {
  it("negates wheel direction into scrcpy scroll units", () => {
    expect(wheelToScroll(0, 100)).toEqual({ scrollX: 0, scrollY: -1 });
    expect(wheelToScroll(0, -100)).toEqual({ scrollX: 0, scrollY: 1 });
    expect(wheelToScroll(120, 0)).toEqual({ scrollX: -1, scrollY: 0 });
  });
});
