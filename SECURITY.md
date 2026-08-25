# Security

## Supported versions

Security fixes are released for the latest major version.

## Reporting

Please report vulnerabilities privately through GitHub Security Advisories for this repository. Do not open a public issue containing an exploit or sensitive repository content.

## Trust boundary

Instruction files, paths, frontmatter, references, and symlinks are untrusted input. `agent-instructions` returns text and metadata; it does not execute content, invoke tools, or contact a model.

References are restricted to `.md` and `.txt` files under the project root by default. Symlinks are blocked unless `followSymlinks` is enabled, and followed links must resolve under an allowed root. `allowedReferenceRoots` deliberately expands the read boundary and should only contain trusted directories.

Consumers remain responsible for deciding whether resolved instruction text may enter a model context and what capabilities that model may use.
