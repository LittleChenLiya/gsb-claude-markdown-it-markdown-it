import type StateCore from './state_core.ts'
import { SOURCE_MAP, mergeRanges } from '../common/source_map.ts'
import type { SourceRange } from '../token.ts'

export default function inline (state: StateCore): void {
  const tokens = state.tokens
  const trackRanges = state.md.options.sourceRanges

  // Parse inlines
  for (let i = 0, l = tokens.length; i < l; i++) {
    const tok = tokens[i]
    if (tok.type === 'inline') {
      const srcMap = trackRanges ? (tok[SOURCE_MAP] ?? null) : null
      delete tok[SOURCE_MAP]

      state.md.inline.parse(tok.content, state.md, state.env, tok.children!, srcMap)

      if (trackRanges) {
        // refine the inline token's own range to cover its children
        const ranges: SourceRange[] = []
        for (const child of tok.children!) {
          if (child.sourceRanges) { ranges.push(...child.sourceRanges) }
        }
        if (ranges.length > 0) { tok.sourceRanges = mergeRanges(ranges) }
      }
    }
  }
}
