# Original loader curtain

Snapshot (Nov 2026) of `animations.js` and `style.css` before the LCP change.

Here the hero sits **above** the loader during the intro (`html.is-loading .hero { z-index: 101; clip-path: inset(100% 0 0 0) }`)
and `addHero()` in `animations.js` opens it with `clip-path` from the bottom up. Looks the same as the live version,
but the hero photo only gets painted when the curtain opens (~5.5s), which Google counts as a late LCP.

Live version: the hero is painted **under** the loader from the start and the loader is cut away along the same line.

To go back: in the live files restore the `html.is-loading .hero` rule (style.css, Loader block) and the
`tl.fromTo(hero, { clipPath: ... })` curtain in `addHero()` (animations.js). Don't copy these files over the live ones
wholesale — they're a snapshot and miss any later changes.
