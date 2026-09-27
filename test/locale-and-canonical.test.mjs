import assert from 'node:assert/strict'
import test from 'node:test'

import {
  advanceContentIdentityBaseline,
  analyzeContentIdentity,
  createContentIdentityBaseline,
  formatContentIdentityReport,
  isValidContentLocale,
  normalizeContentCanonical,
  normalizeContentLocale,
  serializeContentIdentityReport,
} from '../src/index.mjs'

const TODAY = '2026-08-01'

function item(over) {
  return {
    status: 'published',
    publishedAt: '2026-08-01',
    intent: 'informational',
    primaryKeyword: 'pricing',
    ...over,
  }
}

function codesFor(items, baseline = createContentIdentityBaseline({ items: [] }, { today: TODAY })) {
  return analyzeContentIdentity({ items }, baseline, { today: TODAY }).blockers.map((entry) => entry.code)
}

test('locale normalization accepts BCP 47-style tags and rejects junk', () => {
  assert.equal(normalizeContentLocale('  EN-GB '), 'en-gb')
  assert.equal(normalizeContentLocale(undefined), '')
  for (const value of ['en', 'en-gb', 'de', 'pt-br', 'zh-hans-cn']) {
    assert.ok(isValidContentLocale(value), value)
  }
  for (const value of ['', 'e', 'english locale', 'en_GB', 'en-']) {
    assert.equal(isValidContentLocale(value), false, value)
  }
})

test('canonical normalization lowercases scheme and host but keeps path case', () => {
  assert.equal(
    normalizeContentCanonical('HTTPS://Edilec.COM/Guides/Pricing?x=1#section'),
    'https://edilec.com/Guides/Pricing?x=1',
  )
  assert.equal(normalizeContentCanonical('/guides/pricing#top'), '/guides/pricing')
  for (const value of ['', '   ', 'not a url', 'ftp://edilec.com/x', 'javascript:alert(1)']) {
    assert.equal(normalizeContentCanonical(value), '', JSON.stringify(value))
  }
})

test('root-relative canonicals normalize browser dot segments before collision checks', () => {
  assert.equal(normalizeContentCanonical('/a/../b?view=full#section'), '/b?view=full')
  assert.equal(normalizeContentCanonical('/a/%2e%2e/b'), '/b')
  const codes = codesFor([
    item({ id: 'alpha', slug: 'alpha', title: 'Alpha', primaryKeyword: 'alpha', canonical: '/a/../b' }),
    item({ id: 'beta', slug: 'beta', title: 'Beta', primaryKeyword: 'beta', canonical: '/b' }),
  ])
  assert.ok(codes.includes('NEW_CANONICAL_COLLISION'))
})

test('protocol-relative canonical is not mistaken for a root-relative path', () => {
  assert.equal(normalizeContentCanonical('//edilec.com/b'), '')
  const codes = codesFor([
    item({ id: 'alpha', slug: 'alpha', title: 'Alpha', canonical: '//edilec.com/b' }),
  ])
  assert.ok(codes.includes('UNSAFE_CANONICAL'))
})

test('locale variants sharing a title and keyword are not a collision', () => {
  const codes = codesFor([
    item({ id: 'en-pricing', slug: 'pricing', title: 'Pricing', locale: 'en' }),
    item({ id: 'de-pricing', slug: 'preise', title: 'Pricing', locale: 'de' }),
  ])

  assert.equal(codes.includes('NEW_PUNCTUATION_INSENSITIVE_TITLE_COLLISION'), false)
  assert.equal(codes.includes('WORSENED_PRIMARY_KEYWORD_CLUSTER'), false)
})

test('duplicate identity inside one locale is still flagged', () => {
  const codes = codesFor([
    item({ id: 'alpha', slug: 'pricing-a', title: 'Pricing', locale: 'en' }),
    item({ id: 'beta', slug: 'pricing-b', title: 'Pricing', locale: 'en' }),
  ])

  assert.ok(codes.includes('NEW_PUNCTUATION_INSENSITIVE_TITLE_COLLISION'))
  assert.ok(codes.includes('WORSENED_PRIMARY_KEYWORD_CLUSTER'))
})

test('items without a locale keep colliding as they always did', () => {
  const codes = codesFor([
    item({ id: 'alpha', slug: 'pricing-a', title: 'Pricing' }),
    item({ id: 'beta', slug: 'pricing-b', title: 'Pricing' }),
  ])

  assert.ok(codes.includes('NEW_PUNCTUATION_INSENSITIVE_TITLE_COLLISION'))
})

