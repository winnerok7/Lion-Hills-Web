// ---------- Media loading ----------
// Everything below the hero has data-src instead of src (data-src-mobile, if set, wins on mobile). Order:
// 1) critical, loaded while the loader runs (its line/% show the real progress):
//    fonts + hero photo (preloaded in <head>) + [data-load="critical"] (first screens after the hero)
// 2) queue: [data-load="queue"] one by one in page order (first slide of the other sliders, build2)
// 3) the rest: gallery/carousel slides once their block is about a screen away; stories load current + next slide
// On mobile data-load-mobile overrides data-load: critical is only fonts + hero photo (iOS doesn't buffer
// videos that aren't playing, so the loader would hang on them), and the rest waits for the loader to end

var CRITICAL_MAX = 15000; // ms, on a slow connection the loader gives up waiting after this
var isMobile = window.matchMedia('(max-width: 767px)').matches;

// menu anchors: Lenis glide on desktop (under the top pill); native smooth scroll on mobile,
// where the page has CSS scroll-snap on the villas and Lenis' frame-by-frame scrolling would snag on it
function goTo(target) {
    if (window.innerWidth <= 767) {
        window.scrollTo({ top: target.getBoundingClientRect().top + window.scrollY - 20, behavior: 'smooth' });
    } else if (window.lenis) {
        window.lenis.scrollTo(target, { offset: -110 });
    } else {
        target.scrollIntoView({ behavior: 'smooth' });
    }
}

// [data-load] elements of one group, in page order
function loadGroup(name) {
    return Array.prototype.filter.call(document.querySelectorAll('[data-load]'), function (el) {
        var group = isMobile && el.getAttribute('data-load-mobile') || el.getAttribute('data-load');
        return group === name;
    });
}

// data-src-mobile: a separate (vertical / lighter) file for phones
function loadMedia(el) {
    var src = el && el.getAttribute('data-src');
    if (!src) return;
    if (isMobile && el.hasAttribute('data-src-mobile')) src = el.getAttribute('data-src-mobile');
    el.removeAttribute('data-src');
    el.src = src;
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
        if (el.tagName === 'VIDEO') {
            if (el.readyState >= 4) return done();
            el.addEventListener('canplaythrough', done, { once: true });
        } else {
            if (el.complete && el.naturalWidth) return done();
            el.addEventListener('load', done, { once: true });
        }
    });
}

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

    // all at once, in parallel with the hero; a video counts by how much of it is buffered;
    // images are decoded up front too, so big ones (villa covers) don't stutter when scrolled to
    loadGroup('critical').forEach(function (el) {
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
        var queue = loadGroup('queue');
        (function next() {
            var el = queue.shift();
            if (!el) return;
            if (el.tagName === 'VIDEO') el.preload = 'auto';
            loadMedia(el); // no-op if a block already pulled it in
            whenLoaded(el).then(next);
        })();
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
    loaderDone.then(function () {
        // a carousel is watched by its track: .lots .carousel is display: contents on mobile, no box to observe
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

        // no "next" on the last slide (the tabs still go anywhere)
        var last = nextIndex() === null;
        next.classList.toggle('is-hidden', last);
        if (more) more.classList.toggle('is-hidden', last);

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

    function step() {
        var card = track.querySelector('.carousel_card');
        return card.getBoundingClientRect().width + 20;
    }

    function update() {
        prev.disabled = track.scrollLeft <= 1;
        next.disabled = track.scrollLeft + track.clientWidth >= track.scrollWidth - 1;
    }

    prev.addEventListener('click', function () { track.scrollBy({ left: -step(), behavior: 'smooth' }); });
    next.addEventListener('click', function () { track.scrollBy({ left: step(), behavior: 'smooth' }); });
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
        prev.hidden = current === 0;
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
            var queue = Array.prototype.slice.call(document.querySelectorAll('.types .stories [data-src]'));
            (function next() {
                var el = queue.shift();
                if (!el) return;
                if (el.tagName === 'VIDEO') el.preload = 'auto';
                loadMedia(el); // no-op if the slider already pulled it in
                whenLoaded(el).then(next);
            })();
        });
    }, { rootMargin: '100% 0px' });
    obs.observe(first);
})();

// Pill header: shows up once the hero has scrolled out of view, expands into the menu
(function () {
    var bar = document.querySelector('.sticky_header');
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

// Floorplan download pill: stays on from the first villa banner through the last one
(function () {
    var link = document.querySelector('.plan_download');
    var villas = document.querySelectorAll('.types .stories');
    if (!link || !villas.length) return;

    var first = villas[0];
    var last = villas[villas.length - 1];
    var ticking = false;

    function update() {
        ticking = false;
        var vh = window.innerHeight;
        // first banner has (almost) filled the screen and the last one hasn't left it yet
        var show = first.getBoundingClientRect().top <= vh * 0.15 &&
                   last.getBoundingClientRect().bottom >= vh * 0.85;
        if (show === link.classList.contains('is-visible')) return;
        link.classList.toggle('is-visible', show);
        link.setAttribute('aria-hidden', show ? 'false' : 'true');
        link.tabIndex = show ? 0 : -1;
    }

    window.addEventListener('scroll', function () {
        if (!ticking) { ticking = true; requestAnimationFrame(update); }
    }, { passive: true });
    window.addEventListener('resize', update);
    update();
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

// Footer form: no backend yet, so just acknowledge the request
document.querySelectorAll('.footer_form').forEach(function (form) {
    form.addEventListener('submit', function (e) {
        e.preventDefault();
        form.querySelector('.footer_submit').textContent = 'Дякуємо!';
        form.reset();
    });
});

// Header veil: match the color of whatever is under the pill's edge (white card vs dark sections);
// top edge on desktop, bottom edge on mobile where the pill floats at the bottom
(function () {
    var fade = document.querySelector('.sticky_fade');
    if (!fade || !document.elementsFromPoint) return;

    var SKIP = '.sticky_header, .sticky_fade, .drawer, .plan_download';
    var ticking = false;

    function update() {
        ticking = false;
        var y = window.innerWidth <= 767 ? window.innerHeight - 2 : 2;
        var stack = document.elementsFromPoint(window.innerWidth / 2, y);
        var el = null;
        for (var i = 0; i < stack.length; i++) {
            if (!stack[i].closest(SKIP)) { el = stack[i]; break; }
        }
        // dark only over the two dark screens (infrastructure, autonomy), white everywhere else
        fade.classList.toggle('is-dark', !!(el && el.closest('.clubhouse')));
    }

    window.addEventListener('scroll', function () {
        if (!ticking) { ticking = true; requestAnimationFrame(update); }
    }, { passive: true });
    window.addEventListener('resize', update);
    update();
})();
