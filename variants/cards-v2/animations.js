(function () {
    if (!window.gsap || !window.ScrollTrigger || !window.SplitText) return;
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;

    gsap.registerPlugin(ScrollTrigger, SplitText);

    // ---------- config ----------
    var EASE_OUT = 'expo.out';
    var STAGGER = { lines: 0.12, items: 0.1 };
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
        gsap.ticker.add(function (time) { lenis.raf(time * 1000); });
        gsap.ticker.lagSmoothing(0);
    }

    // ---------- effects ----------

    // B: lines rise from under a mask. `trigger` false = play immediately.
    function lineMask(el, opts) {
        opts = opts || {};
        var done = false;
        SplitText.create(el, {
            type: 'lines',
            mask: 'lines',
            linesClass: 'sl',
            autoSplit: true,
            onSplit: function (self) {
                gsap.set(el, { autoAlpha: 1 });
                if (done) return; // re-split on resize: keep the final state
                var vars = {
                    yPercent: 110,
                    duration: dur(opts.duration || 1.1),
                    stagger: STAGGER.lines,
                    ease: EASE_OUT,
                    delay: opts.delay || 0,
                    onComplete: function () { done = true; }
                };
                if (opts.immediate) {
                    return gsap.from(self.lines, vars);
                }
                vars.scrollTrigger = { trigger: el, start: 'top 85%', once: true };
                return gsap.from(self.lines, vars);
            }
        });
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

    // Villa banners behave like full-screen steps: one wheel push moves one banner,
    // a new push while moving carries straight on to the next one, the ends of the group are free to leave.
    function setupSnap() {
        if (!lenis) return;
        if (!window.matchMedia('(hover: hover) and (pointer: fine)').matches) return;
        var items = all('.types .stories');
        if (items.length < 2) return;

        var STEP = 0.85;         // seconds per banner
        var ENTRY = 0.4;         // how close (in screens) to the group we start pulling in
        var MIN_GAP = 260;       // ms between two accepted pushes (also filters trackpad inertia)
        var busy = false;
        var currentTarget = 0;
        var lastStepAt = 0;
        var holdUntil = 0;       // swallow the momentum tail right after arriving
        var failSafe = null;
        var timer = null;

        // halfway between a soft start/stop (in-out) and a fast start with a long soft landing (out)
        function ease(t) {
            var inOut = t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
            var out = 1 - Math.pow(1 - t, 4);
            return 0.5 * inOut + 0.5 * out;
        }

        // position in the document without transforms (banners are scaled)
        function absTop(el) {
            var top = 0;
            while (el) { top += el.offsetTop; el = el.offsetParent; }
            return top;
        }

        function points() {
            return items.map(function (el) { return Math.round(absTop(el) - 10); });
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

        // the banner after the one we are already heading to
        function beyond(target, dir) {
            var p = points();
            var i;
            if (dir > 0) {
                for (i = 0; i < p.length; i++) if (p[i] > target + 2) return p[i];
            } else {
                for (i = p.length - 1; i >= 0; i--) if (p[i] < target - 2) return p[i];
            }
            return null;
        }

        function inZone(pos) {
            var p = points();
            var vh = window.innerHeight;
            return pos >= p[0] - ENTRY * vh && pos <= p[p.length - 1] + ENTRY * vh;
        }

        function go(target) {
            busy = true;
            currentTarget = target;
            lastStepAt = performance.now();
            clearTimeout(failSafe);
            failSafe = setTimeout(done, STEP * 1000 + 250);
            lenis.scrollTo(target, { duration: STEP, easing: ease, onComplete: done });
        }

        function done() {
            if (!busy) return;
            busy = false;
            clearTimeout(failSafe);
            holdUntil = performance.now() + 160;
        }

        window.addEventListener('wheel', function (e) {
            var dy = e.deltaY;
            if (!dy || e.ctrlKey) return;
            var dir = dy > 0 ? 1 : -1;
            var now = performance.now();
            var pos = window.scrollY;
            var push = Math.abs(dy) >= 40 && now - lastStepAt >= MIN_GAP;

            if (busy) {
                e.preventDefault();
                e.stopImmediatePropagation();
                if (push) {
                    var next = beyond(currentTarget, dir);
                    if (next !== null) go(next);
                }
                return;
            }

            if (now < holdUntil && inZone(pos)) {
                e.preventDefault();
                e.stopImmediatePropagation();
                return;
            }

            var target = targetFor(dir, pos);
            if (target === null) return; // outside the group: normal smooth scroll
            e.preventDefault();
            e.stopImmediatePropagation();
            if (now - lastStepAt >= MIN_GAP) go(target);
        }, { passive: false, capture: true });

        // fallback for keyboard / scrollbar: settle on a banner when scrolling stops near or inside the group
        lenis.on('scroll', function () {
            if (busy) return;
            clearTimeout(timer);
            timer = setTimeout(function () {
                if (busy) return;
                var p = points();
                var pos = window.scrollY;
                var last = p[p.length - 1];
                var band = ENTRY * window.innerHeight;
                if (pos < p[0] && pos >= p[0] - band && lenis.direction > 0) { go(p[0]); return; }
                if (pos > last && pos <= last + band && lenis.direction < 0) { go(last); return; }
                if (pos < p[0] || pos > last) return;
                var best = p[0];
                p.forEach(function (v) { if (Math.abs(v - pos) < Math.abs(best - pos)) best = v; });
                if (Math.abs(best - pos) >= 2) go(best);
            }, 200);
        });
    }

    // Lower villa banners are a bit smaller and grow to full size as they come to the centre
    function bannerScale() {
        var from = isMobile ? 0.95 : 0.92;
        all('.types .stories').forEach(function (el) {
            gsap.fromTo(el,
                { scale: from },
                {
                    scale: 1,
                    ease: 'none',
                    scrollTrigger: { trigger: el, start: 'top bottom', end: 'top 10px', scrub: true }
                });
        });
    }

    // ---------- init ----------
    function init() {
        // hero intro (plays right away, no scroll trigger)
        var heroTitle = document.querySelector('[data-anim="hero-title"]');
        if (heroTitle) lineMask(heroTitle, { immediate: true, duration: 1.2, delay: 0.15 });

        all('[data-anim="hero-fade"]').forEach(function (el, i) {
            var end = parseFloat(getComputedStyle(el).opacity) || 1;
            gsap.fromTo(el,
                { autoAlpha: 0, y: y(12) },
                { autoAlpha: end, y: 0, duration: dur(1), ease: EASE_OUT, delay: 0.5 + i * 0.15 });
        });

        var header = document.querySelector('[data-anim="hero-header"]');
        if (header) {
            gsap.fromTo(header,
                { autoAlpha: 0, y: y(-16) },
                { autoAlpha: 1, y: 0, duration: dur(1), ease: EASE_OUT, delay: 0.6 });
        }

        // scroll-driven blocks
        all('[data-anim="lines"]').forEach(function (el) { lineMask(el); });
        all('[data-anim="scrub"]').forEach(wordsScrub);
        all('[data-anim="fade"]').forEach(function (el) { fadeUp(el, true); });
        all('[data-anim="fade-only"]').forEach(function (el) { fadeUp(el, false); });
        all('[data-anim="stagger"]').forEach(staggerItems);
        all('[data-anim="count"]').forEach(countUp);

        // drone video "opens up" while scrolling in
        var video = document.querySelector('.architecture_video video');
        if (video) {
            gsap.fromTo(video,
                { clipPath: 'inset(8% 6% 8% 6% round 28px)' },
                {
                    clipPath: 'inset(0% 0% 0% 0% round 18px)',
                    ease: 'none',
                    scrollTrigger: { trigger: video, start: 'top bottom', end: 'top 30%', scrub: true }
                });
        }

        bannerScale();
        setupSnap();
        ScrollTrigger.refresh();
    }

    // wait for fonts so lines are measured with the real typeface (max 2s)
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
