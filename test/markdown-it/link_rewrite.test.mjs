import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import markdownit from '../../src/index.ts'
import { planLinkRewrite } from '../../src/index.ts'

const rewrite = (url) => url.replace('http://example.com', 'https://example.org')

function findInlineTokens (tokens, type) {
  const result = []
  for (const token of tokens) {
    if (token.type === type) { result.push(token) }
    if (token.children) { result.push(...findInlineTokens(token.children, type)) }
  }
  return result
}

describe('planLinkRewrite', function () {
  it('collects only real link targets, ignoring code and plain text', function () {
    const md = markdownit()
    const env = {}
    const src = [
      '[inline](http://example.com/a "Inline title")',
      '',
      '[one][x] [two][x] and `http://example.com/a`',
      '',
      '```',
      'http://example.com/a',
      '```',
      '',
      'plain http://example.com/a text',
      '',
      '    http://example.com/a',
      '',
      '[x]: http://example.com/a "Ref title"'
    ].join('\n')

    const tokens = md.parse(src, env)
    const plan = planLinkRewrite(tokens, env, rewrite)

    assert.notStrictEqual(plan, null)
    // One inline link + one shared reference definition. The two reference
    // links are uses of the same definition, so the definition is collected
    // exactly once. Code (fence, indented, inline) and plain text are absent.
    assert.strictEqual(plan.targets.length, 2)

    const [inlineTarget, refTarget] = plan.targets

    assert.strictEqual(inlineTarget.kind, 'link')
    assert.strictEqual(inlineTarget.label, null)
    assert.strictEqual(inlineTarget.url, 'http://example.com/a')
    assert.strictEqual(inlineTarget.tokens.length, 1)
    assert.strictEqual(inlineTarget.tokens[0].type, 'link_open')

    assert.strictEqual(refTarget.kind, 'reference')
    assert.strictEqual(refTarget.label, 'X')
    assert.strictEqual(refTarget.url, 'http://example.com/a')
    assert.strictEqual(refTarget.tokens.length, 2)
    assert.deepStrictEqual(
      refTarget.tokens.map((t) => t.meta.label),
      ['X', 'X']
    )
  })

  it('applies the rewrite to inline links, shared definitions and all their uses', function () {
    const md = markdownit()
    const env = {}
    const src = [
      '[inline](http://example.com/a "Inline title")',
      '',
      '[one][x] [two][x]',
      '',
      '```',
      'http://example.com/a',
      '```',
      '',
      '    http://example.com/a',
      '',
      'and `http://example.com/a`',
      '',
      'plain http://example.com/a text',
      '',
      '[x]: http://example.com/a "Ref title"'
    ].join('\n')

    const tokens = md.parse(src, env)
    const plan = planLinkRewrite(tokens, env, rewrite)
    plan.apply()

    // Inline link: href rewritten, title kept.
    const inlineToken = plan.targets[0].tokens[0]
    assert.strictEqual(inlineToken.attrGet('href'), 'https://example.org/a')
    assert.strictEqual(inlineToken.attrGet('title'), 'Inline title')

    // Reference definition rewritten once ...
    assert.strictEqual(env.references.X.href, 'https://example.org/a')
    assert.strictEqual(env.references.X.title, 'Ref title')

    // ... and both reference links still point at the same definition.
    for (const token of plan.targets[1].tokens) {
      assert.strictEqual(token.attrGet('href'), 'https://example.org/a')
      assert.strictEqual(token.meta.label, 'X')
    }

    // Code blocks, inline code and plain text keep the original URL.
    const fence = tokens.find((t) => t.type === 'fence')
    assert.ok(fence.content.includes('http://example.com/a'))
    const codeInline = findInlineTokens(tokens, 'code_inline')[0]
    assert.strictEqual(codeInline.content, 'http://example.com/a')
    const text = findInlineTokens(tokens, 'text').find((t) => t.content.includes('plain'))
    assert.ok(text.content.includes('http://example.com/a'))

    // Rendered output: links use the new target, code keeps the old one.
    const html = md.renderer.render(tokens, md.options, env)
    assert.ok(html.includes('href="https://example.org/a"'))
    assert.ok(html.includes('title="Inline title"'))
    assert.ok(!html.includes('href="http://example.com/a"'))
    assert.ok(html.includes('http://example.com/a')) // code block untouched
  })

  it('rewrites images via src and keeps the title', function () {
    const md = markdownit()
    const env = {}
    const tokens = md.parse('![pic](http://example.com/img "Img title")', env)
    const plan = planLinkRewrite(tokens, env, rewrite)

    assert.strictEqual(plan.targets.length, 1)
    assert.strictEqual(plan.targets[0].kind, 'image')
    plan.apply()

    const image = findInlineTokens(tokens, 'image')[0]
    assert.strictEqual(image.attrGet('src'), 'https://example.org/img')
    assert.strictEqual(image.attrGet('title'), 'Img title')
  })

  it('collects nested links and images inside links', function () {
    const md = markdownit()
    const env = {}
    const tokens = md.parse('[![img](http://example.com/img)](http://example.com/link)', env)
    const plan = planLinkRewrite(tokens, env, rewrite)

    assert.deepStrictEqual(
      plan.targets.map((t) => [t.kind, t.url]),
      [
        ['link', 'http://example.com/link'],
        ['image', 'http://example.com/img']
      ]
    )
  })

  it('treats linkified URLs as links but not code URLs', function () {
    const md = markdownit({ linkify: true })
    const env = {}
    const tokens = md.parse('see http://example.com/a and `http://example.com/b`', env)
    const plan = planLinkRewrite(tokens, env, rewrite)

    assert.strictEqual(plan.targets.length, 1)
    assert.strictEqual(plan.targets[0].kind, 'link')
    assert.strictEqual(plan.targets[0].url, 'http://example.com/a')
  })

  it('rewrites a shared reference definition exactly once', function () {
    const md = markdownit()
    const env = {}
    const tokens = md.parse('[one][x] [two][x]\n\n[x]: http://example.com/a', env)

    const calls = []
    const plan = planLinkRewrite(tokens, env, (url, target) => {
      calls.push([url, target.kind, target.label])
      return rewrite(url)
    })

    assert.deepStrictEqual(calls, [['http://example.com/a', 'reference', 'X']])
    plan.apply()
    assert.strictEqual(env.references.X.href, 'https://example.org/a')
  })

  it('aborts atomically when any target is rejected', function () {
    const md = markdownit()
    const env = {}
    const src = '[a][x] [b][y]\n\n[x]: http://example.com/1\n[y]: http://example.com/2'
    const tokens = md.parse(src, env)
    const snapshot = JSON.parse(JSON.stringify(tokens))
    const refsSnapshot = JSON.parse(JSON.stringify(env.references))

    const plan = planLinkRewrite(tokens, env, (url) => {
      if (url.endsWith('/2')) { return null }
      return rewrite(url)
    })

    assert.strictEqual(plan, null)
    // Tokens and reference definitions are untouched.
    assert.strictEqual(JSON.stringify(tokens), JSON.stringify(snapshot))
    assert.strictEqual(JSON.stringify(env.references), JSON.stringify(refsSnapshot))
  })

  it('aborts atomically when the mapper throws', function () {
    const md = markdownit()
    const env = {}
    const tokens = md.parse('[a](http://example.com/1) [b](http://example.com/2)', env)
    const snapshot = JSON.parse(JSON.stringify(tokens))

    assert.throws(function () {
      planLinkRewrite(tokens, env, () => { throw new Error('boom') })
    })
    assert.strictEqual(JSON.stringify(tokens), JSON.stringify(snapshot))
  })

  it('does not mutate anything when apply is never called', function () {
    const md = markdownit()
    const env = {}
    const tokens = md.parse('[a](http://example.com/a)', env)
    const snapshot = JSON.parse(JSON.stringify(tokens))

    const plan = planLinkRewrite(tokens, env, rewrite)
    assert.notStrictEqual(plan, null)
    assert.strictEqual(JSON.stringify(tokens), JSON.stringify(snapshot))
  })
})
