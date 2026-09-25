// Optional plugin: heading anchors + [[doc#heading]] cross references.
//
// Pass 1 (core rule 'heading_anchors') walks the token stream, computes the
// visible plain text of every heading and assigns a unique 'id' anchor.
// Pass 2 (core rule 'heading_refs') rewrites [[doc#heading]] references in
// text tokens into links. Because references are resolved in a separate core
// rule that runs after *all* headings were collected, forward references
// (to headings further down the document) work transparently.
//
// The external document index (options.docs) is a plain data object
// provided by the caller. It is only ever read from memory - the plugin
// never performs network (or any other I/O) access while parsing.

import type MarkdownIt from '../markdownit.ts'
import type StateCore from '../rules_core/state_core.ts'
import type Token from '../token.ts'

/** Default key in 'env' where the plugin stores its per-parse results. */
export const HEADING_REFS_ENV_KEY = 'headingRefs'

/** One collected heading with its assigned anchor. */
export interface HeadingRefHeading {
  /** Visible plain text of the heading. */
  text: string
  /** Natural slug derived from 'text' (before deduplication). */
  slug: string
  /** Final unique anchor assigned to the heading ('id' attribute). */
  anchor: string
  /** Heading level (1-6). */
  level: number
}

/** Diagnostic for a reference that could not be resolved. */
export interface HeadingRefDiagnostic {
  /** Document part of the reference ('' for the current document). */
  doc: string
  /** Heading part of the reference. */
  heading: string
  /** Raw source of the reference, e.g. '[[Guide#Install]]'. */
  source: string
  /** Machine-readable failure reason. */
  reason: 'empty-heading' | 'missing-doc' | 'missing-heading' | 'invalid-href'
}

/** Per-parse data exposed in 'env[envKey]' (reset on every parse). */
export interface HeadingRefsEnv {
  headings: HeadingRefHeading[]
  diagnostics: HeadingRefDiagnostic[]
}

/** Resolution metadata attached to tokens via 'token.meta.headingRef'. */
export interface HeadingRefMeta {
  doc: string
  heading: string
  source: string
  resolved: boolean
  /** Final link target (only when resolved). */
  href?: string
  /** Failure reason (only when not resolved). */
  reason?: HeadingRefDiagnostic['reason']
}

export interface HeadingRefsOptions {
  /**
   * Title of the current document. References whose doc part is empty or
   * equal to this value are resolved against the current document.
   * When omitted, any non-empty doc part is looked up in 'docs'.
   */
  docName?: string

  /**
   * External document index, supplied by the caller as plain data:
   * doc title -> heading text -> href. Lookups are slug-based, so
   * '[[Guide#Hello World]]' matches a heading key 'Hello World' in
   * docs['Guide']. Never fetched - the plugin does no I/O at parse time.
   */
  docs?: Record<string, Record<string, string>>

  /**
   * Key of the 'env' property used to expose results.
   *
   * @defaultValue 'headingRefs'
   */
  envKey?: string
}

// Convert visible heading text into an anchor slug:
// NFKC normalize, lowercase, map whitespace runs to '-',
// drop every other punctuation/symbol, keep letters/numbers/'_'/'-'.
// An empty result (e.g. an empty heading) becomes 'section'.
export function slugifyHeading (text: string): string {
  const slug = text
    .normalize('NFKC')
    .toLowerCase()
    .replace(/\s+/g, '-')
    .replace(/[^\p{L}\p{N}_-]/gu, '')
  return slug === '' ? 'section' : slug
}

// Extract the visible plain text of an inline token stream.
//
// Value rules (documented contract):
// - 'text' and 'code_inline' tokens contribute their literal content,
//   so code spans in a heading are part of its anchor text.
// - 'image' tokens contribute their alt text (recursively).
// - 'html_inline' tokens (tags, including inline style attributes)
//   contribute nothing - markup is not visible text.
// - 'softbreak'/'hardbreak' contribute a single space.
function visibleText (tokens: Token[]): string {
  let result = ''

  for (const token of tokens) {
    switch (token.type) {
      case 'text':
      case 'code_inline':
        result += token.content
        break
      case 'image':
        result += token.children ? visibleText(token.children) : ''
        break
      case 'softbreak':
      case 'hardbreak':
        result += ' '
        break
      case 'html_inline':
        break
      default:
        if (token.children) result += visibleText(token.children)
    }
  }

  return result
}

const REF_RE = /\[\[([^\[\]\n]+)\]\]/g

interface CollectedHeading extends HeadingRefHeading {
  token: Token
}

