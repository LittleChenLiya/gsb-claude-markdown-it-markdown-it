import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import markdownit from '../../src/index.ts'

const BACKREF = '\u21a9\uFE0E'

function footnoteBlock (items) {
  return '<hr class="footnotes-sep">\n' +
    '<section class="footnotes">\n' +
    '<ol class="footnotes-list">\n' +
    items.join('') +
    '</ol>\n</section>\n'
}

describe('footnote tokens', function () {
  it('should assign numbers in order of first reference', function () {
    const md = markdownit()
    const env = {}
    const tokens = md.parse('first[^b] then[^a]\n\n[^a]: note a\n[^b]: note b\n', env)

    const inline = tokens.find(t => t.type === 'inline')
    const refs = inline.children.filter(t => t.type === 'footnote_ref')
    assert.strictEqual(refs.length, 2)
    assert.deepStrictEqual(refs[0].meta, { id: 0, subId: 0, label: 'b' })
    assert.deepStrictEqual(refs[1].meta, { id: 1, subId: 0, label: 'a' })

    assert.deepStrictEqual(env.footnotes.list, [
      { label: 'b', count: 1 },
      { label: 'a', count: 1 }
    ])
  })

  it('should count repeated references with per-occurrence subIds', function () {
    const md = markdownit()
    const tokens = md.parse('a[^x] b[^x]\n\n[^x]: note\n', {})

    const inline = tokens.find(t => t.type === 'inline')
    const refs = inline.children.filter(t => t.type === 'footnote_ref')
    assert.strictEqual(refs.length, 2)
    assert.deepStrictEqual(refs[0].meta, { id: 0, subId: 0, label: 'x' })
    assert.deepStrictEqual(refs[1].meta, { id: 0, subId: 1, label: 'x' })
  })

  it('should move definition bodies to a footnote block at the end', function () {
    const md = markdownit()
    const tokens = md.parse('text[^a]\n\n[^a]: body\n', {})
    const types = tokens.map(t => t.type)

    assert.deepStrictEqual(types, [
      'paragraph_open',
      'inline',
      'paragraph_close',
      'footnote_block_open',
      'footnote_open',
      'paragraph_open',
      'inline',
      'footnote_anchor',
      'paragraph_close',
      'footnote_close',
      'footnote_block_close'
    ])

    const open = tokens.find(t => t.type === 'footnote_open')
    assert.deepStrictEqual(open.meta, { id: 0, label: 'a' })
    const anchor = tokens.find(t => t.type === 'footnote_anchor')
    assert.deepStrictEqual(anchor.meta, { id: 0, subId: 0, label: 'a' })
  })

  it('should emit one anchor token per reference', function () {
    const md = markdownit()
    const tokens = md.parse('a[^x] b[^x]\n\n[^x]: note\n', {})
    const anchors = tokens.filter(t => t.type === 'footnote_anchor')
    assert.strictEqual(anchors.length, 2)
    assert.strictEqual(anchors[0].meta.subId, 0)
    assert.strictEqual(anchors[1].meta.subId, 1)
  })

  it('should keep missing references as literal text tokens', function () {
    const md = markdownit()
    const tokens = md.parse('foo[^nope] bar', {})
    const inline = tokens.find(t => t.type === 'inline')
    const texts = inline.children.filter(t => t.type === 'text').map(t => t.content)
    assert.ok(texts.some(c => c.includes('[^nope]')))
    assert.strictEqual(tokens.filter(t => t.type === 'footnote_ref').length, 0)
  })
})

