import assert from 'node:assert/strict'
import test from 'node:test'
import {
  AUDIT_SCHEMA,
  BASELINE_SCHEMA,
  NORMALIZATION_VERSION,
  advanceContentIdentityBaseline,
  analyzeContentIdentity,
  assertContentIdentity,
  createContentIdentityBaseline,
  describeJsonParseFailure,
  formatContentIdentityReport,
  normalizeContentRoute,
  normalizeContentSlug,
  normalizeContentTitle,
  normalizeContentTopic,
  serializeContentIdentityReport,
} from '../src/index.mjs'

function item(id, overrides = {}) {
  const token = String(id).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'item'
  return {
    id,
    slug: `guide-${token}`,
    title: `Guide ${id}`,
    status: 'published',
    publishedAt: '2026-08-10',
    intent: 'informational',
    primaryKeyword: `keyword ${id}`,
    ...overrides,
  }
}

function catalog(...items) {
  return { items }
}

function codes(result) {
  return new Set(result.blockers.map((finding) => finding.code))
}

test('normalizers are Unicode-aware, punctuation-insensitive, and configurable', () => {
  assert.equal(normalizeContentTopic('  Café & APIs! '), 'café and apis')
  assert.equal(normalizeContentTitle('Builder’s Guide — 2026'), 'builders guide 2026')
  assert.equal(normalizeContentSlug(' Builder’s Guide & API '), 'builders-guide-and-api')
  assert.equal(normalizeContentRoute({ id: 'GUIDE_1', slug: 'api-basics' }, { routePrefix: '/library/guides' }), '/library/guides/guide-1/api-basics/')
  assert.throws(() => normalizeContentRoute(item('A'), { routePrefix: 'relative' }), /routePrefix/)
})

test('baseline and audit output are deterministic regardless of item order', () => {
  const items = [
    item('B', { slug: 'legacy', title: 'Legacy: title', primaryKeyword: 'shared', publishedAt: '2026-08-01' }),
    item('A', { slug: 'legacy', title: 'Legacy — title!', primaryKeyword: 'shared', publishedAt: '2026-08-01' }),
  ]
  const options = { capturedAt: '2026-08-10', routePrefix: '/notes', titleSuffix: ' | Example' }
  const baseline = createContentIdentityBaseline(catalog(...items), options)
  const reverse = createContentIdentityBaseline(catalog(...[...items].reverse()), options)
  assert.equal(baseline.schema, BASELINE_SCHEMA)
  assert.equal(baseline.normalizationVersion, NORMALIZATION_VERSION)
  assert.equal(serializeContentIdentityReport(baseline), serializeContentIdentityReport(reverse))

  const result = analyzeContentIdentity(catalog(...items), baseline, { today: '2026-08-10' })
  const reversedResult = analyzeContentIdentity(catalog(...[...items].reverse()), baseline, { today: '2026-08-10' })
  assert.equal(result.schema, AUDIT_SCHEMA)
  assert.equal(result.blockers.length, 0)
  assert.equal(serializeContentIdentityReport(result), serializeContentIdentityReport(reversedResult))
  assert.match(formatContentIdentityReport(result), /^Content identity gate: PASS/m)
})

test('new normalized route, slug, title, and keyword collisions block publication', () => {
  const legacy = item('GUIDE_1', {
    slug: 'api-operations',
    title: 'API: Operations',
    primaryKeyword: 'API operations',
    publishedAt: '2026-08-01',
  })
  const baseline = createContentIdentityBaseline(catalog(legacy), { capturedAt: '2026-08-05' })
  const newcomer = item('guide-1', {
    slug: 'api-operations',
    title: 'API — Operations!',
    primaryKeyword: 'API Operations!',
    publishedAt: '2026-08-06',
  })
  const result = analyzeContentIdentity(catalog(legacy, newcomer), baseline, { today: '2026-08-07' })
  for (const code of [
    'NEW_NORMALIZED_ROUTE_COLLISION',
    'NEW_NORMALIZED_SLUG_COLLISION',
    'NEW_PUNCTUATION_INSENSITIVE_TITLE_COLLISION',
    'WORSENED_PRIMARY_KEYWORD_CLUSTER',
  ]) assert.ok(codes(result).has(code), `expected ${code}`)
})

