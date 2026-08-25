import fc from "fast-check";
import { describe, expect, it } from "vitest";

import { matchesAnyGlob, matchesGlob } from "../src/index.js";

describe("glob matching", () => {
  it.each([
    ["src/index.ts", "**/*.ts", true],
    ["index.ts", "**/*.ts", true],
    ["src/view.tsx", "src/**/*.{ts,tsx}", true],
    ["src/view.js", "src/**/*.{ts,tsx}", false],
    ["docs/guide.md", "docs/*.md", true],
    ["docs/nested/guide.md", "docs/*.md", false],
    ["a/b/c.md", "a/**", true],
    ["src/a.ts", "src/?.ts", true],
    ["src/a.ts", "src/[abc].ts", true],
    ["src/d.ts", "src/[abc].ts", false],
    ["src/d.ts", "src/[!abc].ts", true],
    ["src/a.ts", "src/[^abc].ts", false],
    ["src/a.ts", "src/[z-a].ts", false],
    ["src/[abc.ts", "src/[abc.ts", true],
  ])("matches %s against %s", (path, pattern, expected) => {
    expect(matchesGlob(path, pattern)).toBe(expected);
  });

  it("matches any supplied pattern", () => {
    expect(matchesAnyGlob("src/a.ts", ["docs/**", "src/**"])).toBe(true);
    expect(matchesAnyGlob("test/a.ts", ["docs/**", "src/**"])).toBe(false);
  });

  it("matches every literal path against itself", () => {
    fc.assert(
      fc.property(
        fc.array(fc.stringMatching(/^[a-z0-9_-]{1,12}$/u), {
          minLength: 1,
          maxLength: 6,
        }),
        (segments) => {
          const path = segments.join("/");
          expect(matchesGlob(path, path)).toBe(true);
        },
      ),
    );
  });

  it("keeps a single star inside one path segment", () => {
    fc.assert(
      fc.property(fc.stringMatching(/^[a-z0-9_-]{1,20}$/u), (segment) => {
        expect(matchesGlob(segment, "*")).toBe(true);
        expect(matchesGlob(`nested/${segment}`, "*")).toBe(false);
      }),
    );
  });
});
