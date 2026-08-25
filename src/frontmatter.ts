export interface ParsedFrontmatter {
  content: string;
  applyTo: readonly string[];
  hasFrontmatter: boolean;
  valid: boolean;
}

export function parseInstructionFrontmatter(source: string): ParsedFrontmatter {
  const normalized = source.replaceAll("\r\n", "\n");
  if (!normalized.startsWith("---\n")) {
    return {
      content: source,
      applyTo: [],
      hasFrontmatter: false,
      valid: true,
    };
  }

  const end = normalized.indexOf("\n---\n", 4);
  if (end === -1) {
    return {
      content: source,
      applyTo: [],
      hasFrontmatter: true,
      valid: false,
    };
  }

  const header = normalized.slice(4, end);
  const content = normalized.slice(end + 5);
  const applyTo = parsePathSelectors(header);
  return { content, applyTo, hasFrontmatter: true, valid: true };
}

function parsePathSelectors(header: string): string[] {
  const lines = header.split("\n");
  const result: string[] = [];

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index] ?? "";
    const match = /^(?:applyTo|paths)\s*:\s*(.*)$/u.exec(line);
    if (match === null) {
      continue;
    }

    const raw = (match[1] ?? "").trim();
    if (raw !== "") {
      result.push(...parseInlineList(raw));
      continue;
    }

    for (let child = index + 1; child < lines.length; child += 1) {
      const item = /^\s+-\s+(.+)$/u.exec(lines[child] ?? "");
      if (item === null) {
        break;
      }
      result.push(unquote((item[1] ?? "").trim()));
      index = child;
    }
  }

  return result.map((entry) => entry.trim()).filter(Boolean);
}

function parseInlineList(value: string): string[] {
  const withoutBrackets =
    value.startsWith("[") && value.endsWith("]") ? value.slice(1, -1) : value;
  return splitCommaAware(withoutBrackets).map((entry) => unquote(entry.trim()));
}

function splitCommaAware(value: string): string[] {
  const result: string[] = [];
  let current = "";
  let braceDepth = 0;
  let quote: '"' | "'" | undefined;

  for (const character of value) {
    if ((character === '"' || character === "'") && quote === undefined) {
      quote = character;
      current += character;
    } else if (character === quote) {
      quote = undefined;
      current += character;
    } else if (quote === undefined && character === "{") {
      braceDepth += 1;
      current += character;
    } else if (quote === undefined && character === "}") {
      braceDepth = Math.max(0, braceDepth - 1);
      current += character;
    } else if (quote === undefined && braceDepth === 0 && character === ",") {
      result.push(current);
      current = "";
    } else {
      current += character;
    }
  }
  result.push(current);
  return result;
}

function unquote(value: string): string {
  if (
    (value.startsWith('"') && value.endsWith('"')) ||
    (value.startsWith("'") && value.endsWith("'"))
  ) {
    return value.slice(1, -1);
  }
  return value;
}