test('invalid records, identifiers, slugs, titles, statuses, dates, and keywords fail closed', () => {
  const baseline = createContentIdentityBaseline(catalog(item('BASE')), { capturedAt: '2026-08-10' })
  const invalid = catalog(
    null,
    item('', { slug: 'blank-id' }),
    item('bad/id', { slug: 'bad-id' }),
    item('NO-SLUG', { slug: '' }),
    item('BAD-SLUG', { slug: 'Bad Slug!' }),
    item('NO-TITLE', { title: '' }),
    item('PUNCT', { title: '!!!' }),
    item('STATUS', { status: 'publshed' }),
    item('DATE', { publishedAt: '2026-02-30' }),
    item('KEYWORD', { primaryKeyword: '', keywords: [] }),
    item('KEYWORD-TYPE', { primaryKeyword: 999, keywords: [999] }),
    item('KEYWORD-PUNCT', { primaryKeyword: '!!!' }),
    item('DUPLICATE'),
    item('duplicate', { slug: 'another-duplicate' }),
  )
  const result = analyzeContentIdentity(invalid, baseline, { today: '2026-08-10' })
  for (const code of [
    'INVALID_CONTENT_RECORD', 'MISSING_ITEM_ID', 'UNSAFE_ITEM_ID', 'MISSING_SLUG', 'UNSAFE_SLUG',
    'MISSING_TITLE', 'UNSAFE_TITLE', 'INVALID_STATUS', 'INVALID_PUBLISHED_DATE',
    'MISSING_PRIMARY_KEYWORD', 'INVALID_PRIMARY_KEYWORD_TYPE', 'INVALID_KEYWORDS_TYPE',
    'UNSAFE_PRIMARY_KEYWORD', 'DUPLICATE_ID',
  ]) assert.ok(codes(result).has(code), `expected ${code}`)
  assert.throws(() => createContentIdentityBaseline(invalid, { capturedAt: '2026-08-10' }), /invalid content identity baseline/)
})

test('draft collisions warn but do not block an otherwise valid catalog', () => {
  const published = item('A', { slug: 'shared', title: 'Shared title', primaryKeyword: 'shared keyword' })
  const baseline = createContentIdentityBaseline(catalog(published), { capturedAt: '2026-08-10' })
  const draft = item('DRAFT', {
    slug: 'shared',
    title: 'Shared: title!',
    status: 'draft',
    publishedAt: undefined,
    primaryKeyword: 'shared keyword',
  })
  const result = analyzeContentIdentity(catalog(published, draft), baseline, { today: '2026-08-10' })
  assert.equal(result.blockers.length, 0)
  assert.deepEqual(new Set(result.warnings.map((warning) => warning.code)), new Set([
    'DRAFT_SLUG_COLLISION',
    'DRAFT_TITLE_COLLISION',
    'DRAFT_PRIMARY_KEYWORD_COLLISION',
  ]))
})

test('new items require intent and cannot be backdated or future-dated', () => {
  const legacy = item('A', { publishedAt: '2026-08-10' })
  const baseline = createContentIdentityBaseline(catalog(legacy), { capturedAt: '2026-08-10' })
  const result = analyzeContentIdentity(catalog(
    legacy,
    item('BACK', { publishedAt: '2026-08-09', intent: '' }),
    item('FUTURE', { publishedAt: '2026-08-12', intent: 'unknown' }),
  ), baseline, { today: '2026-08-11' })
  assert.ok(codes(result).has('INVALID_NEW_INTENT'))
  assert.ok(codes(result).has('BACKDATED_NEW_ITEM'))
  assert.ok(codes(result).has('FUTURE_NEW_ITEM'))
})

test('space-padded status and publication dates cannot bypass identity or cadence checks', () => {
  const legacy = item('A', { publishedAt: '2026-08-10' })
  const baseline = createContentIdentityBaseline(catalog(legacy), {
    capturedAt: '2026-08-10',
    publicationLimits: { perDay: 1, per7Days: 1, per30Days: 1 },
  })
  const result = analyzeContentIdentity(catalog(
    legacy,
    item('PADDED-STATUS', { status: ' published ', publishedAt: '2026-08-10' }),
    item('PADDED-DATE', { publishedAt: ' 2026-08-10 ' }),
  ), baseline, { today: '2026-08-10' })
  assert.ok(codes(result).has('INVALID_STATUS'))
  assert.ok(codes(result).has('INVALID_PUBLISHED_DATE'))
  assert.ok(result.blockers.length > 0)
})