test('a locale-scoped collision records the locale in its value', () => {
  const result = analyzeContentIdentity(
    {
      items: [
        item({ id: 'alpha', slug: 'pricing-a', title: 'Pricing', locale: 'en' }),
        item({ id: 'beta', slug: 'pricing-b', title: 'Pricing', locale: 'en' }),
      ],
    },
    createContentIdentityBaseline({ items: [] }, { today: TODAY }),
    { today: TODAY },
  )
  const collision = result.blockers.find((entry) => entry.dimension === 'title')

  assert.ok(collision.value.startsWith('en\u0000'))
  assert.deepEqual(collision.ids, ['alpha', 'beta'])
})

test('an unchanged catalog retains collision debt captured before locale scoping', () => {
  const items = [
    item({ id: 'alpha', slug: 'pricing-a', title: 'Pricing', locale: 'en' }),
    item({ id: 'beta', slug: 'pricing-b', title: 'Pricing', locale: 'en' }),
  ]
  const baseline = createContentIdentityBaseline({ items }, { capturedAt: TODAY })
  for (const dimension of ['title', 'primaryKeyword']) {
    baseline.legacyCollisionGroups[dimension][0].value = 'pricing'
  }

  const result = analyzeContentIdentity({ items }, baseline, { today: TODAY })
  assert.deepEqual(result.blockers, [])
  assert.deepEqual(result.resolvedLegacyDebt.title, { groups: 0, items: 0, pairs: 0 })
  assert.deepEqual(result.resolvedLegacyDebt.primaryKeyword, { groups: 0, items: 0, pairs: 0 })

  const advanced = advanceContentIdentityBaseline({ items }, baseline, { ratchetUpdatedAt: TODAY })
  assert.deepEqual(advanced.retiredCollisionPairs.title, [])
  assert.deepEqual(advanced.retiredCollisionPairs.primaryKeyword, [])
})

test('a retired pair from an unscoped baseline blocks reintroduction in one locale', () => {
  const alpha = item({ id: 'alpha', slug: 'pricing-a', title: 'Pricing', locale: 'en' })
  const beta = item({ id: 'beta', slug: 'pricing-b', title: 'Pricing', locale: 'en' })
  const baseline = createContentIdentityBaseline({ items: [alpha, beta] }, { capturedAt: TODAY })
  for (const dimension of ['title', 'primaryKeyword']) {
    baseline.legacyCollisionGroups[dimension][0].value = 'pricing'
  }

  const advanced = advanceContentIdentityBaseline({ items: [alpha] }, baseline, { ratchetUpdatedAt: TODAY })
  assert.deepEqual(advanced.retiredCollisionPairs.title, [{ value: 'pricing', ids: ['alpha', 'beta'] }])
  const result = analyzeContentIdentity({ items: [alpha, beta] }, advanced, { today: TODAY })
  for (const code of ['NEW_PUNCTUATION_INSENSITIVE_TITLE_COLLISION', 'WORSENED_PRIMARY_KEYWORD_CLUSTER']) {
    const finding = result.blockers.find((entry) => entry.code === code)
    assert.ok(finding, `expected ${code}`)
    assert.deepEqual(finding.reintroducedPairs, [['alpha', 'beta']])
    assert.deepEqual(finding.unexpectedIds, [])
  }
})

test('an unscoped baseline still rejects a new member of an old locale collision', () => {
  const alpha = item({ id: 'alpha', slug: 'pricing-a', title: 'Pricing', locale: 'en' })
  const beta = item({ id: 'beta', slug: 'pricing-b', title: 'Pricing', locale: 'en' })
  const baseline = createContentIdentityBaseline({ items: [alpha, beta] }, { capturedAt: TODAY })
  for (const dimension of ['title', 'primaryKeyword']) baseline.legacyCollisionGroups[dimension][0].value = 'pricing'
  const gamma = item({ id: 'gamma', slug: 'pricing-c', title: 'Pricing', locale: 'en' })

  const result = analyzeContentIdentity({ items: [alpha, beta, gamma] }, baseline, { today: TODAY })
  for (const code of ['NEW_PUNCTUATION_INSENSITIVE_TITLE_COLLISION', 'WORSENED_PRIMARY_KEYWORD_CLUSTER']) {
    const finding = result.blockers.find((entry) => entry.code === code)
    assert.ok(finding, `expected ${code}`)
    assert.deepEqual(finding.unexpectedIds, ['gamma'])
    assert.deepEqual(finding.reintroducedPairs, [])
  }
})

