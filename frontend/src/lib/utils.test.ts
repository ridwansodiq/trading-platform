import { describe, expect, it } from "vitest";
import { cn } from "./utils";

describe("cn", () => {
  it("keeps a colour class when merged with a custom font-size class", () => {
    // Without teaching tailwind-merge the custom scale, `text-body-2` is read
    // as a colour and silently removes `text-primary-foreground`.
    const result = cn("bg-primary text-primary-foreground", "text-body-2 font-medium");
    expect(result).toContain("text-primary-foreground");
    expect(result).toContain("text-body-2");
  });

  it("still lets a later colour override an earlier one", () => {
    expect(cn("text-ink-4", "text-red")).toBe("text-red");
  });

  it("still lets a later custom size override an earlier one", () => {
    expect(cn("text-cell", "text-title")).toBe("text-title");
  });

  it("drops falsy values", () => {
    expect(cn("bg-surface", false, undefined, null, "text-ink")).toBe("bg-surface text-ink");
  });
});
