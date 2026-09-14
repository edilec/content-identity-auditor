import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import test from 'node:test'

/*
 * These drive the real CLI rather than calling the guard directly. A guard
 * asserted through its own exported function is defended by a declaration; an
 * exit code and the bytes left in a file on disk cannot be edited into
 * agreement.
 *
 * Every refusal below was measured destroying the named file first, with the
 * run exiting 0 and printing nothing: `--output=<the catalog>` replaced the
 * catalog with the baseline, and `--output=<symlinked dir>/precious.txt`
 * replaced a file outside the working tree.
 *
 * The allowed cases are not optional: a guard that refuses every destination
 * passes a data-loss test while making --output useless.
 */

const packageRoot = path.resolve(import.meta.dirname, '..')
const CLI = path.join(packageRoot, 'bin/content-identity-auditor.mjs')
const BYSTANDER = 'a file this tool was never asked to touch\n'

const CATALOG = {
  items: [
    {
      id: 'GUIDE-001',
      slug: 'designing-reliable-webhooks',
      title: 'Designing reliable webhooks',
      status: 'published',
      publishedAt: '2026-08-20',
      intent: 'implementation',
      primaryKeyword: 'reliable webhooks',
    },
  ],
}

/**
 * base/
 *   work/          the working directory, which is also the default write root
 *     catalog.json the input
 *     nested/      a real subdirectory of the write root
 *   elsewhere/     outside the write root, where the bystanders live
 */
function workspace(t) {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'content-identity-guard-'))
  t.after(() => fs.rmSync(base, { recursive: true, force: true }))
  const work = path.join(base, 'work')
  const nested = path.join(work, 'nested')
  const elsewhere = path.join(base, 'elsewhere')
  fs.mkdirSync(work)
  fs.mkdirSync(nested)
  fs.mkdirSync(elsewhere)
  const catalog = path.join(work, 'catalog.json')
  fs.writeFileSync(catalog, `${JSON.stringify(CATALOG, null, 2)}\n`, 'utf8')
  return { base, work, nested, elsewhere, catalog }
}

function capture(space, args) {
  return spawnSync(process.execPath, [CLI, 'capture', '--content=catalog.json', ...args], {
    cwd: space.work,
    encoding: 'utf8',
  })
}

test('the destination that is the input catalog is refused and the catalog survives', (t) => {
  const space = workspace(t)
  const before = fs.readFileSync(space.catalog, 'utf8')

  const result = capture(space, ['--output=catalog.json'])
  assert.equal(result.status, 2)
  assert.equal(result.stdout, '')
  assert.match(result.stderr, /same file as an input/)
  assert.equal(fs.readFileSync(space.catalog, 'utf8'), before)
})

test('a symlink at the destination is refused and its target survives', (t) => {
  const space = workspace(t)
  const bystander = path.join(space.elsewhere, 'precious.txt')
  fs.writeFileSync(bystander, BYSTANDER, 'utf8')
  const output = path.join(space.work, 'baseline.json')
  fs.symlinkSync(bystander, output)

  const result = capture(space, ['--output=baseline.json'])
  assert.equal(result.status, 2)
  assert.equal(result.stdout, '')
  assert.match(result.stderr, /--output is a symbolic link/)
  assert.equal(fs.readFileSync(bystander, 'utf8'), BYSTANDER)
  assert.equal(fs.lstatSync(output).isSymbolicLink(), true)
})

test('a symlink aimed at a path that does not exist yet creates nothing', (t) => {
  const space = workspace(t)
  const absent = path.join(space.elsewhere, 'created-outside.json')
  fs.symlinkSync(absent, path.join(space.work, 'baseline.json'))

  const result = capture(space, ['--output=baseline.json'])
  assert.equal(result.status, 2)
  assert.equal(result.stdout, '')
  assert.match(result.stderr, /--output is a symbolic link/)
  assert.equal(fs.existsSync(absent), false)
  assert.deepEqual(fs.readdirSync(space.elsewhere), [])
})

test('a symlinked parent directory is refused and the file behind it survives', (t) => {
  const space = workspace(t)
  const bystander = path.join(space.elsewhere, 'precious.txt')
  fs.writeFileSync(bystander, BYSTANDER, 'utf8')
  fs.symlinkSync(space.elsewhere, path.join(space.work, 'link'))

  const result = capture(space, ['--output=link/precious.txt'])
  assert.equal(result.status, 2)
  assert.equal(result.stdout, '')
  assert.match(result.stderr, /outside the permitted root/)
  assert.equal(fs.readFileSync(bystander, 'utf8'), BYSTANDER)
})

