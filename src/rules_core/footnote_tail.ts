// Glue footnote tokens to the end of the token stream
//
// Definition bodies were tokenized in place by the `footnote_def` block
// rule (between `footnote_reference_open`/`footnote_reference_close`
// markers). This rule moves the bodies of actually referenced footnotes
// to the end of the document and drops everything else (unused and
// duplicate definitions).

import type Token from '../token.ts'
import type StateCore from './state_core.ts'

export default function footnote_tail (state: StateCore): void {
  const footnotes = state.env?.footnotes
  if (!footnotes) { return }

  // Collect definition bodies and remove the markers (and the bodies)
  // from the main token stream
  const refTokens: Record<string, Token[]> = Object.create(null)
  let current: Token[] = []
  let currentLabel = ''
  let insideRef = false

  state.tokens = state.tokens.filter((tok) => {
    if (tok.type === 'footnote_reference_open') {
      insideRef = true
      current = []
      currentLabel = tok.meta!.label as string
      return false
    }
    if (tok.type === 'footnote_reference_close') {
      insideRef = false
      // prepend ':' to avoid conflict with Object.prototype members;
      // the first definition wins, duplicates were reported and discarded
      if (typeof refTokens[':' + currentLabel] === 'undefined') {
        refTokens[':' + currentLabel] = current
      }
      return false
    }
    if (insideRef) { current.push(tok) }
    return !insideRef
  })

  const list = footnotes.list
  if (!list || list.length === 0) { return }

  state.tokens.push(new state.Token('footnote_block_open', '', 1))

  for (let i = 0, l = list.length; i < l; i++) {
    const token_fo = new state.Token('footnote_open', '', 1)
    token_fo.meta = { id: i, label: list[i].label }
    state.tokens.push(token_fo)

    const tokens = refTokens[':' + list[i].label]
    if (tokens) { state.tokens = state.tokens.concat(tokens) }

    // If the footnote body ends with a paragraph, put the back-links
    // inside it to keep them on the same line
    let lastParagraph: Token | null = null
    if (state.tokens[state.tokens.length - 1].type === 'paragraph_close') {
      lastParagraph = state.tokens.pop()!
    }

    // One back-link per reference, targeting references in order
    // of their appearance in the text
    for (let j = 0; j < list[i].count; j++) {
      const token_a = new state.Token('footnote_anchor', '', 0)
      token_a.meta = { id: i, subId: j, label: list[i].label }
      state.tokens.push(token_a)
    }

    if (lastParagraph) {
      state.tokens.push(lastParagraph)
    }

    state.tokens.push(new state.Token('footnote_close', '', -1))
  }

  state.tokens.push(new state.Token('footnote_block_close', '', -1))
}
