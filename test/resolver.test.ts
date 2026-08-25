import { rename } from "node:fs/promises";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import {
  discoverInstructions,
  explainInstructions,
  findInstructionRoot,
  formatInstructions,
  getInstructionProfile,
  lintInstructions,
  resolveInstructions,
} from "../src/index.js";
import type { TestProject } from "./helpers.js";
import { createProject } from "./helpers.js";

const projects: TestProject[] = [];

afterEach(async () => {
  await Promise.all(projects.splice(0).map((project) => project.cleanup()));
});

async function project(): Promise<TestProject> {
  const value = await createProject();
  projects.push(value);
  return value;
}

describe("resolveInstructions", () => {
  it("loads hierarchical files from broad to specific", async () => {
    const fixture = await project();
    await fixture.write("AGENTS.md", "root rules");
    await fixture.write("packages/app/AGENTS.md", "app rules");
    const target = await fixture.write(
      "packages/app/src/index.ts",
      "export {};",
    );

    const result = await resolveInstructions({
      cwd: fixture.root,
      targets: [target],
      profile: "agents-md",
    });

    expect(result.sources.map((source) => source.relativePath)).toEqual([
      "AGENTS.md",
      "packages/app/AGENTS.md",
    ]);
    expect(result.sources.map((source) => source.expandedContent)).toEqual([
      "root rules",
      "app rules",
    ]);
    expect(result.targets).toEqual([target]);
  });

  it("resolves multiple targets without duplicating shared sources", async () => {
    const fixture = await project();
    await fixture.write("AGENTS.md", "shared");
    await fixture.write("a/AGENTS.md", "a-only");
    await fixture.write("b/AGENTS.md", "b-only");
    const a = await fixture.write("a/index.ts", "");
    const b = await fixture.write("b/index.ts", "");

    const result = await resolveInstructions({
      cwd: fixture.root,
      targets: [a, b],
      profile: "agents-md",
    });

    expect(result.sources.map((source) => source.relativePath)).toEqual([
      "AGENTS.md",
      "a/AGENTS.md",
      "b/AGENTS.md",
    ]);
    expect(result.sources[0]?.targets).toEqual(["a/index.ts", "b/index.ts"]);
  });

  it("deduplicates identical sibling formats but reports distinct competitors", async () => {
    const fixture = await project();
    await fixture.write("AGENTS.md", "same");
    await fixture.write("CLAUDE.md", "same");
    await fixture.write("GEMINI.md", "different");

    const result = await resolveInstructions({ cwd: fixture.root });

    expect(result.sources.map((source) => source.relativePath)).toEqual([
      "AGENTS.md",
      "GEMINI.md",
    ]);
    expect(result.omitted).toContainEqual(
      expect.objectContaining({
        path: join(fixture.root, "CLAUDE.md"),
        reason: "duplicate",
      }),
    );
    expect(result.issues.map((issue) => issue.code)).toEqual(
      expect.arrayContaining([
        "duplicate-instruction",
        "competing-instructions",
      ]),
    );
  });

  it("applies modular instructions only to matching targets", async () => {
    const fixture = await project();
    await fixture.write(
      ".github/instructions/typescript.instructions.md",
      '---\napplyTo: "src/**/*.{ts,tsx}"\n---\nUse strict TypeScript.',
    );
    await fixture.write(
      ".github/instructions/docs.instructions.md",
      "---\napplyTo:\n  - 'docs/**/*.md'\n---\nWrite concise docs.",
    );
    const target = await fixture.write("src/api/index.ts", "");

    const result = await resolveInstructions({
      cwd: fixture.root,
      targets: [target],
      profile: "copilot",
    });

    expect(result.sources).toHaveLength(1);
    expect(result.sources[0]).toMatchObject({
      relativePath: ".github/instructions/typescript.instructions.md",
      content: "Use strict TypeScript.",
      applyTo: ["src/**/*.{ts,tsx}"],
    });
    expect(result.omitted).toContainEqual(
      expect.objectContaining({ reason: "not-applicable" }),
    );
  });

  it("preserves the most specific files when the total budget is tight", async () => {
    const fixture = await project();
    await fixture.write("AGENTS.md", "broad instruction");
    await fixture.write("nested/AGENTS.md", "specific");
    const target = await fixture.write("nested/file.ts", "");

    const result = await resolveInstructions({
      cwd: fixture.root,
      targets: [target],
      profile: "agents-md",
      maxTotalBytes: 10,
    });

    expect(result.sources.map((source) => source.expandedContent)).toEqual([
      "specific",
    ]);
    expect(result.omitted[0]).toMatchObject({ reason: "budget" });
    expect(result.issues).toContainEqual(
      expect.objectContaining({ code: "budget-exceeded" }),
    );
  });

  it("can disable deduplication", async () => {
    const fixture = await project();
    await fixture.write("AGENTS.md", "same");
    await fixture.write("CLAUDE.md", "same");

    const result = await resolveInstructions({
      cwd: fixture.root,
      dedupe: false,
    });

    expect(result.sources).toHaveLength(2);
  });

  it("discovers candidates without reading their contents", async () => {
    const fixture = await project();
    await fixture.write("AGENTS.md", "root");
    await fixture.write("nested/AGENTS.md", "nested");
    const target = await fixture.write("nested/file.ts", "");

    const candidates = await discoverInstructions({
      cwd: fixture.root,
      targets: [target],
      profile: "agents-md",
    });

    expect(candidates).toHaveLength(2);
  });
});

