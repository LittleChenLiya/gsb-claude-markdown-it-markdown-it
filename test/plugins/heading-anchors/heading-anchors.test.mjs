import { test } from 'node:test'
import assert from 'node:assert/strict'

import MarkdownIt from '../../../src/index.ts'
import headingAnchors, { slugify, getAnchors } from '../../../plugins/heading-anchors/index.mjs'

function ids (anchors) {
  return anchors.map(a => a.id)
}

test('same-name headings get different ids by occurrence order', () => {
  const md = new MarkdownIt().use(headingAnchors)
  const env = {}
  const html = md.render('# Foo\n\nbar\n\n# Foo', env)

  assert.ok(html.includes('<h1 id="foo">'))
  assert.ok(html.includes('<h1 id="foo-2">'))

  const { anchors } = getAnchors(env)
  assert.deepEqual(ids(anchors), ['foo', 'foo-2'])
  assert.equal(anchors[0].line, 1)
  assert.equal(anchors[1].line, 5)
})

test('numbering is local to one parse: the second parse is identical', () => {
  const md = new MarkdownIt().use(headingAnchors)
  const src = '# Foo\n\n# Foo\n\n# Foo'

  const first = md.render(src, {})
  const second = md.render(src, {})
  assert.equal(first, second)
  assert.equal(second, '<h1 id="foo">Foo</h1>\n<h1 id="foo-2">Foo</h1>\n<h1 id="foo-3">Foo</h1>\n')

  // Also independent across different md instances (no module-level counter).
  const other = new MarkdownIt().use(headingAnchors)
  assert.equal(other.render(src, {}), first)

  // And independent of documents parsed before on the same instance.
  md.render('# Foo\n# Foo\n# Foo\n# Foo', {})
  assert.equal(md.render(src, {}), first)
})

test('explicit user id collision reports both locations', () => {
  const md = new MarkdownIt().use(headingAnchors)
  try {
    md.render('# A {#dup}\n\np\n\n# B {#dup}')
    assert.fail('expected an error')
  } catch (err) {
    assert.equal(err.code, 'HEADING_ANCHOR_DUPLICATE_ID')
    assert.equal(err.collisions.length, 1)
    const c = err.collisions[0]
    assert.equal(c.id, 'dup')
    assert.equal(c.first.line, 1)
    assert.equal(c.first.text, 'A')
    assert.equal(c.second.line, 5)
    assert.equal(c.second.text, 'B')
    assert.deepEqual(c.explicit, [true, true])
  }
})

test('user ids are preserved and reserved against generated ids', () => {
  const md = new MarkdownIt().use(headingAnchors)
  const env = {}
  const html = md.render('# api\n\n# API {#api}\n\n# api', env)

  assert.ok(html.includes('<h1 id="api-2">api</h1>'))
  assert.ok(html.includes('<h1 id="api">API</h1>'))
  assert.ok(html.includes('<h1 id="api-3">api</h1>'))
  assert.deepEqual(ids(getAnchors(env).anchors), ['api-2', 'api', 'api-3'])

  // The {#id} marker is removed from the visible heading text.
  assert.ok(!html.includes('{#api}'))
})

test('explicit id colliding with another explicit id is detected regardless of order', () => {
  const md = new MarkdownIt().use(headingAnchors)
  assert.throws(
    () => md.render('# X {#z}\n\n# Y {#z}\n'),
    e => e.code === 'HEADING_ANCHOR_DUPLICATE_ID' &&
         e.collisions[0].first.line === 1 &&
         e.collisions[0].second.line === 3
  )
})

test('pre-existing user ids on tokens are kept and collision-checked', () => {
  const md = new MarkdownIt().use(headingAnchors)
  // Simulate another plugin assigning an id before heading_anchors runs.
  md.core.ruler.before('heading_anchors', 'preset-ids', state => {
    state.tokens[0].attrSet('id', 'from-other-plugin')
  })

  const env = {}
  const html = md.render('# Alpha\n\n# Beta', env)
  assert.ok(html.includes('<h1 id="from-other-plugin">Alpha</h1>'))
  assert.ok(html.includes('<h1 id="beta">Beta</h1>'))
  const { anchors } = getAnchors(env)
  assert.equal(anchors[0].id, 'from-other-plugin')
  assert.equal(anchors[0].explicit, true)

  // Two preset ids on different headings -> collision with both locations.
  const md2 = new MarkdownIt().use(headingAnchors)
  md2.core.ruler.before('heading_anchors', 'preset-ids', state => {
    state.tokens.filter(t => t.type === 'heading_open')
      .forEach(t => t.attrSet('id', 'same'))
  })
  assert.throws(
    () => md2.render('# P\n\n# Q'),
    e => e.code === 'HEADING_ANCHOR_DUPLICATE_ID' &&
         e.collisions[0].first.line === 1 &&
         e.collisions[0].second.line === 3 &&
         e.collisions[0].explicit[0] === true
  )
})

