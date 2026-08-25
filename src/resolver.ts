import { lstat, readFile, readdir, realpath, stat } from "node:fs/promises";
import {
  dirname,
  extname,
  isAbsolute,
  join,
  relative,
  resolve,
  sep,
} from "node:path";

import { parseInstructionFrontmatter } from "./frontmatter.js";
import { matchesAnyGlob } from "./glob.js";
import { getInstructionProfile } from "./profiles.js";
import type {
  InstructionCandidate,
  InstructionIssue,
  InstructionProfile,
  InstructionReference,
  InstructionResolution,
  InstructionSource,
  OmittedInstruction,
  ResolveInstructionsOptions,
} from "./types.js";

const DEFAULT_MAX_FILE_BYTES = 1024 * 1024;
const DEFAULT_MAX_TOTAL_BYTES = 256 * 1024;
const DEFAULT_MAX_REFERENCE_DEPTH = 8;
const REFERENCE_PATTERN =
  /(^|\s)@((?:\.{0,2}\/)?[A-Za-z0-9_./-]+\.(?:md|txt))(?=$|\s|[),.;:])/gmu;

interface NormalizedOptions {
  cwd: string;
  root: string;
  targets: readonly string[];
  profile: InstructionProfile;
  expandReferences: boolean;
  followSymlinks: boolean;
  maxFileBytes: number;
  maxTotalBytes: number;
  maxReferenceDepth: number;
  allowedReferenceRoots: readonly string[];
  dedupe: boolean;
}

interface SafeFile {
  path: string;
  content: string;
}

interface ExpandedFile {
  content: string;
  references: InstructionReference[];
}

export async function findInstructionRoot(start: string): Promise<string> {
  const original = resolve(start);
  let current = await resolveTargetDirectory(original);
  const fallback = current;

  for (;;) {
    if (await exists(join(current, ".git"))) {
      return current;
    }

    const parent = dirname(current);
    if (parent === current) {
      return fallback;
    }
    current = parent;
  }
}

export async function discoverInstructions(
  options: ResolveInstructionsOptions = {},
): Promise<readonly InstructionCandidate[]> {
  const normalized = await normalizeOptions(options);
  return discoverCandidates(normalized);
}

export async function resolveInstructions(
  options: ResolveInstructionsOptions = {},
): Promise<InstructionResolution> {
  const normalized = await normalizeOptions(options);
  const issues: InstructionIssue[] = [];
  const omitted: OmittedInstruction[] = [];
  const candidates = await discoverCandidates(normalized);
  const loaded: InstructionSource[] = [];

  for (const candidate of candidates) {
    const safeFile = await readSafeFile(
      candidate.path,
      normalized,
      issues,
      false,
    );
    if (safeFile === null) {
      omitted.push({ ...candidate, reason: "unsafe" });
      continue;
    }

    const frontmatter = parseInstructionFrontmatter(safeFile.content);
    if (frontmatter.hasFrontmatter && !frontmatter.valid) {
      issues.push({
        code: "invalid-frontmatter",
        severity: "warning",
        message: `Unclosed frontmatter in ${displayPath(normalized.root, candidate.path)}`,
        path: candidate.path,
      });
    }

    const applyTo = frontmatter.valid ? frontmatter.applyTo : [];
    const applicableTargets = getApplicableTargets(
      candidate,
      normalized,
      applyTo,
    );
    if (applicableTargets.length === 0) {
      omitted.push({
        ...candidate,
        ...(applyTo.length > 0 ? { applyTo } : {}),
        reason: "not-applicable",
      });
      continue;
    }

    const sourceContent = frontmatter.valid
      ? frontmatter.content
      : safeFile.content;
    const expanded = normalized.expandReferences
      ? await expandReferences(
          safeFile.path,
          sourceContent,
          normalized,
          issues,
          [safeFile.path],
          0,
        )
      : { content: sourceContent, references: [] };
    const bytes = Buffer.byteLength(expanded.content, "utf8");

    loaded.push({
      ...candidate,
      ...(applyTo.length > 0 ? { applyTo } : {}),
      relativePath: displayPath(normalized.root, candidate.path),
      content: sourceContent,
      expandedContent: expanded.content,
      bytes,
      references: expanded.references,
      targets: applicableTargets.map((target) =>
        displayPath(normalized.root, target),
      ),
    });
  }

  reportCompetingInstructions(loaded, issues, normalized.root);
  const deduped = normalized.dedupe
    ? dedupeWithinScope(loaded, omitted, issues)
    : loaded;
  const budgeted = applyBudget(
    deduped,
    normalized.maxTotalBytes,
    omitted,
    issues,
  );

  return {
    root: normalized.root,
    cwd: normalized.cwd,
    profile: normalized.profile.name,
    targets: normalized.targets,
    sources: budgeted,
    omitted,
    issues,
    bytes: budgeted.reduce((total, source) => total + source.bytes, 0),
  };
}