describe("root and profile behavior", () => {
  it("finds the nearest git root", async () => {
    const fixture = await project();
    const nested = await fixture.directory("a/b/c");
    await expect(findInstructionRoot(nested)).resolves.toBe(fixture.root);
  });

  it("falls back to the starting directory without a marker", async () => {
    const fixture = await project();
    const isolated = await fixture.directory("plain");
    const originalGit = join(fixture.root, ".git");
    const hiddenGit = join(fixture.root, ".git-hidden");
    await rename(originalGit, hiddenGit);
    await expect(findInstructionRoot(isolated)).resolves.toBe(isolated);
    await rename(hiddenGit, originalGit);
  });

  it("starts root discovery from a file's containing directory", async () => {
    const fixture = await project();
    const target = await fixture.write("src/index.ts", "");
    await expect(findInstructionRoot(target)).resolves.toBe(fixture.root);
  });

  it("rejects targets outside the root", async () => {
    const fixture = await project();
    await expect(
      resolveInstructions({
        cwd: fixture.root,
        root: fixture.root,
        targets: [join(fixture.root, "..", "outside.ts")],
      }),
    ).rejects.toThrow("outside the project root");
  });

  it("validates custom profile candidates", () => {
    expect(() =>
      getInstructionProfile({
        name: "bad",
        hierarchicalFiles: [{ name: "../BAD.md", kind: "custom" }],
        references: false,
      }),
    ).toThrow("must be a file name");
    expect(() =>
      getInstructionProfile({
        name: " ",
        hierarchicalFiles: [],
        references: false,
      }),
    ).toThrow("name cannot be empty");
    expect(() =>
      getInstructionProfile({
        name: "bad-repository-path",
        hierarchicalFiles: [],
        repositoryFiles: [{ path: "../SECRETS.md", kind: "custom" }],
        references: false,
      }),
    ).toThrow("safe relative path");
    expect(() =>
      getInstructionProfile({
        name: "bad-modular-path",
        hierarchicalFiles: [],
        modularDirectories: ["/tmp/rules"],
        references: false,
      }),
    ).toThrow("safe relative path");
  });

  it("validates numeric limits", async () => {
    const fixture = await project();
    await expect(
      resolveInstructions({ cwd: fixture.root, maxFileBytes: 0 }),
    ).rejects.toThrow("positive integer");
    await expect(
      resolveInstructions({ cwd: fixture.root, maxReferenceDepth: -1 }),
    ).rejects.toThrow("non-negative integer");
  });
});

describe("formatting and linting", () => {
  it("formats markdown, XML, and explanations with provenance", async () => {
    const fixture = await project();
    await fixture.write("AGENTS.md", "Use <safe> & sound rules.");
    const result = await resolveInstructions({
      cwd: fixture.root,
      profile: "agents-md",
    });

    expect(formatInstructions(result)).toContain(
      "<!-- agent-instructions: AGENTS.md -->",
    );
    expect(
      formatInstructions(result, {
        format: "markdown",
        includeProvenance: false,
      }),
    ).toBe("Use <safe> & sound rules.");
    expect(formatInstructions(result, { format: "xml" })).toContain(
      "Use &lt;safe&gt; &amp; sound rules.",
    );
    expect(
      formatInstructions(result, {
        format: "xml",
        includeProvenance: false,
      }),
    ).not.toContain(" path=");
    expect(explainInstructions(result)).toContain("Included: 1 source(s)");
  });

  it("handles empty resolutions in both output formats", async () => {
    const fixture = await project();
    const result = await resolveInstructions({ cwd: fixture.root });
    expect(formatInstructions(result)).toBe("");
    expect(formatInstructions(result, { format: "xml" })).toContain(
      '<agent-instructions profile="universal">',
    );
    expect(explainInstructions(result)).toContain("Included: 0 source(s)");
  });

  it("supports strict and non-strict lint modes", async () => {
    const fixture = await project();
    await fixture.write("AGENTS.md", "one");
    await fixture.write("CLAUDE.md", "two");

    await expect(
      lintInstructions({ cwd: fixture.root }),
    ).resolves.toMatchObject({
      ok: true,
      warningCount: 1,
    });
    await expect(
      lintInstructions({ cwd: fixture.root, strict: true }),
    ).resolves.toMatchObject({ ok: false, warningCount: 1 });
  });
});
