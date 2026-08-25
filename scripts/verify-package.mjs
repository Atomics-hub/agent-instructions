import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import {
  mkdtempSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import process from "node:process";
import { fileURLToPath, URL } from "node:url";

const root = new URL("../", import.meta.url);
const packageJson = JSON.parse(
  readFileSync(new URL("package.json", root), "utf8"),
);
assert.equal(packageJson.dependencies, undefined);

const esm = await import(new URL("dist/index.js", root));
const cjs = createRequire(import.meta.url)(
  fileURLToPath(new URL("dist/index.cjs", root)),
);
const profilesEsm = await import(new URL("dist/profiles.js", root));
const profilesCjs = createRequire(import.meta.url)(
  fileURLToPath(new URL("dist/profiles.cjs", root)),
);

const directory = mkdtempSync(join(tmpdir(), "agent-instructions-package-"));
try {
  mkdirSync(join(directory, ".git"));
  mkdirSync(join(directory, "src"));
  writeFileSync(join(directory, "AGENTS.md"), "Root rules");
  writeFileSync(join(directory, "src", "AGENTS.md"), "Source rules");
  writeFileSync(join(directory, "src", "index.ts"), "export {};");

  for (const api of [esm, cjs]) {
    const result = await api.resolveInstructions({
      cwd: directory,
      targets: ["src/index.ts"],
      profile: "agents-md",
    });
    assert.deepEqual(
      result.sources.map((source) => source.relativePath),
      ["AGENTS.md", "src/AGENTS.md"],
    );
  }
  assert.equal(profilesEsm.instructionProfiles.universal.name, "universal");
  assert.equal(profilesCjs.instructionProfiles.claude.name, "claude");

  const cli = fileURLToPath(new URL("dist/cli.js", root));
  assert.match(
    execFileSync(process.execPath, [cli, "--help"], { encoding: "utf8" }),
    /^agent-instructions/u,
  );
  assert.equal(
    execFileSync(process.execPath, [cli, "--version"], {
      encoding: "utf8",
    }).trim(),
    packageJson.version,
  );
  assert.match(
    execFileSync(process.execPath, [cli, "explain", "src/index.ts"], {
      cwd: directory,
      encoding: "utf8",
    }),
    /src\/AGENTS\.md/u,
  );

  let lintFailed = false;
  writeFileSync(join(directory, "CLAUDE.md"), "Different rules");
  try {
    execFileSync(process.execPath, [cli, "lint", "--strict"], {
      cwd: directory,
      stdio: "pipe",
    });
  } catch (error) {
    lintFailed = error.status === 1;
  }
  assert.equal(lintFailed, true);
} finally {
  rmSync(directory, { recursive: true, force: true });
}

process.stdout.write(
  "ESM, CommonJS, profiles export, CLI, exit codes, and metadata verification passed.\n",
);
