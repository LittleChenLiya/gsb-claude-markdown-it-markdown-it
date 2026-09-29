import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import markdownit from '../../src/index.ts'

const footnote = markdownit.footnote

function md (options) {
  return markdownit().use(footnote, options)
}

describe('footnote: numbering and references', function () {
  it('numbers footnotes by order of first reference, not definition', function () {
    const html = md().render('first[^b] then[^a]\n\n[^a]: note a\n[^b]: note b\n')

    // b is referenced first, so it gets number 1; a gets number 2
    assert.ok(html.indexOf('id="fnref1"') > -1)
    assert.ok(html.indexOf('id="fnref2"') > -1)
    assert.ok(html.indexOf('<li id="fn1" class="footnote-item"><p>note b') > -1)
    assert.ok(html.indexOf('<li id="fn2" class="footnote-item"><p>note a') > -1)
    // reference captions
    assert.ok(html.indexOf('>[1]</a>') < html.indexOf('>[2]</a>'))
  })

  it('resolves references both before and after definitions', function () {
    const src = 'forward[^late] and backward[^early]\n\n[^early]: defined first\n\npara\n\n[^late]: defined last\n'
    const html = md().render(src)

    // [^late] is referenced first, so the later definition gets number 1
    assert.ok(html.indexOf('<li id="fn1" class="footnote-item"><p>defined last') > -1)
    assert.ok(html.indexOf('<li id="fn2" class="footnote-item"><p>defined first') > -1)
  })

  it('generates one backlink per reference, in reference order', function () {
    const html = md().render('one[^b] two[^b] three[^b]\n\n[^b]: note\n')

    assert.ok(html.indexOf('id="fnref1"') > -1)
    assert.ok(html.indexOf('id="fnref1:1"') > -1)
    assert.ok(html.indexOf('id="fnref1:2"') > -1)

    // backlink targets are fixed by reference occurrence order
    const backlinks = html.match(/href="#fnref1[^"]*" class="footnote-backref"/g)
    assert.deepStrictEqual(backlinks, [
      'href="#fnref1" class="footnote-backref"',
      'href="#fnref1:1" class="footnote-backref"',
      'href="#fnref1:2" class="footnote-backref"'
    ])
  })

  it('does not render unused definitions', function () {
    const html = md().render('text[^used]\n\n[^used]: yes\n[^unused]: no\n')

    assert.ok(html.indexOf('yes') > -1)
    assert.ok(html.indexOf('no</p>') === -1)
    assert.ok(html.indexOf('fn2') === -1)
  })
})

describe('footnote: namespaces', function () {
  const src = 'text[^a]\n\n[^a]: note\n'

  it('prefixes ids with the namespace from plugin options', function () {
    const html = md({ namespace: 'doc1' }).render(src)

    assert.ok(html.indexOf('href="#doc1-fn1"') > -1)
    assert.ok(html.indexOf('id="doc1-fnref1"') > -1)
    assert.ok(html.indexOf('id="doc1-fn1"') > -1)
    assert.ok(html.indexOf('href="#doc1-fnref1"') > -1)
  })

  it('allows per-render namespace override via env', function () {
    const instance = md({ namespace: 'opt' })
    const html = instance.render(src, { footnoteNamespace: 'env1' })

    assert.ok(html.indexOf('id="env1-fn1"') > -1)
    assert.ok(html.indexOf('opt-fn') === -1)
  })

  it('produces unique ids when fragments with different namespaces are merged', function () {
    const instance = md()
    const frag1 = instance.render(src, { footnoteNamespace: 'page1' })
    const frag2 = instance.render(src, { footnoteNamespace: 'page2' })
    const combined = frag1 + frag2

    const ids = [...combined.matchAll(/ id="([^"]+)"/g)].map(m => m[1])
    assert.strictEqual(ids.length, new Set(ids).size)

    const hrefs = [...combined.matchAll(/ href="#([^"]+)"/g)].map(m => m[1])
    assert.strictEqual(hrefs.length, new Set(hrefs).size)
    // every href target exists as an id
    for (const href of hrefs) {
      assert.ok(ids.includes(href), 'missing id for ' + href)
    }
  })

  it('escapes namespace in HTML attributes', function () {
    const html = md().render(src, { footnoteNamespace: 'x"><img src=x onerror=alert(1)>' })

    assert.ok(html.indexOf('<img src=x onerror=alert(1)>') === -1)
    assert.ok(html.indexOf('id="x&quot;&gt;&lt;img src=x onerror=alert(1)&gt;-fnref1"') > -1)
  })
})

describe('footnote: definitions', function () {
  it('supports multi-paragraph definitions', function () {
    const html = md().render('ref[^a]\n\n[^a]: para one\n\n    para two\n')

    assert.ok(html.indexOf('<p>para one</p>') > -1)
    assert.ok(html.indexOf('<p>para two') > -1)
  })

  it('supports nested lists inside definitions', function () {
    const html = md().render('ref[^a]\n\n[^a]: text\n\n    - item 1\n    - item 2\n')

    assert.ok(html.indexOf('<ul>') > -1)
    assert.ok(html.indexOf('<li>item 1</li>') > -1)
    assert.ok(html.indexOf('<li>item 2</li>') > -1)
  })

  it('parses definition content as regular blocks and inline markup', function () {
    const html = md().render('ref[^a]\n\n[^a]: text with *emphasis* and `code`\n')

    assert.ok(html.indexOf('<em>emphasis</em>') > -1)
    assert.ok(html.indexOf('<code>code</code>') > -1)
  })

  it('supports definitions nested in lists', function () {
    const html = md().render('- item\n\n  [^a]: def in list\n\nref[^a]\n')

    assert.ok(html.indexOf('<li id="fn1" class="footnote-item"><p>def in list') > -1)
  })

  it('keeps first definition on duplicates and reports the rest', function () {
    const env = {}
    const html = md().render('ref[^a]\n\n[^a]: first\n[^a]: second\n[^a]: third\n', env)

    assert.ok(html.indexOf('<p>first') > -1)
    assert.ok(html.indexOf('second') === -1)
    assert.ok(html.indexOf('third') === -1)

    const duplicates = env.footnotes.diagnostics.filter(d => d.type === 'duplicate-definition')
    assert.strictEqual(duplicates.length, 2)
    assert.strictEqual(duplicates[0].label, 'a')
    assert.strictEqual(duplicates[1].label, 'a')
  })
})

