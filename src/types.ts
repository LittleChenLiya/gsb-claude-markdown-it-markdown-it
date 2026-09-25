/** @inline */
export interface Reference {
  title: string
  href: string
}

/**
 * Shared environment passed through parsing and rendering.
 *
 * Plugins may use it to store arbitrary data.
 */
export interface Env {
  [key: string | symbol]: unknown
  references?: Record<string, Reference>
  /**
   * Footnote state, filled while parsing when the built-in footnote
   * extension sees `[^name]` definitions and references.
   */
  footnotes?: Footnotes
  /**
   * Problems found by the footnote extension: references without
   * a matching definition and ignored duplicate definitions.
   */
  footnoteDiagnostics?: FootnoteDiagnostic[]
  /**
   * Caller-provided namespace for the footnote extension. When several
   * rendered fragments are merged into one page, give each fragment its
   * own namespace to keep generated HTML ids unique.
   */
  footnoteNamespace?: string
}

/** Diagnostic emitted by the footnote extension. */
export interface FootnoteDiagnostic {
  /**
   * - `missing-definition`: a `[^name]` reference has no matching definition.
   * - `duplicate-definition`: a `[^name]:` definition was ignored because
   *   an earlier definition with the same name already exists.
   */
  type: 'missing-definition' | 'duplicate-definition'
  /** Footnote name (label without the `[^` `]` brackets). */
  name: string
}

/** A single referenced footnote, numbered in order of first reference. */
export interface FootnoteEntry {
  /** Footnote name (label without the `[^` `]` brackets). */
  label: string
  /** Number of references to this footnote in the document. */
  count: number
}

/** Footnote state collected in `env.footnotes` while parsing. */
export interface Footnotes {
  /**
   * Map of `':' + name` to the assigned footnote number
   * (`-1` while the definition is not referenced yet).
   */
  refs: Record<string, number>
  /** Referenced footnotes in order of first reference. */
  list: FootnoteEntry[]
}

/** Delimiter entry used by emphasis-like inline rules. */
export interface Delimiter {
  /** Char code of the starting marker. */
  marker: number

  /** Total length of this series of delimiters. */
  length?: number

  /** A position of the token this delimiter corresponds to. */
  token: number

  /**
   * If this delimiter is matched as a valid opener, `end` will be
   * equal to its position, otherwise it's `-1`.
   */
  end: number

  /** Whether this delimiter can open an emphasis. */
  open: boolean

  /** Whether this delimiter can close an emphasis. */
  close: boolean

  /** One delimiter represents two characters. */
  jump?: number
}

/**
 * Options controlling Markdown parsing and rendering.
 *
 * @category Main
 */
export interface MarkdownItOptions {
  /**
   * Enable HTML tags in source.
   *
   * @defaultValue `false` (`true` for `'commonmark'` preset only)
   */
  html?: boolean

  /**
   * Use '/' to close single tags (`<br />`).
   *
   * @defaultValue `false` (`true` for `'commonmark'` preset only)
   */
  xhtmlOut?: boolean

  /**
   * Convert '\n' in paragraphs into `<br>`.
   *
   * @defaultValue `false`
   */
  breaks?: boolean

  /**
   * CSS language prefix for fenced blocks, used by external syntax highlighters.
   *
   * @defaultValue `'language-'`
   */
  langPrefix?: string

  /**
   * Autoconvert URL-like text to links.
   *
   * @defaultValue `false`
   */
  linkify?: boolean

  /**
   * Enable language-neutral replacements and quotes beautification.
   *
   * See the [replacement rules](https://github.com/markdown-it/markdown-it/blob/master/src/rules_core/replacements.ts)
   * for the full list.
   *
   * @defaultValue `false`
   */
  typographer?: boolean

  /**
   * Double + single quotes replacement pairs, when typographer is enabled
   * and smartquotes are on. Can be either a string or an array.
   *
   * For example, use `'«»„“'` for Russian, `'„“‚‘'` for German, and
   * `['«\xA0', '\xA0»', '‹\xA0', '\xA0›']` for French (including nbsp).
   *
   * @defaultValue `'“”‘’'`
   */
  quotes?: string | string[]

  /**
   * Highlighter function. Should return escaped HTML, or an empty string if
   * the source string was not changed and should be escaped externally.
   * If the result starts with `<pre`, the internal wrapper is skipped.
   *
   * The highlighter is called by the default `fence` renderer rule. If needed,
   * you can replace that renderer rule completely; see the
   * [renderer source](https://github.com/markdown-it/markdown-it/blob/master/src/renderer.ts).
   *
   * @example
   * ```js
   * import MarkdownIt from 'markdown-it'
   * import hljs from 'highlight.js' // https://highlightjs.org
   *
   * const md = new MarkdownIt({
   *   highlight: function (str, lang) {
   *     if (lang && hljs.getLanguage(lang)) {
   *       try {
   *         return hljs.highlight(str, { language: lang }).value
   *       } catch (__) {}
   *     }
   *
   *     return '' // use external default escaping
   *   }
   * });
   * ```
   *
   * @example
   * Or with full wrapper override (if you need assign class to `<pre>` or `<code>`):
   * ```js
   * import MarkdownIt from 'markdown-it'
   * import hljs from 'highlight.js' // https://highlightjs.org
   *
   * const md = new MarkdownIt({
   *   highlight: function (str, lang) {
   *     if (lang && hljs.getLanguage(lang)) {
   *       try {
   *         return `<pre><code class="hljs">${hljs.highlight(str,
   *           { language: lang, ignoreIllegals: true }).value}</code></pre>`
   *       } catch (__) {}
   *     }
   *
   *     return `<pre><code class="hljs">${md.utils.escapeHtml(str)}</code></pre>`
   *   }
   * });
   * ```
   *
   * @defaultValue `null`
   */
  highlight?: ((str: string, lang: string, attrs: string) => string) | null

  /**
   * Internal protection against excessive recursion.
   *
   * @defaultValue `100`
   */
  maxNesting?: number
}
