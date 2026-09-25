import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import markdownit from '../../src/index.ts'
import headingRef, { defaultSlugify } from '../../src/plugins/heading_ref.ts'

const fullWidthHelloWorld = '\uFF28\uFF45\uFF4C\uFF4C\uFF4F\u3000\uFF37\uFF4F\uFF52\uFF4C\uFF44'

function makeMd (options) {
  return markdownit().use(headingRef, options)
}

describe('heading_ref slugify', function () {
  it('normalizes NFKC, lowercases and hyphenates whitespace', function () {
    assert.strictEqual(defaultSlugify('Hello World'), 'hello-world')
    assert.strictEqual(defaultSlugify('Multiple   \t Spaces'), 'multiple-spaces')
  })

  it('handles full-width characters via NFKC', function () {
    assert.strictEqual(defaultSlugify(fullWidthHelloWorld), 'hello-world')
  })

  it('drops punctuation but keeps letters, numbers, marks, _ and -', function () {
    assert.strictEqual(defaultSlugify('Hello, World! (v2)'), 'hello-world-v2')
    assert.strictEqual(defaultSlugify('a_b-c'), 'a_b-c')
    assert.strictEqual(defaultSlugify('C++ & C#'), 'c--c')
  })

  it('uses section for empty slugs', function () {
    assert.strictEqual(defaultSlugify(''), 'section')
    assert.strictEqual(defaultSlugify('!!!'), 'section')
  })
})

describe('heading_ref anchors', function () {
  it('assigns fixed anchors for hello / hello / hello-2', function () {
    const md = makeMd()
    const html = md.render('# hello\n\n# hello\n\n# hello-2\n')
    assert.strictEqual(
      html,
      '<h1 id="hello">hello</h1>\n' +
      '<h1 id="hello-2">hello</h1>\n' +
      '<h1 id="hello-2-2">hello-2</h1>\n'
    )
  })

  it('keeps anchors unique for Hello / Hello / Hello-2', function () {
    const md = makeMd()
    const env = {}
    const html = md.render('# Hello\n\n# Hello\n\n# Hello-2\n', env)
    const ids = [...html.matchAll(/id="([^"]+)"/g)].map(m => m[1])
    assert.deepStrictEqual(ids, ['hello', 'hello-2', 'hello-2-2'])
    assert.strictEqual(new Set(ids).size, 3)
    assert.deepStrictEqual(env.headingRefs.anchors, ['hello', 'hello-2', 'hello-2-2'])
  })

  it('keeps incrementing on collision until the anchor is free', function () {
    const md = makeMd()
    const env = {}
    md.render('# hello\n\n# hello\n\n# hello-2\n\n# hello\n', env)
    assert.deepStrictEqual(env.headingRefs.anchors, ['hello', 'hello-2', 'hello-2-2', 'hello-3'])
  })

  it('uses section for headings without visible text', function () {
    const md = makeMd()
    const env = {}
    md.render('# !!!\n\n# ???\n', env)
    assert.deepStrictEqual(env.headingRefs.anchors, ['section', 'section-2'])
  })

  it('derives slugs from full-width headings', function () {
    const md = makeMd()
    const html = md.render('# ' + fullWidthHelloWorld + '\n')
    assert.strictEqual(html, '<h1 id="hello-world">' + fullWidthHelloWorld + '</h1>\n')
  })

  it('values code, image alt and inline styles explicitly', function () {
    const md = markdownit({ html: true }).use(headingRef)
    const env = {}
    // code_inline contributes content, image contributes alt text,
    // html_inline (tags / inline styles) contributes nothing
    md.render('# `Code` ![Alt Text](x.png) <span style="color:red">Bold</span>\n', env)
    assert.deepStrictEqual(env.headingRefs.anchors, ['code-alt-text-bold'])
  })
})

