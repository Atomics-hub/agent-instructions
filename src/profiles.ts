import type { InstructionProfile, InstructionProfileName } from "./types.js";

const profiles: Record<InstructionProfileName, InstructionProfile> = {
  "agents-md": {
    name: "agents-md",
    hierarchicalFiles: [{ name: "AGENTS.md", kind: "agents" }],
    references: false,
  },
  claude: {
    name: "claude",
    hierarchicalFiles: [
      { name: "CLAUDE.md", kind: "claude" },
      { name: "CLAUDE.local.md", kind: "claude" },
    ],
    repositoryFiles: [{ path: ".claude/CLAUDE.md", kind: "claude" }],
    modularDirectories: [".claude/rules"],
    references: true,
  },
  gemini: {
    name: "gemini",
    hierarchicalFiles: [{ name: "GEMINI.md", kind: "gemini" }],
    references: true,
  },
  copilot: {
    name: "copilot",
    hierarchicalFiles: [
      { name: "AGENTS.md", kind: "agents" },
      { name: "CLAUDE.md", kind: "claude" },
      { name: "GEMINI.md", kind: "gemini" },
    ],
    repositoryFiles: [
      { path: ".github/copilot-instructions.md", kind: "copilot" },
    ],
    modularDirectories: [".github/instructions"],
    references: true,
  },
  universal: {
    name: "universal",
    hierarchicalFiles: [
      { name: "AGENTS.md", kind: "agents" },
      { name: "AGENTS.local.md", kind: "agents" },
      { name: "CLAUDE.md", kind: "claude" },
      { name: "CLAUDE.local.md", kind: "claude" },
      { name: "GEMINI.md", kind: "gemini" },
    ],
    repositoryFiles: [
      { path: ".github/copilot-instructions.md", kind: "copilot" },
      { path: ".claude/CLAUDE.md", kind: "claude" },
    ],
    modularDirectories: [".github/instructions", ".claude/rules"],
    references: true,
  },
};

export const instructionProfiles: Readonly<
  Record<InstructionProfileName, InstructionProfile>
> = Object.freeze(profiles);

export function getInstructionProfile(
  profile: InstructionProfileName | InstructionProfile = "universal",
): InstructionProfile {
  if (typeof profile !== "string") {
    validateProfile(profile);
    return profile;
  }

  return instructionProfiles[profile];
}

function validateProfile(profile: InstructionProfile): void {
  if (profile.name.trim() === "") {
    throw new TypeError("Instruction profile name cannot be empty");
  }

  for (const candidate of profile.hierarchicalFiles) {
    if (
      candidate.name === "" ||
      candidate.name.includes("/") ||
      candidate.name.includes("\\") ||
      candidate.name === "." ||
      candidate.name === ".."
    ) {
      throw new TypeError(
        `Hierarchical instruction candidate must be a file name: ${candidate.name}`,
      );
    }
  }

  for (const candidate of profile.repositoryFiles ?? []) {
    validateRelativePath(candidate.path, "Repository instruction candidate");
  }
  for (const directory of profile.modularDirectories ?? []) {
    validateRelativePath(directory, "Modular instruction directory");
  }
}

function validateRelativePath(value: string, label: string): void {
  const segments = value.replaceAll("\\", "/").split("/");
  if (
    value === "" ||
    value.startsWith("/") ||
    segments.some(
      (segment) => segment === "" || segment === "." || segment === "..",
    )
  ) {
    throw new TypeError(`${label} must be a safe relative path: ${value}`);
  }
}
