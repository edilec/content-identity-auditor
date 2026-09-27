# Content Identity Auditor

[![CI](https://github.com/edilec/content-identity-auditor/actions/workflows/ci.yml/badge.svg)](https://github.com/edilec/content-identity-auditor/actions/workflows/ci.yml)
[![CodeQL](https://github.com/edilec/content-identity-auditor/actions/workflows/codeql.yml/badge.svg)](https://github.com/edilec/content-identity-auditor/actions/workflows/codeql.yml)
[![MIT License](https://img.shields.io/badge/license-MIT-0f766e.svg)](./LICENSE)

Content Identity Auditor is a dependency-free Node.js library and CLI that
detects content identity collisions and publication-cadence regressions before
they reach a site.

It normalizes routes, slugs, titles, and primary keywords; records existing
debt in a deterministic baseline; blocks new debt; and lets teams ratchet away
legacy problems without allowing them to return.

> **Maturity:** experimental `0.1.0`. The API and baseline schema may change
> before `1.0.0`. The package is not currently published to npm.

## Why it exists

Large editorial catalogs often accumulate collisions that cannot be fixed in
one release. A conventional uniqueness check either blocks the whole catalog
or ignores known problems forever. This tool takes a third approach:

- capture the currently deployed state as an explicit ceiling;
- fail new normalized route, slug, title, or primary-keyword collisions;
- flag new publication bursts beyond configured limits;
- allow teams to remove existing debt incrementally; and
- remember resolved collision pairs so they cannot be reintroduced.

The report is deterministically sorted, making it suitable for CI artifacts
and release comparisons.

## Non-goals

This tool does not:

- predict rankings, traffic, indexing, or content quality;
- crawl a website or make network requests;
- choose keywords, titles, publishing dates, or editorial strategy;
- resolve, fetch, or validate canonical declarations against rendered pages,
  redirects, or sitemaps (it compares the canonicals an inventory *declares*);
  or
- silently rewrite content or its baseline.

## Requirements

- Node.js 22 or newer
- JSON input using the documented catalog shape
- no runtime dependencies

## Catalog format

```json
{
  "items": [
    {
      "id": "GUIDE-001",
      "slug": "designing-reliable-webhooks",
      "title": "Designing reliable webhooks",
      "status": "published",
      "publishedAt": "2026-08-20",
      "intent": "implementation",
      "primaryKeyword": "reliable webhooks",
      "locale": "en",
      "canonical": "https://edilec.com/guides/designing-reliable-webhooks"
    }
  ]
}
```

Published items require `id`, canonical lowercase `slug`, `title`, a real
`YYYY-MM-DD` date, and either `primaryKeyword` or a non-empty `keywords` array.
New published items also require one of these intents: `commercial`,
`comparison`, `implementation`, or `informational`.

`locale` and `canonical` are optional.

Drafts participate in collision analysis as warnings but do not become
deployed baseline records.

### Locale scope

Identity dimensions split into two kinds:

| Dimension | Scope | Why |
| --- | --- | --- |
| `route`, `slug`, `canonical` | global | Address space. Two items cannot occupy one address, whatever locale they declare. |
| `title`, `primaryKeyword` | per locale | Editorial. A translated variant legitimately reuses a title or a target keyword. |

So an English and a German article that share the title *Pricing* are not a
collision, while two English articles that share it still are. An item with no
`locale` sits in the default scope, so a catalog that declares no locales
behaves exactly as it did before.

Existing baselines that recorded title or keyword collision debt before locale
scoping remain usable. The same recorded ID pairs remain accepted within a
locale; a new member or a retired pair coming back is still blocked. Newly
captured baselines record locale-scoped values directly.

### Canonical identity

When items declare `canonical`, two items claiming the same canonical address
are reported as `NEW_CANONICAL_COLLISION` — within one inventory, a canonical
should identify one piece of content. Comparison normalizes the parts that are
case-insensitive by definition (scheme and host) and drops the fragment, which
never identifies a separate document; path case is preserved because it can be
significant. Root-relative paths resolve dot segments as a browser would;
protocol-relative addresses are not accepted as root-relative paths.

A deliberate consolidation is accepted the same way any other known collision
is: record it in the baseline and the ratchet holds the line from there.

## CLI quick start

The included [synthetic catalog](./examples/catalog.json) contains no
production data.

```sh
node ./bin/content-identity-auditor.mjs capture \
  --content=examples/catalog.json \
  --output=baseline.json \
  --captured-at=2026-08-20

node ./bin/content-identity-auditor.mjs audit \
  --content=examples/catalog.json \
  --baseline=baseline.json \
  --today=2026-08-20
```

An audit exits with `0` when there are no blockers, `1` when the content gate
is blocked, and `2` for invalid commands, unreadable input, or malformed data.
Inputs are limited to 10 MiB.

After a clean deployment, advance the ratchet into a new file:

```sh
node ./bin/content-identity-auditor.mjs advance \
  --content=examples/catalog.json \
  --baseline=baseline.json \
  --output=baseline.next.json \
  --ratchet-at=2026-08-21
```

Output files are created with owner-only permissions (`0600`) on POSIX systems.
Review and commit the resulting baseline as deployment evidence. Never advance
from content that was not actually deployed.

### The destination is checked before anything is written

`--output` is checked before the first byte is written, and a destination that
cannot be written to safely is a configuration error: exit `2`, nothing on
stdout, and nothing on disk is touched.

| Refused | Why |
| --- | --- |
| The destination is a symbolic link | The output would land wherever the link points, not on the path you named. A link aimed at a path that does not exist yet is refused for the same reason: following it creates a file outside the tree. |
| Its parent resolves outside `--output-root` | A symlinked directory, or a `..` segment, on the way there does not widen the permitted tree. |
| It is the same file as `--content` or `--baseline` | Compared by device and inode, so a hard link to an input is still an input. This tool never rewrites what it reads. |
| It exists and is not a regular file | A directory is not an output file. |

`--output-root` declares the tree the output may be written into and defaults
to the working directory. Widen it deliberately when the baseline belongs
somewhere else; it has no meaning without `--output`.

Run `node ./bin/content-identity-auditor.mjs --help` for configuration options,
including the route prefix, title suffix, and publication limits.

## Library usage

```js
import {
  analyzeContentIdentity,
  createContentIdentityBaseline,
} from 'content-identity-auditor'

const baseline = createContentIdentityBaseline(catalog, {
  capturedAt: '2026-08-20',
  routePrefix: '/guides',
  titleSuffix: ' | Example',
  publicationLimits: { perDay: 2, per7Days: 5, per30Days: 15 },
})

const report = analyzeContentIdentity(candidateCatalog, baseline, {
  today: '2026-08-21',
})

if (report.blockers.length) {
  throw new Error(`Content gate blocked: ${report.blockers.length} finding(s)`)
}
```

TypeScript declarations are included. The package exports baseline creation,
analysis, assertion, advancement, normalization, formatting, and deterministic
serialization helpers.

## What is blocked

| Finding family | Meaning |
| --- | --- |
| `NEW_NORMALIZED_*_COLLISION` | A route, slug, or punctuation-insensitive title collision exceeds the captured ceiling. |
| `WORSENED_PRIMARY_KEYWORD_CLUSTER` | A normalized primary-keyword cluster gains an unexpected member. |
| `ADDED_PUBLICATION_*_BURST_DEBT` | A daily, seven-day, or thirty-day window exceeds its last-deployed debt. |
| `BACKDATED_NEW_ITEM` / `FUTURE_NEW_ITEM` | A never-deployed item uses a date outside the allowed release interval. |
| `FUTURE_BASELINE_ITEM` | A captured baseline claims an item was published after the capture date. |
| `CHANGED_LEGACY_PUBLISHED_DATE` | A deployed item changes its recorded publication date. |
| Record validation findings | Required identity, status, date, or keyword data is absent or unsafe. |

Draft collision findings are warnings so editors can resolve them before
publication.

## Baseline lifecycle

1. Capture once from a verified deployed catalog.
2. Store the baseline with the project that owns the catalog.
3. Audit every candidate release against that baseline.
4. Deploy only a passing catalog.
5. Advance the ratchet after deployment and review the baseline diff.

The baseline is evidence, not a cache. Replacing it with a fresh capture can
erase the record of retired debt and should require the same review as a policy
change.

## Development

```sh
npm test
npm run test:coverage
npm run pack:check
npm run check
```

`npm run check` validates syntax, runs the test suite with coverage thresholds,
and inspects the npm package contents. See [CONTRIBUTING.md](./CONTRIBUTING.md)
before proposing changes.

## Security and limitations

The CLI reads local JSON files, performs in-memory analysis, and writes only to
stdout or an explicitly selected output path. It does not use the network or
execute content from the catalog. Read the complete [security
policy](./SECURITY.md), including the resource-exhaustion limitation for deeply
nested input.

## Provenance

This repository is a generalized extraction from content-identity controls
owned by Edilec Private Limited. Production content, deployed baselines, site
configuration, and internal release logic are deliberately excluded. The exact
lineage and exclusions are documented in [PROVENANCE.md](./PROVENANCE.md).

## Support and licence

Use [SUPPORT.md](./SUPPORT.md) for public support boundaries and
[SECURITY.md](./SECURITY.md) for private vulnerability reporting.

Licensed under the [MIT License](./LICENSE). Copyright © 2026 Edilec Private
Limited.

Maintained by [Edilec](https://edilec.com/).
