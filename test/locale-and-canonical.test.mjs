import assert from 'node:assert/strict'
import test from 'node:test'

import {
  analyzeContentIdentity,
  createContentIdentityBaseline,
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
  assert.equal(collision.value, 'https://edilec.com/Hub')
  assert.deepEqual(collision.ids, ['alpha', 'beta'])
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