async function normalizeOptions(
  options: ResolveInstructionsOptions,
): Promise<NormalizedOptions> {
  const cwd = resolve(options.cwd ?? process.cwd());
  const root = resolve(options.root ?? (await findInstructionRoot(cwd)));
  const rawTargets = options.targets?.length ? options.targets : [cwd];
  const targets = rawTargets.map((target) =>
    resolve(isAbsolute(target) ? target : join(cwd, target)),
  );

  for (const target of targets) {
    if (!isWithin(root, target)) {
      throw new TypeError(
        `Instruction target is outside the project root: ${target}`,
      );
    }
  }

  const profile = getInstructionProfile(options.profile);
  const maxFileBytes = positiveInteger(
    options.maxFileBytes ?? DEFAULT_MAX_FILE_BYTES,
    "maxFileBytes",
  );
  const maxTotalBytes = positiveInteger(
    options.maxTotalBytes ?? DEFAULT_MAX_TOTAL_BYTES,
    "maxTotalBytes",
  );
  const maxReferenceDepth = nonNegativeInteger(
    options.maxReferenceDepth ?? DEFAULT_MAX_REFERENCE_DEPTH,
    "maxReferenceDepth",
  );
  const configuredReferenceRoots = [
    root,
    ...(options.allowedReferenceRoots ?? []).map((entry) =>
      resolve(isAbsolute(entry) ? entry : join(cwd, entry)),
    ),
  ];
  const canonicalReferenceRoots = await Promise.all(
    configuredReferenceRoots.map((entry) => canonicalPath(entry)),
  );
  const allowedReferenceRoots = [
    ...new Set([...configuredReferenceRoots, ...canonicalReferenceRoots]),
  ];

  return {
    cwd,
    root,
    targets,
    profile,
    expandReferences: options.expandReferences ?? profile.references,
    followSymlinks: options.followSymlinks ?? false,
    maxFileBytes,
    maxTotalBytes,
    maxReferenceDepth,
    allowedReferenceRoots,
    dedupe: options.dedupe ?? true,
  };
}

async function discoverCandidates(
  options: NormalizedOptions,
): Promise<InstructionCandidate[]> {
  const candidates = new Map<string, InstructionCandidate>();

  for (const [index, repositoryFile] of (
    options.profile.repositoryFiles ?? []
  ).entries()) {
    const path = join(options.root, repositoryFile.path);
    if (await isFileOrSymlink(path)) {
      candidates.set(path, {
        path,
        kind: repositoryFile.kind,
        scope: options.root,
        origin: "project",
        priority: index,
      });
    }
  }

  for (const target of options.targets) {
    const targetDirectory = await resolveTargetDirectory(target);
    const chain = directoryChain(options.root, targetDirectory);
    for (const [depth, directory] of chain.entries()) {
      for (const [index, file] of options.profile.hierarchicalFiles.entries()) {
        const path = join(directory, file.name);
        if (await isFileOrSymlink(path)) {
          candidates.set(path, {
            path,
            kind: file.kind,
            scope: directory,
            origin: "project",
            priority: 100 + depth * 100 + index,
          });
        }
      }
    }
  }

  for (const [directoryIndex, modularDirectory] of (
    options.profile.modularDirectories ?? []
  ).entries()) {
    const base = join(options.root, modularDirectory);
    const paths = await walkMarkdownFiles(base);
    for (const [index, path] of paths.entries()) {
      candidates.set(path, {
        path,
        kind: "modular",
        scope: options.root,
        origin: "project",
        priority: 1_000_000 + directoryIndex * 100_000 + index,
      });
    }
  }

  return [...candidates.values()].sort(
    (left, right) =>
      left.priority - right.priority || left.path.localeCompare(right.path),
  );
}

function getApplicableTargets(
  candidate: InstructionCandidate,
  options: NormalizedOptions,
  applyTo: readonly string[],
): string[] {
  if (applyTo.length > 0) {
    return options.targets.filter((target) =>
      matchesAnyGlob(displayPath(options.root, target), applyTo),
    );
  }

  if (candidate.kind === "modular") {
    return [...options.targets];
  }

  return options.targets.filter((target) => isWithin(candidate.scope, target));
}

