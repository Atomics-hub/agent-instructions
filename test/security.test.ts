import { symlink, writeFile } from "node:fs/promises";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { resolveInstructions } from "../src/index.js";
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

describe("safe reference expansion", () => {
  it("expands nested references and records provenance", async () => {
    const fixture = await project();
    await fixture.write("AGENTS.md", "Read @docs/rules.md now.");
    await fixture.write("docs/rules.md", "Nested @details.txt");
    await fixture.write("docs/details.txt", "Be precise.");

    const result = await resolveInstructions({ cwd: fixture.root });

    expect(result.sources[0]?.expandedContent).toContain("Be precise.");
    expect(result.sources[0]?.references).toHaveLength(2);
    expect(result.issues).toEqual([]);
  });

  it("can preserve references without reading them", async () => {
    const fixture = await project();
    await fixture.write("AGENTS.md", "Read @missing.md");

    const result = await resolveInstructions({
      cwd: fixture.root,
      expandReferences: false,
    });

    expect(result.sources[0]?.expandedContent).toBe("Read @missing.md");
    expect(result.issues).toEqual([]);
  });

  it("reports cycles without recursing forever", async () => {
    const fixture = await project();
    await fixture.write("AGENTS.md", "@a.md");
    await fixture.write("a.md", "@b.md");
    await fixture.write("b.md", "@a.md");

    const result = await resolveInstructions({ cwd: fixture.root });

    expect(result.issues).toContainEqual(
      expect.objectContaining({ code: "cyclic-reference", severity: "error" }),
    );
  });

  it("reports missing references", async () => {
    const fixture = await project();
    await fixture.write("AGENTS.md", "Read @missing.md");

    const result = await resolveInstructions({ cwd: fixture.root });

    expect(result.issues).toContainEqual(
      expect.objectContaining({ code: "broken-reference" }),
    );
  });

  it("blocks traversal outside the project root", async () => {
    const fixture = await project();
    await writeFile(
      join(fixture.root, "..", "agent-instructions-secret.md"),
      "DO_NOT_LEAK_THIS_PAYLOAD",
    );
    await fixture.write("AGENTS.md", "Read @../agent-instructions-secret.md");

    const result = await resolveInstructions({ cwd: fixture.root });

    expect(result.sources[0]?.expandedContent).not.toContain(
      "DO_NOT_LEAK_THIS_PAYLOAD",
    );
    expect(result.issues).toContainEqual(
      expect.objectContaining({ code: "outside-root" }),
    );
  });

  it("enforces the reference depth limit", async () => {
    const fixture = await project();
    await fixture.write("AGENTS.md", "@a.md");
    await fixture.write("a.md", "@b.md");
    await fixture.write("b.md", "deep");

    const result = await resolveInstructions({
      cwd: fixture.root,
      maxReferenceDepth: 1,
    });

    expect(result.issues).toContainEqual(
      expect.objectContaining({ code: "reference-depth-exceeded" }),
    );
  });
});

describe("filesystem boundaries", () => {
  it("blocks instruction symlinks by default", async () => {
    const fixture = await project();
    await fixture.write("real.md", "linked rules");
    await symlink(
      join(fixture.root, "real.md"),
      join(fixture.root, "AGENTS.md"),
    );

    const result = await resolveInstructions({ cwd: fixture.root });

    expect(result.sources).toHaveLength(0);
    expect(result.issues).toContainEqual(
      expect.objectContaining({ code: "symlink-blocked" }),
    );
  });

  it("follows explicitly allowed in-root symlinks", async () => {
    const fixture = await project();
    await fixture.write("real.md", "linked rules");
    await symlink(
      join(fixture.root, "real.md"),
      join(fixture.root, "AGENTS.md"),
    );

    const result = await resolveInstructions({
      cwd: fixture.root,
      followSymlinks: true,
    });

    expect(result.issues).toEqual([]);
    expect(result.sources[0]?.expandedContent).toBe("linked rules");
  });

  it("blocks followed symlinks that escape allowed roots", async () => {
    const fixture = await project();
    const outside = join(fixture.root, "..", "agent-instructions-outside.md");
    await writeFile(outside, "outside");
    await symlink(outside, join(fixture.root, "AGENTS.md"));

    const result = await resolveInstructions({
      cwd: fixture.root,
      followSymlinks: true,
    });

    expect(result.sources).toHaveLength(0);
    expect(result.issues).toContainEqual(
      expect.objectContaining({ code: "outside-root" }),
    );
  });

  it("permits explicitly allowed external reference roots", async () => {
    const fixture = await project();
    const outside = join(fixture.root, "..", "agent-instructions-shared.md");
    await writeFile(outside, "shared safe rules");
    await fixture.write("AGENTS.md", "@../agent-instructions-shared.md");

    const result = await resolveInstructions({
      cwd: fixture.root,
      allowedReferenceRoots: [join(fixture.root, "..")],
    });

    expect(result.sources[0]?.expandedContent).toContain("shared safe rules");
  });

  it("rejects oversized files before loading them", async () => {
    const fixture = await project();
    await fixture.write("AGENTS.md", "1234567890");

    const result = await resolveInstructions({
      cwd: fixture.root,
      maxFileBytes: 5,
    });

    expect(result.sources).toHaveLength(0);
    expect(result.issues).toContainEqual(
      expect.objectContaining({ code: "file-too-large" }),
    );
  });

  it("reports malformed frontmatter without discarding the file", async () => {
    const fixture = await project();
    await fixture.write("AGENTS.md", "---\napplyTo: '**/*.ts'\nnever closed");

    const result = await resolveInstructions({ cwd: fixture.root });

    expect(result.sources).toHaveLength(1);
    expect(result.issues).toContainEqual(
      expect.objectContaining({ code: "invalid-frontmatter" }),
    );
  });

  it("supports Claude paths frontmatter and comma-aware brace globs", async () => {
    const fixture = await project();
    await fixture.write(
      ".claude/rules/frontend.md",
      "---\npaths: ['src/**/*.{ts,tsx}', 'web/**/*.js']\n---\nFrontend rules",
    );
    const target = await fixture.write("src/ui/button.tsx", "");
    const result = await resolveInstructions({
      cwd: fixture.root,
      targets: [target],
      profile: "claude",
    });
    expect(result.sources[0]?.applyTo).toEqual([
      "src/**/*.{ts,tsx}",
      "web/**/*.js",
    ]);
  });

  it("reports a reference depth issue when expansion is disabled by a zero limit", async () => {
    const fixture = await project();
    await fixture.write("AGENTS.md", "@rules.md");
    await fixture.write("rules.md", "never expanded");
    const result = await resolveInstructions({
      cwd: fixture.root,
      maxReferenceDepth: 0,
    });
    expect(result.sources[0]?.expandedContent).toBe("@rules.md");
    expect(result.issues).toContainEqual(
      expect.objectContaining({ code: "reference-depth-exceeded" }),
    );
  });

  it("ignores non-file modular entries and non-markdown files", async () => {
    const fixture = await project();
    await fixture.directory(".claude/rules/nested");
    await fixture.write(".claude/rules/ignore.txt", "ignored");
    await fixture.write(".claude/rules/nested/keep.md", "kept");
    const result = await resolveInstructions({
      cwd: fixture.root,
      profile: "claude",
    });
    expect(result.sources.map((source) => source.relativePath)).toEqual([
      ".claude/rules/nested/keep.md",
    ]);
  });
});
