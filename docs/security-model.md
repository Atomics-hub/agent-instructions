# Security model

The resolver assumes every repository file may be attacker-controlled.

## Defaults

- targets must be descendants of the project root;
- referenced files must be descendants of an allowed reference root;
- symlinks are blocked;
- each source is capped at 1 MiB;
- expanded output is capped at 256 KiB;
- recursive references are capped at eight levels;
- imports only recognize `.md` and `.txt` paths;
- content is returned as data and never executed.

Filesystem size checks happen before and after reading to reduce race exposure. Canonical paths are checked when following symlinks. Cycles are detected against the canonical expansion stack.

## Opting into broader reads

`followSymlinks: true` still requires the resolved destination to remain under an allowed root. `allowedReferenceRoots` can permit shared instruction directories outside the repository. Supplying it means the caller trusts those directories and accepts that their contents may enter the result.

## Non-goals

The package does not determine whether instruction text is truthful or safe for a privileged agent. Prompt injection is a policy and capability problem beyond file resolution. Consumers should retain provenance, restrict agent permissions, and treat issues as security signals.