describe('heading_ref references', function () {
  it('resolves forward references to the first matching anchor', function () {
    const md = makeMd()
    const html = md.render('See [[#Hello]] first.\n\n# Hello\n\n# Hello\n\n# Hello-2\n')
    assert.strictEqual(
      html,
      '<p>See <a href="#hello">#Hello</a> first.</p>\n' +
      '<h1 id="hello">Hello</h1>\n' +
      '<h1 id="hello-2">Hello</h1>\n' +
      '<h1 id="hello-2-2">Hello-2</h1>\n'
    )
  })

  it('resolves backward references and document titles of the current file', function () {
    const md = makeMd({ currentDocument: 'Specs' })
    const html = md.render('# Intro\n\nBack to [[Specs#Intro]].\n')
    assert.strictEqual(
      html,
      '<h1 id="intro">Intro</h1>\n' +
      '<p>Back to <a href="#intro">Specs#Intro</a>.</p>\n'
    )
  })

  it('resolves external documents through the caller-provided index', function () {
    const md = makeMd({ documents: { Guide: 'https://example.com/guide' } })
    const html = md.render('Read [[Guide#Install Notes]].\n')
    assert.strictEqual(
      html,
      '<p>Read <a href="https://example.com/guide#install-notes">Guide#Install Notes</a>.</p>\n'
    )
  })

  it('checks known anchors of the index when provided', function () {
    const md = makeMd({
      documents: { Guide: { href: 'https://example.com/guide', anchors: ['install'] } }
    })
    const env = {}
    const html = md.render('[[Guide#Install]] vs [[Guide#Missing]]\n', env)
    assert.strictEqual(
      html,
      '<p><a href="https://example.com/guide#install">Guide#Install</a> vs [[Guide#Missing]]</p>\n'
    )
    assert.strictEqual(env.headingRefs.diagnostics.length, 1)
    assert.strictEqual(env.headingRefs.diagnostics[0].reason, 'missing-anchor')
  })

  it('escapes HTML in hrefs and literal output', function () {
    const md = makeMd({ documents: { 'A&B': 'https://x.test/?a=1&b=2' } })
    const html = md.render('[[A&B#Part]] and [[#<b>]]\n')
    assert.strictEqual(
      html,
      '<p><a href="https://x.test/?a=1&amp;b=2#part">A&amp;B#Part</a> and [[#&lt;b&gt;]]</p>\n'
    )
  })

  it('ignores pseudo references inside code fences and inline code', function () {
    const md = makeMd({ documents: { Guide: 'https://example.com/guide' } })
    const env = {}
    const html = md.render('```\n[[Guide#Install]]\n```\n\n`[[Guide#Install]]`\n', env)
    assert.strictEqual(
      html,
      '<pre><code>[[Guide#Install]]\n</code></pre>\n' +
      '<p><code>[[Guide#Install]]</code></p>\n'
    )
    assert.deepStrictEqual(env.headingRefs.diagnostics, [])
    assert.deepStrictEqual(env.headingRefs.resolved, [])
  })
})

describe('heading_ref diagnostics on tokens', function () {
  it('leaves unresolved references in token diagnostics', function () {
    const md = makeMd()
    const tokens = md.parse('[[Nowhere#Ghost]] and [[#Ghost]]\n', {})
    const inline = tokens.find(t => t.type === 'inline')
    const texts = inline.children.filter(t => t.meta && t.meta.diagnostics)
    assert.strictEqual(texts.length, 2)
    assert.strictEqual(texts[0].type, 'text')
    assert.strictEqual(texts[0].content, '[[Nowhere#Ghost]]')
    assert.deepStrictEqual(texts[0].meta.diagnostics, [{
      code: 'unresolved-heading-ref',
      doc: 'Nowhere',
      heading: 'Ghost',
      raw: '[[Nowhere#Ghost]]',
      reason: 'unknown-document'
    }])
    assert.strictEqual(texts[1].meta.diagnostics[0].reason, 'missing-anchor')
  })

  it('sets id attributes on heading_open tokens', function () {
    const md = makeMd()
    const tokens = md.parse('# Hello\n\n# Hello\n', {})
    const heads = tokens.filter(t => t.type === 'heading_open')
    assert.strictEqual(heads[0].attrGet('id'), 'hello')
    assert.strictEqual(heads[1].attrGet('id'), 'hello-2')
  })
})

describe('heading_ref render isolation', function () {
  it('does not leak state between renders', function () {
    const md = makeMd()
    const first = {}
    md.render('# Hello\n\n[[#Hello]]\n', first)
    assert.deepStrictEqual(first.headingRefs.anchors, ['hello'])
    assert.strictEqual(first.headingRefs.resolved.length, 1)

    const second = {}
    const html = md.render('[[#Hello]]\n', second)
    assert.strictEqual(html, '<p>[[#Hello]]</p>\n')
    assert.deepStrictEqual(second.headingRefs.anchors, [])
    assert.strictEqual(second.headingRefs.diagnostics.length, 1)
  })

  it('does not leak state when the caller reuses the env object', function () {
    const md = makeMd()
    const env = {}
    md.render('# Hello\n', env)
    assert.deepStrictEqual(env.headingRefs.anchors, ['hello'])
    const html = md.render('no headings here\n', env)
    assert.strictEqual(html, '<p>no headings here</p>\n')
    assert.deepStrictEqual(env.headingRefs.anchors, [])
  })
})