test('generated ids avoid ids pre-assigned by other rules', () => {
  const md = new MarkdownIt().use(headingAnchors)
  md.core.ruler.before('heading_anchors', 'preset-one', state => {
    state.tokens[0].attrSet('id', 'intro')
  })
  const html = md.render('# Intro\n\n# Intro')
  assert.ok(html.includes('<h1 id="intro">Intro</h1>'))
  assert.ok(html.includes('<h1 id="intro-2">Intro</h1>'))
})

test('empty slug has a deterministic fallback', () => {
  const md = new MarkdownIt().use(headingAnchors)
  const env = {}
  const html = md.render('# !!!\n\n# ???\n\n# 123', env)
  assert.ok(html.includes('<h1 id="section">'))
  assert.ok(html.includes('<h1 id="section-2">'))
  assert.ok(html.includes('<h1 id="123">'))

  // Custom fallback.
  const md2 = new MarkdownIt().use(headingAnchors, { emptySlug: 'untitled' })
  assert.ok(md2.render('# !!!!').includes('<h1 id="untitled">'))
})

test('embedded snippet can carry an explicit prefix via options or env', () => {
  const md = new MarkdownIt().use(headingAnchors, { prefix: 'doc-' })
  const html = md.render('# Notes\n\n# Notes')
  assert.ok(html.includes('id="doc-notes"'))
  assert.ok(html.includes('id="doc-notes-2"'))

  // env overrides options for this render only.
  const env = { headingAnchorsPrefix: 'snip-' }
  const html2 = md.render('# Notes\n\n# Notes\n\n[ref](#notes/2)', env)
  assert.ok(html2.includes('id="snip-notes"'))
  assert.ok(html2.includes('id="snip-notes-2"'))
  assert.ok(html2.includes('href="#snip-notes-2"'))

  // Next render without env prefix keeps the option prefix.
  assert.ok(md.render('# Notes').includes('id="doc-notes"'))
})

test('heading references distinguish occurrences', () => {
  const md = new MarkdownIt().use(headingAnchors)
  const html = md.render(
    '# Change Log\n\n[a](#change-log)\n[b](#change-log/1)\n[c](#change-log/2)\n\n# Change Log'
  )
  assert.ok(html.includes('href="#change-log"'))
  assert.ok(html.includes('href="#change-log/1"') === false)
  assert.ok(html.includes('href="#change-log-2"'))

  // Readable name resolves to the generated slug (destination with a space
  // must use CommonMark autolink-style <> destinations).
  assert.ok(md.render('# Foo Bar\n\n[x](<#Foo Bar>)').includes('href="#foo-bar"'))

  // Out of range / unknown references stay untouched but are reported.
  const env = {}
  const html2 = md.render('# Foo\n\n[x](#foo/3) [y](#missing)', env)
  assert.ok(html2.includes('href="#foo/3"'))
  assert.ok(html2.includes('href="#missing"'))
  const info = getAnchors(env)
  assert.deepEqual(info.unresolvedReferences, ['#foo/3', '#missing'])
})

test('explicit ids are reference targets too', () => {
  const md = new MarkdownIt().use(headingAnchors)
  const html = md.render('# Overview {#ov}\n\n[go](#ov)')
  assert.ok(html.includes('href="#ov"'))
})

