const regexSpecial = /[\\^$+?.()|[\]{}]/g;

export function matchesGlob(path: string, pattern: string): boolean {
  const normalizedPath = normalizeGlobPath(path);
  return expandBraces(pattern).some((expanded) =>
    globToRegExp(normalizeGlobPath(expanded)).test(normalizedPath),
  );
}

export function matchesAnyGlob(
  path: string,
  patterns: readonly string[],
): boolean {
  return patterns.some((pattern) => matchesGlob(path, pattern));
}

function normalizeGlobPath(value: string): string {
  return value.replaceAll("\\", "/").replace(/^\.\//, "");
}

function globToRegExp(pattern: string): RegExp {
  let source = "^";

  for (let index = 0; index < pattern.length; index += 1) {
    const character = pattern[index];

    if (character === "*") {
      const next = pattern[index + 1];
      if (next === "*") {
        const afterDouble = pattern[index + 2];
        index += 1;
        if (afterDouble === "/") {
          index += 1;
          source += "(?:.*/)?";
        } else {
          source += ".*";
        }
      } else {
        source += "[^/]*";
      }
      continue;
    }

    if (character === "?") {
      source += "[^/]";
      continue;
    }

    if (character === "[") {
      const closing = pattern.indexOf("]", index + 1);
      if (closing > index + 1) {
        let body = pattern.slice(index + 1, closing);
        const negated = body.startsWith("!") || body.startsWith("^");
        if (negated) {
          body = body.slice(1);
        }
        if (body !== "") {
          const escaped = body
            .replaceAll("\\", "\\\\")
            .replaceAll("[", "\\[")
            .replaceAll("^", "\\^");
          source += `[${negated ? "^" : ""}${escaped}]`;
          index = closing;
          continue;
        }
      }
    }

    source += (character ?? "").replace(regexSpecial, "\\$&");
  }

  try {
    return new RegExp(`${source}$`, "u");
  } catch {
    return /$a/u;
  }
}

function expandBraces(pattern: string): string[] {
  const match = /\{([^{}]+)\}/u.exec(pattern);
  if (match === null) {
    return [pattern];
  }

  const [whole, alternatives = ""] = match;
  const before = pattern.slice(0, match.index);
  const after = pattern.slice(match.index + whole.length);
  return alternatives
    .split(",")
    .flatMap((alternative) => expandBraces(`${before}${alternative}${after}`));
}
