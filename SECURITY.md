# Security policy

## Supported versions

This repository is a `0.1.x` release candidate. Security fixes are considered
for the latest tagged `0.1.x` release and the default branch. No older-version
support promise is made before `1.0.0`.

## System and scope

Content Identity Auditor is a local Node.js library and CLI. It accepts JSON
catalog and baseline files, normalizes selected string fields, performs
in-memory comparisons, and emits a report or a new baseline. It is not a hosted
service and makes no network requests.

Security-sensitive code includes:

- local file validation and the 10 MiB CLI input limit;
- baseline schema and invariant validation;
- deterministic serialization and finding generation;
- explicit output-path handling; and
- GitHub Actions workflows in `.github/workflows/`.

## Threat model and trust boundaries

Catalogs and baselines may be attacker-controlled. Their strings, object keys,
array sizes, dates, and nesting must be treated as untrusted data. They must not
be evaluated as code, passed to a shell, interpreted as a network location, or
used to bypass baseline invariants.

The invoking user, local Node.js runtime, filesystem permissions, command-line
paths, and project configuration are trusted. The caller is responsible for
choosing which local files the process may read and where it may write.

## Security invariants

- The CLI must not execute catalog or baseline content.
- The library and CLI must not make network requests or start child processes.
- CLI input files must be regular files no larger than 10 MiB at read time.
- Malformed records, incompatible schemas, invalid configuration, and corrupt
  baselines must fail closed rather than silently weaken the gate.
- Diagnostics must not echo catalog or baseline content. A JSON parse failure
  is reported by position, line and column; V8's own message quotes the document
  it choked on, so that quoted copy is stripped before the error is raised.
- Output may be written only to stdout or an explicit `--output` path. New
  output files retain owner-only permissions (`0600`) on POSIX systems.
- A failed audit must produce a non-zero exit code.
- Retired collision pairs must not be silently reintroduced by baseline
  advancement.
- Workflows must use minimum permissions and pin third-party actions to full
  commit SHAs.

## Reportable findings and severity context

Report issues that allow untrusted JSON to execute code, access unintended
files, trigger network activity, bypass a documented blocker, corrupt or weaken
the ratchet without an error, or overwrite an unintended path. Severity depends
on realistic reachability, required caller privileges, and whether the issue
can affect a CI release decision or local data.

## Known limitations and out-of-scope behavior

- The 10 MiB limit bounds input bytes, not the computational complexity of
  every valid JSON shape. Deeply nested or adversarial data within that limit
  may still consume substantial CPU or memory or exceed the JavaScript stack.
  Run the CLI with ordinary CI resource limits when processing untrusted files.
- The library API does not enforce a byte limit because it receives already
  parsed JavaScript objects. Callers that accept remote data must impose their
  own transport and parser limits.
- The tool does not provide filesystem sandboxing. Reading or replacing a path
  intentionally supplied by the local caller is not a sandbox escape.
- Incorrect editorial policy, misleading content, search-engine outcomes, and
  weaknesses in the caller's deployment pipeline are outside this package's
  security boundary.
- Vulnerabilities in Node.js or GitHub-hosted actions that are not caused by
  this repository should be reported upstream unless this project introduces a
  concrete exploitable use.

These limitations are not authorization to suppress a reachable vulnerability
that breaks one of the invariants above.

## Report a vulnerability privately

Do not open a public issue, discussion, or pull request for a suspected
vulnerability. Email [hello@edilec.com](mailto:hello@edilec.com) with the
subject **Security report: content-identity-auditor** and include:

- the affected version or commit;
- security impact and conditions required to reproduce it;
- a minimal, non-destructive reproduction; and
- expected and observed behavior.

Do not send credentials, production catalogs, customer data, or third-party
personal information. If GitHub private vulnerability reporting is enabled for
the repository, its **Security** tab may be used instead.

This policy does not create a bug-bounty program or authorize testing systems
outside code and data you own or have permission to assess.
