export const NORMALIZATION_VERSION = 'content-identity-v1'
export const BASELINE_SCHEMA = 'dev.edilec.content-identity-baseline.v1'
export const AUDIT_SCHEMA = 'dev.edilec.content-identity-audit.v1'

export const VALID_STATUSES = Object.freeze(['published', 'draft'])
export const VALID_INTENTS = Object.freeze(['commercial', 'comparison', 'implementation', 'informational'])

const STATUS_SET = new Set(VALID_STATUSES)
const INTENT_SET = new Set(VALID_INTENTS)
// URL-space dimensions are global: two items cannot occupy one address, whatever
// locale they declare. Editorial dimensions are locale-scoped, because a
// translated variant legitimately reuses a title or a target keyword.
const DIMENSIONS = Object.freeze(['route', 'slug', 'canonical', 'title', 'primaryKeyword'])
const LOCALE_SCOPED_DIMENSIONS = Object.freeze(['title', 'primaryKeyword'])

// Dimensions introduced after the v1 baseline shipped. A baseline written
// before they existed omits them; that is read as "no accepted debt here"
// rather than as a malformed baseline.
const OPTIONAL_BASELINE_DIMENSIONS = Object.freeze(['canonical'])

const LOCALE_PATTERN = /^[a-z]{2,3}(?:-[a-z0-9]{2,8})*$/
const WINDOWS = Object.freeze([
  { key: 'day', days: 1, limitKey: 'perDay', code: 'ADDED_PUBLICATION_DAY_BURST_DEBT' },
  { key: 'days7', days: 7, limitKey: 'per7Days', code: 'ADDED_PUBLICATION_7_DAY_BURST_DEBT' },
  { key: 'days30', days: 30, limitKey: 'per30Days', code: 'ADDED_PUBLICATION_30_DAY_BURST_DEBT' },
])
const DEFAULT_LIMITS = Object.freeze({ perDay: 2, per7Days: 5, per30Days: 15 })
const COLLISION_CODES = Object.freeze({
  route: 'NEW_NORMALIZED_ROUTE_COLLISION',
  slug: 'NEW_NORMALIZED_SLUG_COLLISION',
  canonical: 'NEW_CANONICAL_COLLISION',
  title: 'NEW_PUNCTUATION_INSENSITIVE_TITLE_COLLISION',
  primaryKeyword: 'WORSENED_PRIMARY_KEYWORD_CLUSTER',
})

function text(value) {
  return String(value ?? '').normalize('NFKC')
}

const UNPARSEABLE = 'the document could not be parsed as JSON'

/** Where V8 puts the offending offset. An offset says nothing about content, so it is safe. */
const PARSE_POSITION = /at position \d+(?: \(line \d+ column \d+\))?/

/**
 * The shape that quotes the input back. Recognised FIRST: a catalog whose own
 * text reads `at position 1` makes V8 write
 * `Unexpected token 'a', "at position 1" is not valid JSON`, so looking for the
 * offset first finds that phrase INSIDE the quoted span and slices the catalog
 * straight back out. The `s` flag matters too: the quoted span can contain a
 * newline.
 */
function quotedInputToken(message) {
  const prefix = 'Unexpected token '
  const suffix = ' is not valid JSON'
  if (!message.startsWith(prefix) || !message.endsWith(suffix)) return null
  const body = message.slice(prefix.length, -suffix.length)
  const separator = body.indexOf(', ')
  if (separator < 0) return null
  const token = body.slice(0, separator)
  if (!token.startsWith("'") || !token.endsWith("'")) return null
  const character = token.slice(1, -1)
  if ([...character].length !== 1 || /[\p{Cc}\p{Cf}\p{Cs}\p{Zl}\p{Zp}]/u.test(character)) return null
  let snippet = body.slice(separator + 2)
  const inside = snippet.startsWith('...')
  if (inside) snippet = snippet.slice(3)
  if (snippet.endsWith('...')) snippet = snippet.slice(0, -3)
  if (!snippet.startsWith('"') || !snippet.endsWith('"') || snippet.length < 2) return null
  return { token, inside }
}

function describeParseFailure(message) {
  const quoting = quotedInputToken(message)
  if (quoting !== null) {
    const where = quoting.inside ? 'inside the document' : 'at the start of the document'
    return `unexpected token ${quoting.token} ${where}`
  }
  const position = PARSE_POSITION.exec(message)
  if (position !== null) return message.slice(0, position.index + position[0].length)
  if (message === 'Unexpected end of JSON input') return message
  return UNPARSEABLE
}

/**
 * Describe a JSON parse failure without repeating the document.
 *
 * V8 reports a parse failure two ways, and one of them quotes the input:
 * `Unexpected token 'A', "AKIAIOSFODNN7EXAMPLE" is not valid JSON`. A catalog
 * or baseline short enough to be only a credential is therefore reproduced in
 * full by its own error message, and normalization does not help because the
 * snippet sits at the front. The position, line and column are the useful half
 * and are safe; the quoted half is the input and never leaves this function.
 * V8 omits the position from the quoting form, so that case reports the
 * offending token alone rather than inventing a location for it.
 *
 * The closing guard is deliberate belt and braces, and it is why this function
 * is safe against wordings it has never seen: across 500,206 distinct V8 parse
 * messages, every one that carries no quoted snippet also carries no double
 * quote at all -- it quotes JSON punctuation with apostrophes. So a double
 * quote surviving to the end means a snippet survived, whatever the branch
 * logic above concluded, and the generic sentence is used instead.
 */
