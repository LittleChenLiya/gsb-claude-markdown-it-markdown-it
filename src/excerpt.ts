// Token-based excerpt (summary) helper.
//
// Truncates a parsed token stream to a given number of visible characters
// (counted in Unicode code points), keeping the resulting HTML well-formed:
// every opened structure (paragraphs, emphasis, links, ...) is closed, and
// a single ellipsis is appended when content was cut. The ellipsis itself
// is not counted against the limit.

import Token from './token.ts'

export interface ExcerptOptions {
  /**
   * String appended (at most once) when the content had to be truncated.
   * Not counted against the character limit. Defaults to an ellipsis char.
   */
  ellipsis?: string
}

interface ExcerptState {
  remaining: number
  ellipsis: string
  truncated: boolean
  ellipsisAdded: boolean
}

// Tokens whose content is rendered as visible text at block level
const BLOCK_TEXT_TOKENS = ['text', 'code_block', 'fence']

// Tokens whose content is rendered as visible text inside inline children
const INLINE_TEXT_TOKENS = ['text', 'code_inline']

function codePointLength (str: string): number {
  let len = 0
  for (const _ch of str) { len++ }
  return len
}

function sliceByCodePoints (str: string, max: number): string {
  if (max <= 0) { return '' }
  let pos = 0
  let count = 0
  for (const ch of str) {
    if (count === max) { break }
    pos += ch.length
    count++
  }
  return str.slice(0, pos)
}

function cloneToken (token: Token): Token {
  return Object.assign(Object.create(Token.prototype), token)
}

// Create a closing token matching an opening one (foo_open -> foo_close)
function makeCloseToken (open: Token): Token {
  const type = open.type.endsWith('_open')
    ? open.type.slice(0, -'_open'.length) + '_close'
    : open.type
  const close = new Token(type, open.tag, -1)
  close.level = open.level
  close.block = open.block
  close.hidden = open.hidden
  close.markup = open.markup
  return close
}

// Length of the visible alt text of an image token
function imageAltLength (token: Token): number {
  let len = 0
  for (const child of token.children ?? []) {
    if (INLINE_TEXT_TOKENS.includes(child.type)) {
      len += codePointLength(child.content)
    } else if (child.children) {
      len += imageAltLength(child)
    }
  }
  return len
}

// Truncate children of an inline token, closing any structure that was
// left open by the cut. Returns a new array, inputs are never mutated.
function truncateChildren (children: Token[], state: ExcerptState): Token[] {
  const out: Token[] = []
  const stack: Token[] = []

  for (const child of children) {
    if (state.truncated) { break }

    if (child.nesting === 1) {
      stack.push(child)
      out.push(child)
    } else if (child.nesting === -1) {
      stack.pop()
      out.push(child)
    } else if (INLINE_TEXT_TOKENS.includes(child.type)) {
      const len = codePointLength(child.content)
      if (len <= state.remaining) {
        state.remaining -= len
        out.push(child)
      } else {
        const copy = cloneToken(child)
        copy.content = sliceByCodePoints(child.content, state.remaining) + state.ellipsis
        state.remaining = 0
        state.truncated = true
        state.ellipsisAdded = true
        out.push(copy)
      }
    } else if (child.type === 'image') {
      // Images are kept atomically: either the whole alt text fits, or the
      // image is dropped. An empty alt never consumes the budget.
      const len = imageAltLength(child)
      if (len <= state.remaining) {
        state.remaining -= len
        out.push(child)
      } else {
        state.truncated = true
      }
    } else {
      // softbreak, hardbreak, html_inline, ... don't consume visible chars
      out.push(child)
    }
  }

  while (stack.length > 0) {
    out.push(makeCloseToken(stack.pop()!))
  }

  return out
}

// Append the ellipsis to the last visible text of the truncated stream
// (used when truncation happened by dropping tokens rather than by cutting
// a text token in the middle).
function appendEllipsis (tokens: Token[], ellipsis: string): void {
  for (let i = tokens.length - 1; i >= 0; i--) {
    const token = tokens[i]

    if (token.type === 'inline' && token.children) {
      for (let j = token.children.length - 1; j >= 0; j--) {
        const child = token.children[j]
        if (INLINE_TEXT_TOKENS.includes(child.type)) {
          const copy = cloneToken(child)
          copy.content += ellipsis
          token.children[j] = copy
          return
        }
      }
      const text = new Token('text', '', 0)
      text.content = ellipsis
      token.children.push(text)
      return
    }

    if (BLOCK_TEXT_TOKENS.includes(token.type)) {
      const copy = cloneToken(token)
      copy.content += ellipsis
      tokens[i] = copy
      return
    }
  }
}

/**
 * Truncate a token stream to at most maxChars visible characters, counted
 * in Unicode code points.
 *
 * The result is a new token array that can be passed to the renderer.
 * Opened structures (emphasis, links, paragraphs, ...) are always closed,
 * so the rendered HTML stays well-formed. When content had to be dropped,
 * a single ellipsis is appended; the ellipsis does not count against
 * maxChars.
 *
 * Visible characters are the contents of text and inline/block code tokens,
 * plus the alt text of images. Raw HTML tokens and line breaks don't
 * consume the budget. The input tokens are never modified.
 */
export default function excerptTokens (tokens: Token[], maxChars: number, options: ExcerptOptions = {}): Token[] {
  const state: ExcerptState = {
    remaining: Math.max(0, Math.floor(maxChars)),
    ellipsis: options.ellipsis ?? '\u2026',
    truncated: false,
    ellipsisAdded: false
  }
  const out: Token[] = []
  const stack: Token[] = []

  for (const token of tokens) {
    if (state.truncated) { break }

    if (token.nesting === 1) {
      stack.push(token)
      out.push(token)
    } else if (token.nesting === -1) {
      stack.pop()
      out.push(token)
    } else if (token.type === 'inline' && token.children) {
      const copy = cloneToken(token)
      copy.children = truncateChildren(token.children, state)
      out.push(copy)
    } else if (BLOCK_TEXT_TOKENS.includes(token.type)) {
      const len = codePointLength(token.content)
      if (len <= state.remaining) {
        state.remaining -= len
        out.push(token)
      } else {
        const copy = cloneToken(token)
        copy.content = sliceByCodePoints(token.content, state.remaining) + state.ellipsis
        state.remaining = 0
        state.truncated = true
        state.ellipsisAdded = true
        out.push(copy)
      }
    } else {
      // html_block, hr, and other non-text tokens pass through for free
      out.push(token)
    }
  }

  if (state.truncated) {
    while (stack.length > 0) {
      out.push(makeCloseToken(stack.pop()!))
    }
    if (!state.ellipsisAdded) {
      appendEllipsis(out, state.ellipsis)
    }
  }

  return out
}