test('two items claiming one canonical collide across locales', () => {
  const result = analyzeContentIdentity(
    {
      items: [
        item({ id: 'alpha', slug: 'alpha', title: 'Alpha', primaryKeyword: 'alpha', locale: 'en', canonical: 'https://Edilec.com/Hub' }),
        item({ id: 'beta', slug: 'beta', title: 'Beta', primaryKeyword: 'beta', locale: 'de', canonical: 'https://edilec.com/Hub#frag' }),
      ],
    },
    createContentIdentityBaseline({ items: [] }, { today: TODAY }),
    { today: TODAY },
  )
  const collision = result.blockers.find((entry) => entry.code === 'NEW_CANONICAL_COLLISION')

  assert.ok(collision, 'expected a canonical collision')
  assert.equal(collision.value, 'canonical#1')
  assert.deepEqual(collision.ids, ['alpha', 'beta'])
})

test('accepted canonical collision debt is visible in JSON and text summaries', () => {
  const items = [
    item({ id: 'alpha', slug: 'alpha', title: 'Alpha', primaryKeyword: 'alpha', canonical: '/shared' }),
    item({ id: 'beta', slug: 'beta', title: 'Beta', primaryKeyword: 'beta', canonical: '/shared' }),
  ]
  const baseline = createContentIdentityBaseline({ items }, { capturedAt: TODAY })
  const result = analyzeContentIdentity({ items }, baseline, { today: TODAY })

  assert.deepEqual(result.blockers, [])
  assert.deepEqual(result.currentLegacyDebt.canonical, { groups: 1, items: 2 })
  assert.deepEqual(result.resolvedLegacyDebt.canonical, { groups: 0, items: 0, pairs: 0 })
  assert.match(formatContentIdentityReport(result), /Collision debt:.*1 canonical/)

  const olderReport = structuredClone(result)
  delete olderReport.currentLegacyDebt.canonical
  delete olderReport.resolvedLegacyDebt.canonical
  assert.match(formatContentIdentityReport(olderReport), /Collision debt:.*0 canonical/)
})

test('canonical query values are compared but never stored or reported', () => {
  const secret = 'synthetic-secret'
  const canonical = `https://example.test/shared?token=${secret}`
  const items = [
    item({ id: 'alpha', slug: 'alpha', title: 'Alpha', primaryKeyword: 'alpha', canonical }),
    item({ id: 'beta', slug: 'beta', title: 'Beta', primaryKeyword: 'beta', canonical }),
  ]
  const empty = createContentIdentityBaseline({ items: [] }, { capturedAt: TODAY })
  const captured = createContentIdentityBaseline({ items }, { capturedAt: TODAY })
  const report = analyzeContentIdentity({ items }, empty, { today: TODAY })
  const finding = report.blockers.find((entry) => entry.code === 'NEW_CANONICAL_COLLISION')

  assert.ok(finding, 'the exact canonical collision must still be detected')
  assert.deepEqual(finding.ids, ['alpha', 'beta'])
  for (const rendered of [
    serializeContentIdentityReport(report),
    formatContentIdentityReport(report),
    serializeContentIdentityReport(captured),
  ]) {
    assert.equal(rendered.includes(secret), false)
    assert.equal(rendered.includes(canonical), false)
  }
  const distinct = [items[0], { ...items[1], canonical: 'https://example.test/shared?token=different' }]
  assert.equal(analyzeContentIdentity({ items: distinct }, empty, { today: TODAY })
    .blockers.some((entry) => entry.code === 'NEW_CANONICAL_COLLISION'), false)
})

test('canonical debt tracks item pairs without pinning a sensitive URL', () => {
  const oldCanonical = 'https://example.test/old?token=synthetic-secret'
  const newCanonical = 'https://example.test/new?token=synthetic-other'
  const alpha = item({ id: 'alpha', slug: 'alpha', title: 'Alpha', primaryKeyword: 'alpha', canonical: oldCanonical })
  const beta = item({ id: 'beta', slug: 'beta', title: 'Beta', primaryKeyword: 'beta', canonical: oldCanonical })
  const baseline = createContentIdentityBaseline({ items: [alpha, beta] }, { capturedAt: TODAY })
  const moved = [{ ...alpha, canonical: newCanonical }, { ...beta, canonical: newCanonical }]

  assert.deepEqual(analyzeContentIdentity({ items: moved }, baseline, { today: TODAY }).blockers, [])
  const advanced = advanceContentIdentityBaseline({ items: [alpha] }, baseline, { ratchetUpdatedAt: TODAY })
  const reintroduced = analyzeContentIdentity({ items: moved }, advanced, { today: TODAY })
  const finding = reintroduced.blockers.find((entry) => entry.code === 'NEW_CANONICAL_COLLISION')
  assert.ok(finding)
  assert.deepEqual(finding.reintroducedPairs, [['alpha', 'beta']])

  const legacy = structuredClone(baseline)
  legacy.legacyCollisionGroups.canonical[0].value = oldCanonical
  const migrated = advanceContentIdentityBaseline({ items: [alpha, beta] }, legacy, { ratchetUpdatedAt: TODAY })
  assert.equal(serializeContentIdentityReport(migrated).includes('synthetic-secret'), false)
  const advancedAgain = advanceContentIdentityBaseline({ items: [alpha] }, advanced, { ratchetUpdatedAt: TODAY })
  assert.ok(analyzeContentIdentity({ items: moved }, advancedAgain, { today: TODAY })
    .blockers.some((entry) => entry.code === 'NEW_CANONICAL_COLLISION'))
  assert.equal(serializeContentIdentityReport(advancedAgain).includes('synthetic-secret'), false)
})