describe('footnote: missing definitions', function () {
  it('keeps visible source text and reports diagnostics', function () {
    const env = {}
    const html = md().render('text[^missing] more[^missing]\n', env)

    assert.ok(html.indexOf('<p>text[^missing] more[^missing]</p>') > -1)
    assert.ok(html.indexOf('footnote') === -1 || html.indexOf('class="footnotes"') === -1)

    const missing = env.footnotes.diagnostics.filter(d => d.type === 'missing-definition')
    assert.strictEqual(missing.length, 1)
    assert.strictEqual(missing[0].label, 'missing')
  })

  it('escapes HTML in unresolved reference text', function () {
    const html = md().render('text[^<b>x</b>]\n')

    assert.ok(html.indexOf('[^&lt;b&gt;x&lt;/b&gt;]') > -1)
    assert.ok(html.indexOf('<b>x</b>') === -1)
  })
})

describe('footnote: non-footnote contexts', function () {
  const env = {}

  it('ignores markers in fenced code blocks', function () {
    const html = md().render('```\n[^a]: not a definition\n```\n', env)

    assert.ok(html.indexOf('class="footnotes"') === -1)
    assert.ok(html.indexOf('<code>') > -1)
  })

  it('ignores markers in inline code', function () {
    const html = md().render('`[^a]` and [^a]\n\n[^a]: note\n')

    assert.ok(html.indexOf('<code>[^a]</code>') > -1)
    // only one real reference
    assert.strictEqual((html.match(/class="footnote-ref"/g) || []).length, 1)
  })

  it('ignores escaped markers', function () {
    const html = md().render('\\[^a]\n\n[^a]: unused now\n')

    assert.ok(html.indexOf('<p>[^a]</p>') > -1)
    assert.ok(html.indexOf('class="footnotes"') === -1)
  })

  it('ignores indented code blocks', function () {
    const html = md().render('para\n\n    [^a]: not a definition\n')

    assert.ok(html.indexOf('<code>') > -1)
    assert.ok(html.indexOf('class="footnotes"') === -1)
  })
})

describe('footnote: render state', function () {
  it('does not share state between renders, even with reused env', function () {
    const instance = md()
    const env = {}
    const src = 'text[^a]\n\n[^a]: note\n'

    const html1 = instance.render(src, env)
    const html2 = instance.render(src, env)

    assert.strictEqual(html1, html2)
    assert.strictEqual(env.footnotes.diagnostics.length, 0)
    assert.strictEqual(env.footnotes.list.length, 1)
    assert.strictEqual(env.footnotes.list[0].count, 1)
  })

  it('resets diagnostics between renders', function () {
    const instance = md()
    const env = {}

    instance.render('one[^missing]\n', env)
    assert.strictEqual(env.footnotes.diagnostics.length, 1)

    instance.render('two[^also-missing]\n', env)
    assert.strictEqual(env.footnotes.diagnostics.length, 1)
    assert.strictEqual(env.footnotes.diagnostics[0].label, 'also-missing')
  })
})

describe('footnote: tokens', function () {
  it('emits footnote_ref tokens with id/subId/label meta', function () {
    const instance = md()
    const tokens = instance.parse('a[^x] b[^x]\n\n[^x]: note\n', {})

    const inline = tokens.find(t => t.type === 'inline')
    const refs = inline.children.filter(t => t.type === 'footnote_ref')

    assert.strictEqual(refs.length, 2)
    assert.deepStrictEqual(refs[0].meta, { id: 0, subId: 0, label: 'x' })
    assert.deepStrictEqual(refs[1].meta, { id: 0, subId: 1, label: 'x' })
  })

  it('appends footnote block tokens at the end', function () {
    const instance = md()
    const tokens = instance.parse('a[^y] b[^y]\n\n[^y]: note\n', {})
    const types = tokens.map(t => t.type)

    assert.deepStrictEqual(types.slice(3), [
      'footnote_block_open',
      'footnote_open',
      'paragraph_open',
      'inline',
      'footnote_anchor',
      'footnote_anchor',
      'paragraph_close',
      'footnote_close',
      'footnote_block_close'
    ])

    const anchors = tokens.filter(t => t.type === 'footnote_anchor')
    assert.deepStrictEqual(anchors[0].meta, { id: 0, subId: 0, label: 'y' })
    assert.deepStrictEqual(anchors[1].meta, { id: 0, subId: 1, label: 'y' })

    const open = tokens.find(t => t.type === 'footnote_open')
    assert.deepStrictEqual(open.meta, { id: 0, label: 'y' })
  })

  it('removes definition tokens of unused footnotes from the stream', function () {
    const instance = md()
    const tokens = instance.parse('text\n\n[^unused]: gone\n', {})
    const types = tokens.map(t => t.type)

    assert.ok(!types.includes('footnote_reference_open'))
    assert.ok(!types.includes('footnote_block_open'))
    assert.deepStrictEqual(types, ['paragraph_open', 'inline', 'paragraph_close'])
  })
})
