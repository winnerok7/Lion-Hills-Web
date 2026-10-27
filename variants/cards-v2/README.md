# cards v2 — villa banners (saved variant)

Full copy of `animations.js` at the moment of saving (works with the current `index.html` / `style.css`).
To restore: copy `variants/cards-v2/animations.js` over `animations.js`.

What this variant does (villa banners, `.types .stories`):
- one wheel push moves exactly one banner; a new push while moving carries on to the next one
  (no waiting for the animation to end), ends of the group are free to leave
- easing: half in-out, half out-quart; `STEP = 0.85s`, `MIN_GAP = 260ms`, hold after arrival 160ms
- banner positions are computed without transforms (`absTop`) because the banners are scaled
- lower banners are scaled to 92% (95% on mobile) and grow to 100% while coming to the centre
  (`bannerScale()`, scrubbed with ScrollTrigger)
- keyboard / scrollbar fallback: settles on a banner when scrolling stops near or inside the group
- touch devices and `prefers-reduced-motion`: effect is off
