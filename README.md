# agent-instructions

Resolve the exact instruction context that applies to any file in a coding-agent workspace.

[![npm version](https://img.shields.io/npm/v/agent-instructions.svg)](https://www.npmjs.com/package/agent-instructions)
[![CI](https://github.com/Atomics-hub/agent-instructions/actions/workflows/ci.yml/badge.svg)](https://github.com/Atomics-hub/agent-instructions/actions/workflows/ci.yml)
[![license](https://img.shields.io/npm/l/agent-instructions.svg)](./LICENSE)
[![zero dependencies](https://img.shields.io/badge/runtime_dependencies-0-brightgreen.svg)](./package.json)

One repository can contain `AGENTS.md`, `CLAUDE.md`, `GEMINI.md`, Copilot instructions, nested overrides, modular rules, and imported files. The instruction set changes with the target path. `agent-instructions` discovers that hierarchy, applies path selectors, expands safe references, enforces byte budgets, and explains every inclusion or omission.

```sh
npm install agent-instructions
```

```ts
import { resolveInstructions, formatInstructions } from "agent-instructions";

const result = await resolveInstructions({
  root: process.cwd(),
  targets: ["src/api/orders.ts"],
  profile: "universal",
});

console.log(formatInstructions(result));
console.log(result.sources.map((source) => source.relativePath));
// ['AGENTS.md', 'src/AGENTS.md', '.claude/rules/typescript.md']
```

## Why this exists

Instruction files have become an interoperability layer, but every agent reads a different subset. Integrations often concatenate a few root files, missing nested scopes and path-specific rules—or accidentally load unrelated and unsafe content.

This package gives agent runtimes, editors, CI checks, prompt builders, and developer tools one deterministic interface:

- five built-in profiles: `agents-md`, `claude`, `gemini`, `copilot`, and `universal`;
- broad-to-specific hierarchical resolution for one or many targets;
- Copilot `applyTo` and Claude `paths` frontmatter;
- recursive `@file.md` / `@file.txt` imports with cycle and traversal protection;
- symlinks blocked by default and constrained when explicitly enabled;
- per-file and total byte limits, preserving the most specific context first;
- same-scope deduplication and conflict diagnostics;
- Markdown, XML, JSON, and provenance-rich explanation output;
- zero runtime dependencies, ESM and CommonJS, Node.js 18+.

## CLI

```sh
# Print effective Markdown instructions for one target
npx agent-instructions src/api/orders.ts

# See exactly why each source was included or omitted
npx agent-instructions explain src/api/orders.ts

# Fail CI on unsafe imports, cycles, or unreadable sources
npx agent-instructions lint --profile universal

# Treat competing instructions and budget omissions as failures too
npx agent-instructions lint --strict

# Machine-readable output for integrations
npx agent-instructions resolve src/api src/web --json
```

Run `agent-instructions --help` for every option.

## API

### `resolveInstructions(options?)`

Returns a complete `InstructionResolution` with `sources`, `omitted`, `issues`, target provenance, and total expanded bytes.

```ts
const resolution = await resolveInstructions({
  cwd: process.cwd(),
  root: process.cwd(),
  targets: ["packages/server/src/index.ts", "packages/web/src/app.tsx"],
  profile: "universal",
  expandReferences: true,
  followSymlinks: false,
  maxFileBytes: 1_048_576,
  maxTotalBytes: 262_144,
  maxReferenceDepth: 8,
  dedupe: true,
});
```

Relative targets resolve from `cwd`. Targets must remain under `root`. If `root` is omitted, the nearest ancestor containing `.git` is used; otherwise the starting directory is used.

### `discoverInstructions(options?)`

Finds candidate files without reading their contents. Useful for file watching and cache invalidation.

### `lintInstructions(options?)`

Resolves instructions and returns `{ ok, errorCount, warningCount, resolution }`. Errors fail by default; `strict: true` also fails warnings.

### `formatInstructions(resolution, options?)`

Formats resolved content as provenance-delimited Markdown or escaped XML. Use `includeProvenance: false` for content only.

### `explainInstructions(resolution)`

Produces a human-readable resolution trace.

### `findInstructionRoot(start)`

Walks upward from a file or directory to find the nearest `.git` marker.

### Glob helpers

`matchesGlob(path, pattern)` and `matchesAnyGlob(path, patterns)` expose the same dependency-free matcher used for modular rules. It supports `*`, `**`, `?`, character classes, negated character classes, and brace alternatives.

## Profiles

| Profile     | Hierarchical files                    | Repository/modular files                                          | `@` references |
| ----------- | ------------------------------------- | ----------------------------------------------------------------- | -------------- |
| `agents-md` | `AGENTS.md`                           | —                                                                 | off            |
| `claude`    | `CLAUDE.md`, `CLAUDE.local.md`        | `.claude/CLAUDE.md`, `.claude/rules/**/*.md`                      | on             |
| `gemini`    | `GEMINI.md`                           | —                                                                 | on             |
| `copilot`   | `AGENTS.md`, `CLAUDE.md`, `GEMINI.md` | `.github/copilot-instructions.md`, `.github/instructions/**/*.md` | on             |
| `universal` | all supported hierarchical names      | both repository files and modular directories                     | on             |

Profiles are deterministic compatibility presets, not claims that every vendor client behaves identically. See [Profile semantics](./docs/profile-semantics.md).

Custom profiles are supported:

```ts
await resolveInstructions({
  profile: {
    name: "my-agent",
    hierarchicalFiles: [{ name: "MY_AGENT.md", kind: "custom" }],
    repositoryFiles: [{ path: ".agent/instructions.md", kind: "custom" }],
    modularDirectories: [".agent/rules"],
    references: true,
  },
});
```

## Resolution order

Sources are emitted from broad to specific:

1. repository-wide instruction files in profile order;
2. hierarchical files from project root down to each target directory;
3. modular rule files in lexical order.

Identical expanded content in the same scope is included once. Distinct files in the same scope remain visible and produce a `competing-instructions` warning. When the total budget is exceeded, later and more specific sources win.

## Security model

Instruction files are untrusted input. This library reads and returns text; it never executes instructions or sends them to a model. References are limited to Markdown and text paths, traversal is blocked, recursive imports are bounded, and symlinks are denied unless explicitly enabled. Read [Security model](./docs/security-model.md) before allowing external reference roots.

## Performance

Discovery walks only target ancestor chains plus configured modular directories. Files are read once per resolution, duplicate candidates are coalesced, and all traversals have explicit limits. The release suite stress-tests 1,000 modular files, 200 targets, deep imports, packed ESM/CommonJS exports, and the CLI.

## License

MIT © Atomics Hub
