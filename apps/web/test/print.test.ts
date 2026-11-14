import { afterEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_PRINT_OPTIONS, readPrintOptions } from "../src/lib/print";

const storage = (value: string | null) => ({ getItem: () => value, setItem: () => {} });

describe("print options", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("starts with no page breaks and link addresses written", () => {
    vi.stubGlobal("localStorage", storage(null));
    expect(readPrintOptions()).toEqual(DEFAULT_PRINT_OPTIONS);
    expect(DEFAULT_PRINT_OPTIONS).toEqual({ breaks: "none", linkUrls: true });
  });

  it("reads back the options last chosen", () => {
    vi.stubGlobal("localStorage", storage(JSON.stringify({ breaks: "h2", linkUrls: false })));
    expect(readPrintOptions()).toEqual({ breaks: "h2", linkUrls: false });
  });

  it("ignores what it doesn't know", () => {
    vi.stubGlobal("localStorage", storage(JSON.stringify({ breaks: "h4", linkUrls: "no" })));
    expect(readPrintOptions()).toEqual({ breaks: "none", linkUrls: true });
    vi.stubGlobal("localStorage", storage("{not json"));
    expect(readPrintOptions()).toEqual(DEFAULT_PRINT_OPTIONS);
  });

  it("works without storage (private window)", () => {
    vi.stubGlobal("localStorage", undefined);
    expect(readPrintOptions()).toEqual(DEFAULT_PRINT_OPTIONS);
  });
});