test('baseline capture rejects future content and advancement uses one coherent date', () => {
  assert.throws(
    () => createContentIdentityBaseline(catalog(item('FUTURE', { publishedAt: '2026-08-11' })), { capturedAt: '2026-08-10' }),
    (error) => error instanceof Error && error.result.blockers.some((finding) => finding.code === 'FUTURE_BASELINE_ITEM'),
  )
  const legacy = item('A', { publishedAt: '2026-08-10' })
  const baseline = createContentIdentityBaseline(catalog(legacy), { capturedAt: '2026-08-10' })
  assert.throws(
    () => advanceContentIdentityBaseline(catalog(legacy), baseline, { ratchetUpdatedAt: '2026-08-11', today: '2026-08-12' }),
    /today must match ratchetUpdatedAt/,
  )
  assert.throws(
    () => advanceContentIdentityBaseline(catalog(legacy, item('FUTURE', { publishedAt: '2026-08-12' })), baseline, { ratchetUpdatedAt: '2026-08-11' }),
    /blocked/,
  )
})

test('non-string identity fields and inherited property names fail safely', () => {
  const invalid = catalog({
    id: 123,
    slug: 456,
    title: 789,
    status: 'published',
    publishedAt: '2026-08-10',
    primaryKeyword: 999,
  })
  assert.throws(
    () => createContentIdentityBaseline(invalid, { capturedAt: '2026-08-10' }),
    (error) => error instanceof Error && new Set(error.result.blockers.map((finding) => finding.code)).has('INVALID_ITEM_ID_TYPE'),
  )

  const baseline = createContentIdentityBaseline(catalog(item('BASE')), { capturedAt: '2026-08-10' })
  const reservedName = item('toString', { publishedAt: '2026-08-10' })
  const result = analyzeContentIdentity(catalog(item('BASE'), reservedName), baseline, { today: '2026-08-10' })
  assert.equal(result.newPublishedItems, 1)
  assert.equal(result.blockers.some((finding) => finding.code === 'CHANGED_LEGACY_PUBLISHED_DATE'), false)
})

test('changing a deployed publication date is blocked', () => {
  const legacy = item('A', { publishedAt: '2026-08-01' })
  const baseline = createContentIdentityBaseline(catalog(legacy), { capturedAt: '2026-08-10' })
  const result = analyzeContentIdentity(catalog({ ...legacy, publishedAt: '2026-08-02' }), baseline, { today: '2026-08-10' })
  assert.ok(codes(result).has('CHANGED_LEGACY_PUBLISHED_DATE'))
})

test('publication bursts are ratcheted across daily, seven-day, and thirty-day windows', () => {
  const legacy = item('A', { publishedAt: '2026-08-01' })
  const baseline = createContentIdentityBaseline(catalog(legacy), {
    capturedAt: '2026-08-01',
    publicationLimits: { perDay: 1, per7Days: 1, per30Days: 1 },
  })
  const newcomer = item('B', { publishedAt: '2026-08-01' })
  const result = analyzeContentIdentity(catalog(legacy, newcomer), baseline, { today: '2026-08-01' })
  for (const code of [
    'ADDED_PUBLICATION_DAY_BURST_DEBT',
    'ADDED_PUBLICATION_7_DAY_BURST_DEBT',
    'ADDED_PUBLICATION_30_DAY_BURST_DEBT',
  ]) assert.ok(codes(result).has(code), `expected ${code}`)
})

test('resolved collision debt is allowed, recorded, and cannot be reintroduced after advance', () => {
  const legacy = ['A', 'B', 'C'].map((id) => item(id, {
    slug: 'shared', title: 'Shared title', primaryKeyword: 'shared', publishedAt: '2026-08-01',
  }))
  const baseline = createContentIdentityBaseline(catalog(...legacy), { capturedAt: '2026-08-01' })
  const improved = catalog(...legacy.slice(0, 2))
  const result = analyzeContentIdentity(improved, baseline, { today: '2026-08-02' })
  assert.equal(result.blockers.length, 0)
  assert.deepEqual(result.resolvedLegacyDebt.slug, { groups: 1, items: 1, pairs: 2 })

  const advanced = advanceContentIdentityBaseline(improved, baseline, { ratchetUpdatedAt: '2026-08-02' })
  assert.equal(advanced.lastDeployedItemCount, 2)
  const reintroduced = analyzeContentIdentity(catalog(...legacy), advanced, { today: '2026-08-03' })
  assert.ok(codes(reintroduced).has('NEW_NORMALIZED_SLUG_COLLISION'))
  assert.throws(() => advanceContentIdentityBaseline(catalog(...legacy), advanced, { ratchetUpdatedAt: '2026-08-03' }), /blocked/)
})

