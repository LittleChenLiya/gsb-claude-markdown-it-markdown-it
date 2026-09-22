// Types are checked as a package consumer would see them, via `exports` map.
import md = require('markdown-it')

const parser = new md({ html: true })
const legacy = md('commonmark')
const tokens: md.Token[] = parser.parse('abc', {})
const Token: typeof md.Token = md.Token
const ruler: md.Ruler<[md.StateCore], void> = parser.core.ruler

const parserWithRanges = new md({ sourceRanges: true })
const ranges: md.Token['sourceRanges'] = parserWithRanges.parse('abc', {})[0].sourceRanges
const range: md.SourceRange | undefined = ranges?.[0]

export { parser, legacy, tokens, Token, ruler, parserWithRanges, ranges, range }
