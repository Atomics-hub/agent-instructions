import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { performance } from "node:perf_hooks";
import process from "node:process";

const api = await import("../dist/index.js");
const directory = mkdtempSync(join(tmpdir(), "agent-instructions-stress-"));

try {
  mkdirSync(join(directory, ".git"));
  mkdirSync(join(directory, ".github", "instructions"), { recursive: true });
  writeFileSync(join(directory, "AGENTS.md"), "Repository rules");

  const targets = [];
  for (let index = 0; index < 200; index += 1) {
    const targetDirectory = join(
      directory,
      "packages",
      `package-${index}`,
      "src",
    );
    mkdirSync(targetDirectory, { recursive: true });
    writeFileSync(join(targetDirectory, "AGENTS.md"), `Rules ${index}`);
    const target = join(targetDirectory, "index.ts");
    writeFileSync(target, "export {};");
    targets.push(target);
  }

  for (let index = 0; index < 1_000; index += 1) {
    writeFileSync(
      join(
        directory,
        ".github",
        "instructions",
        `rule-${String(index).padStart(4, "0")}.md`,
      ),
      `---\napplyTo: "packages/package-${index % 200}/**/*.ts"\n---\nModular rule ${index}`,
    );
  }

  const started = performance.now();
  const result = await api.resolveInstructions({
    cwd: directory,
    targets,
    profile: "universal",
    maxTotalBytes: 1_000_000,
  });
  const elapsed = performance.now() - started;

  assert.equal(
    result.issues.filter((issue) => issue.severity === "error").length,
    0,
  );
  assert.equal(result.sources.length, 1_201);
  assert.ok(
    elapsed < 10_000,
    `stress resolution took ${elapsed.toFixed(0)} ms`,
  );
  assert.ok(result.sources.every((source) => source.targets.length > 0));

  process.stdout.write(
    `Resolved 1,201 sources across 200 targets in ${elapsed.toFixed(0)} ms.\n`,
  );
} finally {
  rmSync(directory, { recursive: true, force: true });
}
