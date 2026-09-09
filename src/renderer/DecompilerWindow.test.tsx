import { describe, expect, it } from "vitest";
import { findAllIndices } from "./DecompilerWindow";

describe("findAllIndices", () => {
  it("finds all case-insensitive occurrences", () => {
    expect(findAllIndices("abcABCabc", "abc")).toEqual([0, 3, 6]);
    expect(findAllIndices("Token TOKEN token", "token")).toEqual([0, 6, 12]);
  });

  it("returns empty for empty query or no match", () => {
    expect(findAllIndices("anything", "")).toEqual([]);
    expect(findAllIndices("abc", "xyz")).toEqual([]);
  });

  it("caps the number of hits", () => {
    expect(findAllIndices("aaaaaa", "a", 3)).toEqual([0, 1, 2]);
  });
});
