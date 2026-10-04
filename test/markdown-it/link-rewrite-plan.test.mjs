import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import markdownit from '../../src/index.ts'
import {
  collectLinkTargets,
  planLinkRewrites,
  applyLinkRewritePlan,
  rewriteLinkTargets
} from '../../src/link_rewrite_plan.ts'

// Acceptance fixture: one inline link, two reference links sharing a single
// definition, and the very same URLs repeated inside inline code and a
// fenced code block (those must never participate).
const SRC = [
  '[inline](https://old.example.com/a "keep me")',
  '',
  '[first][shared] and [second][shared]',
  '',
  '[shared]: https://old.example.com/shared "shared title"',
  '',
  '`https://old.example.com/a` stays code',
  '',
  '```',
  'https://old.example.com/shared',
  '```',
  ''
].join('\n')

const remap = (url) => url.startsWith('https://old.example.com/')
  ? url.replace('https://old.example.com/', 'https://new.example.com/')
  : null

function parse (md, src) {
  const env = {}
  const tokens = md.parse(src, env)
  return { tokens, env }
}

describe('link rewrite plan', function () {
  it('collects real targets only: inline link, shared definition, no code', function () {
    const md = markdownit()
    const { tokens, env } = parse(md, SRC)
    const targets = collectLinkTargets(tokens, env)

    // Exactly two owners: the inline link token and the shared definition.
    assert.strictEqual(targets.length, 2)

    const inline = targets.find(t => t.kind === 'link')
    assert.strictEqual(inline.url, 'https://old.example.com/a')
    assert.strictEqual(inline.owner.type, 'token')
    assert.strictEqual(inline.owner.attr, 'href')

    // The reference definition is shown in the plan with its ownership:
    // a single entry, owned by env.references, used by both reference links.
    const ref = targets.find(t => t.kind === 'reference')
    assert.strictEqual(ref.url, 'https://old.example.com/shared')
    assert.deepStrictEqual(ref.owner, { type: 'reference', label: 'SHARED' })
    assert.strictEqual(ref.refCount, 2)

    // Code tokens carry the same URLs but are never collected.
    assert.ok(!targets.some(t => t.owner.type === 'token' &&
      tokens[t.owner.tokenIndex].type !== 'inline'))
  })

  it('applies atomically: real links rewritten, code untouched, titles kept', function () {
    const md = markdownit()
    const { tokens, env } = parse(md, SRC)

    const plan = planLinkRewrites(tokens, env, remap)
    assert.strictEqual(plan.ok, true)
    assert.strictEqual(plan.rewrites.length, 2)
    assert.strictEqual(applyLinkRewritePlan(plan), true)
    assert.strictEqual(plan.applied, true)
    // Applying twice is a no-op.
    assert.strictEqual(applyLinkRewritePlan(plan), false)

    // The shared definition was rewritten exactly once ...
    assert.strictEqual(env.references.SHARED.href, 'https://new.example.com/shared')
    assert.strictEqual(env.references.SHARED.title, 'shared title')

    // ... and both reference links still resolve to it (association kept).
    const hrefs = []
    for (const token of tokens) {
      if (token.type !== 'inline') continue
      for (const child of token.children) {
        if (child.type === 'link_open') hrefs.push(child.attrGet('href'))
      }
    }
    assert.deepStrictEqual(hrefs, [
      'https://new.example.com/a',
      'https://new.example.com/shared',
      'https://new.example.com/shared'
    ])

    // Rendered output: first three real links point to the new targets,
    // titles and inline markup structure are preserved, code is unchanged.
    const html = md.renderer.render(tokens, md.options, env)
    assert.strictEqual(html, '<p><a href="https://new.example.com/a" title="keep me">inline</a></p>\n' +
      '<p><a href="https://new.example.com/shared" title="shared title">first</a> and ' +
      '<a href="https://new.example.com/shared" title="shared title">second</a></p>\n' +
      '<p><code>https://old.example.com/a</code> stays code</p>\n' +
      '<pre><code>https://old.example.com/shared\n</code></pre>\n')
  })

  it('rejects atomically: one refused target means nothing changes', function () {
    const md = markdownit()
    const { tokens, env } = parse(md, SRC)

    const before = JSON.stringify(tokens)
    const refsBefore = JSON.stringify(env.references)
    const htmlBefore = md.renderer.render(tokens, md.options, env)

    // The second target (the shared definition) is rejected.
    const plan = planLinkRewrites(tokens, env, (url) =>
      url === 'https://old.example.com/shared' ? null : remap(url))

    assert.strictEqual(plan.ok, false)
    assert.strictEqual(plan.rewrites.length, 0)
    assert.strictEqual(plan.rejected.length, 1)
    assert.strictEqual(plan.rejected[0].url, 'https://old.example.com/shared')
    assert.strictEqual(plan.rejected[0].owner.type, 'reference')

    assert.strictEqual(applyLinkRewritePlan(plan), false)
    assert.strictEqual(plan.applied, false)

    // All tokens and references are identical to the initial state.
    assert.strictEqual(JSON.stringify(tokens), before)
    assert.strictEqual(JSON.stringify(env.references), refsBefore)
    assert.strictEqual(md.renderer.render(tokens, md.options, env), htmlBefore)
  })

  it('rewrites images and keeps link titles and inline structure', function () {
    const md = markdownit()
    const src = '![*alt*](https://old.example.com/pic.png "pic title") and [x](https://old.example.com/y)'
    const { tokens, env } = parse(md, src)

    const plan = rewriteLinkTargets(tokens, env, remap)
    assert.strictEqual(plan.ok, true)
    assert.strictEqual(plan.rewrites.length, 2)
    assert.ok(plan.rewrites.some(r => r.kind === 'image' && r.owner.attr === 'src'))

    const html = md.renderer.render(tokens, md.options, env)
    assert.strictEqual(html,
      '<p><img src="https://new.example.com/pic.png" alt="alt" title="pic title"> and ' +
      '<a href="https://new.example.com/y">x</a></p>\n')
    // Emphasis inside the alt text survived (inline structure untouched).
    const image = tokens[1].children.find(t => t.type === 'image')
    assert.strictEqual(image.children[0].type, 'em_open')
  })

  it('ignores plain-text URLs and autolink-like text in paragraphs', function () {
    const md = markdownit()
    const src = 'visit https://old.example.com/a today'
    const { tokens, env } = parse(md, src)

    const targets = collectLinkTargets(tokens, env)
    assert.strictEqual(targets.length, 0)

    const plan = rewriteLinkTargets(tokens, env, remap)
    assert.strictEqual(plan.ok, true)
    assert.strictEqual(plan.rewrites.length, 0)
    assert.strictEqual(md.renderer.render(tokens, md.options, env),
      '<p>visit https://old.example.com/a today</p>\n')
  })

  it('handles mapper exceptions as rejections', function () {
    const md = markdownit()
    const { tokens, env } = parse(md, '[a](https://old.example.com/a)')
    const before = JSON.stringify(tokens)

    const plan = rewriteLinkTargets(tokens, env, () => { throw new Error('nope') })
    assert.strictEqual(plan.ok, false)
    assert.strictEqual(plan.applied, false)
    assert.match(plan.rejected[0].reason, /nope/)
    assert.strictEqual(JSON.stringify(tokens), before)
  })
})
