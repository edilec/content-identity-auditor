#!/usr/bin/env node

import fs from 'node:fs'
import path from 'node:path'
import process from 'node:process'
import {
  advanceContentIdentityBaseline,
  analyzeContentIdentity,
  createContentIdentityBaseline,
  describeJsonParseFailure,
  formatContentIdentityReport,
  serializeContentIdentityReport,
} from '../src/index.mjs'

const MAX_INPUT_BYTES = 10 * 1024 * 1024
const command = process.argv[2]
const rawArgs = process.argv.slice(3)

const usage = `Content Identity Auditor

Usage:
  content-identity-auditor capture --content=FILE [--output=FILE] [options]
  content-identity-auditor audit --content=FILE --baseline=FILE [--today=YYYY-MM-DD] [--json|--human-only]
  content-identity-auditor advance --content=FILE --baseline=FILE [--output=FILE] [--ratchet-at=YYYY-MM-DD]

Capture options:
  --captured-at=YYYY-MM-DD   Baseline capture date (defaults to today)
  --route-prefix=/content    Canonical route prefix
  --title-suffix=" | Site"  Text appended before title normalization
  --per-day=2                Maximum publications in one day
  --per-7-days=5             Maximum publications in a seven-day window
  --per-30-days=15           Maximum publications in a thirty-day window

Output is written to stdout unless --output is supplied. Inputs are limited to 10 MiB.`

function fail(message, exitCode = 2) {
  process.stderr.write(`${message}\n`)
  process.exitCode = exitCode
}

function parseArgs(values) {
  const options = new Map()
  for (const value of values) {
    if (!value.startsWith('--')) throw new Error(`Unexpected argument: ${value}`)
    const separator = value.indexOf('=')
    const key = separator === -1 ? value.slice(2) : value.slice(2, separator)
    const optionValue = separator === -1 ? true : value.slice(separator + 1)
    if (!key || options.has(key)) throw new Error(`Invalid or repeated option: --${key}`)
    options.set(key, optionValue)
  }
  return options
}

function requireKnown(options, allowed) {
  for (const key of options.keys()) {
    if (!allowed.has(key)) throw new Error(`Unknown option: --${key}`)
  }
}

function requiredPath(options, key) {
  const value = options.get(key)
  if (typeof value !== 'string' || !value) throw new Error(`--${key}=FILE is required`)
  return path.resolve(process.cwd(), value)
}

function readJson(filePath, label) {
  const stat = fs.statSync(filePath)
  if (!stat.isFile()) throw new Error(`${label} must be a regular file`)
  if (stat.size > MAX_INPUT_BYTES) throw new Error(`${label} exceeds the 10 MiB input limit`)
  const source = fs.readFileSync(filePath, 'utf8')
  if (Buffer.byteLength(source) > MAX_INPUT_BYTES) throw new Error(`${label} exceeds the 10 MiB input limit`)
  try {
    return JSON.parse(source)
  } catch (error) {
    throw new Error(`${label} is not valid JSON: ${describeJsonParseFailure(error)}`)
  }
}

function positiveInteger(options, key, fallback) {
  const value = options.get(key)
  if (value === undefined) return fallback
  if (typeof value !== 'string' || !/^\d+$/.test(value) || Number(value) < 1) {
    throw new Error(`--${key} must be a positive integer`)
  }
  return Number(value)
}

function optionalValue(options, key) {
  const value = options.get(key)
  if (value === undefined) return undefined
  if (typeof value !== 'string') throw new Error(`--${key} requires =VALUE`)
  return value
}

function writeOutput(value, outputPath) {
  const serialized = `${serializeContentIdentityReport(value)}\n`
  if (!outputPath) {
    process.stdout.write(serialized)
    return
  }
  const resolved = path.resolve(process.cwd(), outputPath)
  const temporary = path.join(path.dirname(resolved), `.${path.basename(resolved)}.${process.pid}.tmp`)
  try {
    fs.writeFileSync(temporary, serialized, { encoding: 'utf8', mode: 0o600, flag: 'wx' })
    fs.renameSync(temporary, resolved)
  } finally {
    try {
      fs.unlinkSync(temporary)
    } catch (error) {
      if (!(error instanceof Error) || !('code' in error) || error.code !== 'ENOENT') throw error
    }
  }
}

function runCapture(options) {
  requireKnown(options, new Set(['content', 'output', 'captured-at', 'route-prefix', 'title-suffix', 'per-day', 'per-7-days', 'per-30-days']))
  const catalog = readJson(requiredPath(options, 'content'), 'Content catalog')
  const baseline = createContentIdentityBaseline(catalog, {
    capturedAt: optionalValue(options, 'captured-at'),
    routePrefix: optionalValue(options, 'route-prefix'),
    titleSuffix: optionalValue(options, 'title-suffix'),
    publicationLimits: {
      perDay: positiveInteger(options, 'per-day', 2),
      per7Days: positiveInteger(options, 'per-7-days', 5),
      per30Days: positiveInteger(options, 'per-30-days', 15),
    },
  })
  writeOutput(baseline, optionalValue(options, 'output'))
}

function runAudit(options) {
  requireKnown(options, new Set(['content', 'baseline', 'today', 'json', 'human-only']))
  if (options.has('json') && options.has('human-only')) throw new Error('--json and --human-only cannot be combined')
  if (options.get('json') !== undefined && options.get('json') !== true) throw new Error('--json does not accept a value')
  if (options.get('human-only') !== undefined && options.get('human-only') !== true) throw new Error('--human-only does not accept a value')
  const catalog = readJson(requiredPath(options, 'content'), 'Content catalog')
  const baseline = readJson(requiredPath(options, 'baseline'), 'Baseline')
  const result = analyzeContentIdentity(catalog, baseline, { today: optionalValue(options, 'today') })
  if (!options.has('json')) process.stdout.write(`${formatContentIdentityReport(result)}\n`)
  if (!options.has('human-only')) {
    if (!options.has('json')) process.stdout.write('\nDeterministic JSON report:\n')
    process.stdout.write(`${serializeContentIdentityReport(result)}\n`)
  }
  if (result.blockers.length) process.exitCode = 1
}

function runAdvance(options) {
  requireKnown(options, new Set(['content', 'baseline', 'output', 'ratchet-at']))
  const catalog = readJson(requiredPath(options, 'content'), 'Content catalog')
  const baseline = readJson(requiredPath(options, 'baseline'), 'Baseline')
  const advanced = advanceContentIdentityBaseline(catalog, baseline, {
    ratchetUpdatedAt: optionalValue(options, 'ratchet-at'),
  })
  writeOutput(advanced, optionalValue(options, 'output'))
}

if (command === '--help' || command === '-h' || command === undefined) {
  process.stdout.write(`${usage}\n`)
} else if (command === '--version' || command === '-v') {
  process.stdout.write('0.1.0\n')
} else {
  try {
    const options = parseArgs(rawArgs)
    if (command === 'capture') runCapture(options)
    else if (command === 'audit') runAudit(options)
    else if (command === 'advance') runAdvance(options)
    else throw new Error(`Unknown command: ${command}`)
  } catch (error) {
    fail(`Content identity audit failed: ${error instanceof Error ? error.message : String(error)}`)
    if (error instanceof Error && 'result' in error && error.result) {
      process.stderr.write(`${serializeContentIdentityReport(error.result)}\n`)
    }
  }
}