test('resolved publication debt cannot return after advance', () => {
  const legacy = ['A', 'B', 'C'].map((id) => item(id, { publishedAt: '2026-08-01' }))
  const baseline = createContentIdentityBaseline(catalog(...legacy), { capturedAt: '2026-08-01' })
  const improved = catalog(...legacy.slice(0, 2))
  const advanced = advanceContentIdentityBaseline(improved, baseline, { ratchetUpdatedAt: '2026-08-02' })
  const result = analyzeContentIdentity(catalog(...legacy), advanced, { today: '2026-08-03' })
  assert.ok(codes(result).has('ADDED_PUBLICATION_DAY_BURST_DEBT'))
})

test('assert helper returns a passing report and attaches a blocked report to errors', () => {
  const legacy = item('A')
  const baseline = createContentIdentityBaseline(catalog(legacy), { capturedAt: '2026-08-10' })
  assert.equal(assertContentIdentity(catalog(legacy), baseline, { today: '2026-08-10' }).blockers.length, 0)
  assert.throws(
    () => assertContentIdentity(catalog(legacy, item('B', { slug: legacy.slug })), baseline, { today: '2026-08-10' }),
    (error) => error instanceof Error && error.result.blockers.length > 0,
  )
})

test('catalog, dates, limits, route prefix, and title suffix are validated', () => {
  assert.throws(() => createContentIdentityBaseline({}, { capturedAt: '2026-08-10' }), /items array/)
  assert.throws(() => createContentIdentityBaseline(catalog(item('A')), { capturedAt: 'not-a-date' }), /capturedAt/)
  assert.throws(() => createContentIdentityBaseline(catalog(item('A')), { capturedAt: '2026-08-10', routePrefix: '/Bad' }), /routePrefix/)
  assert.throws(() => createContentIdentityBaseline(catalog(item('A')), { capturedAt: '2026-08-10', titleSuffix: 'x'.repeat(201) }), /titleSuffix/)
  for (const publicationLimits of [{ perDay: 0 }, { per7Days: 1.5 }, { per30Days: -1 }]) {
    assert.throws(() => createContentIdentityBaseline(catalog(item('A')), { capturedAt: '2026-08-10', publicationLimits }), /positive integer/)
  }
})

test('malformed and incompatible baselines fail closed', () => {
  const baseline = createContentIdentityBaseline(catalog(item('A')), { capturedAt: '2026-08-10' })
  const attempts = [
    null,
    { ...baseline, schema: 'unknown' },
    { ...baseline, normalizationVersion: 'unknown' },
    { ...baseline, capturedAt: 'bad' },
    { ...baseline, ratchetUpdatedAt: '2026-08-01' },
    { ...baseline, config: { ...baseline.config, routePrefix: '/Bad' } },
    { ...baseline, itemCount: -1 },
    { ...baseline, lastDeployedItemCount: -1 },
    { ...baseline, publishedAtById: [] },
    { ...baseline, publishedAtById: { 'bad/id': '2026-08-10' } },
    { ...baseline, publishedAtById: { A: '2099-01-01' } },
    { ...baseline, legacyCollisionGroups: { ...baseline.legacyCollisionGroups, slug: null } },
    { ...baseline, retiredCollisionPairs: { ...baseline.retiredCollisionPairs, slug: null } },
    { ...baseline, legacyPublicationBursts: { ...baseline.legacyPublicationBursts, day: null } },
    { ...baseline, lastDeployedPublicationBursts: { ...baseline.lastDeployedPublicationBursts, day: null } },
  ]
  for (const attempt of attempts) assert.throws(() => analyzeContentIdentity(catalog(item('A')), attempt, { today: '2026-08-10' }))
  assert.throws(() => analyzeContentIdentity({}, baseline, { today: '2026-08-10' }), /items array/)
  assert.throws(() => analyzeContentIdentity(catalog(item('A')), baseline, { today: 'bad' }), /today/)
  assert.throws(() => advanceContentIdentityBaseline(catalog(item('A')), baseline, { ratchetUpdatedAt: '2026-08-01' }), /non-decreasing/)
})