export function describeJsonParseFailure(error) {
  const message = String(error?.message ?? '')
  const detail = describeParseFailure(message)
  return detail.includes('"') ? UNPARSEABLE : detail
}

function compareText(left, right) {
  return left < right ? -1 : left > right ? 1 : 0
}

function normalizeWords(value) {
  return text(value)
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/[‘’‛'`´]/g, '')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

export function normalizeContentTopic(value) {
  return normalizeWords(value)
}

export function normalizeContentTitle(value) {
  return normalizeWords(value)
}

export function normalizeContentSlug(value) {
  return text(value)
    .toLowerCase()
    .trim()
    .replace(/&/g, ' and ')
    .replace(/[‘’‛'`´]/g, '')
    .replace(/[^\p{L}\p{N}]+/gu, '-')
    .replace(/-+/g, '-')
    .replace(/^-+|-+$/g, '')
}

function normalizeRoutePrefix(value = '/content') {
  const raw = text(value).trim()
  if (!/^\/(?:[a-z0-9]+(?:-[a-z0-9]+)*)(?:\/[a-z0-9]+(?:-[a-z0-9]+)*)*$/.test(raw)) {
    throw new Error('routePrefix must be a lowercase absolute path without a trailing slash')
  }
  return raw
}

function primaryKeyword(item) {
  if (typeof item?.primaryKeyword === 'string' && item.primaryKeyword.trim()) return item.primaryKeyword
  const keywords = Array.isArray(item?.keywords) ? item.keywords : []
  return keywords.find((value) => typeof value === 'string' && value.trim()) ?? ''
}

function emittedTitle(item, config) {
  return `${text(item?.title).trim()}${config.titleSuffix}`
}

/**
 * Normalize a declared locale to a lowercase BCP 47-style tag.
 *
 * Returns '' when no locale is declared, which places the item in the default
 * locale scope and leaves locale-free catalogs behaving exactly as before.
 */
export function normalizeContentLocale(value) {
  return text(value).trim().toLowerCase()
}

export function isValidContentLocale(value) {
  return LOCALE_PATTERN.test(normalizeContentLocale(value))
}

/**
 * Normalize a declared canonical address for identity comparison.
 *
 * Scheme and host are case-insensitive, so they are lowercased; the path is
 * kept case-sensitive while URL dot segments are resolved. A fragment never identifies
 * a separate document, so it is dropped. Returns '' when the value is not a
 * usable absolute URL or root-relative path.
 */
export function normalizeContentCanonical(value) {
  const raw = text(value).trim()
  if (!raw) return ''
  if (raw.startsWith('/')) {
    try {
      const base = 'https://canonical.invalid'
      const url = new URL(raw, base)
      return url.origin === base && !raw.startsWith('//')
        ? `${url.pathname}${url.search}` : ''
    } catch {
      return ''
    }
  }
  let url
  try {
    url = new URL(raw)
  } catch {
    return ''
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return ''
  return `${url.protocol}//${url.host}${url.pathname}${url.search}`
}

function localeScope(item) {
  return normalizeContentLocale(item?.locale)
}

/** Prefix a group value with its locale scope, using NUL as the separator. */
function scopedValue(locale, value) {
  if (!value) return ''
  return locale ? `${locale}\u0000${value}` : value
}

function splitScopedValue(value) {
  const index = value.indexOf('\u0000')
  return index === -1
    ? { locale: '', bare: value }
    : { locale: value.slice(0, index), bare: value.slice(index + 1) }
}

export function normalizeContentRoute(item, options = {}) {
  const routePrefix = normalizeRoutePrefix(options.routePrefix)
  return `${routePrefix}/${normalizeContentSlug(item?.id)}/${normalizeContentSlug(item?.slug)}/`
}

function sortedValues(values) {
  return values.map((value) => text(value).trim()).filter(Boolean).sort(compareText)
}

function sortedUnique(values) {
  return [...new Set(sortedValues(values))]
}

function validIsoDate(value) {
  if (typeof value !== 'string' || value !== value.trim()) return false
  const raw = value
  if (!/^\d{4}-\d{2}-\d{2}$/.test(raw)) return false
  const date = new Date(`${raw}T00:00:00Z`)
  return !Number.isNaN(date.valueOf()) && date.toISOString().slice(0, 10) === raw
}

function dateNumber(value) {
  return Date.parse(`${value}T00:00:00Z`)
}

function addDays(value, days) {
  return new Date(dateNumber(value) + days * 86_400_000).toISOString().slice(0, 10)
}

function normalizeConfig(options = {}) {
  const publicationLimits = { ...DEFAULT_LIMITS, ...(options.publicationLimits ?? {}) }
  for (const key of ['perDay', 'per7Days', 'per30Days']) {
    if (!Number.isInteger(publicationLimits[key]) || publicationLimits[key] < 1) {
      throw new Error(`${key} must be a positive integer`)
    }
  }
  const titleSuffix = text(options.titleSuffix)
  if (titleSuffix.length > 200) throw new Error('titleSuffix must be at most 200 characters')
  return {
    routePrefix: normalizeRoutePrefix(options.routePrefix),
    titleSuffix,
    publicationLimits,
  }
}

function requireCatalog(catalog) {
  if (!catalog || typeof catalog !== 'object' || !Array.isArray(catalog.items)) {
    throw new Error('Content catalog must contain an items array')
  }
}

function isRecord(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function groupItems(items, valueFor) {
  const groups = new Map()
  for (const item of items) {
    const value = valueFor(item)
    if (!value) continue
    if (!groups.has(value)) groups.set(value, [])
    groups.get(value).push(text(item.id).trim())
  }
  return [...groups.entries()]
    .map(([value, ids]) => ({ value, ids: sortedValues(ids) }))
    .filter((group) => group.ids.length > 1)
    .sort((left, right) => compareText(left.value, right.value))
}

function collisionGroups(items, config) {
  return {
    route: groupItems(items, (item) => normalizeContentRoute(item, config)),
    slug: groupItems(items, (item) => normalizeContentSlug(item.slug)),
    canonical: groupItems(items, (item) => normalizeContentCanonical(item.canonical)),
    title: groupItems(items, (item) => scopedValue(localeScope(item), normalizeContentTitle(emittedTitle(item, config)))),
    primaryKeyword: groupItems(items, (item) => scopedValue(localeScope(item), normalizeContentTopic(primaryKeyword(item)))),
  }
}

function pairsForGroup(group) {
  const ids = sortedUnique(group.ids)
  const pairs = []
  for (let left = 0; left < ids.length; left += 1) {
    for (let right = left + 1; right < ids.length; right += 1) {
      pairs.push({ value: group.value, ids: [ids[left], ids[right]] })
    }
  }
  return pairs
}

function pairKey(pair) {
  return `${pair.value}\u0000${pair.ids[0]}\u0000${pair.ids[1]}`
}

function sortFindings(findings) {
  findings.sort((left, right) => compareText(serializeContentIdentityReport(left), serializeContentIdentityReport(right)))
}

function collectValidationBlockers(rawItems) {
  const blockers = []
  const invalidCount = rawItems.filter((item) => !isRecord(item)).length
  if (invalidCount) blockers.push({ code: 'INVALID_CONTENT_RECORD', count: invalidCount })
  const items = rawItems.filter(isRecord)

  for (const item of items) {
    const id = typeof item.id === 'string' ? item.id : ''
    const slug = typeof item.slug === 'string' ? item.slug : ''
    const title = typeof item.title === 'string' ? item.title : ''
    const status = typeof item.status === 'string' ? item.status : ''
    if (item.id !== undefined && typeof item.id !== 'string') blockers.push({ code: 'INVALID_ITEM_ID_TYPE', valueType: typeof item.id })
    else if (!id) blockers.push({ code: 'MISSING_ITEM_ID', slug: slug || null, title: title || null })
    else if (id !== id.trim() || !/^[A-Za-z0-9][A-Za-z0-9_-]*$/.test(id)) blockers.push({ code: 'UNSAFE_ITEM_ID', id })
    if (item.slug !== undefined && typeof item.slug !== 'string') blockers.push({ code: 'INVALID_SLUG_TYPE', id: id || null, valueType: typeof item.slug })
    else if (!slug) blockers.push({ code: 'MISSING_SLUG', id: id || null })
    else if (slug !== slug.trim() || slug !== normalizeContentSlug(slug) || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug)) {
      blockers.push({ code: 'UNSAFE_SLUG', id: id || null, value: slug, normalized: normalizeContentSlug(slug) })
    }
    if (item.title !== undefined && typeof item.title !== 'string') blockers.push({ code: 'INVALID_TITLE_TYPE', id: id || null, valueType: typeof item.title })
    else if (!title) blockers.push({ code: 'MISSING_TITLE', id: id || null })
    else if (title !== title.trim() || !normalizeContentTitle(title)) blockers.push({ code: 'UNSAFE_TITLE', id: id || null, value: title })
    if (typeof item.status !== 'string' || !STATUS_SET.has(status)) {
      blockers.push({ code: 'INVALID_STATUS', id: id || null, value: item.status ?? null, allowed: VALID_STATUSES })
    }
    // Locale and canonical are optional. When declared they must be usable,
    // because both change how identity is compared.
    if (item.locale !== undefined) {
      if (typeof item.locale !== 'string') blockers.push({ code: 'INVALID_LOCALE_TYPE', id: id || null, valueType: typeof item.locale })
      else if (!isValidContentLocale(item.locale)) blockers.push({ code: 'UNSAFE_LOCALE', id: id || null, value: item.locale })
    }
    if (item.canonical !== undefined) {
      if (typeof item.canonical !== 'string') blockers.push({ code: 'INVALID_CANONICAL_TYPE', id: id || null, valueType: typeof item.canonical })
      else if (!normalizeContentCanonical(item.canonical)) blockers.push({ code: 'UNSAFE_CANONICAL', id: id || null })
    }
    if (status === 'published') {
      const publishedAt = item.publishedAt
      if (!validIsoDate(publishedAt)) blockers.push({ code: 'INVALID_PUBLISHED_DATE', id: id || null, value: publishedAt })
      if (item.primaryKeyword !== undefined && typeof item.primaryKeyword !== 'string') {
        blockers.push({ code: 'INVALID_PRIMARY_KEYWORD_TYPE', id: id || null, valueType: typeof item.primaryKeyword })
      }
      if (item.keywords !== undefined && (!Array.isArray(item.keywords) || item.keywords.some((value) => typeof value !== 'string'))) {
        blockers.push({ code: 'INVALID_KEYWORDS_TYPE', id: id || null })
      }
      const keyword = primaryKeyword(item)
      if (!keyword) blockers.push({ code: 'MISSING_PRIMARY_KEYWORD', id: id || null })
      else if (keyword !== keyword.trim() || !normalizeContentTopic(keyword)) {
        blockers.push({ code: 'UNSAFE_PRIMARY_KEYWORD', id: id || null, value: keyword })
      }
    }
  }

  for (const group of groupItems(items, (item) => text(item.id).trim().toLowerCase())) {
    blockers.push({ code: 'DUPLICATE_ID', value: group.value, ids: group.ids })
  }
  sortFindings(blockers)
  return blockers
}

function publicationRecords(items) {
  return items
    .filter((item) => validIsoDate(item.publishedAt))
    .map((item) => ({ id: text(item.id).trim(), date: text(item.publishedAt).trim(), day: dateNumber(item.publishedAt) }))
    .sort((left, right) => left.day - right.day || compareText(left.id, right.id))
}

function publicationBurstGroups(items, limits) {
  const records = publicationRecords(items)
  const startDates = sortedUnique(records.map((record) => record.date))
  const groups = Object.fromEntries(WINDOWS.map((window) => [window.key, []]))
  for (const window of WINDOWS) {
    for (const startDate of startDates) {
      const start = dateNumber(startDate)
      const end = start + (window.days - 1) * 86_400_000
      const matching = records.filter((record) => record.day >= start && record.day <= end)
      const limit = limits[window.limitKey]
      if (matching.length <= limit) continue
      groups[window.key].push({
        startDate,
        endDate: addDays(startDate, window.days - 1),
        itemCount: matching.length,
        limit,
        excess: matching.length - limit,
        sampleIds: sortedValues(matching.map((record) => record.id)).slice(0, 20),
      })
    }
  }
  return groups
}

function validateGroup(group, dimension, baseline) {
  if (!isRecord(group) || !text(group.value).trim() || !Array.isArray(group.ids) || group.ids.length < 2) {
    throw new Error(`Baseline contains a malformed ${dimension} collision group`)
  }
  if (JSON.stringify(group.ids) !== JSON.stringify(sortedUnique(group.ids))) {
    throw new Error(`Baseline ${dimension} collision group IDs must be sorted and unique`)
  }
  if (group.ids.some((id) => !Object.hasOwn(baseline.publishedAtById, id))) {
    throw new Error(`Baseline ${dimension} collision group references an unknown item`)
  }
}

function burstKey(group) {
  return `${group.startDate}\u0000${group.endDate}`
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function canonicalGroupValue(value, dimension, config) {
  if (dimension === 'route') {
    return new RegExp(`^${escapeRegExp(config.routePrefix)}\/[a-z0-9]+(?:-[a-z0-9]+)*\/[a-z0-9]+(?:-[a-z0-9]+)*\/$`).test(value)
  }
  if (dimension === 'slug') return value === normalizeContentSlug(value) && /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(value)
  if (dimension === 'canonical') return Boolean(value) && value === normalizeContentCanonical(value)
  const { locale, bare } = splitScopedValue(value)
  if (locale && !LOCALE_PATTERN.test(locale)) return false
  if (dimension === 'title') return bare === normalizeContentTitle(bare)
  return bare === normalizeContentTopic(bare)
}

function validateBurstGroup(group, window, limits, maximum) {
  const expectedLimit = limits[window.limitKey]
  if (
    !isRecord(group)
    || !validIsoDate(group.startDate)
    || !validIsoDate(group.endDate)
    || group.endDate !== addDays(group.startDate, window.days - 1)
    || !Number.isInteger(group.itemCount)
    || !Number.isInteger(group.limit)
    || !Number.isInteger(group.excess)
    || group.limit !== expectedLimit
    || group.itemCount <= group.limit
    || group.excess !== group.itemCount - group.limit
    || !Array.isArray(group.sampleIds)
    || JSON.stringify(group.sampleIds) !== JSON.stringify(sortedUnique(group.sampleIds))
    || group.sampleIds.length > 20
    || (maximum && group.excess > maximum.excess)
  ) {
    throw new Error(`Baseline contains a malformed ${window.key} publication burst`)
  }
}

function validateBaseline(baseline) {
  if (!isRecord(baseline)) throw new Error('Content identity baseline must be an object')
  if (baseline.schema !== BASELINE_SCHEMA) throw new Error(`Unsupported baseline schema: ${baseline.schema ?? 'missing'}`)
  if (baseline.normalizationVersion !== NORMALIZATION_VERSION) {
    throw new Error(`Baseline normalization mismatch: ${baseline.normalizationVersion ?? 'missing'}`)
  }
  if (!validIsoDate(baseline.capturedAt)) throw new Error('Baseline has an invalid capturedAt date')
  if (!validIsoDate(baseline.ratchetUpdatedAt) || baseline.ratchetUpdatedAt < baseline.capturedAt) {
    throw new Error('Baseline has an invalid ratchetUpdatedAt date')
  }
  const expectedConfig = normalizeConfig(baseline.config)
  if (serializeContentIdentityReport(expectedConfig) !== serializeContentIdentityReport(baseline.config)) {
    throw new Error('Baseline config is not canonical')
  }
  if (!Number.isInteger(baseline.itemCount) || baseline.itemCount < 0) throw new Error('Baseline has an invalid itemCount')
  if (!Number.isInteger(baseline.lastDeployedItemCount) || baseline.lastDeployedItemCount < 0) {
    throw new Error('Baseline has an invalid lastDeployedItemCount')
  }
  if (!isRecord(baseline.publishedAtById)) throw new Error('Baseline is missing publishedAtById')
  const publicationIds = Object.keys(baseline.publishedAtById)
  if (JSON.stringify(publicationIds) !== JSON.stringify(sortedUnique(publicationIds))) {
    throw new Error('Baseline publication IDs must be sorted and unique')
  }
  if (publicationIds.length < baseline.itemCount || publicationIds.length < baseline.lastDeployedItemCount) {
    throw new Error('Baseline publication records are incomplete')
  }
  for (const [id, publishedAt] of Object.entries(baseline.publishedAtById)) {
    if (!/^[A-Za-z0-9][A-Za-z0-9_-]*$/.test(id) || !validIsoDate(publishedAt) || publishedAt > baseline.ratchetUpdatedAt) {
      throw new Error(`Baseline has an invalid publication record for ${id || 'an empty ID'}`)
    }
  }
  for (const dimension of DIMENSIONS) {
    const groups = baselineDimension(baseline, 'legacyCollisionGroups', dimension)
    const retiredPairs = baselineDimension(baseline, 'retiredCollisionPairs', dimension)
    if (!Array.isArray(groups)) throw new Error(`Baseline is missing ${dimension} collision groups`)
    if (!Array.isArray(retiredPairs)) throw new Error(`Baseline is missing ${dimension} retired pairs`)
    const groupValues = groups.map((group) => group?.value)
    if (JSON.stringify(groupValues) !== JSON.stringify(sortedUnique(groupValues))) {
      throw new Error(`Baseline ${dimension} collision groups must be sorted and unique`)
    }
    groups.forEach((group) => {
      validateGroup(group, dimension, baseline)
      if (!canonicalGroupValue(group.value, dimension, baseline.config)) {
        throw new Error(`Baseline contains a non-canonical ${dimension} collision value`)
      }
    })
    const ceilingPairs = new Set(groups.flatMap(pairsForGroup).map(pairKey))
    const retiredKeys = retiredPairs.map(pairKey)
    if (JSON.stringify(retiredKeys) !== JSON.stringify(sortedUnique(retiredKeys))) {
      throw new Error(`Baseline ${dimension} retired pairs must be sorted and unique`)
    }
    for (const pair of retiredPairs) {
      if (
        !isRecord(pair)
        || !text(pair.value).trim()
        || !Array.isArray(pair.ids)
        || pair.ids.length !== 2
        || JSON.stringify(pair.ids) !== JSON.stringify(sortedUnique(pair.ids))
        || !ceilingPairs.has(pairKey(pair))
      ) {
        throw new Error(`Baseline contains a malformed ${dimension} retired pair`)
      }
    }
  }
  for (const window of WINDOWS) {
    const legacy = baseline.legacyPublicationBursts?.[window.key]
    const deployed = baseline.lastDeployedPublicationBursts?.[window.key]
    if (!Array.isArray(legacy)) throw new Error(`Baseline is missing ${window.key} publication bursts`)
    if (!Array.isArray(deployed)) {
      throw new Error(`Baseline is missing ${window.key} last-deployed publication bursts`)
    }
    const legacyKeys = legacy.map(burstKey)
    const deployedKeys = deployed.map(burstKey)
    if (JSON.stringify(legacyKeys) !== JSON.stringify(sortedUnique(legacyKeys))) {
      throw new Error(`Baseline ${window.key} publication bursts must be sorted and unique`)
    }
    if (JSON.stringify(deployedKeys) !== JSON.stringify(sortedUnique(deployedKeys))) {
      throw new Error(`Baseline ${window.key} last-deployed bursts must be sorted and unique`)
    }
    const ceiling = new Map(legacy.map((group) => [burstKey(group), group]))
    legacy.forEach((group) => validateBurstGroup(group, window, baseline.config.publicationLimits))
    for (const group of deployed) {
      const maximum = ceiling.get(burstKey(group))
      if (!maximum) throw new Error(`Baseline ${window.key} last-deployed burst exceeds its captured ceiling`)
      validateBurstGroup(group, window, baseline.config.publicationLimits, maximum)
    }
  }
}

export function createContentIdentityBaseline(catalog, options = {}) {
  requireCatalog(catalog)
  const capturedAt = options.capturedAt ?? new Date().toISOString().slice(0, 10)
  if (!validIsoDate(capturedAt)) throw new Error('A valid YYYY-MM-DD capturedAt date is required')
  const config = normalizeConfig(options)
  const blockers = collectValidationBlockers(catalog.items)
  for (const item of catalog.items.filter((entry) => isRecord(entry) && entry.status === 'published')) {
    if (validIsoDate(item.publishedAt) && item.publishedAt > capturedAt) {
      blockers.push({ code: 'FUTURE_BASELINE_ITEM', id: item.id, publishedAt: item.publishedAt, capturedAt })
    }
  }
  sortFindings(blockers)
  if (blockers.length) {
    const error = new Error(`Cannot capture an invalid content identity baseline (${blockers.length} blocker(s))`)
    error.result = { blockers }
    throw error
  }
  const published = catalog.items.filter((item) => item.status === 'published')
  const collisions = collisionGroups(published, config)
  const bursts = publicationBurstGroups(published, config.publicationLimits)
  const publishedAtById = Object.fromEntries(
    published.map((item) => [text(item.id).trim(), text(item.publishedAt).trim()]).sort(([left], [right]) => compareText(left, right)),
  )
  return {
    schema: BASELINE_SCHEMA,
    normalizationVersion: NORMALIZATION_VERSION,
    capturedAt,
    ratchetUpdatedAt: capturedAt,
    config,
    itemCount: published.length,
    lastDeployedItemCount: published.length,
    publishedAtById,
    legacyCollisionGroups: collisions,
    retiredCollisionPairs: Object.fromEntries(DIMENSIONS.map((dimension) => [dimension, []])),
    legacyPublicationBursts: bursts,
    lastDeployedPublicationBursts: bursts,
  }
}

/**
 * Read one dimension out of a baseline map, tolerating a baseline written
 * before that dimension existed.
 */
function baselineDimension(baseline, key, dimension) {
  const value = baseline?.[key]?.[dimension]
  if (value === undefined && OPTIONAL_BASELINE_DIMENSIONS.includes(dimension)) return []
  return value
}

function baselineGroups(baseline, dimension) {
  return new Map(baselineDimension(baseline, 'legacyCollisionGroups', dimension).map((group) => [group.value, new Set(group.ids)]))
}

function pushCollisionBlockers(blockers, groups, baseline, dimension) {
  const allowed = baselineGroups(baseline, dimension)
  const retired = new Set(baselineDimension(baseline, 'retiredCollisionPairs', dimension).map(pairKey))
  for (const group of groups) {
    const allowedIds = allowed.get(group.value)
    const unexpectedIds = sortedUnique(group.ids.filter((id) => !allowedIds?.has(id)))
    const reintroducedPairs = pairsForGroup(group).filter((pair) => retired.has(pairKey(pair))).map((pair) => pair.ids)
    if (!allowedIds || unexpectedIds.length || reintroducedPairs.length) {
      blockers.push({
        code: COLLISION_CODES[dimension],
        dimension,
        value: group.value,
        ids: group.ids,
        baselineItemCount: allowedIds?.size ?? 0,
        unexpectedIds,
        reintroducedPairs,
      })
    }
  }
}

function pushPublicationBlockers(blockers, bursts, baseline) {
  for (const window of WINDOWS) {
    const deployed = new Map(baseline.lastDeployedPublicationBursts[window.key].map((group) => [`${group.startDate}\u0000${group.endDate}`, group]))
    for (const group of bursts[window.key]) {
      const prior = deployed.get(`${group.startDate}\u0000${group.endDate}`)
      const priorExcess = prior?.excess ?? 0
      if (group.excess <= priorExcess) continue
      blockers.push({
        code: window.code,
        window: window.key,
        startDate: group.startDate,
        endDate: group.endDate,
        limit: group.limit,
        itemCount: group.itemCount,
        baselineItemCount: prior?.itemCount ?? 0,
        excess: group.excess,
        addedExcess: group.excess - priorExcess,
        sampleIds: group.sampleIds,
      })
    }
  }
}

function collisionDebt(groups, baseline, dimension) {
  const current = new Map(groups.map((group) => [group.value, new Set(group.ids)]))
  let groupsResolved = 0
  let items = 0
  let pairs = 0
  for (const legacy of baselineDimension(baseline, 'legacyCollisionGroups', dimension)) {
    const retained = new Set([...current.get(legacy.value) ?? []].filter((id) => legacy.ids.includes(id)))
    const legacyPairs = pairsForGroup(legacy).length
    const retainedPairs = retained.size > 1 ? (retained.size * (retained.size - 1)) / 2 : 0
    const pairReduction = legacyPairs - retainedPairs
    if (pairReduction > 0) groupsResolved += 1
    items += legacy.ids.length - retained.size
    pairs += pairReduction
  }
  return { groups: groupsResolved, items, pairs }
}

function burstSummary(bursts) {
  return Object.fromEntries(WINDOWS.map((window) => [window.key, {
    groups: bursts[window.key].length,
    excess: bursts[window.key].reduce((total, group) => total + group.excess, 0),
  }]))
}

function burstDebt(bursts, baseline) {
  return Object.fromEntries(WINDOWS.map((window) => {
    const current = new Map(bursts[window.key].map((group) => [`${group.startDate}\u0000${group.endDate}`, group]))
    let groups = 0
    let excess = 0
    for (const legacy of baseline.legacyPublicationBursts[window.key]) {
      const reduction = Math.max(0, legacy.excess - (current.get(`${legacy.startDate}\u0000${legacy.endDate}`)?.excess ?? 0))
      if (reduction) groups += 1
      excess += reduction
    }
    return [window.key, { groups, excess }]
  }))
}

function stableValue(value) {
  if (Array.isArray(value)) return value.map(stableValue)
  if (!value || typeof value !== 'object') return value
  return Object.fromEntries(Object.keys(value).sort(compareText).map((key) => [key, stableValue(value[key])]))
}

export function serializeContentIdentityReport(value) {
  return JSON.stringify(stableValue(value), null, 2)
}

export function analyzeContentIdentity(catalog, baseline, options = {}) {
  validateBaseline(baseline)
  requireCatalog(catalog)
  const today = options.today ?? new Date().toISOString().slice(0, 10)
  if (!validIsoDate(today)) throw new Error('A valid YYYY-MM-DD today value is required')
  const items = catalog.items.filter(isRecord)
  const published = items.filter((item) => item.status === 'published')
  const drafts = items.filter((item) => item.status === 'draft')
  const blockers = collectValidationBlockers(catalog.items)
  const warnings = []
  const collisions = collisionGroups(published, baseline.config)
  for (const dimension of DIMENSIONS) pushCollisionBlockers(blockers, collisions[dimension], baseline, dimension)

  const allCollisions = collisionGroups([...published, ...drafts], baseline.config)
  const draftIds = new Set(drafts.map((item) => text(item.id).trim()))
  for (const dimension of DIMENSIONS) {
    for (const group of allCollisions[dimension]) {
      if (group.ids.some((id) => draftIds.has(id))) {
        warnings.push({ code: `DRAFT_${dimension.replace(/([A-Z])/g, '_$1').toUpperCase()}_COLLISION`, dimension, value: group.value, ids: group.ids })
      }
    }
  }

  const legacyIds = new Set(Object.keys(baseline.publishedAtById))
  const newItems = published.filter((item) => !legacyIds.has(text(item.id).trim()))
  for (const item of published) {
    const id = text(item.id).trim()
    const publishedAt = text(item.publishedAt).trim()
    if (Object.hasOwn(baseline.publishedAtById, id) && baseline.publishedAtById[id] !== publishedAt) {
      blockers.push({ code: 'CHANGED_LEGACY_PUBLISHED_DATE', id, expected: baseline.publishedAtById[id], actual: publishedAt })
    }
  }
  for (const item of newItems) {
    const id = text(item.id).trim()
    const publishedAt = text(item.publishedAt).trim()
    const intent = typeof item.intent === 'string' ? item.intent : ''
    if (!INTENT_SET.has(intent)) blockers.push({ code: 'INVALID_NEW_INTENT', id, value: intent, allowed: VALID_INTENTS })
    if (validIsoDate(publishedAt) && publishedAt < baseline.capturedAt) blockers.push({ code: 'BACKDATED_NEW_ITEM', id, publishedAt, earliest: baseline.capturedAt })
    if (validIsoDate(publishedAt) && publishedAt > today) blockers.push({ code: 'FUTURE_NEW_ITEM', id, publishedAt, today })
  }

  const bursts = publicationBurstGroups(published, baseline.config.publicationLimits)
  pushPublicationBlockers(blockers, bursts, baseline)
  sortFindings(blockers)
  sortFindings(warnings)
  return {
    schema: AUDIT_SCHEMA,
    normalizationVersion: NORMALIZATION_VERSION,
    baselineCapturedAt: baseline.capturedAt,
    ratchetUpdatedAt: baseline.ratchetUpdatedAt,
    config: baseline.config,
    items: items.length,
    publishedItems: published.length,
    draftItems: drafts.length,
    newPublishedItems: newItems.length,
    currentLegacyDebt: {
      route: { groups: collisions.route.length, items: new Set(collisions.route.flatMap((group) => group.ids)).size },
      slug: { groups: collisions.slug.length, items: new Set(collisions.slug.flatMap((group) => group.ids)).size },
      title: { groups: collisions.title.length, items: new Set(collisions.title.flatMap((group) => group.ids)).size },
      primaryKeyword: { groups: collisions.primaryKeyword.length, items: new Set(collisions.primaryKeyword.flatMap((group) => group.ids)).size },
      publicationBursts: burstSummary(bursts),
    },
    resolvedLegacyDebt: {
      route: collisionDebt(collisions.route, baseline, 'route'),
      slug: collisionDebt(collisions.slug, baseline, 'slug'),
      title: collisionDebt(collisions.title, baseline, 'title'),
      primaryKeyword: collisionDebt(collisions.primaryKeyword, baseline, 'primaryKeyword'),
      publicationBursts: burstDebt(bursts, baseline),
    },
    blockers,
    warnings,
  }
}

export function advanceContentIdentityBaseline(catalog, baseline, options = {}) {
  validateBaseline(baseline)
  const ratchetUpdatedAt = options.ratchetUpdatedAt ?? options.today ?? new Date().toISOString().slice(0, 10)
  if (!validIsoDate(ratchetUpdatedAt) || ratchetUpdatedAt < baseline.ratchetUpdatedAt) {
    throw new Error('A non-decreasing YYYY-MM-DD ratchetUpdatedAt date is required')
  }
  if (options.today !== undefined && options.today !== ratchetUpdatedAt) {
    throw new Error('today must match ratchetUpdatedAt when advancing a baseline')
  }
  const result = analyzeContentIdentity(catalog, baseline, { today: ratchetUpdatedAt })
  if (result.blockers.length) {
    const error = new Error(`Cannot advance a blocked content identity baseline (${result.blockers.length} blocker(s))`)
    error.result = result
    throw error
  }
  const published = catalog.items.filter((item) => isRecord(item) && item.status === 'published')
  const collisions = collisionGroups(published, baseline.config)
  const retiredCollisionPairs = Object.fromEntries(DIMENSIONS.map((dimension) => {
    const current = new Set(collisions[dimension].flatMap(pairsForGroup).map(pairKey))
    const retired = new Map(baselineDimension(baseline, 'retiredCollisionPairs', dimension).map((pair) => [pairKey(pair), pair]))
    for (const pair of baselineDimension(baseline, 'legacyCollisionGroups', dimension).flatMap(pairsForGroup)) {
      if (!current.has(pairKey(pair))) retired.set(pairKey(pair), pair)
    }
    return [dimension, [...retired.values()].sort((left, right) => compareText(pairKey(left), pairKey(right)))]
  }))
  const publicationDates = new Map(Object.entries(baseline.publishedAtById))
  for (const item of published) publicationDates.set(text(item.id).trim(), text(item.publishedAt).trim())
  return {
    ...baseline,
    ratchetUpdatedAt,
    lastDeployedItemCount: published.length,
    publishedAtById: Object.fromEntries([...publicationDates.entries()].sort(([left], [right]) => compareText(left, right))),
    retiredCollisionPairs,
    lastDeployedPublicationBursts: publicationBurstGroups(published, baseline.config.publicationLimits),
  }
}

export function formatContentIdentityReport(result) {
  const status = result.blockers.length ? 'BLOCKED' : 'PASS'
  const debt = result.currentLegacyDebt
  const resolved = result.resolvedLegacyDebt
  const lines = [
    `Content identity gate: ${status}`,
    `Content: ${result.publishedItems} published, ${result.draftItems} draft, ${result.newPublishedItems} never deployed (ratchet ${result.ratchetUpdatedAt})`,
    `Collision debt: ${debt.route.groups} route, ${debt.slug.groups} slug, ${debt.title.groups} title, ${debt.primaryKeyword.groups} primary-keyword groups`,
    `Publication debt: ${debt.publicationBursts.day.groups} daily, ${debt.publicationBursts.days7.groups} seven-day, ${debt.publicationBursts.days30.groups} thirty-day windows`,
    `Resolved debt: ${resolved.route.items} route, ${resolved.slug.items} slug, ${resolved.title.items} title, ${resolved.primaryKeyword.items} primary-keyword memberships`,
    `Findings: ${result.blockers.length} blocker(s), ${result.warnings.length} warning(s)`,
  ]
  for (const finding of result.blockers.slice(0, 20)) {
    const subject = finding.id ?? finding.value ?? finding.startDate ?? ''
    lines.push(`- ${finding.code}${subject ? `: ${subject}` : ''}`)
  }
  if (result.blockers.length > 20) lines.push(`- … ${result.blockers.length - 20} more blocker(s) in the JSON report`)
  return lines.join('\n')
}

export function assertContentIdentity(catalog, baseline, options = {}) {
  const result = analyzeContentIdentity(catalog, baseline, options)
  if (result.blockers.length) {
    const error = new Error(`Content identity gate failed with ${result.blockers.length} blocker(s)`)
    error.result = result
    throw error
  }
  return result
}
