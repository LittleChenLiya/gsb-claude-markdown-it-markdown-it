// Footnote syntax extension (opt-in plugin).
//
// Syntax:
//
//   Inline reference:      [^name]
//   Block definition:      [^name]: footnote content
//
// Footnotes are numbered by order of first reference in the text. Referencing
// the same footnote multiple times produces one backlink per reference.
// Definitions that are never referenced are not rendered. References without
// a matching definition are kept as visible literal text and reported in
// `env.footnotes.diagnostics`. Duplicate definitions are ignored after the
// first one and reported as well.
//
// When several rendered fragments are combined into a single page, pass
// a per-fragment namespace (plugin option or `env.footnoteNamespace`) to
// keep generated HTML ids unique.

import { escapeHtml, isSpace } from '../common/utils.ts'
import type MarkdownIt from '../markdownit.ts'
import type StateBlock from '../rules_block/state_block.ts'
import type StateCore from '../rules_core/state_core.ts'
import type StateInline from '../rules_inline/state_inline.ts'
import type Token from '../token.ts'
import type { Env, MarkdownItOptions } from '../types.ts'

/** Problem found while resolving footnote references and definitions. */
export interface FootnoteDiagnostic {
  /** `missing-definition` - reference has no definition, `duplicate-definition` - definition ignored in favor of the first one. */
  type: 'missing-definition' | 'duplicate-definition'
  /** Footnote label (without brackets). */
  label: string
  /** Human-readable description. */
  message: string
}

/** A footnote that was referenced at least once, in first-reference order. */
export interface FootnoteListEntry {
  /** Footnote label (without brackets). */
  label: string
  /** Number of references to this footnote in the text. */
  count: number
}

/** Per-render footnote state, stored in `env.footnotes` and reset on every parse. */
export interface FootnoteEnv {
  /** Id prefix namespace for this render (empty string when not set). */
  namespace: string
  /** Map of `:` + label to footnote id (-1 while defined but not yet referenced). */
  refs: Record<string, number>
  /** Referenced footnotes in order of first reference. */
  list: FootnoteListEntry[]
  /** Problems found during this render. */
  diagnostics: FootnoteDiagnostic[]
}

/** Options for the footnote plugin. */
export interface FootnotePluginOptions {
  /**
   * Namespace prepended to all generated HTML ids (`<namespace>-fn1`,
   * `<namespace>-fnref1`, ...). Use it to avoid id collisions when
   * combining several rendered fragments in one page. Can be overridden
   * per render with `env.footnoteNamespace`.
   *
   * @defaultValue `''`
   */
  namespace?: string
}

interface FootnoteMeta {
  id: number
  subId: number
  label: string
}

function getFootnotes (env: Env | undefined): FootnoteEnv | undefined {
  return env?.footnotes as FootnoteEnv | undefined
}

// Tokenize the body of a footnote definition (the part after `[^label]:`)
// with the regular block parser. Consumes all continuation lines indented
// by 4+ spaces relative to the definition start.
function tokenizeDefinition (state: StateBlock, startLine: number, endLine: number, posAfterColon: number): void {
  const oldBMark = state.bMarks[startLine]
  const oldTShift = state.tShift[startLine]
  const oldSCount = state.sCount[startLine]
  const oldParentType = state.parentType

  const max = state.eMarks[startLine]
  const initial = state.sCount[startLine] + posAfterColon - (state.bMarks[startLine] + state.tShift[startLine])
  let offset = initial
  let pos = posAfterColon

  // skip spaces after ':', tracking the column offset
  while (pos < max) {
    const ch = state.src.charCodeAt(pos)
    if (isSpace(ch)) {
      if (ch === 0x09) {
        offset += 4 - offset % 4
      } else {
        offset++
      }
    } else {
      break
    }
    pos++
  }

  state.tShift[startLine] = pos - posAfterColon
  state.sCount[startLine] = offset - initial
  state.bMarks[startLine] = posAfterColon
  state.blkIndent += 4
  state.parentType = 'footnote'

  if (state.sCount[startLine] < state.blkIndent) {
    state.sCount[startLine] += state.blkIndent
  }

  state.md.block.tokenize(state, startLine, endLine)

  state.parentType = oldParentType
  state.blkIndent -= 4
  state.tShift[startLine] = oldTShift
  state.sCount[startLine] = oldSCount
  state.bMarks[startLine] = oldBMark
}

