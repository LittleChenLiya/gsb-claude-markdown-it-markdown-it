import type StateCore from './state_core.ts'
import type { SourceRange } from '../token.ts'

// Convert token line maps to source ranges (offsets in the original,
// unnormalized source). Closing tokens without a line map inherit the
// range of their opening token, so parents always cover their children.
function assignBlockSourceRanges (state: StateCore): void {
  const src = state.src
  const srcMap = state.srcMap!

  // line begin offsets in the normalized src (same splitting as StateBlock)
  const bMarks = [0]
  for (let i = 0; i < src.length; i++) {
    if (src.charCodeAt(i) === 0x0A /* \n */) { bMarks.push(i + 1) }
  }

  const stack: Array<SourceRange[] | null> = []

  for (const token of state.tokens) {
    let ranges: SourceRange[] | null = null

    if (token.map) {
      const start = token.map[0] < bMarks.length ? bMarks[token.map[0]] : src.length
      const end = token.map[1] < bMarks.length ? bMarks[token.map[1]] : src.length
      ranges = [[srcMap[start], srcMap[end]]]
    } else if (token.nesting === -1 && stack.length) {
      ranges = stack[stack.length - 1]
    }

    token.sourceRanges = ranges

    if (token.nesting === 1) { stack.push(ranges) }
    if (token.nesting === -1) { stack.pop() }
  }
}

export default function block (state: StateCore): void {
  let token

  if (state.inlineMode) {
    token = new state.Token('inline', '', 0)
    token.content = state.src
    token.map = [0, 1]
    token.children = []
    if (state.srcMap) {
      // identity map: inline content is the whole normalized source
      token.contentMap = Array.from({ length: state.src.length + 1 }, (_, i) => i)
      token.sourceRanges = [[state.srcMap[0], state.srcMap[state.src.length]]]
    }
    state.tokens.push(token)
  } else {
    state.md.block.parse(state.src, state.md, state.env, state.tokens)

    if (state.srcMap) {
      assignBlockSourceRanges(state)
    }
  }
}
