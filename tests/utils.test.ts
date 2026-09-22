import { describe, expect, it } from "vitest";
import {
  escapePythonString,
  isPlainObject,
  quotePythonString,
  toPythonIdentifier
} from "../src/utils.js";

describe("toPythonIdentifier", () => {
  it("passes identifiers through unchanged", () => {
    expect(toPythonIdentifier("userId")).toBe("userId");
  });

  it("replaces invalid characters and leading digits", () => {
    expect(toPythonIdentifier("user-id")).toBe("user_id");
    expect(toPythonIdentifier("123Bad")).toBe("_Bad");
  });

  it("falls back to an underscore for empty names", () => {
    expect(toPythonIdentifier("")).toBe("_");
  });

  it("suffixes Python keywords", () => {
    expect(toPythonIdentifier("class")).toBe("class_");
  });
});

describe("quotePythonString", () => {
  it("quotes and escapes string literals", () => {
    expect(quotePythonString("plain")).toBe("'plain'");
    expect(escapePythonString("a'b\\c")).toBe("a\\'b\\\\c");
  });
});

describe("isPlainObject", () => {
  it("distinguishes plain objects", () => {
    expect(isPlainObject({})).toBe(true);
    expect(isPlainObject(null)).toBe(false);
    expect(isPlainObject([])).toBe(false);
    expect(isPlainObject("x")).toBe(false);
  });
});
