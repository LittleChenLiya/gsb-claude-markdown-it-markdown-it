import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import MarkdownIt from '../src/index.ts'
import CodeBlockPlan from '../src/code_block_plan.ts'

const CodeBlockPlanError = CodeBlockPlan.Error

// Source fixture: a fenced js block, a fenced python block, an indented code
// block and inline code. Line numbers are 0-based in the token map.
const SRC = [
  '# Title',
  '',
  '``` js',
  'console.log("old js")',
  '```',
  '',
  '```python',
  'print("py")',
  '```',
  '',
  '    indented code block',
  '',
  'Inline `code_inline` stays.',
  ''
].join('\n')

const JS_CONTENT = 'console.log("old js")\n'
const PY_CONTENT = 'print("py")\n'
const CB_CONTENT = 'indented code block\n'

function makeMd (highlightCalls) {
  return new MarkdownIt({
    highlight (str, lang) {
      highlightCalls.push({ str, lang })
      return ''
    }
  })
}

function findFence (tokens, langPrefix) {
  return tokens.find(t => t.type === 'fence' && t.info.trim().startsWith(langPrefix))
}

function findInlineCode (tokens) {
  for (const token of tokens) {
    if (token.type !== 'inline') { continue }
    for (const child of token.children) {
      if (child.type === 'code_inline') { return child }
    }
  }
  return null
}

