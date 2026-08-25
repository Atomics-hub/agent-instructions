export type InstructionProfileName =
  "agents-md" | "claude" | "gemini" | "copilot" | "universal";

export type InstructionKind =
  "agents" | "claude" | "gemini" | "copilot" | "modular" | "custom";

export type IssueSeverity = "info" | "warning" | "error";

export type IssueCode =
  | "broken-reference"
  | "budget-exceeded"
  | "competing-instructions"
  | "cyclic-reference"
  | "duplicate-instruction"
  | "file-too-large"
  | "invalid-frontmatter"
  | "outside-root"
  | "read-failed"
  | "reference-depth-exceeded"
  | "symlink-blocked";

export interface InstructionIssue {
  code: IssueCode;
  severity: IssueSeverity;
  message: string;
  path?: string;
  relatedPath?: string;
}

export interface InstructionCandidate {
  path: string;
  kind: InstructionKind;
  scope: string;
  origin: "project" | "global";
  priority: number;
  applyTo?: readonly string[];
}

export interface InstructionReference {
  from: string;
  path: string;
  depth: number;
}

export interface InstructionSource extends InstructionCandidate {
  relativePath: string;
  content: string;
  expandedContent: string;
  bytes: number;
  references: readonly InstructionReference[];
  targets: readonly string[];
}

export interface OmittedInstruction extends InstructionCandidate {
  reason: "budget" | "duplicate" | "not-applicable" | "unsafe";
}

export interface InstructionProfile {
  name: string;
  hierarchicalFiles: readonly {
    name: string;
    kind: InstructionKind;
  }[];
  repositoryFiles?: readonly {
    path: string;
    kind: InstructionKind;
  }[];
  modularDirectories?: readonly string[];
  references: boolean;
}

export interface ResolveInstructionsOptions {
  cwd?: string;
  root?: string;
  targets?: readonly string[];
  profile?: InstructionProfileName | InstructionProfile;
  expandReferences?: boolean;
  followSymlinks?: boolean;
  maxFileBytes?: number;
  maxTotalBytes?: number;
  maxReferenceDepth?: number;
  allowedReferenceRoots?: readonly string[];
  dedupe?: boolean;
}

export interface InstructionResolution {
  root: string;
  cwd: string;
  profile: string;
  targets: readonly string[];
  sources: readonly InstructionSource[];
  omitted: readonly OmittedInstruction[];
  issues: readonly InstructionIssue[];
  bytes: number;
}

export interface FormatInstructionsOptions {
  format?: "markdown" | "xml";
  includeProvenance?: boolean;
}

export interface LintInstructionsOptions extends ResolveInstructionsOptions {
  strict?: boolean;
}

export interface LintResult {
  resolution: InstructionResolution;
  ok: boolean;
  errorCount: number;
  warningCount: number;
}
