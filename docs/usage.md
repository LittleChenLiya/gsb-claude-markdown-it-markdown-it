---
title: Usage examples
category: Main
---

# Usage examples

## Simple

Node.js:

```js
import MarkdownIt from 'markdown-it'
const md = new MarkdownIt()
const result = md.render('# markdown-it rulezz!');
```

Browser with UMD build, added to `window` on script load:

```js
// Note, there is no dash in "markdownit".
const md = new window.markdownit();
const result = md.render('# markdown-it rulezz!');
```

Single line rendering, without paragraph wrap:

```js
import MarkdownIt from 'markdown-it'
const md = new MarkdownIt()
const result = md.renderInline('__markdown-it__ rulezz!');
```


## Init with presets and options

(*) presets define combinations of active rules and options. Can be
`"commonmark"`, `"zero"` or `"default"` (if skipped). See
[API docs](https://markdown-it.github.io/markdown-it/classes/MarkdownIt.html#constructor.constructor) for more details.

CommonMark mode:

```js
import MarkdownIt from 'markdown-it'
const md = new MarkdownIt('commonmark')
```

Default mode:

```js
import MarkdownIt from 'markdown-it'
const md = new MarkdownIt()
```

Enable everything:

```js
import MarkdownIt from 'markdown-it'
const md = new MarkdownIt({
  html: true,
  linkify: true,
  typographer: true
})
```

See [MarkdownItOptions](https://markdown-it.github.io/markdown-it/interfaces/MarkdownItOptions.html)
for the full options list.


## Plugins load

```js
import MarkdownIt from 'markdown-it'
import markdownItAbbr from 'markdown-it-abbr'
import markdownItContainer from 'markdown-it-container'
import markdownItFootnote from 'markdown-it-footnote'

const md = new MarkdownIt()
  .use(markdownItAbbr)
  .use(markdownItContainer, 'warning')
  .use(markdownItFootnote)
```


## Syntax highlighting

Apply syntax highlighting to fenced code blocks with the `highlight` option:

```js
import MarkdownIt from 'markdown-it'
import hljs from 'highlight.js' // https://highlightjs.org

const md = new MarkdownIt({
  highlight: function (str, lang) {
    if (lang && hljs.getLanguage(lang)) {
      try {
        return hljs.highlight(str, { language: lang }).value
      } catch (__) {}
    }

    return '' // use external default escaping
  }
});
```

Or with full wrapper override (if you need assign class to `<pre>` or `<code>`):

```js
import MarkdownIt from 'markdown-it'
import hljs from 'highlight.js' // https://highlightjs.org

const md = new MarkdownIt({
  highlight: function (str, lang) {
    if (lang && hljs.getLanguage(lang)) {
      try {
        return `<pre><code class="hljs">${hljs.highlight(str,
          { language: lang, ignoreIllegals: true }).value}</code></pre>`
      } catch (__) {}
    }

    return `<pre><code class="hljs">${md.utils.escapeHtml(str)}</code></pre>`
  }
});
```


## Linkify

`linkify: true` uses [linkify-it](https://github.com/markdown-it/linkify-it). To
configure linkify-it, access the linkify instance through `md.linkify`:

```js
import MarkdownIt from 'markdown-it'

const md = new MarkdownIt({ linkify: true })
md.linkify.set({ fuzzyEmail: false }) // disables converting email to link
```

## Rewriting link targets

When you need to rewrite the actual targets of parsed links, images or link
reference definitions (for example, to redirect URLs through a proxy), use
`planLinkRewrite`. It traverses the token stream and collects every *actual*
link target, asks a caller-supplied mapper for a replacement URL of each
distinct target, and applies the result in one pass:

```js
import MarkdownIt from 'markdown-it'
import { planLinkRewrite } from 'markdown-it'

const md = new MarkdownIt()
const env = {}
const tokens = md.parse(src, env)

const plan = planLinkRewrite(tokens, env, (url, target) => {
  // Return a new URL to accept the target, or `null` to reject the whole plan.
  return url.replace('http://example.com', 'https://example.org')
})

if (plan) {
  plan.apply()
  const html = md.renderer.render(tokens, md.options, env)
}
```

How it works:

- Only parsed `link_open` / `image` tokens and `env.references` definitions
  are considered. URLs inside code blocks, inline code and plain text are
  never touched — they are not link targets, and the token stream is walked
  directly instead of string-replacing the Markdown source.
- A shared reference definition is rewritten exactly once: the definition in
  `env.references` is updated together with every token that references it, so
  all references keep pointing at the same definition and stay associated
  with it. The plan shows this ownership: `target.kind` is `'reference'`,
  `target.label` names the definition and `target.tokens` lists every token
  that uses it.
- Applying a plan only changes the `href`/`src` attributes; link titles, alt
  text and the inline markup structure are preserved.

Atomicity: the mapper is consulted for *every* collected target before
anything is written. If it rejects a target (returns `null`/`undefined`/
`false`) or throws, `planLinkRewrite` returns `null` and the token stream is
left exactly as it was before the call — nothing is half-rewritten.
