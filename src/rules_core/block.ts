import type StateCore from './state_core.ts'
import { SOURCE_MAP, buildSliceMap } from '../common/source_map.ts'

export default function block (state: StateCore): void {
  let token

  if (state.inlineMode) {
    token = new state.Token('inline', '', 0)
    token.content = state.src
    token.map = [0, 1]
    token.children = []
    if (state.md.options.sourceRanges) {
      token[SOURCE_MAP] = buildSliceMap(0, state.src.length)
    }
    state.tokens.push(token)
  } else {
    state.md.block.parse(state.src, state.md, state.env, state.tokens)
  }
}