async function expandReferences(
  path: string,
  content: string,
  options: NormalizedOptions,
  issues: InstructionIssue[],
  stack: readonly string[],
  depth: number,
): Promise<ExpandedFile> {
  const matches = [...content.matchAll(REFERENCE_PATTERN)];
  if (matches.length === 0) {
    return { content, references: [] };
  }

  let cursor = 0;
  let output = "";
  const references: InstructionReference[] = [];

  for (const match of matches) {
    const index = match.index;
    const prefix = match[1] ?? "";
    const referenceText = match[2] ?? "";
    output += content.slice(cursor, index) + prefix;
    cursor = index + match[0].length;

    if (depth >= options.maxReferenceDepth) {
      issues.push({
        code: "reference-depth-exceeded",
        severity: "error",
        message: `Reference depth exceeded at ${referenceText}`,
        path,
      });
      output += `@${referenceText}`;
      continue;
    }

    const referencePath = resolve(dirname(path), referenceText);
    if (
      !options.allowedReferenceRoots.some((root) =>
        isWithin(root, referencePath),
      )
    ) {
      issues.push({
        code: "outside-root",
        severity: "error",
        message: `Blocked reference outside allowed roots: ${referenceText}`,
        path,
        relatedPath: referencePath,
      });
      output += `@${referenceText}`;
      continue;
    }

    const safeFile = await readSafeFile(referencePath, options, issues, true);
    if (safeFile === null) {
      output += `@${referenceText}`;
      continue;
    }

    if (stack.includes(safeFile.path)) {
      issues.push({
        code: "cyclic-reference",
        severity: "error",
        message: `Cyclic instruction reference: ${displayPath(options.root, safeFile.path)}`,
        path,
        relatedPath: safeFile.path,
      });
      output += `@${referenceText}`;
      continue;
    }

    const nested = await expandReferences(
      safeFile.path,
      safeFile.content,
      options,
      issues,
      [...stack, safeFile.path],
      depth + 1,
    );
    references.push(
      { from: path, path: safeFile.path, depth: depth + 1 },
      ...nested.references,
    );
    output += [
      `<!-- referenced: ${displayPath(options.root, safeFile.path)} -->`,
      nested.content.trim(),
      `<!-- /referenced: ${displayPath(options.root, safeFile.path)} -->`,
    ].join("\n");
  }

  output += content.slice(cursor);
  return { content: output, references };
}

async function readSafeFile(
  path: string,
  options: NormalizedOptions,
  issues: InstructionIssue[],
  reference: boolean,
): Promise<SafeFile | null> {
  try {
    const metadata = await lstat(path);
    let readPath = path;

    if (metadata.isSymbolicLink()) {
      if (!options.followSymlinks) {
        issues.push({
          code: "symlink-blocked",
          severity: "error",
          message: `Blocked symbolic link: ${displayPath(options.root, path)}`,
          path,
        });
        return null;
      }
      readPath = await realpath(path);
      if (
        !options.allowedReferenceRoots.some((root) => isWithin(root, readPath))
      ) {
        issues.push({
          code: "outside-root",
          severity: "error",
          message: `Symbolic link resolves outside allowed roots: ${displayPath(options.root, path)}`,
          path,
          relatedPath: readPath,
        });
        return null;
      }
    }

    const fileMetadata = await stat(readPath);
    if (!fileMetadata.isFile()) {
      throw new Error("Path is not a regular file");
    }
    if (fileMetadata.size > options.maxFileBytes) {
      issues.push({
        code: "file-too-large",
        severity: "error",
        message: `${displayPath(options.root, path)} exceeds maxFileBytes`,
        path,
      });
      return null;
    }

    const content = await readFile(readPath, "utf8");
    if (Buffer.byteLength(content, "utf8") > options.maxFileBytes) {
      issues.push({
        code: "file-too-large",
        severity: "error",
        message: `${displayPath(options.root, path)} grew beyond maxFileBytes while reading`,
        path,
      });
      return null;
    }
    return { path: readPath, content };
  } catch (error) {
    issues.push({
      code: reference ? "broken-reference" : "read-failed",
      severity: reference ? "error" : "warning",
      message: `${reference ? "Could not read referenced file" : "Could not read instruction file"}: ${displayPath(options.root, path)} (${errorMessage(error)})`,
      path,
    });
    return null;
  }
}