// Block rule for footnote definitions: `[^label]: content`
function footnote_def (state: StateBlock, startLine: number, endLine: number, silent: boolean): boolean {
  const start = state.bMarks[startLine] + state.tShift[startLine]
  const max = state.eMarks[startLine]

  // line should be at least 5 chars - "[^x]:"
  if (start + 4 > max) { return false }

  // if it's indented more than 3 spaces, it should be a code block
  if (state.sCount[startLine] - state.blkIndent >= 4) { return false }

  if (state.src.charCodeAt(start) !== 0x5B/* [ */) { return false }
  if (state.src.charCodeAt(start + 1) !== 0x5E/* ^ */) { return false }

  let pos = start + 2
  for (; pos < max; pos++) {
    const ch = state.src.charCodeAt(pos)
    if (ch === 0x20 || ch === 0x09) { return false } // no spaces in labels
    if (ch === 0x5D/* ] */) { break }
  }

  if (pos === start + 2) { return false } // no empty footnote labels
  if (pos + 1 >= max || state.src.charCodeAt(pos + 1) !== 0x3A/* : */) { return false }
  if (silent) { return true }
  pos++

  const footnotes = getFootnotes(state.env)
  /* istanbul ignore if */
  if (!footnotes) { return false }

  const label = state.src.slice(start + 2, pos - 1)
  const key = ':' + label

  if (typeof footnotes.refs[key] !== 'undefined') {
    // Duplicate definition: the first one wins, this one is consumed
    // (so it doesn't leak into the output) but discarded and reported.
    footnotes.diagnostics.push({
      type: 'duplicate-definition',
      label,
      message: `Duplicate footnote definition "[^${label}"] ignored, the first definition takes effect`
    })

    const tokensLength = state.tokens.length
    const level = state.level
    tokenizeDefinition(state, startLine, endLine, pos + 1)
    state.tokens.length = tokensLength
    state.level = level
    return true
  }

  footnotes.refs[key] = -1

  const openToken = state.push('footnote_reference_open', '', 1)
  openToken.meta = { label }
  openToken.map = [startLine, endLine]

  tokenizeDefinition(state, startLine, endLine, pos + 1)

  state.push('footnote_reference_close', '', -1)
  return true
}

// Inline rule for footnote references: `[^label]`
function footnote_ref (state: StateInline, silent: boolean): boolean {
  const max = state.posMax
  const start = state.pos

  // should be at least 4 chars - "[^x]"
  if (start + 3 > max) { return false }

  if (state.src.charCodeAt(start) !== 0x5B/* [ */) { return false }
  if (state.src.charCodeAt(start + 1) !== 0x5E/* ^ */) { return false }

  const footnotes = getFootnotes(state.env)
  if (!footnotes) { return false }

  let pos = start + 2
  for (; pos < max; pos++) {
    const ch = state.src.charCodeAt(pos)
    if (ch === 0x20 || ch === 0x0A) { return false }
    if (ch === 0x5D/* ] */) { break }
  }

  if (pos === start + 2) { return false } // no empty footnote labels
  if (pos >= max) { return false }
  pos++

  const label = state.src.slice(start + 2, pos - 1)

  if (!silent) {
    const key = ':' + label

    if (typeof footnotes.refs[key] === 'undefined') {
      // Missing definition: keep the source visible as literal text
      // and report the problem.
      if (!footnotes.diagnostics.some(d => d.type === 'missing-definition' && d.label === label)) {
        footnotes.diagnostics.push({
          type: 'missing-definition',
          label,
          message: `Footnote reference "[^${label}"] has no matching definition`
        })
      }

      const token = state.push('text', '', 0)
      token.content = state.src.slice(start, pos)
    } else {
      let id = footnotes.refs[key]

      if (id < 0) {
        // First reference to this footnote: assign the next number.
        id = footnotes.list.length
        footnotes.list[id] = { label, count: 0 }
        footnotes.refs[key] = id
      }

      const subId = footnotes.list[id].count
      footnotes.list[id].count++

      const token = state.push('footnote_ref', '', 0)
      token.meta = { id, subId, label } satisfies FootnoteMeta
    }
  }

  state.pos = pos
  state.posMax = max
  return true
}

// Core rule (runs after inline parsing): moves footnote definition bodies
// out of the main token stream and appends the footnote block at the end.
function footnote_tail (state: StateCore): void {
  const footnotes = getFootnotes(state.env)
  if (!footnotes) { return }

  const refTokens: Record<string, Token[]> = Object.create(null)
  let current: Token[] = []
  let currentLabel = ''
  let insideRef = false

  state.tokens = state.tokens.filter((tok) => {
    if (tok.type === 'footnote_reference_open') {
      insideRef = true
      current = []
      currentLabel = (tok.meta as { label: string }).label
      return false
    }
    if (tok.type === 'footnote_reference_close') {
      insideRef = false
      refTokens[':' + currentLabel] = current
      return false
    }
    if (insideRef) { current.push(tok) }
    return !insideRef
  })

  const list = footnotes.list
  if (!list.length) { return }

  state.tokens.push(new state.Token('footnote_block_open', '', 1))

  for (let i = 0; i < list.length; i++) {
    const entry = list[i]

    const openToken = new state.Token('footnote_open', '', 1)
    openToken.meta = { id: i, label: entry.label }
    state.tokens.push(openToken)

    const bodyTokens = refTokens[':' + entry.label]
    if (bodyTokens) {
      state.tokens = state.tokens.concat(bodyTokens)
    }

    // Put backlinks at the end of the last paragraph, if there is one
    let lastParagraph: Token | null = null
    if (state.tokens[state.tokens.length - 1].type === 'paragraph_close') {
      lastParagraph = state.tokens.pop()!
    }

    // One backlink per reference, in order of reference occurrence
    const count = entry.count > 0 ? entry.count : 1
    for (let j = 0; j < count; j++) {
      const anchorToken = new state.Token('footnote_anchor', '', 0)
      anchorToken.meta = { id: i, subId: j, label: entry.label }
      state.tokens.push(anchorToken)
    }

    if (lastParagraph) {
      state.tokens.push(lastParagraph)
    }

    state.tokens.push(new state.Token('footnote_close', '', -1))
  }

  state.tokens.push(new state.Token('footnote_block_close', '', -1))
}

