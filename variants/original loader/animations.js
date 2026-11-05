(function () {
    var root = document.documentElement;
    var isMobile = window.matchMedia('(max-width: 767px)').matches;
    // loader v2 (#loader-v2) everywhere; v1 (#loader) stays in the markup and code to switch back, dropped right away
    var LOADER = 'v2';
    var loader = document.getElementById(LOADER === 'v2' ? 'loader-v2' : 'loader');
    var unused = document.getElementById(LOADER === 'v2' ? 'loader' : 'loader-v2');
    if (unused) unused.remove();

    // scripts.js holds the rest of the media on mobile until the loader text is over
    function loaderDone() {
        window.dispatchEvent(new Event('loader:done'));
    }

    // no GSAP (CDN failed) or reduced motion: drop the loader and show the page as is
    function bail() {
        if (loader) loader.remove();
        root.classList.remove('is-loading', 'js-anim');
        loaderDone();
    }
    if (!window.gsap || !window.ScrollTrigger || !window.SplitText) return bail();
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return bail();

    gsap.registerPlugin(ScrollTrigger, SplitText);
    // the iOS address bar folding in and out is a resize: without this every scroll back up to the top
    // re-measured all triggers (and re-split the scrubbed text) mid-scroll, a visible hitch
    ScrollTrigger.config({ ignoreMobileResize: true });

    // ---------- config ----------
    var EASE_OUT = 'expo.out';
    var STAGGER = { items: 0.1 };
    var K_DUR = isMobile ? 0.8 : 1;   // durations
    var K_Y = isMobile ? 0.6 : 1;     // y offsets
    var START = 'top 88%';

    function dur(v) { return v * K_DUR; }
    function y(v) { return v * K_Y; }
    function all(sel, root) { return Array.prototype.slice.call((root || document).querySelectorAll(sel)); }
    function wait(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }

    // ---------- smooth scroll ----------
    // desktop only: on phones the scroll is native anyway (Lenis doesn't smooth touch), so it would only add
    // a layer between the finger and ScrollTrigger; html.is-loading keeps the page still during the loader.
    // Not on Apple devices either (any Mac / MacBook, Intel or M chip, and iPads in desktop mode all say
    // "Macintosh"; platform "MacIntel" as a backup): the trackpad already scrolls smoothly with its own momentum,
    // Lenis on top of it felt laggy. No Lenis also means no villa snap there
    var isApple = /Macintosh|Mac OS X|iPhone|iPad|iPod/.test(navigator.userAgent) ||
                  /^(Mac|iPhone|iPad|iPod)/.test(navigator.platform || '');
    var lenis = null;
    if (window.Lenis && !isMobile && !isApple) {
        lenis = new Lenis({
            duration: 0.85,
            easing: function (t) { return Math.min(1, 1.001 - Math.pow(2, -10 * t)); },
            smoothWheel: true,
            syncTouch: false
        });
        lenis.on('scroll', ScrollTrigger.update);
        window.lenis = lenis; // used by the menu for anchor scrolling
        // no scrolling while the loader is on screen (intro() starts it again)
        if (loader) lenis.stop();
        gsap.ticker.add(function (time) { lenis.raf(time * 1000); });
        gsap.ticker.lagSmoothing(0);
    }

    // ---------- effects ----------

    // ---------- loader v1 (mobile): logo, then the phrase come out of blur part by part ----------
    // while a line runs along the screen edge with a % counter; the grey screen fades before the hero curtain
    function loaderV1(tl, counter) {
        var parts = all('.loader_part', loader);
        var percent = loader.querySelector('.loader_percent');
        var segs = all('.loader_frame i', loader);
        var blur = isMobile ? 4 : 8;

        // edge line from the bottom centre, clockwise: the drawn length is spread over the 5 segments
        // (bottom-left half, left, top, right, bottom-right half) as scale transforms
        function progress() {
            var w = window.innerWidth, h = window.innerHeight;
            var lens = [w / 2, h, w, h, w / 2];
            var len = 2 * (w + h) * counter.v / 100;
            segs.forEach(function (seg, i) {
                var fill = Math.max(0, Math.min(1, len / lens[i]));
                len -= lens[i];
                seg.style.transform = (i % 2 ? 'scaleY(' : 'scaleX(') + fill + ')';
            });
            percent.textContent = Math.round(counter.v) + '%';
        }
        progress();

        // mobile: animating filter: blur() on text is choppy in iOS Safari and snaps sharp at the very end,
        // so each part gets a still blurred copy (.loader_ghost) and only opacities cross-fade
        var ghosts = isMobile ? parts.map(function (part) {
            var ghost = part.cloneNode(true);
            ghost.classList.add('loader_ghost');
            part.parentNode.insertBefore(ghost, part); // same grid cell, under the sharp text
            return ghost;
        }) : null;

        // mobile: one tween drives both opacities from a single progress p (0 hidden -> 1 sharp),
        // so the focus pull is one continuous motion: the blurred copy rises first and hands over to the sharp text
        function focus(part, from, to, at, duration) {
            var ghost = ghosts[parts.indexOf(part)];
            var state = { p: from };
            tl.fromTo(state, { p: from }, {
                p: to,
                duration: duration,
                ease: 'sine.inOut',
                immediateRender: false, // an "out" tween would otherwise show its part fully right away
                onUpdate: function () {
                    var p = state.p;
                    part.style.opacity = Math.pow(p, 1.6);
                    ghost.style.opacity = Math.min(1, p * 3) * (1 - p);
                }
            }, at);
        }

        // each part comes out of blur; "out" parts blur away again (0.5s)
        var lastIn = 0;
        function partIn(part, at, duration) {
            if (ghosts) {
                focus(part, 0, 1, at, duration);
            } else {
                tl.fromTo(part,
                    { opacity: 0, filter: 'blur(' + blur + 'px)', color: '#bdbdbd' },
                    { opacity: 1, filter: 'blur(0px)', color: '#252525', duration: duration, ease: 'sine.out' }, at);
            }
            lastIn = Math.max(lastIn, at + duration);
        }
        function partOut(part, at) {
            if (ghosts) {
                focus(part, 1, 0, at, 0.6);
                return;
            }
            tl.to(part, { opacity: 0, filter: 'blur(' + blur + 'px)', duration: 0.5, ease: 'sine.in' }, at);
        }

        // every part opens the same slow way as the logo: 1.1s in, 0.3s hold before an "out"
        var IN = 1.1;
        partIn(parts[0], 0.5, IN); // short pause first so the start isn't abrupt
        partOut(parts[0], 0.5 + IN + 0.3);
        if (isMobile) {
            // mobile: the phrase parts take turns in the centre too, the last one stays
            partIn(parts[1], 2.4, IN);
            partOut(parts[1], 2.4 + IN + 0.3);
            partIn(parts[2], 4.3, IN);
        } else {
            // desktop: then the phrase builds up part by part in one line and stays
            partIn(parts[1], 2.4, IN);
            partIn(parts[2], 3.0, IN);
        }
        tl.addLabel('reveal', lastIn) // last part is fully in; the timeline waits here for the loading
          .to(loader.children, { opacity: 0, duration: 0.5, ease: 'power1.out' }, 'reveal+=0.3');

        return {
            render: progress,
            minLap: lastIn + 0.2,
            done: function () { return wait(300); } // short hold on 100%
        };
    }

    // ---------- loader v2: the ornament (media/pattern light upd 2.svg) shows through on the brand green ----------
    // the horizontals first, then every other line on its own at a random moment: a soft gradient edge runs along it
    // from its first point (the lower end in the markup) to the other; the whole drawing follows the loading,
    // the logo and the phrase under it come in near the end; then the hero curtain rises over it all
    // while the ornament drifts up a little
    function loaderV2(tl, counter) {
        var svg = loader.querySelector('.loader_pattern');
        var brand = loader.querySelector('.loader_v2_brand');
        var logo = loader.querySelector('.loader_v2_logo');
        var phrase = loader.querySelector('.loader_v2_phrase');
        var defs = svg.querySelector('defs');
        var NS = 'http://www.w3.org/2000/svg';
        var BAND = 0.6;   // soft edge, as a share of the line length
        var DUR = 0.3;    // one line's reveal, as a share of the whole loader
        var H_PHASE = 0.25; // horizontals come first, within this share; the rest go after them in random order
        var BRAND_AT = 0.6; // the logo starts coming in at this share of the drawing, before the last lines settle

        // mobile: at the phone's scale the 3 pattern rows cover only ~60% of the height, so more rows go around
        // them: a copy of the bottom row above the top one, of the top row under the bottom one (5 rows in view),
        // and the middle row once more below that, drawn past the svg's box (overflow: visible) into the part of
        // the loader that reaches under the browser's bottom bar. The view centres on the empty middle cell
        // (x 509..1071) where the logo sits
        if (isMobile) {
            var ROW = 1086; // 3 rows of 362, edge to edge
            var flatYs = all('line', svg).filter(function (l) {
                return l.getAttribute('y1') === l.getAttribute('y2');
            }).map(function (l) { return +l.getAttribute('y1'); });
            all('line', svg).forEach(function (line) {
                var y1 = +line.getAttribute('y1'), y2 = +line.getAttribute('y2');
                // bottom row -> above; top and middle rows -> below; the bottom row's top edge also closes the extra row
                var shifts = Math.min(y1, y2) >= 723 ? [-ROW] : [ROW];
                if (y1 === y2 && Math.abs(y1 - 724.5) < 1) shifts.push(ROW);
                shifts.forEach(function (shift) {
                    // a copied edge that lands on an existing one would be drawn twice
                    if (y1 === y2 && flatYs.some(function (y) { return Math.abs(y - (y1 + shift)) < 1; })) return;
                    var copy = line.cloneNode();
                    copy.setAttribute('y1', y1 + shift);
                    copy.setAttribute('y2', y2 + shift);
                    svg.appendChild(copy);
                });
            });
            // the 5 rows are -34 -362 1647 1810; 5% closer in around the same centre, so the top edge line
            // sits ~20px above the screen instead of drawing a white line along the very top of the page
            svg.setAttribute('viewBox', '5 -319 1569 1724');
        }

        // logo out of blur, the phrase a moment later; started from render(), awaited by done().
        // Mobile: no animated blur (choppy in iOS Safari and snaps sharp at the end), a short rise instead
        var brandIn = gsap.timeline({ paused: true });
        if (isMobile) {
            brandIn.fromTo(logo, { opacity: 0, y: 10 }, { opacity: 1, y: 0, duration: 1.1, ease: 'sine.out' })
                .fromTo(phrase, { opacity: 0, y: 8 }, { opacity: 0.75, y: 0, duration: 1, ease: 'sine.out' }, 0.45);
        } else {
            brandIn.fromTo(logo, { opacity: 0, filter: 'blur(8px)' },
                    { opacity: 1, filter: 'blur(0px)', duration: 1.1, ease: 'sine.out' })
                .fromTo(phrase, { opacity: 0, filter: 'blur(6px)' },
                    { opacity: 0.75, filter: 'blur(0px)', duration: 1, ease: 'sine.out' }, 0.45);
        }

        var lines = all('line', svg).map(function (line, i) {
            var x1 = +line.getAttribute('x1'), y1 = +line.getAttribute('y1');
            var x2 = +line.getAttribute('x2'), y2 = +line.getAttribute('y2');
            // opaque before the edge, transparent after it (pad spreads both ends along the line)
            var grad = document.createElementNS(NS, 'linearGradient');
            grad.id = 'loader-line-' + i;
            grad.setAttribute('gradientUnits', 'userSpaceOnUse');
            grad.innerHTML = '<stop offset="0" stop-color="#fff"/><stop offset="1" stop-color="#fff" stop-opacity="0"/>';
            defs.appendChild(grad);
            line.style.stroke = 'url(#' + grad.id + ')';
            var flat = Math.abs(y2 - y1) < 1;
            var dur = flat ? H_PHASE * 0.8 : DUR;
            var start = flat ? Math.random() * (H_PHASE - dur) : H_PHASE + Math.random() * (1 - H_PHASE - DUR);
            return { grad: grad, x: x1, y: y1, dx: x2 - x1, dy: y2 - y1, start: start, dur: dur };
        });

        function render() {
            var p = counter.v / 100;
            lines.forEach(function (l) {
                var t = Math.max(0, Math.min(1, (p - l.start) / l.dur));
                t = t * t * (3 - 2 * t); // soft start and stop
                // edge start: before the line's first point (all transparent) -> past its far end (all opaque)
                var s = -BAND + t * (1 + BAND);
                l.grad.setAttribute('x1', l.x + l.dx * s);
                l.grad.setAttribute('y1', l.y + l.dy * s);
                l.grad.setAttribute('x2', l.x + l.dx * (s + BAND));
                l.grad.setAttribute('y2', l.y + l.dy * (s + BAND));
            });
            if (p >= BRAND_AT && brandIn.paused()) brandIn.play();
        }

        // short gap before the label so the timeline isn't empty at 0 (it would complete right away)
        tl.addLabel('reveal', 0.05)
          .to(svg, { yPercent: -8, duration: 1.6, ease: 'power2.inOut' }, 'reveal')
          .to(brand, { y: function () { return -0.08 * window.innerHeight; }, duration: 1.6, ease: 'power2.inOut' }, 'reveal');

        // ornament drawn: let the logo + phrase finish coming in, a short hold, then the curtain
        function done() {
            return new Promise(function (resolve) {
                brandIn.play(); // in case the drawing jumped past BRAND_AT
                brandIn.eventCallback('onComplete', function () { setTimeout(resolve, 400); });
                if (brandIn.progress() === 1) setTimeout(resolve, 400);
            });
        }

        // 4.5s drawing; the logo from 60% (~2.8s, 1.45s long) is in just before the last lines settle,
        // then the 0.4s hold: the curtain starts at ~5s
        return { render: render, minLap: 4.5, done: done };
    }

    // ---------- intro: loader -> hero curtain -> hero content (plays once; the loader lasts as long as the critical media takes, v2: curtain at ~5s at the soonest) ----------
    // the loader (v1 or v2, see above) follows the real loading, then the hero opens from the bottom over it
    // and its texts come in
    function intro() {
        var hero = document.querySelector('.hero');
        var media = document.querySelector('.hero_media');
        var title = document.querySelector('[data-anim="hero-title"]');
        var header = document.querySelector('[data-anim="hero-header"]');
        var sub = document.querySelector('.hero_subtitle');
        var btn = document.querySelector('.hero_btn');
        var split = null;

        var tl = gsap.timeline({
            onComplete: function () {
                if (loader) loader.remove();
                root.classList.remove('is-loading');
                gsap.set(hero, { clearProps: 'clipPath' });
                if (media) gsap.set(media, { clearProps: 'transform' });
                if (split) split.revert(); // real text back, so it reflows on resize
                gsap.set([sub, btn], { clearProps: 'transform' }); // back to the CSS centering
                document.removeEventListener('touchmove', holdTouch);
                if (lenis) lenis.start();
                ScrollTrigger.refresh();
            }
        });

        // the curtain opens the hero, so the page must be at the very top (also Lenis' own position)
        function toTop() {
            window.scrollTo(0, 0);
            if (lenis) lenis.scrollTo(0, { immediate: true, force: true });
        }

        // the loader isn't position: fixed (see .loader in style.css), so on a phone a swipe could drag the page
        // under it; html.is-loading hides the overflow, this also stops iOS touch scrolling until the intro ends
        function holdTouch(e) { e.preventDefault(); }

        if (loader) {
            if ('scrollRestoration' in history) history.scrollRestoration = 'manual';
            toTop();
            document.addEventListener('touchmove', holdTouch, { passive: false });

            // each version draws itself from counter.v (0..100) and puts the 'reveal' label on tl
            var counter = { v: 0 };
            var view = (loader.id === 'loader-v2' ? loaderV2 : loaderV1)(tl, counter);
            view.render();

            // line + % follow the real loading (scripts.js loadProgress), eased so they glide instead of jumping;
            // never faster than one lap in MIN_LAP s, so with everything cached it still reads as a sweep
            var MIN_LOADER = 3; // s, the loader never closes sooner, even when everything is cached
            var MIN_LAP = Math.max(MIN_LOADER, view.minLap); // or longer if the version asks (v1: its text, ~4.3-5.6s)
            var t0 = performance.now();
            var resolveLoaded;
            var loaded = new Promise(function (r) { resolveLoaded = r; });
            var tick = function () {
                var real = window.loadProgress ? window.loadProgress() : 1;
                // the time cap eases in and out but stays close to an even pace (half linear, half smoothstep):
                // gentle start and finish without a fast middle
                var lap = Math.min(1, (performance.now() - t0) / 1000 / MIN_LAP);
                lap = 0.5 * lap + 0.5 * lap * lap * (3 - 2 * lap);
                var target = Math.min(real, lap) * 100;
                // frame-rate independent smoothing (same feel at 60 and 120 Hz)
                counter.v += (target - counter.v) * (1 - Math.pow(0.9, gsap.ticker.deltaRatio()));
                if (target >= 100 && counter.v > 99.6) counter.v = 100;
                view.render();
                if (counter.v === 100) { gsap.ticker.remove(tick); resolveLoaded(); }
            };
            gsap.ticker.add(tick);
        } else {
            tl.addLabel('reveal', 0);
        }

        // the curtain needs the critical media (scripts.js criticalReady); with the loader also the drawing at 100%
        // and the version's own finish (v1: short hold, v2: logo)
        var ready = loader
            ? loaded.then(view.done)
            : (window.criticalReady || Promise.resolve());

        function addHero() {
            // slow, soft curtain (1.6s) so the loader doesn't fly away
            tl.fromTo(hero, { clipPath: 'inset(100% 0% 0% 0%)' }, { clipPath: 'inset(0% 0% 0% 0%)', duration: 1.6, ease: 'power2.inOut' }, 'reveal');
            if (media) tl.fromTo(media, { yPercent: 25, scale: 1.1 }, { yPercent: 0, scale: 1, duration: 1.6, ease: 'power2.inOut' }, 'reveal');

            if (title) {
                // each line slides up from under its own mask
                split = SplitText.create(title, { type: 'lines', mask: 'lines', linesClass: 'sl' });
                tl.set(title, { autoAlpha: 1 }, 'reveal')
                  .fromTo(split.lines, { yPercent: 100 }, { yPercent: 0, duration: 0.9, stagger: 0.12, ease: 'power3.out' }, 'reveal+=1.3');
            }
            if (sub) {
                tl.fromTo(sub, { autoAlpha: 0, y: 10 },
                    { autoAlpha: parseFloat(getComputedStyle(sub).opacity) || 1, y: 0, duration: 0.6, ease: 'power2.out' }, 'reveal+=1.5');
            }
            if (header) tl.fromTo(header, { autoAlpha: 0 }, { autoAlpha: 1, duration: 0.5 }, 'reveal+=1.5');
            // xPercent keeps the CSS translateX(-50%) centering while GSAP owns the transform
            if (btn) tl.fromTo(btn, { autoAlpha: 0, xPercent: -50, x: 0, y: 10 }, { autoAlpha: 1, y: 0, duration: 0.5, ease: 'power2.out' }, 'reveal+=1.9');
        }

        if (loader) {
            // hold at the reveal point until everything is ready (pause stretches if the photo is slow)
            var held = false;
            tl.call(function () {
                if (held) return; // resuming can pass this point again
                held = true;
                tl.pause();
                ready.then(function () { toTop(); addHero(); tl.play(); loaderDone(); });
            }, null, 'reveal');
        } else {
            tl.pause();
            ready.then(function () { addHero(); tl.play(); loaderDone(); });
        }
    }

    // C: paragraph fills word by word while scrolling
    function wordsScrub(el) {
        SplitText.create(el, {
            type: 'words',
            autoSplit: true,
            onSplit: function (self) {
                gsap.set(el, { autoAlpha: 1 });
                return gsap.from(self.words, {
                    opacity: 0.18,
                    stagger: 0.05,
                    ease: 'none',
                    scrollTrigger: { trigger: el, start: 'top 80%', end: 'bottom 55%', scrub: 0.6 }
                });
            }
        });
    }

    // E: fade up. Keeps the element's own CSS opacity as the end value.
    function fadeUp(el, withY) {
        var end = parseFloat(getComputedStyle(el).opacity) || 1;
        var from = { autoAlpha: 0 };
        var to = {
            autoAlpha: end,
            duration: dur(0.9),
            ease: EASE_OUT,
            scrollTrigger: { trigger: el, start: START, once: true }
        };
        if (withY) { from.y = y(40); to.y = 0; }
        gsap.fromTo(el, from, to);
    }

    // F: children of a container appear one after another
    function staggerItems(container) {
        gsap.from(container.children, {
            autoAlpha: 0,
            y: y(30),
            duration: dur(0.9),
            stagger: STAGGER.items,
            ease: EASE_OUT,
            scrollTrigger: { trigger: container, start: START, once: true }
        });
    }

    // H: numbers count up. Only the digits animate, the rest of the text stays.
    function countUp(card) {
        all('.lot_main, .lot_terrace', card).forEach(function (el) {
            var node = el.firstChild;
            if (!node || node.nodeType !== 3) return;
            var m = node.nodeValue.match(/^(\d+)(.*)$/s);
            if (!m) return;
            var span = document.createElement('span');
            span.textContent = m[1];
            node.nodeValue = m[2];
            el.insertBefore(span, node);

            var target = parseInt(m[1], 10);
            var counter = { v: 0 };
            span.textContent = '0';
            gsap.to(counter, {
                v: target,
                duration: dur(1.4),
                ease: 'power2.out',
                scrollTrigger: { trigger: card, start: START, once: true },
                onUpdate: function () { span.textContent = Math.round(counter.v); },
                onComplete: function () { span.textContent = target; }
            });
        });
    }

    // hero depth on scroll: the photo lags behind the page, the title lags less and fades out (scrubbed both ways).
    // Uses y (px), not the intro's yPercent/scale on the photo, so the two never fight.
    // Mobile: the photo parallax stays (the main effect), the title only fades: moving text from JS against
    // native touch scroll lands a frame late on iOS and shook. Where the browser has CSS scroll-driven
    // animations (iOS 26+) the photo parallax is the CSS one in style.css instead, in step with the finger
    // (the white card no longer scales on the way in: re-rendering that big card with its video
    // every frame cost more than the 2% was worth)
    function heroParallax() {
        var hero = document.querySelector('.hero');
        var media = document.querySelector('.hero_media');
        var content = document.querySelector('.hero_content');
        if (!hero) return;
        var cssParallax = isMobile && window.CSS && CSS.supports('animation-timeline: scroll()');
        if (media && !cssParallax) {
            gsap.to(media, {
                y: function () { return hero.offsetHeight * 0.3; },
                ease: 'none',
                scrollTrigger: { trigger: hero, start: 'top top', end: 'bottom top', scrub: true, invalidateOnRefresh: true }
            });
        }
        if (content) {
            var fade = { opacity: 0, ease: 'none',
                scrollTrigger: { trigger: hero, start: 'top top', end: '60% top', scrub: true, invalidateOnRefresh: true } };
            if (!isMobile) {
                gsap.set(content, { x: 0, xPercent: -50 }); // keep the CSS centering (translateX(-50%)) as GSAP's own transform
                fade.y = function () { return hero.offsetHeight * 0.15; };
            }
            gsap.to(content, fade);
        }
        // the button steps away as soon as the page moves down and comes back at the very top
        // (a class, not a tween: the intro owns the button's opacity)
        var btn = document.querySelector('.hero_btn');
        if (btn) {
            ScrollTrigger.create({
                trigger: hero,
                start: 'top+=40 top',
                end: 'max',
                onToggle: function (self) { btn.classList.toggle('is-away', self.isActive); }
            });
        }
    }

    // footer widens to the edges and slides down, uncovering the big outro text (scrubbed both ways)
    function footerReveal() {
        var footer = document.querySelector('.footer');
        if (!footer) return;
        gsap.fromTo(footer,
            { '--inset': isMobile ? '12px' : '2.5vw', y: isMobile ? -50 : -100 },
            {
                '--inset': isMobile ? '6px' : '0.5vw',
                y: 0,
                ease: 'none',
                scrollTrigger: {
                    trigger: footer,
                    start: 'top bottom', // footer top enters from below
                    end: 'max',          // very end of the page
                    scrub: true
                }
            });
    }

    // Villa banners behave like full-screen steps: one wheel gesture moves exactly one banner,
    // fast scrolling chains the banners one after another, and the ends of the group are free to leave
    function setupSnap() {
        if (!lenis) return;
        if (!window.matchMedia('(hover: hover) and (pointer: fine)').matches) return;
        var items = all('.types .stories');
        if (items.length < 2) return;

        var STEP = 0.7;          // seconds per banner
        var ENTRY = 0.4;         // how close (in screens) to the group we start pulling in
        var busy = false;        // a step animation is running
        var startedAt = 0;
        var pending = 0;         // direction queued by fast scrolling while a step runs
        var holdUntil = 0;       // swallow the momentum tail right after a step
        var failSafe = null;
        var timer = null;

        function ease(t) { return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2; }

        function points() {
            return items.map(function (el) {
                return Math.round(el.getBoundingClientRect().top + window.scrollY - 10);
            });
        }

        // where a step in this direction should go, or null when the page should scroll freely
        function targetFor(dir, pos) {
            var p = points();
            var last = p[p.length - 1];
            var vh = window.innerHeight;
            var i;
            if (dir > 0) {
                if (pos < p[0] - ENTRY * vh || pos >= last - 2) return null;
                for (i = 0; i < p.length; i++) if (p[i] > pos + 2) return p[i];
                return null;
            }
            if (pos > last + ENTRY * vh || pos <= p[0] + 2) return null;
            if (pos > last + 2) return last;
            for (i = p.length - 1; i >= 0; i--) if (p[i] < pos - 2) return p[i];
            return null;
        }

        function inZone(pos) {
            var p = points();
            var vh = window.innerHeight;
            return pos >= p[0] - ENTRY * vh && pos <= p[p.length - 1] + ENTRY * vh;
        }

        function go(target) {
            busy = true;
            startedAt = performance.now();
            clearTimeout(failSafe);
            failSafe = setTimeout(done, STEP * 1000 + 250);
            lenis.scrollTo(target, { duration: STEP, easing: ease, lock: true, onComplete: done });
        }

        function done() {
            if (!busy) return;
            busy = false;
            clearTimeout(failSafe);
            holdUntil = performance.now() + 300;
            var dir = pending;
            pending = 0;
            if (dir) {
                var t = targetFor(dir, window.scrollY);
                if (t !== null) go(t);
            }
        }

        window.addEventListener('wheel', function (e) {
            var dy = e.deltaY;
            if (!dy || e.ctrlKey) return;
            var dir = dy > 0 ? 1 : -1;
            var now = performance.now();

            if (busy) {
                e.preventDefault();
                e.stopImmediatePropagation();
                // a clear, deliberate push after the step has started queues the next banner
                if (Math.abs(dy) >= 30 && now - startedAt > 150) pending = dir;
                return;
            }

            if (now < holdUntil && inZone(window.scrollY)) {
                e.preventDefault();
                e.stopImmediatePropagation();
                return;
            }

            var target = targetFor(dir, window.scrollY);
            if (target === null) return; // outside the group: normal smooth scroll
            e.preventDefault();
            e.stopImmediatePropagation();
            go(target);
        }, { passive: false, capture: true });

        // fallback for keyboard / scrollbar: settle on the nearest banner when scrolling stops inside the group
        lenis.on('scroll', function () {
            if (busy) return;
            clearTimeout(timer);
            timer = setTimeout(function () {
                if (busy) return;
                var p = points();
                var pos = window.scrollY;
                var last = p[p.length - 1];
                var band = ENTRY * window.innerHeight;
                // arrived close to the group while moving toward it: pull the nearest banner into focus
                if (pos < p[0] && pos >= p[0] - band && lenis.direction > 0) { go(p[0]); return; }
                if (pos > last && pos <= last + band && lenis.direction < 0) { go(last); return; }
                if (pos < p[0] || pos > last) return;
                var best = p[0];
                p.forEach(function (v) { if (Math.abs(v - pos) < Math.abs(best - pos)) best = v; });
                if (Math.abs(best - pos) >= 2) go(best);
            }, 200);
        });
    }

    // ---------- init ----------
    function init() {
        // scroll-driven blocks (the hero intro is in intro())
        all('[data-anim="lines"]').forEach(function (el) { fadeUp(el, true); });
        all('[data-anim="scrub"]').forEach(wordsScrub);
        all('[data-anim="fade"]').forEach(function (el) { fadeUp(el, true); });
        all('[data-anim="fade-only"]').forEach(function (el) { fadeUp(el, false); });
        all('[data-anim="stagger"]').forEach(staggerItems);
        all('[data-anim="count"]').forEach(countUp);

        heroParallax();
        footerReveal();
        setupSnap();
        ScrollTrigger.refresh();
    }

    // loader starts right away; scroll blocks wait for fonts so lines are measured with the real typeface (max 2s)
    intro();

    var started = false;
    function start() {
        if (started) return;
        started = true;
        init();
    }
    if (document.fonts && document.fonts.ready) {
        document.fonts.ready.then(start);
        setTimeout(start, 2000);
    } else {
        start();
    }

    window.addEventListener('load', function () { ScrollTrigger.refresh(); });
})();