function reportCompetingInstructions(
  sources: readonly InstructionSource[],
  issues: InstructionIssue[],
  root: string,
): void {
  const scopes = new Map<string, InstructionSource[]>();
  for (const source of sources) {
    const entries = scopes.get(source.scope) ?? [];
    entries.push(source);
    scopes.set(source.scope, entries);
  }

  for (const [scope, entries] of scopes) {
    const unique = new Set(entries.map((entry) => entry.content.trim()));
    if (entries.length > 1 && unique.size > 1) {
      const first = entries[0];
      issues.push({
        code: "competing-instructions",
        severity: "warning",
        message: `Multiple distinct instruction files share scope ${displayPath(root, scope)}`,
        ...(first === undefined ? {} : { path: first.path }),
      });
    }
  }
}

function dedupeWithinScope(
  sources: readonly InstructionSource[],
  omitted: OmittedInstruction[],
  issues: InstructionIssue[],
): InstructionSource[] {
  const seen = new Map<string, InstructionSource>();
  const result: InstructionSource[] = [];

  for (const source of sources) {
    const key = `${source.scope}\0${source.expandedContent.trim()}`;
    const existing = seen.get(key);
    if (existing === undefined) {
      seen.set(key, source);
      result.push(source);
      continue;
    }

    omitted.push({ ...source, reason: "duplicate" });
    issues.push({
      code: "duplicate-instruction",
      severity: "info",
      message: `${source.relativePath} duplicates ${existing.relativePath} in the same scope`,
      path: source.path,
      relatedPath: existing.path,
    });
  }

  return result;
}

function applyBudget(
  sources: readonly InstructionSource[],
  maxBytes: number,
  omitted: OmittedInstruction[],
  issues: InstructionIssue[],
): InstructionSource[] {
  let remaining = maxBytes;
  const included = new Set<string>();

  for (const source of [...sources].reverse()) {
    if (source.bytes <= remaining) {
      included.add(source.path);
      remaining -= source.bytes;
      continue;
    }
    omitted.push({ ...source, reason: "budget" });
    issues.push({
      code: "budget-exceeded",
      severity: "warning",
      message: `Omitted ${source.relativePath} to preserve more specific instructions within ${maxBytes} bytes`,
      path: source.path,
    });
  }

  return sources.filter((source) => included.has(source.path));
}

async function resolveTargetDirectory(target: string): Promise<string> {
  try {
    const metadata = await stat(target);
    return metadata.isDirectory() ? target : dirname(target);
  } catch {
    return extname(target) === "" ? target : dirname(target);
  }
}

function directoryChain(root: string, target: string): string[] {
  if (!isWithin(root, target)) {
    return [];
  }
  const result = [target];
  let current = target;
  while (current !== root) {
    current = dirname(current);
    result.push(current);
  }
  return result.reverse();
}

async function walkMarkdownFiles(base: string): Promise<string[]> {
  if (!(await exists(base))) {
    return [];
  }

  const result: string[] = [];
  const queue = [base];
  while (queue.length > 0) {
    const directory = queue.shift();
    if (directory === undefined) {
      continue;
    }
    let entries;
    try {
      entries = await readdir(directory, { withFileTypes: true });
    } catch {
      continue;
    }
    entries.sort((left, right) => left.name.localeCompare(right.name));
    for (const entry of entries) {
      const path = join(directory, entry.name);
      if (entry.isDirectory()) {
        queue.push(path);
      } else if (entry.isFile() && entry.name.endsWith(".md")) {
        result.push(path);
      }
    }
  }
  return result.sort();
}

async function isFileOrSymlink(path: string): Promise<boolean> {
  try {
    const metadata = await lstat(path);
    return metadata.isFile() || metadata.isSymbolicLink();
  } catch {
    return false;
  }
}

async function exists(path: string): Promise<boolean> {
  try {
    await lstat(path);
    return true;
  } catch {
    return false;
  }
}

async function canonicalPath(path: string): Promise<string> {
  try {
    return await realpath(path);
  } catch {
    return resolve(path);
  }
}

function isWithin(root: string, candidate: string): boolean {
  const value = relative(resolve(root), resolve(candidate));
  return value === "" || (!value.startsWith(`..${sep}`) && value !== "..");
}

function displayPath(root: string, path: string): string {
  const value = relative(root, path);
  return value === "" ? "." : value.replaceAll(sep, "/");
}

function positiveInteger(value: number, name: string): number {
  if (!Number.isInteger(value) || value <= 0) {
    throw new TypeError(`${name} must be a positive integer`);
  }
  return value;
}

function nonNegativeInteger(value: number, name: string): number {
  if (!Number.isInteger(value) || value < 0) {
    throw new TypeError(`${name} must be a non-negative integer`);
  }
  return value;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
