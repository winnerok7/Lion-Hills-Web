// ---------- Media loading ----------
// Everything below the hero has data-src instead of src (data-src-mobile, if set, wins on mobile; data-media drops an element on the other device). Order:
// 1) critical, the loader waits for it (its drawing runs on a fixed time, then "завантаження…" if this isn't in yet):
//    fonts + hero photo (preloaded in <head>) + [data-load="critical"] (first screens after the hero);
//    a critical video with a poster only needs the poster (the video opens the queue), without one its first frame.
//    Every video has data-poster (+ data-poster-mobile): its first frame as WebP, set together with the src
// 2) queue: [data-load="queue"] in page order, QUEUE_SLOTS files at a time (first slide of the other sliders, build1/2)
// 3) the rest: gallery/carousel slides once their block is about a screen away; stories load current + next slide
// On mobile data-load-mobile overrides data-load: the critical videos go to the queue (iOS doesn't buffer
// videos that aren't playing, so the loader would hang on them), critical is fonts + hero photo + the villa
// covers (fast scrolling showed black banners while they loaded), and the rest waits for the loader to end.
// Save-data / 2g: critical is only the fonts and the hero photo, everything else goes to the queue

var CRITICAL_MAX = 9000; // ms, on a slow connection the loader gives up waiting after this and shows the page
var QUEUE_SLOTS = 3;     // queue files loading at once
var isMobile = window.matchMedia('(max-width: 767px)').matches;
// touch devices (phones, iPads, also iPadOS in desktop mode that says "MacIntel"): iOS/iPadOS Safari doesn't
// buffer a video that isn't playing, so for those only the metadata is waited for. isMobile stays the layout
// switch (phone files via data-src-mobile), an iPad still gets the desktop files
var isTouch = window.matchMedia('(hover: none), (pointer: coarse)').matches ||
              (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
var conn = navigator.connection;
var isSlowNet = !!(conn && (conn.saveData || /(^|-)2g$/.test(conn.effectiveType || '')));

// Desktop menus (pill + drawer): full size from 1680px wide, proportionally smaller below, never under 85%.
// style.css uses --menu-k only above the mobile breakpoint, so phones keep their own sizes
(function () {
    function fit() {
        var k = Math.max(0.85, Math.min(1, window.innerWidth / 1680));
        document.documentElement.style.setProperty('--menu-k', k.toFixed(3));
    }
    fit();
    window.addEventListener('resize', fit);
})();

// data-media="desktop" / "mobile": a slide whose media differs in kind between devices (photo vs video);
// the other device's element is dropped before anything loads or plays
document.querySelectorAll(isMobile ? '[data-media="desktop"]' : '[data-media="mobile"]').forEach(function (el) {
    el.parentNode.removeChild(el);
});

// menu anchors: Lenis glide on desktop (under the top pill); native smooth scroll on mobile,
// where the page has CSS scroll-snap on the villas and Lenis' frame-by-frame scrolling would snag on it,
// and on Macs, which have no Lenis (animations.js)
function goTo(target) {
    var mobile = window.innerWidth <= 767;
    if (!mobile && window.lenis) {
        window.lenis.scrollTo(target, { offset: -110 });
    } else {
        window.scrollTo({ top: target.getBoundingClientRect().top + window.scrollY - (mobile ? 20 : 110), behavior: 'smooth' });
    }
}

// [data-load] elements of the given group(s), in page order; on a slow connection critical counts as queue
function loadGroup(names) {
    return Array.prototype.filter.call(document.querySelectorAll('[data-load]'), function (el) {
        var group = isMobile && el.getAttribute('data-load-mobile') || el.getAttribute('data-load');
        if (isSlowNet && group === 'critical') group = 'queue';
        return names.indexOf(group) >= 0;
    });
}

// load a list in order, `slots` files at a time; each slot moves on once its file is usable (or after 10s)
function loadInTurn(list, slots) {
    var i = 0;
    function next() {
        var el = list[i++];
        if (!el) return;
        if (el.tagName === 'VIDEO') el.preload = 'auto';
        loadMedia(el); // no-op if a block already pulled it in
        whenLoaded(el).then(next);
    }
    for (var k = 0; k < slots; k++) next();
}

// a video's first frame as a still (data-poster / data-poster-mobile, WebP): shown until the video has frames,
// so a slow video is never a black or white box. Returns the poster url, if any
function setPoster(el) {
    var url = isMobile && el.getAttribute('data-poster-mobile') || el.getAttribute('data-poster');
    if (url && !el.hasAttribute('poster')) el.poster = url;
    return url;
}

// data-src-mobile: a separate (vertical / lighter) file for phones
function loadMedia(el) {
    var src = el && el.getAttribute('data-src');
    if (!src) return;
    if (isMobile && el.hasAttribute('data-src-mobile')) src = el.getAttribute('data-src-mobile');
    if (el.tagName === 'VIDEO') setPoster(el); // before the src, so the still is what shows while it loads
    el.removeAttribute('data-src');
    el.src = src;
    // decode right away (off the main thread), not on the first paint mid-scroll / mid-animation
    if (el.tagName === 'IMG' && el.decode) el.decode().catch(function () {});
}

function loadMediaIn(root) {
    if (!root) return;
    if (root.hasAttribute('data-src')) loadMedia(root);
    root.querySelectorAll('[data-src]').forEach(loadMedia);
}

// resolves once the file is usable (or failed / took too long), so one slow file doesn't stall everything
function whenLoaded(el, max) {
    return new Promise(function (resolve) {
        var t = setTimeout(resolve, max || 10000);
        function done() { clearTimeout(t); resolve(); }
        el.addEventListener('error', done, { once: true });
        if (el.tagName === 'VIDEO' && isTouch) {
            // iOS doesn't buffer a video that isn't playing, so canplaythrough may never come: metadata is enough
            if (el.readyState >= 1) return done();
            el.addEventListener('loadedmetadata', done, { once: true });
        } else if (el.tagName === 'VIDEO') {
            // the first frame is enough: with preload="auto" the rest keeps coming in on its own
            if (el.readyState >= 2) return done();
            el.addEventListener('loadeddata', done, { once: true });
        } else {
            if (el.complete && el.naturalWidth) return done();
            el.addEventListener('load', done, { once: true });
        }
    });
}

// critical videos whose poster stood in for them during the loader; they open the queue
var criticalVideos = [];

// critical set: window.criticalReady (promise) + window.loadProgress() (0..1) for the loader;
// animations.js holds the hero curtain on criticalReady too
(function () {
    var parts = []; // each: { done, fraction() }
    var finished = false;

    function track(promise, fraction) {
        var part = { done: false, fraction: fraction || function () { return 0; } };
        parts.push(part);
        return Promise.resolve(promise).then(function () { part.done = true; });
    }

    var waits = [];
    waits.push(track(document.fonts ? document.fonts.ready : null));

    var media = document.querySelector('.hero_media');
    var bg = media && getComputedStyle(media).backgroundImage.match(/url\(["']?(.*?)["']?\)/);
    if (bg) {
        var img = new Image();
        img.src = bg[1];
        waits.push(track(img.decode ? img.decode().catch(function () {}) : null));
    }

    // all at once, in parallel with the hero; images are decoded up front too, so big ones (villa covers)
    // don't stutter when scrolled to. A critical video only needs its poster here: the video file itself
    // goes first in the queue, right after the loader
    loadGroup(['critical']).forEach(function (el) {
        if (el.tagName === 'VIDEO' && el.hasAttribute('data-poster')) {
            var still = new Image();
            still.src = setPoster(el);
            waits.push(track(new Promise(function (resolve) {
                var t = setTimeout(resolve, CRITICAL_MAX);
                function ok() { clearTimeout(t); resolve(); }
                if (still.decode) still.decode().then(ok, ok);
                else { still.onload = ok; still.onerror = ok; }
            })));
            criticalVideos.push(el);
            return;
        }
        if (el.tagName === 'VIDEO') el.preload = 'auto';
        loadMedia(el);
        var usable = whenLoaded(el, CRITICAL_MAX).then(function () {
            if (el.tagName === 'IMG' && el.decode) return el.decode().catch(function () {});
        });
        waits.push(track(usable, function () {
            if (el.tagName !== 'VIDEO' || !el.duration || !el.buffered.length) return 0;
            return Math.min(0.95, el.buffered.end(el.buffered.length - 1) / el.duration);
        }));
    });

    window.criticalReady = Promise.race([
        Promise.all(waits),
        new Promise(function (r) { setTimeout(r, CRITICAL_MAX); })
    ]).then(function () { finished = true; });

    window.loadProgress = function () {
        if (finished || !parts.length) return 1;
        var sum = 0;
        parts.forEach(function (p) { sum += p.done ? 1 : p.fraction(); });
        return sum / parts.length;
    };
})();

// mobile: nothing else loads while the loader text animates, so it stays smooth;
// animations.js fires 'loader:done' when the hero curtain starts (or when there is no loader)
var loaderDone = new Promise(function (resolve) {
    if (!isMobile || !document.documentElement.classList.contains('is-loading')) return resolve();
    window.addEventListener('loader:done', function () { resolve(); }, { once: true });
    setTimeout(resolve, CRITICAL_MAX + 5000); // animations.js failed
});

(function () {
    Promise.all([window.criticalReady, loaderDone]).then(function () {
        loadInTurn(criticalVideos.concat(loadGroup(['queue'])), QUEUE_SLOTS);
    });

    // the rest: whole gallery / carousel at once, standalone media by itself (stories handle their own)
    var roots = [];
    document.querySelectorAll('[data-src]').forEach(function (el) {
        if (el.closest('.stories')) return;
        var root = el.closest('.gallery, .carousel') || el;
        if (roots.indexOf(root) < 0) roots.push(root);
    });
    var near = new IntersectionObserver(function (entries) {
        entries.forEach(function (e) {
            if (!e.isIntersecting) return;
            near.unobserve(e.target);
            loadMediaIn(e.target);
        });
    }, { rootMargin: '100% 0px' });
    // not before the critical set: on desktop the "Концепція" gallery is already within a screen at the top,
    // and its other videos (~28MB) would take the bandwidth from the loader
    Promise.all([window.criticalReady, loaderDone]).then(function () {
        // a carousel is watched by its track (the row that actually comes into view)
        roots.forEach(function (root) { near.observe(root.querySelector('.carousel_track') || root); });
    });
})();


document.querySelectorAll(".gallery").forEach(function (gallery) {

    var items = gallery.querySelectorAll('.gallery_item');
    var tabs = gallery.querySelectorAll('.gallery_tab');
    var captions = gallery.querySelectorAll('.gallery_caption');
    var next = gallery.querySelector('.gallery_next');
    var strip = gallery.querySelector('.gallery_tabs');
    var more = gallery.querySelector('.gallery_tabs_more'); // ">" next to tabs that don't fit (mobile)
    var current = 0;
    var isLast = false;

    // the pill turns into a scrolling strip + ">" only when the tabs don't fit
    function fitTabs() {
        if (!more) return;
        var wrap = more.parentNode;
        wrap.classList.remove('is-overflow');
        wrap.classList.toggle('is-overflow', strip.scrollWidth > strip.clientWidth + 1);
        fadeTabs();
    }

    // fade the strip at the edges it can still scroll to
    function fadeTabs() {
        var max = strip.scrollWidth - strip.clientWidth;
        strip.classList.toggle('fade_start', strip.scrollLeft > 1);
        strip.classList.toggle('fade_end', strip.scrollLeft < max - 1);
        updateMore();
    }

    // ">" goes away (and gives its room to the strip) on the last slide or once the strip is scrolled to its end
    function updateMore() {
        if (!more) return;
        var atEnd = strip.scrollLeft >= strip.scrollWidth - strip.clientWidth - 1;
        more.classList.toggle('is-hidden', isLast || atEnd);
    }

    // keep the active tab in the middle of the strip (only moves the strip, not the page)
    function centerTab(tab) {
        if (strip.scrollWidth <= strip.clientWidth) return;
        var left = tab.getBoundingClientRect().left - strip.getBoundingClientRect().left + strip.scrollLeft;
        strip.scrollTo({ left: left - (strip.clientWidth - tab.offsetWidth) / 2, behavior: 'smooth' });
    }

    function currentVideo() {
        return items[current].querySelector('video');
    }

    function show(index) {
        var prev = currentVideo();
        if (prev) prev.pause();

        current = index;
        items.forEach(function (el, i) { el.classList.toggle('active', i === index); });
        tabs.forEach(function (el, i) { el.classList.toggle('active', i === index); });
        captions.forEach(function (el, i) { el.classList.toggle('active', i === index); });
        loadMediaIn(items[index]); // a tab clicked before the block got near
        if (tabs[index]) centerTab(tabs[index]);
        primeNext();

        // no "next" on the last slide (the tabs still go anywhere)
        isLast = nextIndex() === null;
        next.classList.toggle('is-hidden', isLast);
        updateMore();

        var video = currentVideo();
        if (video) {
            video.currentTime = 0;
            video.play().catch(function () {});
        }
    }

    tabs.forEach(function (tab, i) {
        tab.addEventListener('click', function () { show(i); });
    });

    // next slide after the current one, skipping slides whose tab is hidden; null on the last one
    function nextIndex() {
        for (var i = current + 1; i < items.length; i++) {
            if (!tabs[i] || tabs[i].offsetParent !== null) return i;
        }
        return null;
    }

    function goNext() {
        var i = nextIndex();
        if (i !== null) show(i);
    }

    // the slide after the current one buffers in full ahead of time (the markup's preload="metadata" would leave
    // it empty until clicked); not before the critical set, the first gallery is near the top on desktop
    function primeNext() {
        var at = current;
        window.criticalReady.then(function () {
            if (at !== current) return;
            var i = nextIndex();
            if (i === null) return;
            items[i].querySelectorAll('video').forEach(function (v) { v.preload = 'auto'; });
            loadMediaIn(items[i]);
        });
    }

    next.addEventListener('click', goNext);
    if (more) {
        more.addEventListener('click', goNext);
        strip.addEventListener('scroll', fadeTabs, { passive: true });
        window.addEventListener('resize', fitTabs);
        if (document.fonts && document.fonts.ready) document.fonts.ready.then(fitTabs);
        fitTabs();
    }

    // Autoplay the first video just before the gallery edge enters the screen:
    // iOS shows a not-yet-played video as a black box. From then on it just loops
    var started = false;
    new IntersectionObserver(function (entries) {
        if (entries[0].isIntersecting && !started) {
            started = true;
            show(0);
        }
    }, { rootMargin: '0px 0px 15% 0px' }).observe(gallery);
});

    document.querySelectorAll(".carousel").forEach(function (root) {
    if (!root) return;

    var track = root.querySelector('.carousel_track');
    var prev = root.querySelector('.carousel_prev');
    var next = root.querySelector('.carousel_next');

    // go to the next / previous card's own position (not a fixed step: the gap differs on mobile,
    // and iOS doesn't re-snap after a programmatic scroll, so any error would add up)
    function go(dir) {
        var pad = parseFloat(getComputedStyle(track).scrollPaddingLeft) || 0;
        var base = track.getBoundingClientRect().left - track.scrollLeft + pad;
        var pos = track.scrollLeft;
        var target = null;
        track.querySelectorAll('.carousel_card').forEach(function (card) {
            var x = card.getBoundingClientRect().left - base;
            if (dir > 0 && target === null && x > pos + 1) target = x;
            if (dir < 0 && x < pos - 1) target = x;
        });
        if (target !== null) track.scrollTo({ left: target, behavior: 'smooth' });
    }

    function update() {
        prev.disabled = track.scrollLeft <= 1;
        next.disabled = track.scrollLeft + track.clientWidth >= track.scrollWidth - 1;
    }

    prev.addEventListener('click', function () { go(-1); });
    next.addEventListener('click', function () { go(1); });
    track.addEventListener('scroll', update, { passive: true });
    window.addEventListener('resize', update);
    update();
});


document.querySelectorAll('.stories').forEach(function (root) {
    var slides = root.querySelectorAll('.stories_slide');
    if (slides.length < 2) return; // a single cover slide: nothing to switch
    var segs = root.querySelectorAll('.stories_seg');
    var prev = root.querySelector('.stories_prev');
    var next = root.querySelector('.stories_next');
    var current = 0;
    var isNear = false;

    // media of the visible slide and the next one, only once the block is close to the screen;
    // preload="none" in the markup would keep the next video unbuffered (black) until shown
    function loadAround() {
        if (!isNear) return;
        [slides[current], slides[(current + 1) % slides.length]].forEach(function (slide) {
            slide.querySelectorAll('video').forEach(function (v) { v.preload = 'auto'; });
            loadMediaIn(slide);
        });
    }

    function show(index) {
        current = index;
        loadAround();
        slides.forEach(function (el, i) { el.classList.toggle('active', i === current); });
        segs.forEach(function (el, i) {
            el.classList.remove('active');
            el.classList.toggle('done', i < current);
        });
        void root.offsetWidth; // restart the fill animation
        segs[current].classList.add('active');
        // no "back" on the first slide, no "next" on the last one (mobile: the tap zone goes with it)
        prev.hidden = current === 0;
        next.hidden = current === slides.length - 1;
        // only the visible slide's video plays
        slides.forEach(function (el, i) {
            var v = el.querySelector('video');
            if (!v) return;
            if (i === current) { v.currentTime = 0; v.play().catch(function () {}); } else { v.pause(); }
        });
    }

    function goNext() { show((current + 1) % slides.length); }

    next.addEventListener('click', goNext);
    prev.addEventListener('click', function () { show(current - 1); });
    segs.forEach(function (seg, i) {
        seg.addEventListener('animationend', goNext);
        seg.addEventListener('click', function () { show(i); });
    });

    // The progress bar only runs while the block is on screen
    new IntersectionObserver(function (entries) {
        root.classList.toggle('in_view', entries[0].isIntersecting);
    }, { threshold: 0.5 }).observe(root);

    var nearObserver = new IntersectionObserver(function (entries) {
        if (!entries[0].isIntersecting) return;
        nearObserver.disconnect();
        isNear = true;
        loadAround();
    }, { rootMargin: '100% 0px' });
    nearObserver.observe(root);

    show(0);
});

// Villa floor plans (mobile): the pills switch between the first and the second floor
document.querySelectorAll('.plan_floors').forEach(function (box) {
    var tabs = box.querySelectorAll('.plan_floors_tab');
    var floors = box.querySelectorAll('.plan_floor');
    tabs.forEach(function (tab, i) {
        tab.addEventListener('click', function () {
            tabs.forEach(function (el, j) {
                el.classList.toggle('active', j === i);
                el.setAttribute('aria-pressed', j === i ? 'true' : 'false');
            });
            floors.forEach(function (el, j) { el.classList.toggle('active', j === i); });
        });
    });
});

// Once the first villa banner is near, all villa slides load in the background,
// one file at a time in page order, so flipping through them never hits a black frame
(function () {
    var first = document.querySelector('.types .stories');
    if (!first) return;
    var started = false;
    var obs = new IntersectionObserver(function (entries) {
        if (!entries[0].isIntersecting || started) return;
        started = true;
        obs.disconnect();
        window.criticalReady.then(function () {
            loadInTurn(Array.prototype.slice.call(document.querySelectorAll('.types .stories [data-src]')), 1);
        });
    }, { rootMargin: '100% 0px' });
    obs.observe(first);
})();

// Fixed layers that come and go (pill, its veil, the glass drawer) leave the render tree when hidden:
// Safari 26 colours its bars from fixed elements at the screen edges even at opacity 0 / visibility hidden,
// and caught the pill mid fade-out (a grey strip under the footer); only display: none takes them out.
// On: back in the tree first (and a reflow), so the class change after it still animates.
// Off: display: none once the CSS fade-out (delay ms) is over
function presence(el, on, delay) {
    if (!el) return;
    clearTimeout(el._presenceTimer);
    if (on) {
        if (el.style.display === 'none') {
            el.style.display = '';
            void el.offsetWidth;
        }
    } else if (el.style.display !== 'none') {
        el._presenceTimer = setTimeout(function () { el.style.display = 'none'; }, delay);
    }
}

// Pill header: shows up once the hero has scrolled out of view, expands into the menu
(function () {
    var bar = document.querySelector('.sticky_header');
    var fade = document.querySelector('.sticky_fade');
    var hero = document.querySelector('.hero');
    if (!bar || !hero) return;

    var toggle = bar.querySelector('.sticky_header_menu');
    var panel = bar.querySelector('.sticky_header_panel');
    var barLinks = bar.querySelectorAll('.sticky_header_bar a, .sticky_header_bar button');
    var panelLinks = panel.querySelectorAll('a');
    var heroMenu = document.querySelector('.header_menu');
    var barRow = bar.querySelector('.sticky_header_bar'); // its height = closed pill (66px, 60px on mobile)
    var footer = document.querySelector('.footer');
    var pastHero = false;
    var atFooter = false; // mobile: the bottom pill (and its veil) steps aside for the real footer
    var open = false;

    function render() {
        var show = (pastHero && !(atFooter && window.innerWidth <= 767)) || open;
        // the CSS fade-outs: pill 0.6s, veil 0.5s
        presence(bar, show, 700);
        presence(fade, show, 700);
        document.documentElement.classList.toggle('pill-on', show); // the mobile cookie strip rides above the pill
        bar.classList.toggle('is-visible', show);
        bar.classList.toggle('is-open', open);
        document.documentElement.classList.toggle('menu-open', open);
        bar.setAttribute('aria-hidden', show ? 'false' : 'true');
        toggle.setAttribute('aria-expanded', open ? 'true' : 'false');
        bar.style.height = open ? (barRow.offsetHeight + panel.offsetHeight) + 'px' : '';
        barLinks.forEach(function (el) { el.tabIndex = show ? 0 : -1; });
        panelLinks.forEach(function (el) { el.tabIndex = open ? 0 : -1; });
    }

    function setOpen(value) {
        if (open === value) return;
        open = value;
        render();
    }

    toggle.addEventListener('click', function () { setOpen(!open); });
    // the hero button opens the glass drawer instead (see below)

    // menu anchors: close, then glide to the section
    panel.querySelectorAll('a[href^="#"]').forEach(function (a) {
        var target = a.getAttribute('href').length > 1 && document.querySelector(a.getAttribute('href'));
        if (!target) return;
        a.addEventListener('click', function (e) {
            e.preventDefault();
            setOpen(false);
            goTo(target);
        });
    });

    document.addEventListener('keydown', function (e) {
        if (e.key === 'Escape' && open) { setOpen(false); toggle.focus(); }
    });
    document.addEventListener('click', function (e) {
        if (open && !bar.contains(e.target) && !(heroMenu && heroMenu.contains(e.target))) setOpen(false);
    });
    window.addEventListener('resize', function () { if (open) render(); });

    new IntersectionObserver(function (entries) {
        var e = entries[0];
        pastHero = !e.isIntersecting && e.boundingClientRect.bottom <= 0;
        render();
    }).observe(hero);

    if (footer) new IntersectionObserver(function (entries) {
        atFooter = entries[0].isIntersecting;
        render();
    }).observe(footer);
})();

// Scroll handlers below compare scrollY with section positions measured here, only when the layout changes
// (resize, load, page height change), so a scroll frame never forces a layout read in the middle of the animations
function onLayout(measure) {
    measure();
    window.addEventListener('resize', measure);
    window.addEventListener('load', measure);
    if (window.ResizeObserver) new ResizeObserver(function () { measure(); }).observe(document.body);
}

// document-space top / bottom of an element
function docBox(el) {
    var r = el.getBoundingClientRect();
    return { top: r.top + window.scrollY, bottom: r.bottom + window.scrollY };
}

// Floorplan download pill: stays on from the first villa banner through the last one
(function () {
    var link = document.querySelector('.plan_download');
    var villas = document.querySelectorAll('.types .stories');
    if (!link || !villas.length) return;

    var first = villas[0];
    var last = villas[villas.length - 1];
    var firstTop = 0, lastBottom = 0;
    var ticking = false;

    function measure() {
        firstTop = docBox(first).top;
        lastBottom = docBox(last).bottom;
        update();
    }

    function update() {
        ticking = false;
        var vh = window.innerHeight;
        var y = window.scrollY;
        // first banner has (almost) filled the screen and the last one hasn't left it yet
        var show = firstTop - y <= vh * 0.15 && lastBottom - y >= vh * 0.85;
        if (show === link.classList.contains('is-visible')) return;
        link.classList.toggle('is-visible', show);
        link.setAttribute('aria-hidden', show ? 'false' : 'true');
        link.tabIndex = show ? 0 : -1;
    }

    window.addEventListener('scroll', function () {
        if (!ticking) { ticking = true; requestAnimationFrame(update); }
    }, { passive: true });
    onLayout(measure);
})();

// Hero menu: glass drawer with Kyiv time and date
(function () {
    var drawer = document.querySelector('.drawer');
    var heroMenu = document.querySelector('.header_menu');
    if (!drawer || !heroMenu) return;

    var clock = drawer.querySelector('.drawer_clock');
    var date = drawer.querySelector('.drawer_date');
    var focusables = drawer.querySelectorAll('a, button');
    var open = false;
    var timer = null;

    function tick() {
        var now = new Date();
        clock.textContent = now.toLocaleTimeString('uk-UA', { timeZone: 'Europe/Kyiv', hour: '2-digit', minute: '2-digit' });
        date.textContent = now.toLocaleDateString('uk-UA', { timeZone: 'Europe/Kyiv', day: 'numeric', month: 'long', weekday: 'short' });
    }

    function setOpen(value) {
        if (open === value) return;
        open = value;
        presence(drawer, open, 700); // the CSS close is 0.6s
        drawer.classList.toggle('is-open', open);
        drawer.setAttribute('aria-hidden', open ? 'false' : 'true');
        heroMenu.setAttribute('aria-expanded', open ? 'true' : 'false');
        focusables.forEach(function (el) { el.tabIndex = open ? 0 : -1; });
        clearInterval(timer);
        if (open) { tick(); timer = setInterval(tick, 10000); }
        openedAt = window.scrollY;
    }

    // scrolling away closes it (page scroll stays on, so the scrollbar doesn't jump)
    var openedAt = 0;
    window.addEventListener('scroll', function () {
        if (open && Math.abs(window.scrollY - openedAt) > 60) setOpen(false);
    }, { passive: true });

    drawer.style.display = 'none'; // closed: out of the render tree (see presence())
    heroMenu.setAttribute('aria-controls', 'hero-menu');
    heroMenu.setAttribute('aria-expanded', 'false');
    heroMenu.addEventListener('click', function () { setOpen(!open); });
    drawer.querySelectorAll('.drawer_handle, .drawer_close').forEach(function (el) {
        el.addEventListener('click', function () { setOpen(false); });
    });

    drawer.querySelectorAll('a[href^="#"]').forEach(function (a) {
        var target = a.getAttribute('href').length > 1 && document.querySelector(a.getAttribute('href'));
        if (!target) return;
        a.addEventListener('click', function (e) {
            e.preventDefault();
            setOpen(false);
            goTo(target);
        });
    });

    document.addEventListener('keydown', function (e) {
        if (e.key === 'Escape' && open) { setOpen(false); heroMenu.focus(); }
    });
    document.addEventListener('click', function (e) {
        if (open && !drawer.contains(e.target) && !heroMenu.contains(e.target)) setOpen(false);
    });
})();

// FAQ accordion: one answer open at a time
document.querySelectorAll('.faq_list').forEach(function (list) {
    var items = list.querySelectorAll('.faq_item');

    items.forEach(function (item) {
        item.querySelector('.faq_question').addEventListener('click', function () {
            var open = !item.classList.contains('is-open');
            items.forEach(function (el) {
                var on = el === item && open;
                el.classList.toggle('is-open', on);
                el.querySelector('.faq_question').setAttribute('aria-expanded', on ? 'true' : 'false');
            });
            // page height changed: re-measure scroll triggers once the answer settles
            setTimeout(function () { if (window.ScrollTrigger) ScrollTrigger.refresh(); }, 550);
        });
    });
});

// Footer form: just a phone number, sent through Web3Forms (sendForm below); "Дякуємо!" until the visitor types again
document.querySelectorAll('.footer_form').forEach(function (form) {
    var input = form.elements.phone;
    var btn = form.querySelector('.footer_submit');
    var label = btn.textContent;

    input.addEventListener('input', function () {
        input.setCustomValidity('');
        if (!btn.disabled) btn.textContent = label;
    });

    form.addEventListener('submit', function (e) {
        e.preventDefault();
        if (btn.disabled) return; // already on its way
        var digits = input.value.replace(/\D/g, '');
        if (digits.length < 9 || digits.length > 15) {
            input.setCustomValidity('Вкажіть номер телефону повністю');
            input.reportValidity();
            return;
        }
        withSending(btn, sendForm(form, 'Нова заявка з сайту Lion Hills (футер)', {
            'Form': 'Футер',
            'Phone': input.value.trim()
        })).then(function () {
            form.reset();
            btn.textContent = 'Дякуємо!';
        }, function () {});
    });
});

// Cookie notice (desktop card / mobile strip in the hero): comes in once the hero intro has played,
// "Добре" hides it for good. The choice lives in localStorage; if storage is blocked it simply shows again next time
(function () {
    var box = document.querySelector('.cookie');
    if (!box) return;
    var KEY = 'lh-cookies-ok';
    try { if (localStorage.getItem(KEY)) return; } catch (e) {}

    // animations.js fires 'loader:done' as the hero curtain starts; the hero texts take ~2.5s more
    var introOver = new Promise(function (resolve) {
        if (!document.documentElement.classList.contains('is-loading')) return resolve();
        window.addEventListener('loader:done', function () { resolve(); }, { once: true });
        setTimeout(resolve, CRITICAL_MAX + 5000); // animations.js failed
    });

    introOver.then(function () {
        setTimeout(function () {
            box.hidden = false;
            void box.offsetWidth; // in the layout first, so the fade-up runs
            box.classList.add('is-visible');
        }, 2600);
    });

    box.querySelector('.cookie_btn').addEventListener('click', function () {
        try { localStorage.setItem(KEY, '1'); } catch (e) {}
        box.classList.remove('is-visible');
        setTimeout(function () { box.hidden = true; }, 700);
    });
})();

// ---------- Web3Forms ----------
// Both forms (popup + footer) send here; the access key is public by design (Web3Forms checks the domain).
// Field names are in English: Web3Forms garbles Cyrillic keys in the email (values are fine)
var WEB3FORMS_KEY = '29418635-8536-417c-b5a5-40390421bba5';

function sendForm(form, subject, fields) {
    var data = new FormData();
    data.append('access_key', WEB3FORMS_KEY);
    data.append('subject', subject);
    data.append('from_name', 'Сайт Lion Hills');
    // honeypot: a hidden box only a bot would tick, Web3Forms drops the request then
    if (form.elements.botcheck && form.elements.botcheck.checked) data.append('botcheck', 'on');
    Object.keys(fields).forEach(function (key) { data.append(key, fields[key]); });
    return fetch('https://api.web3forms.com/submit', { method: 'POST', body: data }).then(function (res) {
        return res.json().catch(function () { return {}; }).then(function (json) {
            if (!res.ok || json.success === false) throw new Error(json.message || 'HTTP ' + res.status);
            return json;
        });
    });
}

// the button says "sending" while the request is out (and can't be pressed twice);
// on failure it says so for a moment, then gets its label back
function withSending(btn, request) {
    var label = btn.textContent;
    btn.disabled = true;
    btn.textContent = 'Надсилаємо…';
    return request.then(function (result) {
        btn.disabled = false;
        btn.textContent = label;
        return result;
    }, function (err) {
        btn.textContent = 'Помилка, спробуйте ще';
        setTimeout(function () { btn.disabled = false; btn.textContent = label; }, 2500);
        throw err;
    });
}

// Request popup (quiz): pops up once the "Готовність комплексу 2027" block is on screen.
// Steps: property type -> way to contact (nothing picked up front, "next" waits for a choice) -> name + phone, then a thank-you.
// Once per visit (sessionStorage), never again after a sent request (localStorage). Sent through Web3Forms (sendForm)
(function () {
    var quiz = document.querySelector('.quiz');
    var trigger = document.querySelector('[data-quiz-trigger] .ready_box');
    if (!quiz || !trigger) return;
    var SEEN = 'lh-quiz-seen', SENT = 'lh-quiz-sent';
    // ?quiz in the address forgets both (for testing)
    if (/[?&]quiz\b/.test(location.search)) {
        try { localStorage.removeItem(SENT); sessionStorage.removeItem(SEEN); } catch (e) {}
    }
    try { if (localStorage.getItem(SENT) || sessionStorage.getItem(SEEN)) return; } catch (e) {}

    var form = quiz.querySelector('.quiz_box');
    var steps = quiz.querySelectorAll('.quiz_step');
    var bar = quiz.querySelector('.quiz_bar');
    var segs = bar.querySelectorAll('i');
    var prev = quiz.querySelector('.quiz_prev');
    var next = quiz.querySelector('.quiz_next');
    var submit = quiz.querySelector('.quiz_submit');
    var name = form.elements.name;
    var phone = form.elements.phone;
    var codeBtn = quiz.querySelector('.quiz_code');
    var list = quiz.querySelector('.quiz_countries');
    var current = 0;
    var open = false;
    var lastFocus = null;

    // Ukraine first, then Europe A-Z; min / max digits after the code (Ukraine has the XX XXX XXXX mask)
    var FLAGS = 'https://cdn.jsdelivr.net/npm/flag-icons@7.2.3/flags/4x3/';
    var countries = [
        ['ua', 'Україна', '+380', 9, 9],
        ['at', 'Австрія', '+43'], ['be', 'Бельгія', '+32'], ['bg', 'Болгарія', '+359'], ['gb', 'Велика Британія', '+44'],
        ['gr', 'Греція', '+30'], ['ge', 'Грузія', '+995'], ['dk', 'Данія', '+45'], ['ee', 'Естонія', '+372'],
        ['ie', 'Ірландія', '+353'], ['is', 'Ісландія', '+354'], ['es', 'Іспанія', '+34'], ['it', 'Італія', '+39'],
        ['cy', 'Кіпр', '+357'], ['lv', 'Латвія', '+371'], ['lt', 'Литва', '+370'], ['lu', 'Люксембург', '+352'],
        ['mt', 'Мальта', '+356'], ['md', 'Молдова', '+373'], ['mc', 'Монако', '+377'], ['nl', 'Нідерланди', '+31'],
        ['de', 'Німеччина', '+49'], ['no', 'Норвегія', '+47'], ['pl', 'Польща', '+48'], ['pt', 'Португалія', '+351'],
        ['ro', 'Румунія', '+40'], ['rs', 'Сербія', '+381'], ['sk', 'Словаччина', '+421'], ['si', 'Словенія', '+386'],
        ['hu', 'Угорщина', '+36'], ['fi', 'Фінляндія', '+358'], ['fr', 'Франція', '+33'], ['hr', 'Хорватія', '+385'],
        ['me', 'Чорногорія', '+382'], ['cz', 'Чехія', '+420'], ['ch', 'Швейцарія', '+41'], ['se', 'Швеція', '+46']
    ].map(function (c) { return { iso: c[0], name: c[1], code: c[2], min: c[3] || 6, max: c[4] || 12 }; });
    var country = countries[0];

    countries.forEach(function (c, i) {
        var li = document.createElement('li');
        li.innerHTML = '<button class="quiz_country" type="button" role="option" aria-selected="' + (i === 0) + '">' +
            '<img class="quiz_flag" loading="lazy" src="' + FLAGS + c.iso + '.svg" alt="">' + c.name + '<span>' + c.code + '</span></button>';
        li.firstChild.addEventListener('click', function () { pickCountry(c); });
        list.appendChild(li);
    });
    var options = list.querySelectorAll('.quiz_country');

    // phones: the native picker instead of the list (it shows emoji flags there), invisible over the code button
    var select = document.createElement('select');
    select.className = 'quiz_code_select';
    select.setAttribute('aria-label', 'Код країни');
    countries.forEach(function (c) {
        var flag = c.iso.toUpperCase().replace(/./g, function (ch) { return String.fromCodePoint(0x1F1A5 + ch.charCodeAt(0)); });
        select.add(new Option(flag + ' ' + c.name + ' ' + c.code));
    });
    select.addEventListener('change', function () { pickCountry(countries[select.selectedIndex]); });
    codeBtn.parentNode.insertBefore(select, codeBtn.nextSibling);

    function setList(value, refocus) {
        list.hidden = !value;
        codeBtn.setAttribute('aria-expanded', value ? 'true' : 'false');
        if (value) {
            var sel = options[countries.indexOf(country)];
            list.scrollTop = sel.offsetTop - list.clientHeight / 2 + sel.offsetHeight / 2;
            sel.focus({ preventScroll: true });
        } else if (refocus) {
            codeBtn.focus();
        }
    }

    function pickCountry(c) {
        country = c;
        options.forEach(function (el, i) { el.setAttribute('aria-selected', countries[i] === c ? 'true' : 'false'); });
        codeBtn.querySelector('.quiz_flag').src = FLAGS + c.iso + '.svg';
        codeBtn.querySelector('.quiz_code_num').textContent = c.code;
        codeBtn.setAttribute('aria-label', 'Код країни: ' + c.name + ' ' + c.code);
        form.elements.code.value = c.code;
        select.selectedIndex = countries.indexOf(c);
        phone.placeholder = c.iso === 'ua' ? 'XX XXX XXXX *' : 'Номер телефону *';
        formatPhone();
        setList(false);
        phone.focus();
    }

    codeBtn.addEventListener('click', function () { setList(list.hidden); });
    // arrows move through the countries
    list.addEventListener('keydown', function (e) {
        if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return;
        e.preventDefault();
        var i = Array.prototype.indexOf.call(options, document.activeElement) + (e.key === 'ArrowDown' ? 1 : -1);
        if (options[i]) options[i].focus();
    });
    document.addEventListener('click', function (e) {
        if (!list.hidden && !list.contains(e.target) && !codeBtn.contains(e.target)) setList(false);
    });

    function canGoOn() {
        if (current === 0) return !!form.querySelector('[name="type"]:checked');
        if (current === 1) return !!form.querySelector('[name="contact"]:checked');
        return true;
    }

    function show(index) {
        current = index;
        setList(false);
        steps.forEach(function (el, i) { el.classList.toggle('active', i === index); });
        segs.forEach(function (el, i) { el.classList.toggle('active', i <= index); });
        bar.hidden = index > 2;
        prev.hidden = next.hidden = index > 1;
        submit.hidden = index !== 2;
        prev.disabled = index === 0;
        next.disabled = !canGoOn();
        form.scrollTop = 0;
        // no keyboard popping up on its own on phones
        if (index === 2 && !isMobile) name.focus({ preventScroll: true });
        if (index === 3) form.focus({ preventScroll: true }); // the button that had focus is gone
    }

    function setOpen(value) {
        if (open === value) return;
        open = value;
        presence(quiz, open, 600); // the CSS fade-out is 0.5s
        quiz.classList.toggle('is-open', open);
        quiz.setAttribute('aria-hidden', open ? 'false' : 'true');
        document.documentElement.classList.toggle('quiz-open', open);
        if (window.lenis) { if (open) window.lenis.stop(); else window.lenis.start(); }
        if (open) {
            lastFocus = document.activeElement;
            loadMediaIn(quiz);
            form.focus({ preventScroll: true });
        } else {
            setList(false);
            if (lastFocus && lastFocus.focus) lastFocus.focus({ preventScroll: true });
        }
    }

    // pictures ahead of time, while the visitor is still a screen away
    var near = new IntersectionObserver(function (entries) {
        if (!entries[0].isIntersecting) return;
        near.disconnect();
        loadMediaIn(quiz);
    }, { rootMargin: '100% 0px' });
    near.observe(trigger);

    // the block's top has passed 60% of the screen height
    var obs = new IntersectionObserver(function (entries) {
        if (!entries[0].isIntersecting) return;
        obs.disconnect();
        try { sessionStorage.setItem(SEEN, '1'); } catch (e) {}
        setOpen(true);
    }, { rootMargin: '0px 0px -40% 0px' });
    obs.observe(trigger);

    form.addEventListener('change', function () { next.disabled = !canGoOn(); });

    prev.addEventListener('click', function () { show(current - 1); });
    next.addEventListener('click', function () { if (canGoOn()) show(current + 1); });

    // phone without the country code: Ukraine as XX XXX XXXX, others in groups of 3
    // (a pasted number with its code or a leading 0 is trimmed to fit)
    function digits() {
        return phone.value.replace(/\D/g, '');
    }

    function formatPhone() {
        var d = digits();
        var dial = country.code.slice(1);
        if (/^\s*(\+|00)/.test(phone.value)) {
            d = d.replace(/^00/, '');
            if (d.indexOf(dial) === 0) d = d.slice(dial.length);
        } else if (d.length > country.max && d.indexOf(dial) === 0) d = d.slice(dial.length);
        else if (d.length > country.max && d.charAt(0) === '0') d = d.slice(1);
        d = d.slice(0, country.max);
        var parts = country.iso === 'ua' ? [d.slice(0, 2), d.slice(2, 5), d.slice(5)] : d.match(/.{1,3}/g) || [];
        phone.value = parts.filter(Boolean).join(' ');
    }
    phone.addEventListener('input', formatPhone);
    // keyboard's Enter: name -> phone -> send
    name.addEventListener('keydown', function (e) {
        if (e.key === 'Enter') { e.preventDefault(); phone.focus(); }
    });
    [name, phone].forEach(function (el) {
        el.addEventListener('input', function () { el.classList.remove('is-error'); });
    });

    form.addEventListener('submit', function (e) {
        e.preventDefault();
        // Enter on the first two steps works as "next"
        if (current < 2) { if (canGoOn()) show(current + 1); return; }
        if (current !== 2) return;
        var bad = [];
        if (!name.value.trim()) bad.push(name);
        if (digits().length < country.min || digits().length > country.max) bad.push(phone);
        bad.forEach(function (el) { el.classList.add('is-error'); });
        if (bad.length) { bad[0].focus(); return; }
        if (submit.disabled) return; // already on its way
        withSending(submit, sendForm(form, 'Нова заявка з сайту Lion Hills (попап)', {
            'Form': 'Попап «Запис на перегляд»',
            'Property type': form.querySelector('[name="type"]:checked').value,
            'Contact method': form.querySelector('[name="contact"]:checked').value,
            'Name': name.value.trim(),
            'Phone': country.code + ' ' + phone.value,
            'Country': country.name
        })).then(function () {
            try { localStorage.setItem(SENT, '1'); } catch (e) {}
            show(3);
            setTimeout(function () { setOpen(false); }, 3500);
        }, function () {}); // the button shows the failure, the data stays in the fields for another try
    });

    quiz.querySelector('.quiz_close').addEventListener('click', function () { setOpen(false); });
    quiz.querySelector('.quiz_overlay').addEventListener('click', function () { setOpen(false); });

    // Escape closes; Tab stays inside the popup
    document.addEventListener('keydown', function (e) {
        if (!open) return;
        // Escape closes the country list first, then the popup
        if (e.key === 'Escape') { if (!list.hidden) setList(false, true); else setOpen(false); return; }
        if (e.key !== 'Tab') return;
        var items = Array.prototype.filter.call(
            quiz.querySelectorAll('button, input, a[href]'),
            function (el) { return !el.disabled && el.offsetParent !== null && !(el.type === 'radio' && !el.checked && form.querySelector('[name="' + el.name + '"]:checked')); }
        );
        if (!items.length) return;
        var first = items[0], last = items[items.length - 1];
        if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
        else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
    });

    show(0);
})();

// Footer "back to top": a longer Lenis glide on desktop (it's the whole page), native smooth scroll on mobile
document.querySelectorAll('.footer_top').forEach(function (btn) {
    btn.addEventListener('click', function () {
        if (window.innerWidth > 767 && window.lenis) {
            window.lenis.scrollTo(0, { duration: 1.8 });
        } else {
            window.scrollTo({ top: 0, behavior: 'smooth' });
        }
    });
});

// Header veil: match the color of whatever is under the pill's edge (white card vs dark sections);
// top edge on desktop, bottom edge on mobile where the pill floats at the bottom
(function () {
    var fade = document.querySelector('.sticky_fade');
    var darks = document.querySelectorAll('.clubhouse');
    if (!fade) return;

    var ranges = [];
    var ticking = false;

    function measure() {
        ranges = Array.prototype.map.call(darks, docBox);
        update();
    }

    function update() {
        ticking = false;
        var y = window.scrollY + (window.innerWidth <= 767 ? window.innerHeight - 2 : 2);
        // dark only over the two dark screens (infrastructure, autonomy), white everywhere else
        fade.classList.toggle('is-dark', ranges.some(function (r) { return y >= r.top && y < r.bottom; }));
    }

    window.addEventListener('scroll', function () {
        if (!ticking) { ticking = true; requestAnimationFrame(update); }
    }, { passive: true });
    onLayout(measure);
})();
