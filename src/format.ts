import { relative } from "node:path";

import type {
  FormatInstructionsOptions,
  InstructionResolution,
} from "./types.js";

export function formatInstructions(
  resolution: InstructionResolution,
  options: FormatInstructionsOptions = {},
): string {
  const format = options.format ?? "markdown";
  const includeProvenance = options.includeProvenance ?? true;

  if (format === "xml") {
    return formatXml(resolution, includeProvenance);
  }

  return formatMarkdown(resolution, includeProvenance);
}

export function explainInstructions(resolution: InstructionResolution): string {
  const lines = [
    `Profile: ${resolution.profile}`,
    `Root: ${resolution.root}`,
    `Targets: ${resolution.targets.map((target) => relative(resolution.root, target) || ".").join(", ")}`,
    `Included: ${resolution.sources.length} source(s), ${resolution.bytes} byte(s)`,
  ];

  for (const source of resolution.sources) {
    const applies =
      source.targets.length > 0 ? ` -> ${source.targets.join(", ")}` : "";
    lines.push(
      `  + ${source.relativePath} [${source.kind}; scope ${relative(resolution.root, source.scope) || "."}]${applies}`,
    );
  }

  for (const omitted of resolution.omitted) {
    lines.push(
      `  - ${relative(resolution.root, omitted.path)} [omitted: ${omitted.reason}]`,
    );
  }

  for (const issue of resolution.issues) {
    lines.push(`  ! ${issue.severity} ${issue.code}: ${issue.message}`);
  }

  return `${lines.join("\n")}\n`;
}

function formatMarkdown(
  resolution: InstructionResolution,
  includeProvenance: boolean,
): string {
  return resolution.sources
    .map((source) => {
      if (!includeProvenance) {
        return source.expandedContent.trim();
      }
      return [
        `<!-- agent-instructions: ${source.relativePath} -->`,
        source.expandedContent.trim(),
        `<!-- /agent-instructions: ${source.relativePath} -->`,
      ].join("\n");
    })
    .filter(Boolean)
    .join("\n\n");
}

function formatXml(
  resolution: InstructionResolution,
  includeProvenance: boolean,
): string {
  const body = resolution.sources
    .map((source) => {
      const path = includeProvenance
        ? ` path="${escapeXml(source.relativePath)}" kind="${source.kind}"`
        : "";
      return `  <instructions${path}>\n${indent(escapeXml(source.expandedContent.trim()))}\n  </instructions>`;
    })
    .join("\n");
  return `<agent-instructions profile="${escapeXml(resolution.profile)}">\n${body}\n</agent-instructions>`;
}

function indent(value: string): string {
  return value
    .split("\n")
    .map((line) => `    ${line}`)
    .join("\n");
}

function escapeXml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");
}
