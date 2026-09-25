import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import markdownit from '../../src/index.ts'
import headingRefs, { slugifyHeading } from '../../src/plugins/heading_refs.ts'

function mdWith (options) {
  return markdownit({ html: true }).use(headingRefs, options)
}

describe('heading_refs plugin', function () {
  it('slugifyHeading follows the documented rules', function () {
    assert.strictEqual(slugifyHeading('Hello, World!'), 'hello-world')
    assert.strictEqual(slugifyHeading('Ｈｅｌｌｏ　Ｗｏｒｌｄ'), 'hello-world')
    // punctuation is removed without collapsing adjacent hyphens
    assert.strictEqual(slugifyHeading('C++ & C#'), 'c--c')
    assert.strictEqual(slugifyHeading('already_slugged-values'), 'already_slugged-values')
    assert.strictEqual(slugifyHeading(''), 'section')
    assert.strictEqual(slugifyHeading('!!!'), 'section')
  })

  it('assigns unique anchors: hello, hello, hello-2 -> hello, hello-3, hello-2', function () {
    // Fixed expectation: the first heading keeps its natural slug, the
    // duplicate skips 'hello-2' (reserved by the real 'hello-2' heading)
    // and lands on 'hello-3'; the real 'hello-2' heading keeps its slug.
    const env = {}
    const html = mdWith().render(
      'Fwd: [[#hello]].\n\n' +
      '# Hello\n\n' +
      '# Hello\n\n' +
      '# Hello-2\n',
      env
    )
    assert.strictEqual(
      html,
      '<p>Fwd: <a href="#hello">#hello</a>.</p>\n' +
      '<h1 id="hello">Hello</h1>\n' +
      '<h1 id="hello-3">Hello</h1>\n' +
      '<h1 id="hello-2">Hello-2</h1>\n'
    )
    const anchors = env.headingRefs.headings.map(h => h.anchor)
    assert.deepStrictEqual(anchors, ['hello', 'hello-3', 'hello-2'])
    assert.strictEqual(new Set(anchors).size, anchors.length)
  })

  it('increments suffixes on collision until the anchor is free', function () {
    const env = {}
    mdWith().render('# hello\n\n# hello\n\n# hello\n\n# hello\n', env)
    assert.deepStrictEqual(
      env.headingRefs.headings.map(h => h.anchor),
      ['hello', 'hello-2', 'hello-3', 'hello-4']
    )
  })

  it('resolves forward references to the first matching heading', function () {
    const html = mdWith().render('See [[#hello]].\n\n# Hello\n\n# Hello\n')
    assert.strictEqual(
      html,
      '<p>See <a href="#hello">#hello</a>.</p>\n' +
      '<h1 id="hello">Hello</h1>\n' +
      '<h1 id="hello-2">Hello</h1>\n'
    )
  })

  it('resolves references against the caller-provided document index', function () {
    const md = mdWith({
      docName: 'Home',
      docs: { Guide: { 'Getting Started': '/guide/#getting-started' } }
    })
    const html = md.render('See [[Guide#Getting Started]] and [[Home#Intro]].\n\n# Intro\n')
    assert.strictEqual(
      html,
      '<p>See <a href="/guide/#getting-started">Guide#Getting Started</a>' +
      ' and <a href="#intro">Home#Intro</a>.</p>\n' +
      '<h1 id="intro">Intro</h1>\n'
    )
  })

  it('keeps unresolved references as text and records token diagnostics', function () {
    const md = mdWith()
    const env = {}
    const html = md.render('Missing [[#Nope]] and [[Unknown#Doc]].\n\n# Real\n', env)
    assert.strictEqual(
      html,
      '<p>Missing [[#Nope]] and [[Unknown#Doc]].</p>\n<h1 id="real">Real</h1>\n'
    )
    assert.deepStrictEqual(env.headingRefs.diagnostics, [
      { doc: '', heading: 'Nope', source: '[[#Nope]]', reason: 'missing-heading' },
      { doc: 'Unknown', heading: 'Doc', source: '[[Unknown#Doc]]', reason: 'missing-doc' }
    ])

    const tokens = md.parse('Missing [[#Nope]].\n', {})
    const inline = tokens.find(t => t.type === 'inline')
    const broken = inline.children.find(t => t.meta && t.meta.headingRef)
    assert.strictEqual(broken.type, 'text')
    assert.strictEqual(broken.content, '[[#Nope]]')
    assert.strictEqual(broken.meta.headingRef.resolved, false)
    assert.strictEqual(broken.meta.headingRef.reason, 'missing-heading')
  })

  it('marks resolved link tokens with headingRef meta', function () {
    const tokens = mdWith().parse('# Target\n\n[[#target]]\n', {})
    const inline = tokens.find(
      t => t.type === 'inline' && t.children.some(c => c.type === 'link_open')
    )
    const open = inline.children.find(c => c.type === 'link_open')
    assert.strictEqual(open.attrGet('href'), '#target')
    assert.deepStrictEqual(open.meta.headingRef, {
      doc: '',
      heading: 'target',
      source: '[[#target]]',
      resolved: true,
      href: '#target'
    })
  })

  it('normalizes full-width characters via NFKC', function () {
    const env = {}
    const html = mdWith().render(
      '# Ｈｅｌｌｏ　Ｗｏｒｌｄ\n\nGo to [[#Ｈｅｌｌｏ　Ｗｏｒｌｄ]].\n',
      env
    )
    assert.strictEqual(env.headingRefs.headings[0].anchor, 'hello-world')
    assert.strictEqual(
      html,
      '<h1 id="hello-world">Ｈｅｌｌｏ　Ｗｏｒｌｄ</h1>\n' +
      '<p>Go to <a href="#hello-world">#Ｈｅｌｌｏ　Ｗｏｒｌｄ</a>.</p>\n'
    )
  })

  it('ignores pseudo references inside code fences and inline code', function () {
    const src =
      '# Real\n\n' +
      '```\n[[#real]]\n```\n\n' +
      '`[[#real]]` and [[#real]].\n'
    const html = mdWith().render(src)
    assert.strictEqual(
      html,
      '<h1 id="real">Real</h1>\n' +
      '<pre><code>[[#real]]\n</code></pre>\n' +
      '<p><code>[[#real]]</code> and <a href="#real">#real</a>.</p>\n'
    )
  })

  it('escapes HTML in reference labels and unresolved sources', function () {
    const md = markdownit().use(headingRefs)
    const html = md.render('# a & b\n\n[[#a & b]] and [[#x <y>]].\n')
    assert.strictEqual(
      html,
      '<h1 id="a--b">a &amp; b</h1>\n' +
      '<p><a href="#a--b">#a &amp; b</a> and [[#x &lt;y&gt;]].</p>\n'
    )
  })

  it('derives anchor text from code spans and image alt, ignoring inline html', function () {
    const env = {}
    mdWith().render(
      '# Hello `code` ![alt](x.png) <span style="color:red">world</span>\n',
      env
    )
    assert.strictEqual(env.headingRefs.headings[0].text, 'Hello code alt world')
    assert.strictEqual(env.headingRefs.headings[0].anchor, 'hello-code-alt-world')
  })

  it('uses "section" for empty headings', function () {
    const env = {}
    mdWith().render('#\n\n# !!!\n', env)
    assert.deepStrictEqual(
      env.headingRefs.headings.map(h => h.anchor),
      ['section', 'section-2']
    )
  })

  it('does not leak state between repeated renders', function () {
    const md = mdWith()
    const src = '# Hello\n\n[[#missing]]\n'
    const first = md.render(src)
    const second = md.render(src)
    assert.strictEqual(first, second)

    const env = {}
    md.render(src, env)
    md.render(src, env)
    assert.strictEqual(env.headingRefs.diagnostics.length, 1)
    assert.deepStrictEqual(env.headingRefs.headings.map(h => h.anchor), ['hello'])
  })
})
