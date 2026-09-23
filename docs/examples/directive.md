# Directive containers

Markdown-it ships an opt-in block rule for directive containers (notes,
warnings and similar admonitions with a markdown body). It is **disabled by
default**, so it does not change CommonMark or default preset output.

Enable it via the rule name `directive`:

```js
import MarkdownIt from 'markdown-it'

const md = new MarkdownIt().enable('directive')
```

## Syntax

```md
:::note Optional title
Body is parsed as **regular markdown**.
:::
```

- The opening marker is `:::name` on its own line. `name` must start with an
  ASCII letter and may contain letters, digits, `_` and `-`.
- The rest of the opening line is an optional plain-text title (escaped on
  render, never parsed as markup).
- The container is closed by a `:::` line. Containers nest, and work inside
  lists and blockquotes with the usual block indentation rules.
- `:::` inside fenced code blocks does not close a container.
- An unclosed container falls back to plain text; following blocks are
  parsed normally.
- Nesting depth is limited by the `directiveMaxDepth` option (default `10`);
  deeper markers are rendered as plain text.

## Output

```md
:::warning <img>
Careful!
:::
```

renders as:

```html
<div class="markdown-it-directive markdown-it-directive-warning">
<p class="markdown-it-directive-title">&lt;img&gt;</p>
<p>Careful!</p>
</div>
```

The rule emits `directive_open` / `directive_close` token pairs (with the
name in `token.info` and the title in `token.meta.title`), so you can
override `md.renderer.rules.directive_open` / `directive_close` for custom
markup.

## Try it in a terminal

```sh
node support/demo-directive.mjs
```

This prints the input, the token stream and the rendered HTML.

