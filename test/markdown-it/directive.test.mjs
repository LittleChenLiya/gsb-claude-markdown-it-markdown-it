import { fileURLToPath } from 'node:url'
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { generateTests } from '../helpers.mjs'
import markdownit from '../../src/index.ts'

describe('markdown-it directive fixtures', function () {
  const md = markdownit({ html: true }).enable('directive')

  generateTests(fileURLToPath(new URL('../fixtures/markdown-it/directive.txt', import.meta.url)), md)
})

describe('directive block rule', function () {
  it('is disabled by default and does not change commonmark output', function () {
    const src = ':::note\nhi\n:::\n'
    const expected = '<p>:::note\nhi\n:::</p>\n'

    assert.strictEqual(markdownit().render(src), expected)
    assert.strictEqual(markdownit('commonmark').render(src), expected)
  })

  it('can be toggled with enable/disable', function () {
    const md = markdownit()
    const src = ':::note\nhi\n:::\n'

    assert.strictEqual(md.render(src), '<p>:::note\nhi\n:::</p>\n')
    assert.strictEqual(md.enable('directive').render(src),
      '<div class="markdown-it-directive markdown-it-directive-note">\n<p>hi</p>\n</div>\n')
    assert.strictEqual(md.disable('directive').render(src), '<p>:::note\nhi\n:::</p>\n')
  })

  it('emits open/close tokens with correct nesting levels and map', function () {
    const md = markdownit().enable('directive')
    const tokens = md.parse(':::note outer\n:::warning <img>\ninner\n:::\n:::\n', {})

    const types = tokens.map(t => t.type)
    assert.deepStrictEqual(types, [
      'directive_open',
      'directive_open',
      'paragraph_open', 'inline', 'paragraph_close',
      'directive_close',
      'directive_close'
    ])

    const outer = tokens[0]
    const inner = tokens[1]
    assert.strictEqual(outer.info, 'note')
    assert.strictEqual(inner.info, 'warning')
    assert.deepStrictEqual(outer.map, [0, 5])
    assert.deepStrictEqual(inner.map, [1, 4])
    assert.strictEqual(outer.level, 0)
    assert.strictEqual(inner.level, 1)
    assert.strictEqual(tokens[tokens.length - 2].level, 1) // inner directive_close
    assert.strictEqual(tokens[tokens.length - 1].level, 0) // outer directive_close

    // titles are stored as plain text metadata
    assert.strictEqual(outer.meta.title, 'outer')
    assert.strictEqual(inner.meta.title, '<img>')
  })

  it('escapes title and cannot inject HTML attributes via name or title', function () {
    const md = markdownit().enable('directive')
    const html = md.render(':::note <img>\nbody\n:::\n', {})

    assert.ok(html.includes('<p class="markdown-it-directive-title">&lt;img&gt;</p>'))
    assert.ok(!html.includes('<img>'))

    // quotes in title stay escaped text, never become attributes
    const html2 = md.render(':::note " onmouseover="alert(1)\nbody\n:::\n', {})
    assert.ok(html2.includes('&quot; onmouseover=&quot;alert(1)'))
    assert.ok(!html2.includes('onmouseover="alert'))
  })

  it('does not close on ::: inside fenced code', function () {
    const md = markdownit().enable('directive')
    const html = md.render(':::note\n```\n:::\n```\n:::\nafter\n', {})

    assert.ok(html.includes('<pre><code>:::\n</code></pre>'))
    assert.ok(html.includes('</div>\n<p>after</p>'))
  })

  it('unclosed container keeps the rest of the document as plain blocks', function () {
    const md = markdownit().enable('directive')
    const html = md.render(':::note\nunclosed\n\npara after\n', {})

    assert.strictEqual(html, '<p>:::note\nunclosed</p>\n<p>para after</p>\n')
  })

  it('renders containers nested deeper than directiveMaxDepth as plain text', function () {
    const md = markdownit({ directiveMaxDepth: 2 }).enable('directive')
    const html = md.render(':::a\n:::b\n:::c\n:::\n:::\n:::\n', {})

    assert.strictEqual(html,
      '<div class="markdown-it-directive markdown-it-directive-a">\n' +
      '<div class="markdown-it-directive markdown-it-directive-b">\n' +
      '<p>:::c\n:::</p>\n' +
      '</div>\n' +
      '</div>\n')
  })

  it('silent mode validates without mutating state', function () {
    const md = markdownit().enable('directive')
    const rule = md.block.ruler.__rules__.find(r => r.name === 'directive').fn
    const tokens = []
    const state = new md.block.State(':::note\nbody\n:::\n', md, {}, tokens)

    assert.strictEqual(rule(state, 0, state.lineMax, true), true)
    assert.strictEqual(state.line, 0)
    assert.strictEqual(tokens.length, 0)

    // unclosed container is rejected in silent mode too
    const state2 = new md.block.State(':::note\nbody\n', md, {}, [])
    assert.strictEqual(rule(state2, 0, state2.lineMax, true), false)
  })

  it('stays linear on pathological nesting input', function () {
    const md = markdownit().enable('directive')
    const opens = ':::a\n'.repeat(5000)
    const start = Date.now()
    md.render(opens)
    assert.ok(Date.now() - start < 5000, 'should not backtrack exponentially')
  })
})
