import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import MarkdownIt from '../../src/index.ts'
import excerptTokens from '../../src/excerpt.ts'

const md = new MarkdownIt()

function renderExcerpt (src, maxChars, options) {
  const tokens = md.parse(src, {})
  return md.renderer.render(excerptTokens(tokens, maxChars, options), md.options, {})
}

// visible code points of rendered HTML, ellipsis not included
function visibleLength (html) {
  const text = html.replace(/<[^>]*>/g, '').replace(/\u2026/g, '').replace(/\s/g, '')
  return [...text].length
}

describe('excerptTokens', function () {
  it('closes nested structures when cutting CJK link text with emoji', function () {
    const src = '😀**加粗[中文链接](https://example.com)文字**后缀'
    const html = renderExcerpt(src, 6)
    assert.equal(html, '<p>😀<strong>加粗<a href="https://example.com">中文链…</a></strong></p>\n')
    assert.equal(visibleLength(html), 6)
  })

  it('handles zero budget', function () {
    const html = renderExcerpt('hello world', 0)
    assert.equal(html, '<p>…</p>\n')
    assert.equal(visibleLength(html), 0)
  })

  it('adds no ellipsis when content fits exactly', function () {
    const src = 'hello **world**'
    const html = renderExcerpt(src, 11)
    assert.equal(html, md.render(src))
    assert.ok(!html.includes('\u2026'))
  })

  it('truncates across multiple paragraphs', function () {
    const html = renderExcerpt('aaaa\n\nbbbbcc', 5)
    assert.equal(html, '<p>aaaa</p>\n<p>b…</p>\n')
    assert.equal(visibleLength(html), 5)
  })

  it('keeps images with empty alt for free', function () {
    const html = renderExcerpt('前![](img.png)后', 1)
    assert.equal(html, '<p>前<img src="img.png" alt="">…</p>\n')
    assert.equal(visibleLength(html), 1)
  })

  it('drops images whose alt text does not fit', function () {
    const html = renderExcerpt('ab![xyz](i.png)cd', 2)
    assert.equal(html, '<p>ab…</p>\n')
    assert.equal(visibleLength(html), 2)
  })

  it('passes inline raw html through without counting it', function () {
    const mdHtml = new MarkdownIt({ html: true })
    const tokens = mdHtml.parse('a<span>b</span>c', {})
    const html = mdHtml.renderer.render(excerptTokens(tokens, 2), mdHtml.options, {})
    assert.equal(html, '<p>a<span>b</span>…</p>\n')
    assert.equal(visibleLength(html), 2)
  })

  it('passes block raw html through without counting it', function () {
    const mdHtml = new MarkdownIt({ html: true })
    const tokens = mdHtml.parse('<div>raw</div>\n\nabcdef', {})
    const html = mdHtml.renderer.render(excerptTokens(tokens, 3), mdHtml.options, {})
    assert.equal(html, '<div>raw</div>\n<p>abc…</p>\n')
    // 3 budgeted chars + 3 chars inside the raw html block (not budgeted)
    assert.equal(visibleLength(html), 6)
  })

  it('does not mutate the original tokens', function () {
    const src = '😀**加粗[中文链接](https://example.com)文字**后缀\n\n第二段 ![](i.png) 文字'
    const tokens = md.parse(src, {})
    const before = JSON.stringify(tokens)
    excerptTokens(tokens, 4)
    assert.equal(JSON.stringify(tokens), before)
  })

  it('supports a custom ellipsis string', function () {
    const html = renderExcerpt('abcdef', 3, { ellipsis: '...' })
    assert.equal(html, '<p>abc...</p>\n')
  })

  it('counts astral characters as single code points', function () {
    const html = renderExcerpt('😀😀😀😀abc', 3)
    assert.equal(html, '<p>😀😀😀…</p>\n')
    assert.equal(visibleLength(html), 3)
  })

  it('is exposed as a static method on MarkdownIt', function () {
    assert.equal(MarkdownIt.excerptTokens, excerptTokens)
  })
})
