import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import markdownit from '../../src/index.ts'

const ELLIPSIS = '\u2026'
const { truncateTokens } = markdownit

// Count visible code points in a token stream the same way the truncation
// does: text + code_inline contents + image alt text. The appended ellipsis
// marker is excluded, it must not count towards the budget.
function visibleCodePoints (tokens, ellipsis = ELLIPSIS) {
  let count = 0
  const walk = (list) => {
    for (const token of list) {
      if (token.type === 'text' || token.type === 'code_inline') {
        if (token.content !== ellipsis) { count += [...token.content].length }
      } else if ((token.type === 'inline' || token.type === 'image') && token.children) {
        walk(token.children)
      }
    }
  }
  walk(tokens)
  return count
}

describe('excerpt', function () {
  it('cuts inside chinese link, emoji and nested bold, keeping html closed', function () {
    const md = markdownit()
    const src = '\u524D[\u4E2D\u6587\u94FE\u63A5](https://example.com)`\u4EE3\u7801`**\u52A0\u7C97\uD83C\uDF89 nested**\u5C3E'

    const html = md.renderExcerpt(src, 12)

    assert.strictEqual(html, '<p>\u524D<a href="https://example.com">\u4E2D\u6587\u94FE\u63A5</a><code>\u4EE3\u7801</code><strong>\u52A0\u7C97\uD83C\uDF89 n' + ELLIPSIS + '</strong></p>\n')
    // all opened structures are closed
    assert.ok(html.includes('</strong>'))
    assert.ok(html.includes('</a>'))
    assert.ok(html.includes('</code>'))
    assert.ok(html.trimEnd().endsWith('</p>'))
    // exactly one ellipsis, not counted towards the budget
    assert.strictEqual(html.split(ELLIPSIS).length - 1, 1)

    const result = truncateTokens(md.parse(src, {}), 12)
    assert.strictEqual(result.truncated, true)
    assert.strictEqual(result.visible, 12)
    assert.strictEqual(visibleCodePoints(result.tokens), 12)
  })

  it('counts emoji as single code points', function () {
    const md = markdownit()
    const src = '\uD83C\uDF89\uD83C\uDF89\uD83C\uDF89'

    assert.strictEqual(md.renderExcerpt(src, 2), '<p>\uD83C\uDF89\uD83C\uDF89' + ELLIPSIS + '</p>\n')

    const result = truncateTokens(md.parse(src, {}), 2)
    assert.strictEqual(result.visible, 2)
    assert.strictEqual(result.truncated, true)
  })

  it('handles zero budget', function () {
    const md = markdownit()

    assert.strictEqual(md.renderExcerpt('hello world', 0), '<p>' + ELLIPSIS + '</p>\n')

    const result = truncateTokens(md.parse('hello world', {}), 0)
    assert.strictEqual(result.visible, 0)
    assert.strictEqual(result.truncated, true)
  })

  it('does not add ellipsis when content fits exactly', function () {
    const md = markdownit()
    const src = '\u4F60\u597D\uD83C\uDF89'

    assert.strictEqual(md.renderExcerpt(src, 3), '<p>\u4F60\u597D\uD83C\uDF89</p>\n')

    const result = truncateTokens(md.parse(src, {}), 3)
    assert.strictEqual(result.visible, 3)
    assert.strictEqual(result.truncated, false)
    assert.ok(!md.renderer.render(result.tokens, md.options).includes(ELLIPSIS))
  })

  it('truncates across multiple paragraphs', function () {
    const md = markdownit()
    const src = '\u7B2C\u4E00\u6BB5\n\n\u7B2C\u4E8C\u6BB5'

    assert.strictEqual(md.renderExcerpt(src, 4), '<p>\u7B2C\u4E00\u6BB5</p>\n<p>\u7B2C' + ELLIPSIS + '</p>\n')

    const result = truncateTokens(md.parse(src, {}), 4)
    assert.strictEqual(result.visible, 4)
    assert.strictEqual(result.truncated, true)
  })

  it('treats empty-alt images as zero width', function () {
    const md = markdownit()
    const src = 'a![](x.png)b'

    // image costs nothing, everything fits
    assert.strictEqual(md.renderExcerpt(src, 2), '<p>a<img src="x.png" alt="">b</p>\n')

    // budget cuts right after the image; ellipsis goes after it
    assert.strictEqual(md.renderExcerpt(src, 1), '<p>a<img src="x.png" alt="">' + ELLIPSIS + '</p>\n')

    const result = truncateTokens(md.parse(src, {}), 1)
    assert.strictEqual(result.visible, 1)
    assert.strictEqual(result.truncated, true)
  })

  it('counts image alt text as visible characters', function () {
    const md = markdownit()
    const src = 'ab![cd](x.png)ef'

    const result = truncateTokens(md.parse(src, {}), 4)
    assert.strictEqual(result.visible, 4)
    assert.strictEqual(result.truncated, true)
  })

  it('passes raw html through as zero-width content', function () {
    const md = markdownit({ html: true })
    const src = '<div>raw</div>\n\nparagraph text'

    // html_block costs nothing, paragraph is truncated to the budget
    assert.strictEqual(md.renderExcerpt(src, 5), '<div>raw</div>\n<p>parag' + ELLIPSIS + '</p>\n')

    // zero budget still keeps the raw html block, without ellipsis
    assert.strictEqual(md.renderExcerpt('<div>raw</div>', 0), md.render('<div>raw</div>'))

    const result = truncateTokens(md.parse(src, {}), 5)
    assert.strictEqual(result.visible, 5)
    assert.strictEqual(result.truncated, true)
  })

  it('supports custom and empty ellipsis', function () {
    const md = markdownit()

    assert.strictEqual(md.renderExcerpt('abcdef', 3, { ellipsis: '...' }), '<p>abc...</p>\n')
    assert.strictEqual(md.renderExcerpt('abcdef', 3, { ellipsis: '' }), '<p>abc</p>\n')
  })

  it('never mutates the original token stream', function () {
    const md = markdownit()
    const src = '\u524D[\u4E2D\u6587](https://example.com)**\u7C97\uD83C\uDF89**![alt](i.png)\u5C3E'
    const env = {}
    const tokens = md.parse(src, env)
    const snapshot = JSON.stringify(tokens)

    const result = truncateTokens(tokens, 3)

    // deep content of the original tokens is unchanged
    assert.strictEqual(JSON.stringify(tokens), snapshot)
    // and they still render the full original output
    assert.strictEqual(md.renderer.render(tokens, md.options, env), md.render(src))
    // the truncated stream is a different set of tokens
    assert.strictEqual(result.visible, 3)
    assert.strictEqual(result.truncated, true)
  })

  it('keeps content intact when nothing needs truncation', function () {
    const md = markdownit()
    const src = 'short **text**'
    const tokens = md.parse(src, {})

    const result = truncateTokens(tokens, 100)
    assert.strictEqual(result.truncated, false)
    assert.strictEqual(md.renderer.render(result.tokens, md.options), md.render(src))
  })
})
