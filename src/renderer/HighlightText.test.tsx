import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { HighlightText, splitHighlightSegments } from "./HighlightText";

describe("splitHighlightSegments", () => {
  it("returns a single plain segment when no terms match", () => {
    expect(splitHighlightSegments("Hello World", [])).toEqual([
      { text: "Hello World", hit: false }
    ]);
    expect(splitHighlightSegments("Hello", ["xyz"])).toEqual([
      { text: "Hello", hit: false }
    ]);
  });

  it("splits at the earliest match across terms case-insensitively", () => {
    expect(splitHighlightSegments("Fatal error in Camera", ["camera", "error"])).toEqual([
      { text: "Fatal ", hit: false },
      { text: "error", hit: true },
      { text: " in ", hit: false },
      { text: "Camera", hit: true }
    ]);
  });

  it("handles consecutive and empty terms", () => {
    expect(splitHighlightSegments("abcabc", ["abc", ""])).toEqual([
      { text: "abc", hit: true },
      { text: "abc", hit: true }
    ]);
    expect(splitHighlightSegments("same", ["same", "same"])).toEqual([
      { text: "same", hit: true }
    ]);
  });
});

describe("HighlightText", () => {
  it("renders plain text without marks when nothing matches", () => {
    const html = renderToStaticMarkup(
      <HighlightText text="Boot completed" terms={["crash"]} />
    );
    expect(html).toBe("Boot completed");
  });

  it("wraps each match in one log-hl mark", () => {
    const html = renderToStaticMarkup(
      <HighlightText text="camera died" terms={["camera"]} />
    );
    expect(html).toBe('<mark class="log-hl">camera</mark><span> died</span>');
  });

  it("renders overlapping earliest match first", () => {
    const html = renderToStaticMarkup(
      <HighlightText text="foobar" terms={["bar", "foobar"]} />
    );
    expect(html).toBe('<mark class="log-hl">foobar</mark>');
  });
});
