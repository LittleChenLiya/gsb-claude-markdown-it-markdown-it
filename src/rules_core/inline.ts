import type StateCore from './state_core.ts'

export default function inline (state: StateCore): void {
  const tokens = state.tokens
  const srcMap = state.srcMap

  // Parse inlines
  for (let i = 0, l = tokens.length; i < l; i++) {
    const tok = tokens[i]
    if (tok.type === 'inline') {
      // Compose the block-level content map (content offset -> normalized
      // src offset) with the normalization map (normalized src offset ->
      // original src offset), so inline tokens can be mapped straight to
      // the original source.
      let contentMap = null
      if (srcMap && tok.contentMap) {
        contentMap = tok.contentMap.map(offset => srcMap[offset])
        // the inline token itself covers its whole content
        tok.sourceRanges = [[contentMap[0], contentMap[contentMap.length - 1]]]
      }
      delete tok.contentMap
      state.md.inline.parse(tok.content, state.md, state.env, tok.children!, contentMap)
    }
  }
}
