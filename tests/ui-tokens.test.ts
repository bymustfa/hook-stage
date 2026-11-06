import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const css = readFileSync("apps/web/src/styles.css", "utf8");
const app = readFileSync("apps/web/src/App.tsx", "utf8");

describe("WebUI visual system", () => {
  it("uses the approved motion curve and neutral surfaces", () => {
    expect(css).toContain("cubic-bezier(0.22, 1, 0.36, 1)");
    expect(css).toContain("#000000");
    expect(css).toContain("#181818");
    expect(css).toContain("#1f1f1f");
    expect(css).not.toMatch(/radial-gradient|linear-gradient/i);
    expect(css).not.toMatch(/fraunces|outfit|ibm plex|font-style:\s*italic/i);
  });

  it("keeps font sizes on the type scale", () => {
    const sizes = [...css.matchAll(/font-size:\s*(\d+)px/g)].map((match) => Number(match[1]));
    const allowed = new Set([12, 14, 16, 18, 20, 24, 30, 36, 48, 60, 72, 96, 128]);
    expect(sizes.length).toBeGreaterThan(0);
    expect(sizes.every((size) => allowed.has(size))).toBe(true);
  });

  it("ships loading, empty, and discard states without a confirm dialog", () => {
    expect(app).toContain("Loading scenarios");
    expect(app).toContain("Discard unsaved edits?");
    expect(app).not.toContain("window.confirm");
    expect(app).toContain("Skip to scenario");
  });
});
