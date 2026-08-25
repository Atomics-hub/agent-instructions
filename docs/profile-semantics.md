# Profile semantics

Profiles are explicit interoperability presets. They do not emulate proprietary client internals.

## Scopes and precedence

Repository files have project scope. Hierarchical files apply to targets inside their containing directory and are ordered from the project root toward the target. Modular files apply to all targets unless frontmatter contains a selector.

The parser recognizes Copilot-style `applyTo` and Claude-style `paths` keys in either inline or YAML-list form. Only these keys are interpreted; other frontmatter is preserved as metadata but does not alter resolution.

When several target paths are supplied, shared candidates appear once and record every applicable target. Lexical ordering makes modular discovery stable across filesystems.

## References

Profiles with references enabled expand whitespace-delimited `@path.md` and `@path.txt` references. Resolution is relative to the referring file. The original token remains in output when an import is blocked or unreadable, and an issue records the reason.

## Deliberate exclusions

Global user instruction files are not loaded. Their locations and trust boundaries vary across products and machines. Callers can resolve those separately or define a custom profile without silently mixing machine state into a project result.
