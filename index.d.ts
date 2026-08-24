export interface ContentItem {
  id: string
  slug: string
  title: string
  status: 'published' | 'draft'
  publishedAt?: string
  intent?: 'commercial' | 'comparison' | 'implementation' | 'informational'
  primaryKeyword?: string
  keywords?: string[]
}

export interface ContentCatalog {
  items: ContentItem[]
}

export interface PublicationLimits {
  perDay: number
  per7Days: number
  per30Days: number
}

export interface ContentIdentityOptions {
  capturedAt?: string
  today?: string
  ratchetUpdatedAt?: string
  routePrefix?: string
  titleSuffix?: string
  publicationLimits?: Partial<PublicationLimits>
}

export interface Finding {
  code: string
  [key: string]: unknown
}

export interface ContentIdentityBaseline {
  schema: string
  normalizationVersion: string
  capturedAt: string
  ratchetUpdatedAt: string
  config: {
    routePrefix: string
    titleSuffix: string
    publicationLimits: PublicationLimits
  }
  itemCount: number
  lastDeployedItemCount: number
  publishedAtById: Record<string, string>
  legacyCollisionGroups: Record<string, Array<{ value: string; ids: string[] }>>
  retiredCollisionPairs: Record<string, Array<{ value: string; ids: [string, string] }>>
  legacyPublicationBursts: Record<string, unknown[]>
  lastDeployedPublicationBursts: Record<string, unknown[]>
}

export interface ContentIdentityReport {
  schema: string
  normalizationVersion: string
  baselineCapturedAt: string
  ratchetUpdatedAt: string
  items: number
  publishedItems: number
  draftItems: number
  newPublishedItems: number
  blockers: Finding[]
  warnings: Finding[]
  [key: string]: unknown
}

export const NORMALIZATION_VERSION: string
export const BASELINE_SCHEMA: string
export const AUDIT_SCHEMA: string
export const VALID_STATUSES: readonly string[]
export const VALID_INTENTS: readonly string[]

export function normalizeContentTopic(value: unknown): string
export function normalizeContentTitle(value: unknown): string
export function normalizeContentSlug(value: unknown): string
export function normalizeContentRoute(item: Partial<ContentItem>, options?: Pick<ContentIdentityOptions, 'routePrefix'>): string
export function createContentIdentityBaseline(catalog: ContentCatalog, options?: ContentIdentityOptions): ContentIdentityBaseline
export function analyzeContentIdentity(catalog: ContentCatalog, baseline: ContentIdentityBaseline, options?: ContentIdentityOptions): ContentIdentityReport
export function advanceContentIdentityBaseline(catalog: ContentCatalog, baseline: ContentIdentityBaseline, options?: ContentIdentityOptions): ContentIdentityBaseline
export function formatContentIdentityReport(report: ContentIdentityReport): string
export function serializeContentIdentityReport(value: unknown): string
export function assertContentIdentity(catalog: ContentCatalog, baseline: ContentIdentityBaseline, options?: ContentIdentityOptions): ContentIdentityReport
