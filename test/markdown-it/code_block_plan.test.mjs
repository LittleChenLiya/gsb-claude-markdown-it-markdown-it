import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import markdownit from '../../src/index.ts'
import { createCodeBlockPlan, CODE_BLOCK_PLAN_META } from '../../src/helpers/code_block_plan.ts'

const SRC = [
  '# Demo',
  '',
  '```js',
  'const a = 1',
  '```',
  '',
  '```python',
  "print('hi')",
  '```',
  '',
  'inline `const b = 2` here',
  '',
  '    indented = 1',
  ''
].join('\n')

function parse (md, src = SRC) {
  const env = {}
  const tokens = md.parse(src, env)
  return { tokens, env }
}

function codeInlineTokens (tokens) {
  const inline = tokens.find(t => t.type === 'inline')
  return inline.children.filter(t => t.type === 'code_inline')
}

describe('code block replacement plan', () => {
  it('selects only the js fence, by language and block identity', () => {
    const md = markdownit()
    const { tokens } = parse(md)

    const plan = createCodeBlockPlan(tokens, { lang: 'js' }, 'const a = 42\n')

    assert.equal(plan.size, 1)
    const entry = plan.entries[0]
    assert.equal(entry.token.type, 'fence')
    assert.equal(entry.token.info, 'js')
    // identity: position in stream + original source lines
    assert.deepEqual(entry.map, [2, 5])
    assert.deepEqual(entry.token.map, [2, 5])
    assert.equal(entry.baseline, 'const a = 1\n')
  })

  it('matches language from the info string, never from code content', () => {
    const md = markdownit()
    const src = '```js\n// mentions python and `code`\n```\n'
    const { tokens } = parse(md, src)

    // content mentions python, but the block language is js
    assert.equal(createCodeBlockPlan(tokens, { lang: 'js' }, 'x\n').size, 1)
    assert.equal(createCodeBlockPlan(tokens, { lang: 'python' }, 'x\n').size, 0)
    // inline code is never selected, even when its text is a language name
    const { tokens: t2 } = parse(md, 'some `js` inline\n')
    assert.equal(createCodeBlockPlan(t2, { lang: 'js' }, 'x\n').size, 0)
  })

  it('handles fence and indented code separately', () => {
    const md = markdownit()
    const { tokens } = parse(md)

    const fences = createCodeBlockPlan(tokens, { kind: 'fence' }, 'x\n')
    assert.equal(fences.size, 2) // js + python

    const indented = createCodeBlockPlan(tokens, { kind: 'indented' }, 'x\n')
    assert.equal(indented.size, 1)
    assert.equal(indented.entries[0].token.type, 'code_block')
    assert.deepEqual(indented.entries[0].map, [12, 13])

    // lang never matches indented blocks (they carry no language)
    const jsOnly = createCodeBlockPlan(tokens, { lang: 'js', kind: 'both' }, 'x\n')
    assert.equal(jsOnly.size, 1)
    assert.equal(jsOnly.entries[0].token.type, 'fence')
  })

  it('apply replaces content but keeps info, map and unrelated tokens', () => {
    const md = markdownit()
    const { tokens } = parse(md)
    const before = tokens.map(t => ({ type: t.type, content: t.content, info: t.info, map: t.map && [...t.map] }))
    const inlineBefore = codeInlineTokens(tokens).map(t => t.content)

    const plan = createCodeBlockPlan(tokens, { lang: 'js' }, 'const a = 42\n')
    assert.equal(plan.apply(), true)
    assert.equal(plan.applied, true)

    tokens.forEach((t, i) => {
      if (t === plan.entries[0].token) {
        assert.equal(t.content, 'const a = 42\n') // content replaced
        assert.equal(t.info, 'js') // info preserved
        assert.deepEqual(t.map, [2, 5]) // source line numbers preserved
      } else {
        // every unrelated token is untouched
        assert.equal(t.content, before[i].content)
        assert.equal(t.info, before[i].info)
        assert.deepEqual(t.map, before[i].map)
      }
    })

    // python fence and indented code unchanged
    assert.equal(tokens.filter(t => t.type === 'fence')[1].content, "print('hi')\n")
    assert.equal(tokens.find(t => t.type === 'code_block').content, 'indented = 1\n')
    // inline code unchanged
    assert.deepEqual(codeInlineTokens(tokens).map(t => t.content), inlineBefore)
  })

  it('render verification: replaced fence skips the highlight callback', () => {
    let highlightCalls = 0
    const highlightArgs = []
    const md = markdownit({
      highlight (str, lang) {
        highlightCalls++
        highlightArgs.push([str, lang])
        return `<span class="hl">${str}</span>`
      }
    })
    const { tokens, env } = parse(md)

    const plan = createCodeBlockPlan(tokens, { lang: 'js' }, 'const a = 42\n')
    assert.equal(plan.apply(), true)

    // render only the plan-targeted tokens: highlight must not run at all
    const scoped = md.renderer.render(plan.entries.map(e => e.token), md.options, env)
    assert.equal(highlightCalls, 0)
    assert.equal(scoped, '<pre><code class="language-js">const a = 42\n</code></pre>\n')

    // full document render: python fence still highlighted, js fence not
    const html = md.renderer.render(tokens, md.options, env)
    assert.equal(highlightCalls, 1) // only the python fence
    assert.deepEqual(highlightArgs, [["print('hi')\n", 'python']])
    assert.ok(html.includes('<pre><code class="language-js">const a = 42\n</code></pre>'))
    assert.ok(html.includes("<span class=\"hl\">print('hi')\n</span>"))
    assert.ok(html.includes('<code>const b = 2</code>')) // inline code intact
    assert.ok(html.includes('<pre><code>indented = 1\n</code></pre>'))
  })

  it('marks applied tokens via meta flag', () => {
    const md = markdownit()
    const { tokens } = parse(md)
    const plan = createCodeBlockPlan(tokens, { lang: 'js' }, 'x\n')
    assert.equal(plan.entries[0].token.meta, null)
    plan.apply()
    assert.deepEqual(plan.entries[0].token.meta[CODE_BLOCK_PLAN_META], { replaced: true })
  })

  it('refuses to apply when the baseline changed, leaving tokens untouched', () => {
    const md = markdownit()
    const { tokens } = parse(md)

    const plan = createCodeBlockPlan(tokens, { lang: 'js' }, 'const a = 42\n')
    const target = plan.entries[0].token

    // target content changed after the plan was created
    target.content = 'const a = 999\n'

    assert.equal(plan.apply(), false)
    assert.equal(plan.applied, false)
    // failed plan: original tokens untouched (no rewrite, no meta flag)
    assert.equal(target.content, 'const a = 999\n')
    assert.equal(target.meta, null)
    assert.equal(tokens.filter(t => t.type === 'fence')[1].content, "print('hi')\n")
  })

  it('an older plan refuses after a newer plan was applied', () => {
    const md = markdownit()
    const { tokens } = parse(md)

    const first = createCodeBlockPlan(tokens, { lang: 'js' }, 'const a = 42\n')
    const stale = createCodeBlockPlan(tokens, { lang: 'js' }, 'const a = 43\n')

    assert.equal(first.apply(), true)
    // baseline moved -> the stale plan must refuse and change nothing
    assert.equal(stale.apply(), false)
    assert.equal(first.entries[0].token.content, 'const a = 42\n')
    // applying twice is refused too
    assert.equal(first.apply(), false)
    assert.equal(first.entries[0].token.content, 'const a = 42\n')
  })

  it('can target a specific occurrence by index', () => {
    const md = markdownit()
    const src = '```js\none\n```\n\n```js\ntwo\n```\n'
    const { tokens } = parse(md, src)

    const plan = createCodeBlockPlan(tokens, { lang: 'js', index: 1 }, 'TWO\n')
    assert.equal(plan.size, 1)
    assert.equal(plan.entries[0].baseline, 'two\n')
    assert.equal(plan.apply(), true)

    const fences = tokens.filter(t => t.type === 'fence')
    assert.equal(fences[0].content, 'one\n')
    assert.equal(fences[1].content, 'TWO\n')
  })

  it('supports a content function per entry', () => {
    const md = markdownit()
    const { tokens } = parse(md)

    const plan = createCodeBlockPlan(tokens, { kind: 'fence' },
      entry => entry.baseline.toUpperCase())
    assert.equal(plan.size, 2)
    assert.equal(plan.apply(), true)

    const fences = tokens.filter(t => t.type === 'fence')
    assert.equal(fences[0].content, 'CONST A = 1\n')
    assert.equal(fences[1].content, "PRINT('HI')\n")
  })
})