describe('CodeBlockPlan', function () {
  it('replaces only the selected js fence and preserves info, map and unrelated tokens', function () {
    const highlightCalls = []
    const md = makeMd(highlightCalls)
    const tokens = md.parse(SRC, {})

    const plan = CodeBlockPlan.fromTokens(tokens, { lang: 'js' })

    // Only the js fence is selected.
    assert.equal(plan.replacements.length, 1)
    assert.deepEqual(plan.replacements[0].kind, 'fence')
    assert.equal(plan.replacements[0].lang, 'js')
    assert.equal(plan.replacements[0].index, 0)
    assert.equal(plan.replacements[0].baseline, JS_CONTENT)

    plan.replacements[0].content = 'console.log("new js")\n'
    plan.apply(tokens)

    // js fence: content replaced, info and map preserved.
    const js = findFence(tokens, 'js')
    assert.equal(js.content, 'console.log("new js")\n')
    assert.equal(js.info, ' js')
    assert.deepEqual(js.map, [2, 5])

    // python fence: untouched, map preserved.
    const py = findFence(tokens, 'python')
    assert.equal(py.content, PY_CONTENT)
    assert.equal(py.info, 'python')
    assert.deepEqual(py.map, [6, 9])

    // indented code block: untouched, map preserved.
    const cb = tokens.find(t => t.type === 'code_block')
    assert.equal(cb.content, CB_CONTENT)
    assert.deepEqual(cb.map, [10, 11])

    // inline code: untouched.
    const inlineCode = findInlineCode(tokens)
    assert.ok(inlineCode)
    assert.equal(inlineCode.content, 'code_inline')

    // The plan never renders, so the highlight callback is never called.
    assert.equal(highlightCalls.length, 0)

    // Rendering verification: new js is rendered, python and inline code stay.
    const html = md.renderer.render(tokens, md.options, {})
    assert.ok(html.includes('console.log(&quot;new js&quot;)'), 'new js content rendered')
    assert.ok(!html.includes('old js'), 'old js content gone')
    assert.ok(html.includes('print(&quot;py&quot;)'), 'python content unchanged')
    assert.ok(html.includes('<code>code_inline</code>'), 'inline code unchanged')
    assert.ok(html.includes('language-js'), 'js language class kept')
  })

  it('handles fenced and indented blocks separately', function () {
    const md = new MarkdownIt()
    const tokens = md.parse(SRC, {})

    // A language selector must never match an indented block.
    const jsPlan = CodeBlockPlan.fromTokens(tokens, { lang: 'js' })
    assert.equal(jsPlan.replacements.length, 1)
    assert.equal(jsPlan.replacements[0].kind, 'fence')

    // The indented selector only matches code_block tokens.
    const indentedPlan = CodeBlockPlan.fromTokens(tokens, { kind: 'code_block' })
    assert.equal(indentedPlan.replacements.length, 1)
    assert.equal(indentedPlan.replacements[0].kind, 'code_block')
    assert.equal(indentedPlan.replacements[0].lang, '')

    // No selector captures both kinds, each with its own identity.
    const allPlan = CodeBlockPlan.fromTokens(tokens)
    assert.equal(allPlan.replacements.length, 3)
    assert.deepEqual(allPlan.replacements.map(r => `${r.kind}:${r.lang}#${r.index}`), [
      'fence:js#0',
      'fence:python#0',
      'code_block:#0'
    ])

    // Applying the indented plan only touches the indented block.
    indentedPlan.replacements[0].content = 'new indented\n'
    indentedPlan.apply(tokens)
    assert.equal(tokens.find(t => t.type === 'code_block').content, 'new indented\n')
    assert.equal(findFence(tokens, 'js').content, JS_CONTENT)
    assert.equal(findFence(tokens, 'python').content, PY_CONTENT)
  })

  it('selects blocks by identity when several share the same language', function () {
    const src = [
      '```js', 'one', '```', '',
      '```js', 'two', '```', '',
      '```js', 'three', '```', ''
    ].join('\n')
    const md = new MarkdownIt()
    const tokens = md.parse(src, {})

    const plan = CodeBlockPlan.fromTokens(tokens, { lang: 'js', index: 1 })
    assert.equal(plan.replacements.length, 1)
    assert.equal(plan.replacements[0].index, 1)
    assert.equal(plan.replacements[0].baseline, 'two\n')

    plan.replacements[0].content = 'TWO\n'
    plan.apply(tokens)

    const fences = tokens.filter(t => t.type === 'fence')
    assert.equal(fences[0].content, 'one\n')
    assert.equal(fences[1].content, 'TWO\n')
    assert.equal(fences[2].content, 'three\n')
  })

  it('refuses to apply when the baseline changed and leaves tokens untouched', function () {
    const md = new MarkdownIt()
    const tokens = md.parse(SRC, {})

    const plan = CodeBlockPlan.fromTokens(tokens, { lang: 'js' })
    plan.replacements[0].content = 'should not be written'

    // Change the target content after the plan was created.
    const js = findFence(tokens, 'js')
    js.content = 'tampered'

    assert.throws(
      () => plan.apply(tokens),
      (err) => err instanceof CodeBlockPlanError && /baseline/.test(err.message)
    )

    // The failed application must not touch the token stream.
    assert.equal(js.content, 'tampered')
    assert.equal(findFence(tokens, 'python').content, PY_CONTENT)
    assert.equal(tokens.find(t => t.type === 'code_block').content, CB_CONTENT)
  })

  it('refuses to apply when a target block is missing', function () {
    const md = new MarkdownIt()
    const tokens = md.parse(SRC, {})

    const plan = CodeBlockPlan.fromTokens(tokens, { lang: 'js' })
    plan.replacements[0].content = 'new'

    // Drop the target block from the stream.
    const idx = tokens.findIndex(t => t.type === 'fence' && t.info.trim().startsWith('js'))
    tokens.splice(idx, 1)

    assert.throws(
      () => plan.apply(tokens),
      (err) => err instanceof CodeBlockPlanError && /not found/.test(err.message)
    )
  })

  it('is atomic: a failed apply does not write any replacement', function () {
    const md = new MarkdownIt()
    const tokens = md.parse(SRC, {})

    const plan = CodeBlockPlan.fromTokens(tokens)
    assert.equal(plan.replacements.length, 3)
    plan.replacements.forEach((r, i) => { r.content = `new ${i}\n` })

    // Tamper only with the python block; the js block would match.
    findFence(tokens, 'python').content = 'tampered'

    assert.throws(() => plan.apply(tokens), CodeBlockPlanError)

    // Nothing was written, even for the blocks whose baseline still matched.
    assert.equal(findFence(tokens, 'js').content, JS_CONTENT)
    assert.equal(findFence(tokens, 'python').content, 'tampered')
    assert.equal(tokens.find(t => t.type === 'code_block').content, CB_CONTENT)
  })

  it('describes the planned replacements', function () {
    const md = new MarkdownIt()
    const tokens = md.parse(SRC, {})

    const plan = CodeBlockPlan.fromTokens(tokens, { lang: 'js' })
    plan.replacements[0].content = 'console.log("new js")\n'

    const description = plan.describe()
    assert.match(description, /Code block replacement plan \(1 replacement\)/)
    assert.match(description, /fence "js" #0/)
    assert.match(description, /22 -> 22 chars/)
    assert.equal(plan.description, description)
  })

  it('is exposed on the MarkdownIt class', function () {
    assert.equal(MarkdownIt.CodeBlockPlan, CodeBlockPlan)
  })
})