function idPrefix (env: Env | undefined): string {
  const namespace = getFootnotes(env)?.namespace
  return namespace ? `${namespace}-` : ''
}

function render_footnote_ref (tokens: Token[], idx: number, _options: Required<MarkdownItOptions>, env: Env | undefined): string {
  const meta = tokens[idx].meta as unknown as FootnoteMeta
  const prefix = idPrefix(env)
  const n = meta.id + 1
  let refid = `${prefix}fnref${n}`

  if (meta.subId > 0) {
    refid += ':' + meta.subId
  }

  const id = `${prefix}fn${n}`
  return `<sup class="footnote-ref"><a href="#${escapeHtml(id)}" id="${escapeHtml(refid)}">[${n}]</a></sup>`
}

function render_footnote_block_open (): string {
  return '<hr class="footnotes-sep">\n' +
    '<section class="footnotes">\n' +
    '<ol class="footnotes-list">\n'
}

function render_footnote_block_close (): string {
  return '</ol>\n</section>\n'
}

function render_footnote_open (tokens: Token[], idx: number, _options: Required<MarkdownItOptions>, env: Env | undefined): string {
  const meta = tokens[idx].meta as unknown as FootnoteMeta
  const id = `${idPrefix(env)}fn${meta.id + 1}`
  return `<li id="${escapeHtml(id)}" class="footnote-item">`
}

function render_footnote_close (): string {
  return '</li>\n'
}

function render_footnote_anchor (tokens: Token[], idx: number, _options: Required<MarkdownItOptions>, env: Env | undefined): string {
  const meta = tokens[idx].meta as unknown as FootnoteMeta
  const n = meta.id + 1
  let refid = `${idPrefix(env)}fnref${n}`

  if (meta.subId > 0) {
    refid += ':' + meta.subId
  }

  /* ↩ with escape code to prevent display as Apple Emoji on iOS */
  return `<a href="#${escapeHtml(refid)}" class="footnote-backref">↩︎</a>`
}

/**
 * Footnote plugin: `[^name]` references and `[^name]: ...` block definitions.
 *
 * @example
 * ```js
 * import MarkdownIt from 'markdown-it'
 * import { footnote } from 'markdown-it'
 *
 * const md = new MarkdownIt().use(footnote, { namespace: 'page1' })
 * const env = {}
 * const html = md.render('text[^a]\n\n[^a]: note', env)
 * console.log(env.footnotes.diagnostics)
 * ```
 */
export default function footnote (md: MarkdownIt, options: FootnotePluginOptions = {}): void {
  const optionNamespace = typeof options.namespace === 'string' ? options.namespace : ''

  // Reset per-render state before block parsing starts, so repeated
  // renders never share state (even when `env` is reused by the caller).
  md.core.ruler.before('block', 'footnote_begin', (state: StateCore) => {
    const env = state.env
    const namespace = typeof env.footnoteNamespace === 'string'
      ? env.footnoteNamespace
      : optionNamespace

    env.footnotes = {
      namespace,
      refs: Object.create(null),
      list: [],
      diagnostics: []
    } satisfies FootnoteEnv
  })

  md.block.ruler.before('reference', 'footnote_def', footnote_def, { alt: ['paragraph', 'reference'] })
  md.inline.ruler.after('image', 'footnote_ref', footnote_ref)
  md.core.ruler.after('inline', 'footnote_tail', footnote_tail)

  md.renderer.rules.footnote_ref = render_footnote_ref
  md.renderer.rules.footnote_block_open = render_footnote_block_open
  md.renderer.rules.footnote_block_close = render_footnote_block_close
  md.renderer.rules.footnote_open = render_footnote_open
  md.renderer.rules.footnote_close = render_footnote_close
  md.renderer.rules.footnote_anchor = render_footnote_anchor
}
