export { formatInstructions, explainInstructions } from "./format.js";
export { matchesAnyGlob, matchesGlob } from "./glob.js";
export { lintInstructions } from "./lint.js";
export {
  discoverInstructions,
  findInstructionRoot,
  resolveInstructions,
} from "./resolver.js";
export { getInstructionProfile, instructionProfiles } from "./profiles.js";
export type {
  FormatInstructionsOptions,
  InstructionCandidate,
  InstructionIssue,
  InstructionKind,
  InstructionProfile,
  InstructionProfileName,
  InstructionReference,
  InstructionResolution,
  InstructionSource,
  IssueCode,
  IssueSeverity,
  LintInstructionsOptions,
  LintResult,
  OmittedInstruction,
  ResolveInstructionsOptions,
} from "./types.js";