export default function headingRefsPlugin (md: MarkdownIt, options: HeadingRefsOptions = {}): void {
  const envKey = options.envKey ?? HEADING_REFS_ENV_KEY
  const docName = options.docName
  const docs = options.docs ?? {}

  // Pass 1: collect headings and assign unique anchors.
  //
  // Deduplication: the first heading keeps its natural slug. Later headings
  // with the same natural slug get '-2', '-3', ... appended, skipping any
  // candidate that is already assigned *or* reserved as the natural slug of
  // a real heading in this document (so a real 'hello-2' heading is never
  // shadowed by an auto-generated 'hello-2' anchor).
  function heading_anchors (state: StateCore): void {
    const headings: CollectedHeading[] = []

    for (let i = 0; i < state.tokens.length - 1; i++) {
      const open = state.tokens[i]
      const inline = state.tokens[i + 1]
      if (open.type !== 'heading_open' || inline.type !== 'inline') continue

      const text = visibleText(inline.children ?? [])
      headings.push({
        text,
        slug: slugifyHeading(text),
        anchor: '',
        level: Number(open.tag.slice(1)) || 1,
        token: open
      })
    }

    const reserved = new Set(headings.map(h => h.slug))
    const used = new Set<string>()

    for (const heading of headings) {
      let anchor = heading.slug

      if (used.has(anchor)) {
        let suffix = 2
        while (used.has(heading.slug + '-' + suffix) || reserved.has(heading.slug + '-' + suffix)) {
          suffix++
        }
        anchor = heading.slug + '-' + suffix
      }

      heading.anchor = anchor
      used.add(anchor)
      heading.token.attrSet('id', anchor)
    }

    // Reset per-parse state so repeated render calls never leak data,
    // even when the caller reuses the same 'env' object.
    const envData: HeadingRefsEnv = {
      headings: headings.map(({ text, slug, anchor, level }) => ({ text, slug, anchor, level })),
      diagnostics: []
    }
    state.env[envKey] = envData
  }

  // Pass 2: resolve [[doc#heading]] references into links.
  function heading_refs (state: StateCore): void {
    const envData = state.env[envKey] as HeadingRefsEnv
    const headings = envData.headings

    function resolve (doc: string, heading: string): { href?: string, reason?: HeadingRefDiagnostic['reason'] } {
      if (heading === '') return { reason: 'empty-heading' }

      const slug = slugifyHeading(heading)

      if (doc === '' || (docName !== undefined && doc === docName)) {
        // Internal reference: first heading (document order) whose natural
        // slug matches wins, so duplicates resolve to the first match.
        const target = headings.find(h => h.slug === slug)
        return target ? { href: '#' + target.anchor } : { reason: 'missing-heading' }
      }

      // External reference: pure data lookup in the caller-provided index.
      const docIndex = docs[doc]
      if (!docIndex) return { reason: 'missing-doc' }

      for (const key of Object.keys(docIndex)) {
        if (slugifyHeading(key) === slug) {
          const href = docIndex[key]
          if (!md.validateLink(href)) return { reason: 'invalid-href' }
          return { href: md.normalizeLink(href) }
        }
      }
      return { reason: 'missing-heading' }
    }

    function pushText (out: Token[], content: string): void {
      if (content === '') return
      const token = new state.Token('text', '', 0)
      token.content = content
      out.push(token)
    }

    function rewrite (children: Token[]): Token[] {
      const out: Token[] = []

      for (const token of children) {
        if (token.type !== 'text' || !token.content.includes('[[')) {
          out.push(token)
          continue
        }

        REF_RE.lastIndex = 0
        let last = 0
        let match: RegExpExecArray | null

        while ((match = REF_RE.exec(token.content)) !== null) {
          const source = match[0]
          const inner = match[1]
          const hashIndex = inner.indexOf('#')
          const doc = (hashIndex === -1 ? '' : inner.slice(0, hashIndex)).trim()
          const heading = (hashIndex === -1 ? inner : inner.slice(hashIndex + 1)).trim()

          pushText(out, token.content.slice(last, match.index))
          last = match.index + source.length

          const { href, reason } = resolve(doc, heading)
          const meta: HeadingRefMeta = { doc, heading, source, resolved: href !== undefined }

          if (href !== undefined) {
            meta.href = href

            const open = new state.Token('link_open', 'a', 1)
            open.attrSet('href', href)
            open.meta = { headingRef: meta }

            const text = new state.Token('text', '', 0)
            text.content = inner

            const close = new state.Token('link_close', 'a', -1)

            out.push(open, text, close)
          } else {
            // Unresolved references stay as literal text; the diagnostic
            // is kept both on the token (meta.headingRef) and in
            // env[envKey].diagnostics.
            meta.reason = reason

            const text = new state.Token('text', '', 0)
            text.content = source
            text.meta = { headingRef: meta }
            out.push(text)

            envData.diagnostics.push({ doc, heading, source, reason: reason! })
          }
        }

        pushText(out, token.content.slice(last))
      }

      return out
    }

    for (const token of state.tokens) {
      // Only plain 'text' tokens of inline streams are considered, so
      // fenced code blocks, indented code and inline code can never
      // produce references.
      if (token.type === 'inline' && token.children) {
        token.children = rewrite(token.children)
      }
    }
  }

  md.core.ruler.push('heading_anchors', heading_anchors)
  md.core.ruler.push('heading_refs', heading_refs)
}

