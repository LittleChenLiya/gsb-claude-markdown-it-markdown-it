import MarkdownIt, { type Token } from 'markdown-it'

const parser = new MarkdownIt({ html: true })
const tokens: Token[] = parser.parse('abc', {})

const parserWithRanges = new MarkdownIt({ sourceRanges: true })
const ranges: Token['sourceRanges'] = parserWithRanges.parse('abc', {})[0].sourceRanges
const range: import('markdown-it').SourceRange | undefined = ranges?.[0]
parserWithRanges.parse('abc', {})[0].setSourceRange(0, 3)

export { parser, tokens, parserWithRanges, ranges, range }
