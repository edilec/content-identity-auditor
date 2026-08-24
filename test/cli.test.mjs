import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { execFileSync, spawnSync } from 'node:child_process'
import test from 'node:test'

const root = path.resolve(import.meta.dirname, '..')
const cli = path.join(root, 'bin/content-identity-auditor.mjs')
const fixture = path.join(root, 'test/fixtures/new-catalog.json')

function run(args, options = {}) {
  return spawnSync(process.execPath, [cli, ...args], { cwd: root, encoding: 'utf8', ...options })
}

test('CLI prints help and version', () => {
  assert.match(execFileSync(process.execPath, [cli, '--help'], { encoding: 'utf8' }), /Usage:/)
  assert.equal(execFileSync(process.execPath, [cli, '--version'], { encoding: 'utf8' }), '0.1.0\n')
})

test('CLI captures, audits, and advances a synthetic baseline', () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'content-identity-'))
  const baselinePath = path.join(directory, 'baseline.json')
  const advancedPath = path.join(directory, 'advanced.json')
  try {
    const capture = run(['capture', `--content=${fixture}`, `--output=${baselinePath}`, '--captured-at=2026-08-20', '--route-prefix=/guides'])
    assert.equal(capture.status, 0, capture.stderr)
    assert.equal(fs.statSync(baselinePath).mode & 0o777, 0o600)
    const audit = run(['audit', `--content=${fixture}`, `--baseline=${baselinePath}`, '--today=2026-08-20', '--human-only'])
    assert.equal(audit.status, 0, audit.stderr)
    assert.match(audit.stdout, /Content identity gate: PASS/)
    const json = run(['audit', `--content=${fixture}`, `--baseline=${baselinePath}`, '--today=2026-08-20', '--json'])
    assert.equal(JSON.parse(json.stdout).blockers.length, 0)
    const advance = run(['advance', `--content=${fixture}`, `--baseline=${baselinePath}`, `--output=${advancedPath}`, '--ratchet-at=2026-08-21'])
    assert.equal(advance.status, 0, advance.stderr)
    assert.equal(JSON.parse(fs.readFileSync(advancedPath, 'utf8')).ratchetUpdatedAt, '2026-08-21')
  } finally {
    fs.rmSync(directory, { recursive: true, force: true })
  }
})

test('CLI reports blocked audits with exit code one', () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'content-identity-'))
  const baselinePath = path.join(directory, 'baseline.json')
  const baselineCatalog = path.join(root, 'test/fixtures/legacy-catalog.json')
  try {
    assert.equal(run(['capture', `--content=${fixture}`, `--output=${baselinePath}`, '--captured-at=2026-08-20']).status, 0)
    const result = run(['audit', `--content=${baselineCatalog}`, `--baseline=${baselinePath}`, '--today=2026-08-20'])
    assert.equal(result.status, 1)
    assert.match(result.stdout, /Content identity gate: BLOCKED/)
  } finally {
    fs.rmSync(directory, { recursive: true, force: true })
  }
})

test('CLI rejects invalid commands, options, JSON, flag values, and conflicting modes', () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'content-identity-'))
  const invalidPath = path.join(directory, 'invalid.json')
  fs.writeFileSync(invalidPath, '{nope', 'utf8')
  try {
    for (const args of [
      ['unknown'],
      ['capture', `--content=${fixture}`, '--unknown'],
      ['capture', `--content=${fixture}`, `--content=${fixture}`],
      ['capture', `--content=${fixture}`, '--per-day=0'],
      ['capture', `--content=${fixture}`, '--title-suffix'],
      ['capture', `--content=${invalidPath}`],
      ['audit', `--content=${fixture}`, '--json', '--human-only'],
      ['audit', `--content=${fixture}`, '--json=yes'],
    ]) {
      const result = run(args)
      assert.equal(result.status, 2, `${args.join(' ')}\n${result.stderr}`)
      assert.match(result.stderr, /Content identity audit failed/)
    }
  } finally {
    fs.rmSync(directory, { recursive: true, force: true })
  }
})

test('CLI rejects non-file and oversized inputs before parsing', () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'content-identity-'))
  const oversizedPath = path.join(directory, 'oversized.json')
  fs.writeFileSync(oversizedPath, Buffer.alloc(10 * 1024 * 1024 + 1, 0x20))
  try {
    const nonFile = run(['capture', `--content=${directory}`])
    assert.equal(nonFile.status, 2)
    assert.match(nonFile.stderr, /regular file/)
    const oversized = run(['capture', `--content=${oversizedPath}`])
    assert.equal(oversized.status, 2)
    assert.match(oversized.stderr, /10 MiB input limit/)
  } finally {
    fs.rmSync(directory, { recursive: true, force: true })
  }
})
