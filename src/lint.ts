import { resolveInstructions } from "./resolver.js";
import type { LintInstructionsOptions, LintResult } from "./types.js";

export async function lintInstructions(
  options: LintInstructionsOptions = {},
): Promise<LintResult> {
  const resolution = await resolveInstructions(options);
  const errorCount = resolution.issues.filter(
    (issue) => issue.severity === "error",
  ).length;
  const warningCount = resolution.issues.filter(
    (issue) => issue.severity === "warning",
  ).length;
  return {
    resolution,
    errorCount,
    warningCount,
    ok: errorCount === 0 && (!(options.strict ?? false) || warningCount === 0),
  };
}
