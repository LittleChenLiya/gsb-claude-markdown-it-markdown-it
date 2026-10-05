import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import MarkdownIt from '../../src/markdownit.ts'
import { anchors, slugify } from '../../src/plugins/anchors.ts'

function makeParser (options) {
  return new MarkdownIt().use(anchors, options)
}

/** Test plugin that sets a fixed id on the first heading. */
function presetFirstHeadingId (md) {
  md.core.ruler.push('test_preset_first', (state) => {
    let first = true
    for (const tok of state.tokens) {
      if (tok.type === 'heading_open' && first) {
        tok.attrSet('id', 'custom')
        first = false
      }
    }
  })
}

/** Test plugin that sets the same id on every heading. */
function presetAllHeadingIds (md) {
  md.core.ruler.push('test_preset_all', (state) => {
    for (const tok of state.tokens) {
      if (tok.type === 'heading_open') tok.attrSet('id', 'dup')
    }
  })
}

describe('anchors plugin', function () {
  it('assigns an id to every heading', function () {
    const env = {}
    const out = makeParser().render('# Hello world', env)
    assert.equal(out, '<h1 id="hello-world">Hello world</h1>\n')
    assert.deepEqual(env.anchors.ids, ['hello-world'])
  })

  it('gives same-named headings different ids', function () {
    const out = makeParser().render('# Foo\n# Foo\n# Foo')
    assert.equal(out,
      '<h1 id="foo">Foo</h1>\n' +
      '<h1 id="foo-2">Foo</h1>\n' +
      '<h1 id="foo-3">Foo</h1>\n')
  })

  it('second parse is byte-identical (no global counter)', function () {
    const source = '# Foo\n# Foo\n# Foo'
    const parser = makeParser()
    const first = parser.render(source)
    const second = parser.render(source)
    assert.equal(first, second)
    assert.equal(first,
      '<h1 id="foo">Foo</h1>\n' +
      '<h1 id="foo-2">Foo</h1>\n' +
      '<h1 id="foo-3">Foo</h1>\n')
  })

  it('keeps numbering per parse even with a reused env', function () {
    const parser = makeParser()
    const env = {}
    parser.render('# Foo', env)
    assert.deepEqual(env.anchors.ids, ['foo'])
    parser.render('# Foo', env)
    assert.deepEqual(env.anchors.ids, ['foo'])
  })

  it('reports both positions on user id conflict', function () {
    const source = '# Foo {#dup}\n\ntext\n\n## Bar {#dup}'
    assert.throws(
      () => makeParser().render(source),
      (err) => {
        assert.match(err.message, /duplicate explicit anchor id "dup"/)
        assert.match(err.message, /first heading at line 1: "Foo"/)
        assert.match(err.message, /second heading at line 5: "Bar"/)
        return true
      }
    )
  })

  it('preserves an existing id attribute', function () {
    const parser = new MarkdownIt().use(presetFirstHeadingId).use(anchors)
    const out = parser.render('# A\n# B')
    assert.equal(out, '<h1 id="custom">A</h1>\n<h1 id="b">B</h1>\n')
  })

  it('includes existing id attributes in conflict detection', function () {
    const parser = new MarkdownIt().use(presetAllHeadingIds).use(anchors)
    assert.throws(
      () => parser.render('# A\n# B'),
      (err) => {
        assert.match(err.message, /duplicate explicit anchor id "dup"/)
        assert.match(err.message, /first heading at line 1: "A"/)
        assert.match(err.message, /second heading at line 2: "B"/)
        return true
      }
    )
  })

  it('slugifies Unicode with the documented rule', function () {
    assert.equal(slugify('Café'), 'cafe')
    assert.equal(slugify('Привет мир'), 'привет-мир')
    assert.equal(slugify('你好，世界'), '你好-世界')
    assert.equal(slugify('Hello, World!'), 'hello-world')
    assert.equal(slugify('  A & B  '), 'a-b')
    assert.equal(slugify('---'), 'heading')
    assert.equal(slugify(''), 'heading')
    assert.equal(slugify('!!!'), 'heading')
    assert.equal(slugify('ﬁle'), 'file')
  })

  it('parses explicit {#id} markers and strips them from text', function () {
    const out = makeParser().render('# Foo {#foo}\n# Foo')
    assert.equal(out,
      '<h1 id="foo">Foo</h1>\n' +
      '<h1 id="foo-2">Foo</h1>\n')
  })

  it('falls back to a deterministic id for empty slugs', function () {
    const out = makeParser().render('# !!!\n# !!!')
    assert.equal(out,
      '<h1 id="heading">!!!</h1>\n' +
      '<h1 id="heading-2">!!!</h1>\n')
  })

  it('namespaces ids and references in embedded fragments', function () {
    const parser = makeParser({ prefix: 'demo-' })
    const env = {}
    const out = parser.render('# Foo\n# Foo\n[first](#foo) [second](#foo-2)', env)
    assert.equal(out,
      '<h1 id="demo-foo">Foo</h1>\n' +
      '<h1 id="demo-foo-2">Foo</h1>\n' +
      '<p><a href="#demo-foo">first</a> <a href="#demo-foo-2">second</a></p>\n')
    assert.deepEqual(env.anchors.ids, ['demo-foo', 'demo-foo-2'])
  })

  it('supports a dynamic prefix from env', function () {
    const parser = makeParser({
      prefix: (env) => `f-${env.name}-`
    })
    const env = { name: 'x' }
    const out = parser.render('# Foo', env)
    assert.equal(out, '<h1 id="f-x-foo">Foo</h1>\n')
  })

  it('heading references distinguish same-name occurrence order', function () {
    const source = [
      '# Foo',
      '# Foo',
      '',
      'See [the first](#foo) and [the second](#foo-2).'
    ].join('\n')
    const out = makeParser().render(source)
    assert.equal(out,
      '<h1 id="foo">Foo</h1>\n' +
      '<h1 id="foo-2">Foo</h1>\n' +
      '<p>See <a href="#foo">the first</a> and <a href="#foo-2">the second</a>.</p>\n')
  })

  it('exposes occurrence order of same-named headings on env', function () {
    const env = {}
    makeParser().render('# Foo\n# Foo\n# Bar\n# Foo', env)
    assert.deepEqual(env.anchors.slugs.get('foo'), ['foo', 'foo-2', 'foo-3'])
    assert.deepEqual(env.anchors.slugs.get('bar'), ['bar'])
  })

  it('accepts a custom slugify function', function () {
    const parser = makeParser({ slugify: (s) => s.split('').reverse().join('') })
    const out = parser.render('# abc')
    assert.equal(out, '<h1 id="cba">abc</h1>\n')
  })

  it('calls onConflict instead of throwing when provided', function () {
    const conflicts = []
    const parser = makeParser({ onConflict: (c) => conflicts.push(c) })
    parser.render('# A {#x}\n# B {#x}')
    assert.equal(conflicts.length, 1)
    assert.equal(conflicts[0].id, 'x')
    assert.equal(conflicts[0].first.line, 1)
    assert.equal(conflicts[0].first.text, 'A')
    assert.equal(conflicts[0].second.line, 2)
    assert.equal(conflicts[0].second.text, 'B')
  })

  it('does not expose registry when envKey is false', function () {
    const env = {}
    makeParser({ envKey: false }).render('# Foo', env)
    assert.equal(env.anchors, undefined)
  })

  it('ignores {#id} markers when explicit is disabled', function () {
    const out = makeParser({ explicit: false }).render('# Foo {#bar}')
    assert.equal(out, '<h1 id="foo-bar">Foo {#bar}</h1>\n')
  })

  it('includes inline code text in the slug', function () {
    const out = makeParser().render('# Hello `code`')
    assert.equal(out, '<h1 id="hello-code">Hello <code>code</code></h1>\n')
  })

  it('handles all heading levels', function () {
    const out = makeParser().render('# H1\n## H2\n### H3\n#### H4\n##### H5\n###### H6')
    assert.match(out, /<h1 id="h1">H1<\/h1>/)
    assert.match(out, /<h2 id="h2">H2<\/h2>/)
    assert.match(out, /<h3 id="h3">H3<\/h3>/)
    assert.match(out, /<h4 id="h4">H4<\/h4>/)
    assert.match(out, /<h5 id="h5">H5<\/h5>/)
    assert.match(out, /<h6 id="h6">H6<\/h6>/)
  })

  it('handles setext headings', function () {
    const out = makeParser().render('Foo\n===\n\nBar\n---')
    assert.equal(out, '<h1 id="foo">Foo</h1>\n<h2 id="bar">Bar</h2>\n')
  })

  it('does not rewrite references when there is no prefix', function () {
    const out = makeParser().render('[x](#foo)')
    assert.equal(out, '<p><a href="#foo">x</a></p>\n')
  })

  it('does not rewrite references to non-heading fragments', function () {
    const out = makeParser({ prefix: 'p-' }).render('[x](#missing)')
    assert.equal(out, '<p><a href="#missing">x</a></p>\n')
  })

  it('is exposed as MarkdownIt.anchors static', function () {
    assert.equal(typeof MarkdownIt.anchors, 'function')
    assert.equal(typeof MarkdownIt.slugify, 'function')
    const parser = new MarkdownIt().use(MarkdownIt.anchors)
    const out = parser.render('# Foo\n# Foo')
    assert.equal(out, '<h1 id="foo">Foo</h1>\n<h1 id="foo-2">Foo</h1>\n')
  })

  it('static slugify matches the documented Unicode rule', function () {
    assert.equal(MarkdownIt.slugify('Café'), 'cafe')
    assert.equal(MarkdownIt.slugify('!!!'), 'heading')
  })
})
