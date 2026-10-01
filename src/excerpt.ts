// Token-based excerpt (truncation) helper.
//
// Cuts a token stream so that the number of visible characters does not
// exceed a caller-provided limit, counted in Unicode code points. Unlike
// naive HTML string slicing, this works on the parsed token stream, so
// structures like emphasis, links and inline code are always closed in
// pairs and the rendered HTML stays well-formed.

import Token from './token.ts'

/** Options for {@link truncateTokens}. */
export interface ExcerptOptions {
  /**
   * Marker appended (at most once) when content was cut. It does not count
   * towards the character limit. Pass an empty string to disable it.
   * Defaults to the horizontal ellipsis character "U+2026".
   */
  ellipsis?: string
}

/** Result of {@link truncateTokens}. */
export interface ExcerptResult {
  /** Truncated token stream, safe to pass to {@link Renderer.render}. */
  tokens: Token[]
  /** True if any content was dropped or shortened. */
  truncated: boolean
  /** Number of visible code points kept in the output. */
  visible: number
}

interface ExcerptState {
  remaining: number
  used: number
  truncated: boolean
  ellipsis: string
}

function countCodePoints (str: string): number {
  let count = 0
  for (const ch of str) { void ch; count++ }
  return count
}

function sliceCodePoints (str: string, max: number): string {
  let result = ''
  let count = 0
  for (const ch of str) {
    if (count >= max) { break }
    result += ch
    count++
  }
  return result
}

// Shallow copy preserving the prototype, so cloned tokens keep class
// behaviour while the originals stay untouched.
function cloneToken (token: Token): Token {
  return Object.assign(Object.create(Object.getPrototypeOf(token)), token)
}

function pushEllipsis (out: Token[], state: ExcerptState): void {
  if (state.ellipsis.length === 0) { return }
  const token = new Token('text', '', 0)
  token.content = state.ellipsis
  out.push(token)
}

function processList (tokens: Token[], state: ExcerptState): { list: Token[], modified: boolean } {
  const out: Token[] = []
  let modified = false
  // Depth of structures opened after the cut point; their closers must be
  // dropped together with the openers to keep the stream balanced.
  let skipDepth = 0

  for (const token of tokens) {
    if (state.truncated) {
      // Budget exhausted: keep only closers of structures that were opened
      // before the cut, drop everything else.
      if (token.nesting === 1) {
        skipDepth++
        modified = true
        continue
      }
      if (token.nesting === -1) {
        if (skipDepth > 0) {
          skipDepth--
          modified = true
          continue
        }
        out.push(token)
        continue
      }
      modified = true
      continue
    }

    // Structural tokens (paragraph_open, strong_close, ...) carry no visible
    // text and always pass through while the budget lasts.
    if (token.nesting !== 0) {
      out.push(token)
      continue
    }

    // Tokens with nested content: inline tokens (visible text in children)
    // and images (visible alt text in children).
    if ((token.type === 'inline' || token.type === 'image') && token.children) {
      const sub = processList(token.children, state)
      if (sub.modified) {
        const clone = cloneToken(token)
        clone.children = sub.list
        out.push(clone)
        modified = true
      } else {
        out.push(token)
      }
      continue
    }

    if (token.type === 'text' || token.type === 'code_inline') {
      const len = countCodePoints(token.content)
      if (len <= state.remaining) {
        state.remaining -= len
        state.used += len
        out.push(token)
      } else {
        // Cut inside this token: keep what fits, then append the ellipsis
        // once, still inside the innermost open structure.
        if (state.remaining > 0) {
          const clone = cloneToken(token)
          clone.content = sliceCodePoints(token.content, state.remaining)
          out.push(clone)
          state.used += state.remaining
          state.remaining = 0
        }
        pushEllipsis(out, state)
        state.truncated = true
        modified = true
      }
      continue
    }

    // Everything else (html_inline, html_block, softbreak, hardbreak, ...)
    // has no visible characters and passes through unchanged.
    out.push(token)
  }

  return { list: out, modified }
}

/**
 * Truncate a token stream to at most maxChars visible characters, counted
 * in Unicode code points (an emoji counts as 1 even though it may take
 * several UTF-16 code units).
 *
 * Visible characters are the contents of text and code_inline tokens,
 * plus the alt text of images. Raw HTML, line breaks and markup itself do
 * not count towards the limit.
 *
 * If content had to be dropped, a single ellipsis (see
 * {@link ExcerptOptions.ellipsis}) is appended at the cut point; it does not
 * count towards the limit. All structures opened before the cut point are
 * closed properly, so rendering the result always yields well-formed HTML.
 *
 * The input tokens are never modified; tokens that need changes are cloned.
 */
export function truncateTokens (tokens: Token[], maxChars: number, options: ExcerptOptions = {}): ExcerptResult {
  const state: ExcerptState = {
    remaining: Math.max(0, Math.floor(maxChars)),
    used: 0,
    truncated: false,
    ellipsis: options.ellipsis ?? '…'
  }

  const { list } = processList(tokens, state)

  return { tokens: list, truncated: state.truncated, visible: state.used }
}

export default truncateTokens