describe('footnote html', function () {
  it('should number by first reference order, not definition order', function () {
    const md = markdownit()
    assert.strictEqual(
      md.render('first[^b] then[^a].\n\n[^a]: note a\n[^b]: note b\n'),
      '<p>first<sup class="footnote-ref"><a href="#fn1" id="fnref1">[1]</a></sup>' +
      ' then<sup class="footnote-ref"><a href="#fn2" id="fnref2">[2]</a></sup>.</p>\n' +
      footnoteBlock([
        '<li id="fn1" class="footnote-item"><p>note b <a href="#fnref1" class="footnote-backref">' + BACKREF + '</a></p>\n</li>\n',
        '<li id="fn2" class="footnote-item"><p>note a <a href="#fnref2" class="footnote-backref">' + BACKREF + '</a></p>\n</li>\n'
      ])
    )
  })

  it('should generate one back-link per reference to the same footnote', function () {
    const md = markdownit()
    const html = md.render('a[^x] b[^x]\n\n[^x]: note\n')

    assert.ok(html.includes('id="fnref1"'))
    assert.ok(html.includes('id="fnref1:1"'))
    assert.ok(html.includes('<a href="#fnref1" class="footnote-backref">'))
    assert.ok(html.includes('<a href="#fnref1:1" class="footnote-backref">'))
    assert.strictEqual(html.match(/class="footnote-backref"/g).length, 2)
  })

  it('should resolve references both before and after their definition', function () {
    const md = markdownit()
    const before = md.render('ref[^a]\n\n[^a]: defined after\n')
    const after = md.render('[^a]: defined before\n\nref[^a]\n')

    for (const html of [before, after]) {
      assert.ok(html.includes('href="#fn1" id="fnref1"'))
      assert.ok(html.includes('id="fn1" class="footnote-item"'))
    }
    assert.ok(before.includes('defined after'))
    assert.ok(after.includes('defined before'))
  })

  it('should support multi-paragraph footnotes', function () {
    const md = markdownit()
    const html = md.render('ref[^p]\n\n[^p]: first para\n\n    second para\n')

    assert.ok(html.includes('<p>first para</p>\n<p>second para <a href="#fnref1" class="footnote-backref">'))
  })

  it('should support nested lists inside footnotes', function () {
    const md = markdownit()
    const html = md.render('ref[^l]\n\n[^l]: text\n    - item1\n    - item2\n')

    assert.ok(html.includes('<ul>'))
    assert.ok(html.includes('<li>item1</li>'))
    assert.ok(html.includes('<li>item2</li>'))
  })

  it('should escape html in footnote content', function () {
    const md = markdownit()
    const html = md.render('ref[^e]\n\n[^e]: a < b & "c"\n')

    assert.ok(html.includes('a &lt; b &amp; &quot;c&quot;'))
  })

  it('should not output unused definitions', function () {
    const md = markdownit()
    const html = md.render('just text\n\n[^unused]: ghost\n')

    assert.strictEqual(html, '<p>just text</p>\n')
  })

  it('should keep missing definitions visible and report them', function () {
    const md = markdownit()
    const env = {}
    const html = md.render('foo[^nope] bar', env)

    assert.strictEqual(html, '<p>foo[^nope] bar</p>\n')
    assert.deepStrictEqual(env.footnoteDiagnostics, [
      { type: 'missing-definition', name: 'nope' }
    ])
  })

  it('should keep the first of duplicate definitions and report later ones', function () {
    const md = markdownit()
    const env = {}
    const html = md.render('use[^a]\n\n[^a]: first\n[^a]: second\n', env)

    assert.ok(html.includes('first'))
    assert.ok(!html.includes('second'))
    assert.deepStrictEqual(env.footnoteDiagnostics, [
      { type: 'duplicate-definition', name: 'a' }
    ])
  })

  it('should not treat markers in fences, code spans or escapes as footnotes', function () {
    const md = markdownit()
    const env = {}
    const html = md.render(
      '```\n[^a]: not a definition\n\n```\n' +
      '\n' +
      '`[^b]` and \\[^c]\n',
      env
    )

    assert.ok(html.includes('[^a]: not a definition'))
    assert.ok(html.includes('<code>[^b]</code>'))
    assert.ok(html.includes('[^c]'))
    assert.ok(!html.includes('footnote'))
    assert.strictEqual(env.footnoteDiagnostics, undefined)
  })

  it('should not share state between repeated renders', function () {
    const md = markdownit()
    const src = 'a[^x] b[^x]\n\n[^x]: note\n'
    const first = md.render(src)
    const second = md.render(src)

    assert.strictEqual(first, second)
    assert.strictEqual(first.match(/class="footnote-backref"/g).length, 2)
    assert.ok(!first.includes('fnref1:2'))
  })
})

describe('footnote namespaces', function () {
  const src = 'text[^a] and[^b]\n\n[^a]: note a\n[^b]: note b\n'

  it('should prefix ids with the caller-provided namespace', function () {
    const md = markdownit()
    const html = md.render(src, { footnoteNamespace: 'doc1' })

    assert.ok(html.includes('href="#doc1-fn1" id="doc1-fnref1"'))
    assert.ok(html.includes('id="doc1-fn1" class="footnote-item"'))
    assert.ok(html.includes('href="#doc1-fnref1" class="footnote-backref"'))
  })

  it('should produce unique ids when fragments with different namespaces are merged', function () {
    const md = markdownit()
    const html1 = md.render(src, { footnoteNamespace: 'part1' })
    const html2 = md.render(src, { footnoteNamespace: 'part2' })
    const merged = html1 + html2

    const ids = [...merged.matchAll(/ id="([^"]+)"/g)].map(m => m[1])
    assert.strictEqual(ids.length, new Set(ids).size)

    const hrefs = [...merged.matchAll(/ href="#([^"]+)"/g)].map(m => m[1])
    for (const href of hrefs) {
      assert.ok(ids.includes(href), 'back-link target exists: ' + href)
    }
  })

  it('should escape the namespace in html attributes', function () {
    const md = markdownit()
    const html = md.render('x[^a]\n\n[^a]: note\n', { footnoteNamespace: 'evil"><script' })

    assert.ok(!html.includes('evil"><script'))
    assert.ok(html.includes('evil&quot;&gt;&lt;script-fn1'))
  })
})
