// Token class

/** @inline */
type TokenNesting = -1 | 0 | 1

/** @inline */
type TokenAttribute = [name: string, value: string | number]

/**
 * Half-open `[start, end)` interval in the original Markdown source,
 * measured in UTF-16 code units (the same units as JavaScript strings).
 */
type SourceRange = [start: number, end: number]

/**
 * Merge two source range lists into one ordered list. Adjacent or
 * overlapping ranges are coalesced; ranges coming from genuinely
 * discontinuous parts of the source are kept as separate entries.
 * `null` (unknown source) does not contribute anything.
 *
 * @internal
 */
function mergeSourceRanges (a: SourceRange[] | null, b: SourceRange[] | null): SourceRange[] | null {
  if (!a) { return b }
  if (!b) { return a }

  const all = [...a, ...b].map(range => [range[0], range[1]] as SourceRange)
  all.sort((x, y) => x[0] - y[0])

  const result = [all[0]]
  for (let i = 1; i < all.length; i++) {
    const last = result[result.length - 1]
    if (all[i][0] <= last[1]) {
      if (all[i][1] > last[1]) { last[1] = all[i][1] }
    } else {
      result.push(all[i])
    }
  }
  return result
}

/**
 * Represents one item in the parsed token stream, storing parsed data and
 * providing helpers for managing HTML attributes.
 */
class Token {
  /**
   * Type of the token (string, e.g. "paragraph_open")
   */
  declare type: string

  /**
   * html tag name, e.g. "p"
   */
  declare tag: string

  /** Html attributes. Format: `[ [ name1, value1 ], [ name2, value2 ] ]` */
  declare attrs: TokenAttribute[] | null

  /**
   * Source map info. Format: `[ line_begin, line_end ]`
   */
  map: [number, number] | null = null

  /**
   * Ranges of the original Markdown source this token was generated from,
   * as an ordered list of half-open `[start, end)` UTF-16 offsets.
   * Ranges include the syntax markers the token was formed from, and
   * parent tokens cover all of their children. A token can have multiple
   * ranges if it was merged from discontinuous parts of the source.
   *
   * Populated only when the `sourceRanges` option is enabled. Stays
   * `null` when the option is disabled or when the source is unknown
   * (for example, tokens injected by plugins).
   */
  sourceRanges: SourceRange[] | null = null

  /**
   * Temporary map of inline `content` offsets to source offsets, used to
   * carry positions from the block parser to the inline parser when the
   * `sourceRanges` option is enabled.
   *
   * @internal
   */
  declare contentMap?: number[] | null

  /**
   * Level change (number in {-1, 0, 1} set), where:
   *
   * -  `1` means the tag is opening
   * -  `0` means the tag is self-closing
   * - `-1` means the tag is closing
   */
  declare nesting: TokenNesting

  /**
   * nesting level, the same as `state.level`
   */
  level = 0

  /**
   * An array of child nodes (inline and img tokens)
   */
  children: Token[] | null = null

  /**
   * In a case of self-closing tag (code, html, fence, etc.),
   * it has contents of this tag.
   */
  content = ''

  /**
   * '*' or '_' for emphasis, fence string for fence, etc.
   */
  markup = ''

  /**
   * Additional information:
   *
   * - Info string for "fence" tokens
   * - The value "auto" for autolink "link_open" and "link_close" tokens
   * - The string value of the item marker for ordered-list "list_item_open" tokens
   */
  info = ''

  /** A place for plugins to store an arbitrary data */
  declare meta: Record<string, unknown> | null

  /**
   * True for block-level tokens, false for inline tokens.
   * Used in renderer to calculate line breaks
   */
  block = false

  /**
   * If it's true, ignore this element when rendering. Used for tight lists
   * to hide paragraphs.
   */
  hidden = false

  constructor (type: string, tag: string, nesting: TokenNesting) {
    this.type = type
    this.tag = tag

    this.attrs = null

    this.nesting = nesting

    this.meta = null
  }

  /**
   * Search attribute index by name.
   */
  attrIndex (name: string): number {
    if (!this.attrs) { return -1 }

    const attrs = this.attrs

    for (let i = 0, len = attrs.length; i < len; i++) {
      if (attrs[i][0] === name) { return i }
    }
    return -1
  }

  /**
   * Add `[ name, value ]` attribute to list. Init attrs if necessary
   */
  attrPush (attrData: TokenAttribute): void {
    if (this.attrs) {
      this.attrs.push(attrData)
    } else {
      this.attrs = [attrData]
    }
  }

  /**
   * Set `name` attribute to `value`. Override old value if exists.
   */
  attrSet (name: string, value: string | number): void {
    const idx = this.attrIndex(name)
    const attrData: TokenAttribute = [name, value]

    if (idx < 0) {
      this.attrPush(attrData)
    } else {
      this.attrs![idx] = attrData
    }
  }

  /**
   * Get the value of attribute `name`, or null if it does not exist.
   */
  attrGet (name: string): string | number | null {
    const idx = this.attrIndex(name)
    let value = null
    if (idx >= 0) {
      value = this.attrs![idx][1]
    }
    return value
  }

  /**
   * Join value to existing attribute via space. Or create new attribute if not
   * exists. Useful to operate with token classes.
   */
  attrJoin (name: string, value: string | number): void {
    const idx = this.attrIndex(name)

    if (idx < 0) {
      this.attrPush([name, value])
    } else {
      this.attrs![idx][1] = `${this.attrs![idx][1]} ${value}`
    }
  }

  /**
   * Record a source range for this token. This is the plugin-facing API
   * for reporting where a token came from in the original Markdown source.
   * `start` and `end` are UTF-16 offsets into the original source,
   * forming a half-open interval. Ranges should be added in source order.
   */
  addSourceRange (start: number, end: number): void {
    if (!this.sourceRanges) { this.sourceRanges = [] }
    this.sourceRanges.push([start, end])
  }
}

export default Token
export { mergeSourceRanges }
export type { SourceRange }