test('a hard link to an input is refused and the input survives', (t) => {
  const space = workspace(t)
  const before = fs.readFileSync(space.catalog, 'utf8')
  const output = path.join(space.work, 'baseline.json')
  fs.linkSync(space.catalog, output)

  const result = capture(space, ['--output=baseline.json'])
  assert.equal(result.status, 2)
  assert.equal(result.stdout, '')
  assert.match(result.stderr, /same file as an input/)
  assert.equal(fs.readFileSync(space.catalog, 'utf8'), before)
  assert.equal(fs.readFileSync(output, 'utf8'), before)
})

test('advance guards the baseline it reads against a hard link too', (t) => {
  const space = workspace(t)
  const baseline = path.join(space.work, 'baseline.json')
  assert.equal(capture(space, ['--output=baseline.json', '--captured-at=2026-08-20']).status, 0)
  const before = fs.readFileSync(baseline, 'utf8')
  const output = path.join(space.work, 'advanced.json')
  fs.linkSync(baseline, output)

  const result = spawnSync(
    process.execPath,
    [CLI, 'advance', '--content=catalog.json', '--baseline=baseline.json', '--output=advanced.json'],
    { cwd: space.work, encoding: 'utf8' },
  )
  assert.equal(result.status, 2)
  assert.equal(result.stdout, '')
  assert.match(result.stderr, /same file as an input/)
  assert.equal(fs.readFileSync(baseline, 'utf8'), before)
})

test('a lexical ".." escape out of the write root is refused', (t) => {
  const space = workspace(t)
  const bystander = path.join(space.elsewhere, 'precious.txt')
  fs.writeFileSync(bystander, BYSTANDER, 'utf8')

  const result = capture(space, ['--output=../elsewhere/precious.txt'])
  assert.equal(result.status, 2)
  assert.equal(result.stdout, '')
  assert.match(result.stderr, /outside the permitted root/)
  assert.equal(fs.readFileSync(bystander, 'utf8'), BYSTANDER)
})

test('a destination that is a directory is refused', (t) => {
  const space = workspace(t)

  const result = capture(space, ['--output=nested'])
  assert.equal(result.status, 2)
  assert.equal(result.stdout, '')
  assert.match(result.stderr, /not a regular file/)
  assert.equal(fs.statSync(space.nested).isDirectory(), true)
})

test('--output-root without --output is a usage error, not a silently ignored option', (t) => {
  const space = workspace(t)

  const result = capture(space, [`--output-root=${space.base}`])
  assert.equal(result.status, 2)
  assert.equal(result.stdout, '')
  assert.match(result.stderr, /--output-root has no meaning without --output/)
})

test('a plain new file in the write root is allowed', (t) => {
  const space = workspace(t)

  const result = capture(space, ['--output=baseline.json', '--captured-at=2026-08-20'])
  assert.equal(result.status, 0)
  assert.equal(result.stdout, '')
  const baseline = JSON.parse(fs.readFileSync(path.join(space.work, 'baseline.json'), 'utf8'))
  assert.equal(baseline.capturedAt, '2026-08-20')
  assert.equal(baseline.itemCount, 1)
})

test('a real subdirectory of the write root is allowed', (t) => {
  const space = workspace(t)

  const result = capture(space, ['--output=nested/baseline.json', '--captured-at=2026-08-20'])
  assert.equal(result.status, 0)
  assert.equal(result.stdout, '')
  assert.equal(
    JSON.parse(fs.readFileSync(path.join(space.nested, 'baseline.json'), 'utf8')).capturedAt,
    '2026-08-20',
  )
})

test('an existing regular file that is not an input is overwritten', (t) => {
  const space = workspace(t)
  const output = path.join(space.work, 'baseline.json')
  fs.writeFileSync(output, 'stale baseline\n', 'utf8')

  const result = capture(space, ['--output=baseline.json', '--captured-at=2026-08-20'])
  assert.equal(result.status, 0)
  assert.equal(JSON.parse(fs.readFileSync(output, 'utf8')).capturedAt, '2026-08-20')
})

test('a write root the operator widens covers what it names', (t) => {
  const space = workspace(t)
  const output = path.join(space.elsewhere, 'baseline.json')

  const refused = capture(space, [`--output=${output}`])
  assert.equal(refused.status, 2)
  assert.equal(refused.stdout, '')
  assert.equal(fs.existsSync(output), false)

  const allowed = capture(space, [`--output=${output}`, `--output-root=${space.base}`, '--captured-at=2026-08-20'])
  assert.equal(allowed.status, 0)
  assert.equal(JSON.parse(fs.readFileSync(output, 'utf8')).capturedAt, '2026-08-20')
})