test('collision pairs and burst ceilings in a baseline are structurally ratcheted', () => {
  const colliding = [
    item('GUIDE_1', { slug: 'shared', title: 'Shared', primaryKeyword: 'shared', publishedAt: '2026-08-01' }),
    item('guide-1', { slug: 'shared', title: 'Shared', primaryKeyword: 'shared', publishedAt: '2026-08-01' }),
    item('C', { slug: 'shared', title: 'Shared', primaryKeyword: 'shared', publishedAt: '2026-08-01' }),
  ]
  const baseline = createContentIdentityBaseline(catalog(...colliding), { capturedAt: '2026-08-01' })
  const invalidGroup = structuredClone(baseline)
  invalidGroup.legacyCollisionGroups.slug[0].value = 'Not Canonical!'
  assert.throws(() => analyzeContentIdentity(catalog(...colliding), invalidGroup, { today: '2026-08-01' }), /non-canonical/)

  const invalidReference = structuredClone(baseline)
  invalidReference.legacyCollisionGroups.slug[0].ids[2] = 'UNKNOWN'
  assert.throws(() => analyzeContentIdentity(catalog(...colliding), invalidReference, { today: '2026-08-01' }), /unknown item/)

  const advanced = advanceContentIdentityBaseline(catalog(...colliding.slice(0, 2)), baseline, { ratchetUpdatedAt: '2026-08-02' })
  const invalidPair = structuredClone(advanced)
  invalidPair.retiredCollisionPairs.slug[0].ids = ['GUIDE_1', 'UNKNOWN']
  assert.throws(() => analyzeContentIdentity(catalog(...colliding.slice(0, 2)), invalidPair, { today: '2026-08-02' }), /slug retired pair/)

  const invalidBurst = structuredClone(baseline)
  invalidBurst.lastDeployedPublicationBursts.day[0].excess += 1
  assert.throws(() => analyzeContentIdentity(catalog(...colliding), invalidBurst, { today: '2026-08-01' }), /malformed day publication burst/)
})

test('formatting truncates long finding lists and JSON keys remain stable', () => {
  const baseline = createContentIdentityBaseline(catalog(item('BASE')), { capturedAt: '2026-08-10' })
  const invalidItems = Array.from({ length: 25 }, (_, index) => item(`BAD-${index}`, { intent: '' }))
  const result = analyzeContentIdentity(catalog(item('BASE'), ...invalidItems), baseline, { today: '2026-08-10' })
  assert.match(formatContentIdentityReport(result), /more blocker\(s\)/)
  assert.equal(serializeContentIdentityReport({ z: 1, a: { y: 2, b: 3 } }), '{\n  "a": {\n    "b": 3,\n    "y": 2\n  },\n  "z": 1\n}')
})

test('describeJsonParseFailure keeps the position and drops the quoted document', () => {
  const capture = (source) => {
    try {
      JSON.parse(source)
      return null
    } catch (error) {
      return error
    }
  }

  const secret = 'AKIAIOSFODNN7EXAMPLE'
  const quoting = capture(secret)
  assert.ok(quoting.message.includes(secret), 'V8 no longer quotes the input; this guard needs revisiting')
  assert.equal(describeJsonParseFailure(quoting), "unexpected token 'A' in the document")

  const truncatedSnippet = capture('password=hunter2-correct-horse')
  assert.equal(describeJsonParseFailure(truncatedSnippet), "unexpected token 'p' in the document")

  const positional = describeJsonParseFailure(capture('{"token": "AKIAIOSFODNN7EXAMPLE", '))
  assert.ok(!positional.includes('AKIAIOSF'), 'the quoted document survived a positional failure')
  assert.equal(positional, 'Expected double-quoted property name in JSON at position 34 (line 1 column 35)')
  assert.equal(describeJsonParseFailure(capture('')), 'Unexpected end of JSON input')
  assert.equal(describeJsonParseFailure(new Error('something else entirely')), 'the document could not be parsed as JSON')
  assert.equal(describeJsonParseFailure(undefined), 'the document could not be parsed as JSON')
})