test('distinct canonicals do not collide', () => {
  const codes = codesFor([
    item({ id: 'alpha', slug: 'alpha', title: 'Alpha', primaryKeyword: 'alpha', canonical: 'https://edilec.com/a' }),
    item({ id: 'beta', slug: 'beta', title: 'Beta', primaryKeyword: 'beta', canonical: 'https://edilec.com/b' }),
  ])

  assert.equal(codes.includes('NEW_CANONICAL_COLLISION'), false)
})

test('a declared locale or canonical that cannot be used is a blocker', () => {
  const codes = codesFor([item({ id: 'alpha', slug: 'alpha', title: 'Alpha', locale: 'english' })])
  assert.ok(codes.includes('UNSAFE_LOCALE'))

  const canonicalCodes = codesFor([item({ id: 'beta', slug: 'beta', title: 'Beta', canonical: 'not a url' })])
  assert.ok(canonicalCodes.includes('UNSAFE_CANONICAL'))

  const typeCodes = codesFor([item({ id: 'gamma', slug: 'gamma', title: 'Gamma', locale: 7, canonical: [] })])
  assert.ok(typeCodes.includes('INVALID_LOCALE_TYPE'))
  assert.ok(typeCodes.includes('INVALID_CANONICAL_TYPE'))
})

test('an unsafe canonical is identified without echoing URL credentials', () => {
  const baseline = createContentIdentityBaseline({ items: [] }, { capturedAt: TODAY })
  const result = analyzeContentIdentity({ items: [
    item({ id: 'alpha', slug: 'alpha', title: 'Alpha', canonical: 'https://user:synthetic-secret@' }),
  ] }, baseline, { today: TODAY })
  const finding = result.blockers.find((entry) => entry.code === 'UNSAFE_CANONICAL')

  assert.ok(finding, 'the invalid canonical must still be a blocker')
  assert.equal(finding.id, 'alpha')
  assert.equal(Object.hasOwn(finding, 'value'), false)
  assert.equal(serializeContentIdentityReport(result).includes('synthetic-secret'), false)
})

test('a baseline written before the canonical dimension existed still loads', () => {
  const baseline = createContentIdentityBaseline({ items: [] }, { today: TODAY })
  delete baseline.legacyCollisionGroups.canonical
  delete baseline.retiredCollisionPairs.canonical

  const items = [
    item({ id: 'alpha', slug: 'alpha', title: 'Alpha', primaryKeyword: 'alpha', canonical: 'https://edilec.com/hub' }),
    item({ id: 'beta', slug: 'beta', title: 'Beta', primaryKeyword: 'beta', canonical: 'https://edilec.com/hub' }),
  ]

  const result = analyzeContentIdentity({ items }, baseline, { today: TODAY })
  assert.ok(result.blockers.some((entry) => entry.code === 'NEW_CANONICAL_COLLISION'))
})

test('rerunning the same inventory produces the same report', () => {
  const items = [
    item({ id: 'en-pricing', slug: 'pricing', title: 'Pricing', locale: 'en', canonical: 'https://edilec.com/en/pricing' }),
    item({ id: 'de-pricing', slug: 'preise', title: 'Pricing', locale: 'de', canonical: 'https://edilec.com/de/pricing' }),
    item({ id: 'alpha', slug: 'alpha', title: 'Alpha', primaryKeyword: 'alpha', locale: 'en', canonical: 'https://edilec.com/a' }),
  ]
  const baseline = createContentIdentityBaseline({ items: [] }, { today: TODAY })

  const first = analyzeContentIdentity({ items }, baseline, { today: TODAY })
  const second = analyzeContentIdentity({ items: [...items].reverse() }, baseline, { today: TODAY })

  assert.equal(
    serializeContentIdentityReport(first),
    serializeContentIdentityReport(second),
  )
})
