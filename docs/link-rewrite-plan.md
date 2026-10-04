# Link target rewrite plan

`src/link_rewrite_plan.ts` implements a two-phase, atomic rewrite of link
targets on the **parsed token stream**. It never does string replacement
over the source Markdown: every change is a `Token#attrSet` on a collected
`link_open` / `image` token, or a single update of a shared entry in
`env.references`.

## How it works

1. **Collect** — `collectLinkTargets(tokens, env)` walks the token stream
   and gathers the *real* targets only:
   - `link_open` tokens (inline links) → `href` attribute;
   - `image` tokens (inline images) → `src` attribute;
   - shared reference definitions → `env.references[label].href`.

   Reference links/images carry no target of their own: they are accounted
   to their definition through `token.meta.label`, so a shared definition
   appears **once** in the plan, with `refCount` showing how many links stay
   associated with it. Code blocks, inline code and plain text contain no
   `link_open`/`image` tokens, so look-alike URLs inside them never
   participate. Link titles and the inline markup structure (emphasis,
   nested tokens, …) are not part of the collected data and stay untouched.

2. **Plan** — `planLinkRewrites(tokens, env, mapUrl)` asks the caller's
   mapping function for a new URL for *every* collected target **before
   changing anything**. The mapper returns the new URL (non-empty string)
   to accept, or `null` / `undefined` / `false` / `''` (or throws) to
   reject.

3. **Apply** — `applyLinkRewritePlan(plan)` mutates the tokens only when
   `plan.ok` is `true`, and only once (`plan.applied` guards re-entry).
   Token-owned targets are reassigned via `attrSet`; a reference definition
   is rewritten exactly once in `env.references`, after which every
   link/image token associated with it (via `meta.label`) is re-pointed to
   the same new URL, so all references keep resolving to the shared
   definition.

`rewriteLinkTargets(tokens, env, mapUrl)` is a convenience wrapper that
plans and applies in one call.

## Atomicity

Validation is strictly separated from mutation:

- if **any** target is rejected, the plan has `ok: false`, exposes **no**
  rewrites, and `applyLinkRewritePlan` returns `false` without touching a
  single token — the token stream and `env.references` remain byte-identical
  to their initial state (verified by JSON snapshot in the tests);
- if **all** targets are accepted, every rewrite is applied in one pass.

There is no partial state: either all real links point to their new targets,
or nothing changed at all.

## Plan shape

```js
{
  ok: true,          // every target accepted by the mapper
  applied: false,    // becomes true after applyLinkRewritePlan()
  rewrites: [
    { kind: 'link',      url: 'https://old/a', newUrl: 'https://new/a',
      owner: { type: 'token', tokenIndex: 0, childIndex: 0, attr: 'href' } },
    { kind: 'reference', url: 'https://old/s', newUrl: 'https://new/s',
      owner: { type: 'reference', label: 'SHARED' }, refCount: 2 }
  ],
  rejected: [],      // filled (and rewrites emptied) when ok === false
  tokens, env
}
```

The `owner` field makes the **ownership of each reference definition**
visible in the plan: `{ type: 'reference', label }` means the target is
owned by the shared definition in `env.references`, not by any single link.

## Usage

```js
import markdownit, { rewriteLinkTargets } from 'markdown-it'

const md = markdownit()
const env = {}
const tokens = md.parse(src, env)

const plan = rewriteLinkTargets(tokens, env, (url, target) =>
  url.startsWith('https://old.example.com/')
    ? url.replace('old.example.com', 'new.example.com')
    : null) // returning null rejects the target and aborts everything

if (plan.applied) {
  const html = md.renderer.render(tokens, md.options, env)
}
```

## Local verification commands

```sh
# only the tests for this feature
node --test test/markdown-it/link-rewrite-plan.test.mjs

# lint + types for the touched sources
npx eslint .
npx tsc --noEmit
```
