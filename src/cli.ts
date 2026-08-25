#!/usr/bin/env node

import { readFileSync } from "node:fs";

import { explainInstructions, formatInstructions } from "./format.js";
import { lintInstructions } from "./lint.js";
import { resolveInstructions } from "./resolver.js";
import type {
  InstructionProfileName,
  ResolveInstructionsOptions,
} from "./types.js";

const packageJson = JSON.parse(
  readFileSync(new URL("../package.json", import.meta.url), "utf8"),
) as { version: string };
const VERSION = packageJson.version;
const profileNames = new Set<InstructionProfileName>([
  "agents-md",
  "claude",
  "gemini",
  "copilot",
  "universal",
]);

interface CliOptions {
  command: "resolve" | "lint" | "explain";
  resolve: ResolveInstructionsOptions;
  format: "markdown" | "xml" | "json";
  strict: boolean;
}

async function main(argv: readonly string[]): Promise<void> {
  if (argv.includes("--help") || argv.includes("-h")) {
    process.stdout.write(helpText());
    return;
  }
  if (argv.includes("--version") || argv.includes("-v")) {
    process.stdout.write(`${VERSION}\n`);
    return;
  }

  const options = parseArguments(argv);
  if (options.command === "lint") {
    const result = await lintInstructions({
      ...options.resolve,
      strict: options.strict,
    });
    if (options.format === "json") {
      process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    } else {
      process.stdout.write(explainInstructions(result.resolution));
    }
    process.exitCode = result.ok ? 0 : 1;
    return;
  }

  const resolution = await resolveInstructions(options.resolve);
  if (options.command === "explain") {
    process.stdout.write(
      options.format === "json"
        ? `${JSON.stringify(resolution, null, 2)}\n`
        : explainInstructions(resolution),
    );
    return;
  }

  if (options.format === "json") {
    process.stdout.write(`${JSON.stringify(resolution, null, 2)}\n`);
  } else {
    process.stdout.write(
      `${formatInstructions(resolution, { format: options.format })}\n`,
    );
  }
}

function parseArguments(argv: readonly string[]): CliOptions {
  let command: CliOptions["command"] = "resolve";
  let format: CliOptions["format"] = "markdown";
  let strict = false;
  let cwd: string | undefined;
  let root: string | undefined;
  let profile: InstructionProfileName | undefined;
  let expandReferences: boolean | undefined;
  let followSymlinks = false;
  let maxFileBytes: number | undefined;
  let maxTotalBytes: number | undefined;
  let maxReferenceDepth: number | undefined;
  const targets: string[] = [];

  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index] ?? "";
    if (index === 0 && ["resolve", "lint", "explain"].includes(argument)) {
      command = argument as CliOptions["command"];
      continue;
    }
    if (argument === "--json") {
      format = "json";
    } else if (argument === "--strict") {
      strict = true;
    } else if (argument === "--no-references") {
      expandReferences = false;
    } else if (argument === "--references") {
      expandReferences = true;
    } else if (argument === "--follow-symlinks") {
      followSymlinks = true;
    } else if (argument === "--cwd") {
      cwd = nextValue(argv, ++index, argument);
    } else if (argument === "--root") {
      root = nextValue(argv, ++index, argument);
    } else if (argument === "--profile") {
      const value = nextValue(argv, ++index, argument);
      if (!profileNames.has(value as InstructionProfileName)) {
        throw new TypeError(`Unknown profile: ${value}`);
      }
      profile = value as InstructionProfileName;
    } else if (argument === "--format") {
      const value = nextValue(argv, ++index, argument);
      if (!new Set(["markdown", "xml", "json"]).has(value)) {
        throw new TypeError(`Unknown format: ${value}`);
      }
      format = value as CliOptions["format"];
    } else if (argument === "--max-file-bytes") {
      maxFileBytes = parseInteger(nextValue(argv, ++index, argument), argument);
    } else if (argument === "--max-bytes") {
      maxTotalBytes = parseInteger(
        nextValue(argv, ++index, argument),
        argument,
      );
    } else if (argument === "--max-reference-depth") {
      maxReferenceDepth = parseInteger(
        nextValue(argv, ++index, argument),
        argument,
      );
    } else if (argument.startsWith("-")) {
      throw new TypeError(`Unknown option: ${argument}`);
    } else {
      targets.push(argument);
    }
  }

  return {
    command,
    format,
    strict,
    resolve: {
      ...(cwd === undefined ? {} : { cwd }),
      ...(root === undefined ? {} : { root }),
      ...(profile === undefined ? {} : { profile }),
      ...(expandReferences === undefined ? {} : { expandReferences }),
      ...(maxFileBytes === undefined ? {} : { maxFileBytes }),
      ...(maxTotalBytes === undefined ? {} : { maxTotalBytes }),
      ...(maxReferenceDepth === undefined ? {} : { maxReferenceDepth }),
      ...(targets.length === 0 ? {} : { targets }),
      followSymlinks,
    },
  };
}

function nextValue(
  argv: readonly string[],
  index: number,
  option: string,
): string {
  const value = argv[index];
  if (value === undefined || value.startsWith("-")) {
    throw new TypeError(`${option} requires a value`);
  }
  return value;
}

function parseInteger(value: string, option: string): number {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 0) {
    throw new TypeError(`${option} requires a non-negative integer`);
  }
  return parsed;
}

function helpText(): string {
  return `agent-instructions ${VERSION}

Resolve, explain, and lint coding-agent instruction files.

Usage:
  agent-instructions [resolve] [targets...] [options]
  agent-instructions explain [targets...] [options]
  agent-instructions lint [targets...] [options]

Options:
  --profile <name>          agents-md, claude, gemini, copilot, universal
  --cwd <path>              Working directory used for relative paths
  --root <path>             Explicit project root (otherwise nearest .git)
  --format <format>         markdown, xml, or json
  --json                    Alias for --format json
  --references              Expand safe @file references
  --no-references           Preserve @file references without expansion
  --follow-symlinks         Follow links that remain inside allowed roots
  --max-file-bytes <n>      Maximum bytes read from one source
  --max-bytes <n>           Maximum total expanded instruction bytes
  --max-reference-depth <n> Maximum recursive @file depth
  --strict                  Make lint warnings fail
  -h, --help                Show help
  -v, --version             Show version
`;
}

main(process.argv.slice(2)).catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  process.stderr.write(`agent-instructions: ${message}\n`);
  process.exitCode = 1;
});
