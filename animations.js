(function () {
    var root = document.documentElement;
    var loader = document.getElementById('loader');

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

    // ---------- config ----------
    var EASE_OUT = 'expo.out';
    var STAGGER = { items: 0.1 };
    var isMobile = window.matchMedia('(max-width: 767px)').matches;
    var K_DUR = isMobile ? 0.8 : 1;   // durations
    var K_Y = isMobile ? 0.6 : 1;     // y offsets
    var START = 'top 88%';

    function dur(v) { return v * K_DUR; }
    function y(v) { return v * K_Y; }
    function all(sel, root) { return Array.prototype.slice.call((root || document).querySelectorAll(sel)); }

    // ---------- smooth scroll ----------
    var lenis = null;
    if (window.Lenis) {
        lenis = new Lenis({
            duration: 1.15,
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

    // ---------- intro: loader -> hero curtain -> hero content (plays once; the loader lasts as long as the critical media takes, min ~4.6s) ----------
    // loader phrase comes out of blur part by part while a line runs along the screen edge with a % counter,
    // then the hero opens from the bottom over the grey screen and its texts come in
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
                if (lenis) lenis.start();
                ScrollTrigger.refresh();
            }
        });

        // the curtain opens the hero, so the page must be at the very top (also Lenis' own position)
        function toTop() {
            window.scrollTo(0, 0);
            if (lenis) lenis.scrollTo(0, { immediate: true, force: true });
        }

        if (loader) {
            if ('scrollRestoration' in history) history.scrollRestoration = 'manual';
            toTop();

            var parts = all('.loader_part', loader);
            var percent = loader.querySelector('.loader_percent');
            var segs = all('.loader_frame i', loader);
            var counter = { v: 0 };
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

            // line + % follow the real loading (scripts.js loadProgress), eased so they glide instead of jumping;
            // never faster than one lap in MIN_LAP s, so with everything cached it still reads as a sweep
            var MIN_LOADER = 4; // s, the line never closes sooner, even when everything is cached
            var MIN_LAP = Math.max(MIN_LOADER, lastIn + 0.2); // and not before the last part settles
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
                progress();
                if (counter.v === 100) { gsap.ticker.remove(tick); resolveLoaded(); }
            };
            gsap.ticker.add(tick);
        } else {
            tl.addLabel('reveal', 0);
        }

        // the curtain needs the critical media (scripts.js criticalReady); with the loader also the line at 100%
        var ready = loader
            ? loaded.then(function () { return new Promise(function (r) { setTimeout(r, 300); }); }) // short hold on 100%
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

    // Villa banners behave like full-screen steps: one wheel gesture moves exactly one banner,
    // fast scrolling chains the banners one after another, and the ends of the group are free to leave.
    // first white card grows 0.97 -> 1 as it comes up over the hero (scrubbed).
    // Not on mobile: iOS Safari stops painting the architecture video inside this clipped, rounded card
    // while its transform changes (blank box after scrolling back up); 2% isn't visible on a phone anyway
    function firstCardScale() {
        var card = document.querySelector('.white_card:not(.white_card_next)');
        if (!card || isMobile) return;
        gsap.fromTo(card,
            { scale: 0.98, transformOrigin: '50% 0%' },
            {
                scale: 1,
                ease: 'none',
                scrollTrigger: { trigger: card, start: 'top bottom', end: 'top 35%', scrub: true }
            });
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

        firstCardScale();
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