test('Unicode slug rule', () => {
  const cases = [
    ['Hello World', 'hello-world'],
    ['café', 'cafe'],                 // NFKD strips combining accent
    ['Ångström', 'angstrom'],
    ['标题 锚点', '标题-锚点'],        // CJK letters kept
    ['Кириллица', 'кириллица'],        // Cyrillic kept
    ['Ελληνικά', 'ελληνικα'],        // Greek kept; tonos is a combining mark
    ['FOO---BAR', 'foo-bar'],         // hyphen collapse/trim
    ['  spaces  ', 'spaces'],
    ['emoji 😀 here', 'emoji-here'],  // symbol -> separator
    ['100% done!', '100-done'],
    ['snake_case', 'snake_case'],
    ['', '']
  ]
  for (const [input, expected] of cases) {
    assert.equal(slugify(input), expected, `slugify(${JSON.stringify(input)})`)
  }
})

test('incremental suffixes never collide with reserved ids', () => {
  const md = new MarkdownIt().use(headingAnchors)
  // Generated first, then explicit reservations that match suffixes.
  const html = md.render('# a\n\n# a {#a-2}\n\n# a\n\n# a {#a-3}\n\n# a')
  assert.ok(html.includes('<h1 id="a">'))
  assert.ok(html.includes('<h1 id="a-2">a</h1>'))
  assert.ok(html.includes('<h1 id="a-4">a</h1>'))
  assert.ok(html.includes('<h1 id="a-3">a</h1>'))
  assert.ok(html.includes('<h1 id="a-5">a</h1>'))
})

test('getAnchors is safe on a fresh env', () => {
  assert.deepEqual(getAnchors({}), {
    anchors: [],
    unresolvedReferences: [],
    collisions: []
  })
})

test('reference rewriting can be disabled', () => {
  const md = new MarkdownIt().use(headingAnchors, { resolveReferences: false })
  const html = md.render('# Foo\n\n# Foo\n\n[x](#foo/2)')
  assert.ok(html.includes('id="foo-2"'))
  assert.ok(html.includes('href="#foo/2"'))
})

test('setext headings, formatted text and different levels share numbering', () => {
  const md = new MarkdownIt().use(headingAnchors)
  const html = md.render(
    'Title\n=====\n\n# *Notes*\n\n## Notes\n\n# Title {#t}')
  assert.ok(html.includes('<h1 id="title">'))
  assert.ok(html.includes('<h1 id="notes">'))
  assert.ok(html.includes('<h2 id="notes-2">'))
  assert.ok(html.includes('<h1 id="t">Title</h1>'))
  assert.ok(!html.includes('{#t}'))
})

test('explicit id marker inside inline emphasis is removed', () => {
  const md = new MarkdownIt().use(headingAnchors)
  const html = md.render('# Hello *world {#hi}*')
  assert.ok(html.includes('id="hi"'))
  assert.ok(html.includes('<em>world</em>'))
  assert.ok(!html.includes('{#hi}'))
})

test('prefix applies to explicit ids and keeps snippets isolated', () => {
  const md = new MarkdownIt().use(headingAnchors)
  const a = md.render('# Sec {#sec}', { headingAnchorsPrefix: 'a-' })
  const b = md.render('# Sec {#sec}', { headingAnchorsPrefix: 'b-' })
  const c = md.render('# Sec {#sec}', {})
  assert.ok(a.includes('id="a-sec"'))
  assert.ok(b.includes('id="b-sec"'))
  assert.ok(c.includes('id="sec"'))
})

test('second parse produces identical output after a collision error', () => {
  const md = new MarkdownIt().use(headingAnchors)
  assert.throws(() => md.render('# Ok {#x}\n\n# Bad {#x}'))
  // The failed render must not poison state for later parses with fresh env.
  assert.equal(
    md.render('# Clean\n\n# Clean', {}),
    '<h1 id="clean">Clean</h1>\n<h1 id="clean-2">Clean</h1>\n'
  )
})

test('state is rebuilt for every parse, even when env is reused', () => {
  const md = new MarkdownIt().use(headingAnchors)
  const env = {}
  md.render('# T\n\n# T', env)
  md.render('# T', env)
  const info = getAnchors(env)
  assert.deepEqual(ids(info.anchors), ['t'])
  assert.deepEqual(info.unresolvedReferences, [])

  // A failed render is also fully replaced by the next one on the same env.
  const env2 = {}
  assert.throws(() => md.render('# A {#z}\n\n# B {#z}', env2))
  assert.doesNotThrow(() => md.render('# Fine', env2))
  assert.deepEqual(ids(getAnchors(env2).anchors), ['fine'])
})
