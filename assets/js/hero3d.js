/* ==========================================================================
   hero3d.js — 3-D motion for the hero headline ("i am Atul Rathod")

   Enhances the CSS-first headline defined in index.html / style.css:
     1. typing    — TYPES the headline out, glyph by glyph. Once the title is in
                    view (IntersectionObserver, with a timed fallback) the loop
                    adds `.hero-3d__l--typed` to each of the 17 glyphs in
                    sequence at a believable cadence (a beat after every space,
                    a longer one at the start of a new line), which is what
                    starts that character's own 3-D entrance stamp
                    (hero-3d-type-in). CHARACTERS ONLY: there is deliberately no
                    caret / typing bar - the loop reveals glyphs and nothing else.
     2. entrance  — the same `.hero-3d-in` class also starts the per-WORD
                    gather, the idle float / wave and the gradient sheen, which
                    take over once the typing has landed.
     3. depth     — adds `.hero-3d-live` and eases the CSS custom properties
                    --hero-rx / --hero-ry / --hero-mx / --hero-my / --hero-mz
                    toward the pointer position over the hero section, so the
                    headline tilts in 3-D and each word parallaxes by its --d
                    depth token, with every LETTER parallaxing ~3x deeper on
                    top of its word. A rAF loop with inertia; it parks itself
                    when the motion settles instead of burning frames forever.

   The letter spans themselves are authored in index.html (no JS generation), so
   the headline is fully readable - and fully spaced - with JavaScript off.

   Guarantees
     - ES5 IIFE, no dependencies beyond window/document.
     - Bails out early (no errors) when the hero markup is missing.
     - prefers-reduced-motion AND `?motion=reduce` / `#motion=reduce` (same gate
       astra3d.js / parallax3d.js use) -> no entrance classes, no typing timers,
       no caret, no rAF loop, no listeners: the headline renders statically.
     - `?speed=N` (N>0) divides every typing beat, so an automated run can watch
       a whole pass quickly; the same URL flag drives a debug clock elsewhere.
     - Observation hooks (read-only attributes on #welcome-hero, nothing styles
       from them): data-hero3d-letters, -mode (live|static), -entrance, -reveal,
       -depth, -typed (glyphs written so far), -state (idle|typing|typing-done|
       wave) and -caret (always 'off': the typing draws characters only).
     - Never touches `.hero-cta` links: the pointer listeners sit on the SECTION
       (no preventDefault), and no hover transform is added to `.header-text a`
       (hero buttons must not move on hover).
     - Does not listen to touch pointers, so mobile scrolling stays smooth.
     - Every animated property is transform / opacity / filter / background-
       position: no layout box ever changes, the CTA row below never moves.
   ========================================================================== */
(function () {
    'use strict';

    var hero = document.getElementById('welcome-hero');
    if (!hero) { return; }

    var header = hero.querySelector('.header-text');
    var title = header ? header.querySelector('.hero-title') : null;
    if (!header || !title) { return; }

    /* --------------------------------------------------------------------
       Reduced-motion gate (identical to astra3d.js)
    -------------------------------------------------------------------- */
    var forceReduce = /[?&]motion=reduce(&|$)/.test(window.location.search) ||
        /motion=reduce/.test(window.location.hash);
    var mq = window.matchMedia ? window.matchMedia('(prefers-reduced-motion: reduce)') : null;
    var reduced = forceReduce || !!(mq && mq.matches);

    /* Pure observation hook: lets a headless run read the real runtime state
       straight from the DOM (no styling depends on these attributes). */
    function signal(key, value) {
        try { hero.setAttribute('data-hero3d-' + key, String(value)); } catch (e) { /* noop */ }
    }
    function addClass(el, cls) {
        if ((' ' + el.className + ' ').indexOf(' ' + cls + ' ') === -1) { el.className += ' ' + cls; }
    }
    function stripClasses(el, kill) {
        var parts = String(el.className || '').split(/\s+/);
        var out = [];
        for (var i = 0; i < parts.length; i++) {
            if (parts[i] && kill.indexOf(parts[i]) === -1) { out.push(parts[i]); }
        }
        el.className = out.join(' ');
    }

    /* The per-letter spans are authored in index.html (17 glyphs for
       "hi , i am Atul Rathod ."); the CSS animates them by their --j index.
       Published purely as an observation hook so a headless run can assert the
       letter layer is present - no styling depends on it. */
    signal('letters', title.querySelectorAll('.hero-3d__l').length);

    if (reduced) {
        addClass(header, 'hero-3d-static');
        signal('mode', 'static');
        return;
    }

    addClass(header, 'hero-3d-live');
    signal('mode', 'live');
    /* pre-typing state, so a headless run can tell "not started yet" from
       "typing" without guessing from a timer */
    signal('typed', 0);
    signal('state', 'idle');
    signal('caret', 'off');

    /* --------------------------------------------------------------------
       0. Release the template's legacy reveal on this same <h2>
       custom.js §5 ("welcome animation support") runs on window.load and adds
       `animated fadeInUp` to `.header-text h2` plus an inline `opacity: 0`.
       animate.css then PINS `transform: translate3d(0,0,0)` on the element
       (`.animated { animation-fill-mode: both }`), and a filled animation beats
       every authored declaration - so the pointer tilt below would silently
       never apply, and fadeInUp's translate would fight the word flip-rise.
       custom.js registers its load handlers before this file, so our load
       handler runs last: strip the classes and clear the inline opacity, with
       a delayed second pass in case anything re-adds them.
    -------------------------------------------------------------------- */
    function releaseLegacyReveal() {
        stripClasses(title, ['animated', 'fadeInUp']);
        addClass(title, 'hero-3d__stage');
        if (title.style && title.style.opacity) { title.style.opacity = ''; }
        signal('reveal', 'hero3d');
    }
    if (document.readyState === 'complete') {
        releaseLegacyReveal();
    } else {
        window.addEventListener('load', releaseLegacyReveal, false);
    }

    /* --------------------------------------------------------------------
       1. Typed reveal — the headline types itself out, glyph by glyph
       Driving the reveal from a timer loop (instead of one long CSS delay list
       per letter) is what makes it read as TYPING: the loop can take a beat
       after every space and hold longer at the start of a new line. Each glyph
       is revealed by adding
       `.hero-3d__l--typed` - the class the CSS keys the per-character 3-D
       entrance (`hero-3d-type-in`) off - so the stamp itself stays pure CSS,
       started at exactly the moment that character is written.
    -------------------------------------------------------------------- */
    var letters = title.querySelectorAll('.hero-3d__l');
    var glyphCount = letters.length;

    /* The cadence lives in the CSS tokens (style.css / responsive.css), so the
       phone breakpoint re-times the typing without duplicating the schedule
       here. `?speed=N` divides every beat (N=4 types four times faster), the
       same URL-flag idea as the ?motion gate, so an automated run can watch a
       whole pass quickly. */
    var speedMatch = /[?&]speed=([0-9]*\.?[0-9]+)/.exec(window.location.search);
    var speed = speedMatch ? parseFloat(speedMatch[1]) : 1;
    if (!(speed > 0)) { speed = 1; }

    function tokenMs(name, fallback) {
        var raw = '';
        try {
            raw = window.getComputedStyle(title).getPropertyValue(name) || '';
        } catch (e) { raw = ''; }
        var value = parseFloat(raw);
        if (isNaN(value)) { return fallback; }
        if (/s\s*$/.test(raw) && !/ms\s*$/.test(raw)) { value *= 1000; }  /* "1.2s" */
        return value;
    }

    var tStep = tokenMs('--tl-step', 78) / speed;          /* per glyph           */
    var tLead = tokenMs('--tl-in-delay', 220) / speed;     /* before glyph 1      */
    var tWord = tokenMs('--tl-pause-word', 150) / speed;   /* across a space      */
    var tLine = tokenMs('--tl-pause-line', 260) / speed;   /* new line (<br>)     */
    var tWaveGap = tokenMs('--tl-wave-gap', 1080);

    /* the `.hero-3d__w` wrapper a glyph belongs to (word-boundary test) */
    function wordOf(el) {
        var node = el;
        while (node && node !== title) {
            if ((' ' + node.className + ' ').indexOf(' hero-3d__w ') !== -1) { return node; }
            node = node.parentNode;
        }
        return null;
    }

    /* The beat before glyph k: the typing cadence, plus a longer pause after a
       space / at a word boundary, plus a longer one still when the glyph starts
       a new line. offsetTop is transform-immune, so it identifies the line
       reliably even while the glyphs either side are mid-flip - which also
       means the beats follow whatever line the headline actually wraps into. */
    function beatBefore(k) {
        var prev = letters[k - 1];
        var next = letters[k];
        var beat = tStep;
        var sibling = prev.nextSibling;
        var spaced = !!(sibling && sibling.nodeType === 3 &&
            /\s/.test(sibling.nodeValue || ''));
        if (spaced || wordOf(prev) !== wordOf(next)) { beat += tWord; }
        if (prev.offsetTop !== next.offsetTop) { beat += tLine; }
        return beat;
    }

    /* ---- no caret / typing bar (by design) -------------------------------
       An insertion bar over the name is explicitly NOT wanted: "keep only
       charector, do not add bar while typing animation". The live path
       therefore creates no caret node at all - the glyph-by-glyph reveal is
       the whole animation - and the -caret hook is pinned to 'off'. The
       `.hero-3d__caret` CSS rules are gone from style.css with it. */

    /* ---- the typing loop ------------------------------------------------- */
    var typing = false, typedCount = 0, typedDone = false, typedPaused = false;
    var typeTimer = 0, watchdog = 0;

    function arm(ms) {
        if (typeTimer) { window.clearTimeout(typeTimer); }
        typeTimer = window.setTimeout(typeGlyph, ms);
    }

    function typeGlyph() {
        typeTimer = 0;
        if (document.hidden) { typedPaused = true; return; }   /* resume on show */
        if (typedCount >= glyphCount) { finishTyping(); return; }
        var el = letters[typedCount];
        addClass(el, 'hero-3d__l--typed');    /* starts this glyph's 3-D stamp */
        typedCount++;
        signal('typed', typedCount);
        if (typedCount >= glyphCount) { finishTyping(); return; }
        arm(beatBefore(typedCount));
    }

    function finishTyping() {
        if (typedDone) { return; }
        typedDone = true;
        signal('typed', glyphCount);
        signal('state', 'typing-done');
        /* no blink / fade step: nothing but the characters was ever drawn */
        /* the last glyph's idle wave starts --tl-wave-gap after it was typed;
           publish that hand-over so a headless run can observe it */
        window.setTimeout(function () { signal('state', 'wave'); }, tWaveGap);
    }

    /* Deadline: a stalled loop (a throttled timer, an exotic browser) must never
       leave the headline half written - force the remaining glyphs in. */
    function forceComplete() {
        if (typedDone) { return; }
        if (typeTimer) { window.clearTimeout(typeTimer); typeTimer = 0; }
        while (typedCount < glyphCount) {
            addClass(letters[typedCount], 'hero-3d__l--typed');
            typedCount++;
        }
        finishTyping();
    }

    function typingDuration() {
        var total = tLead;
        for (var k = 1; k < glyphCount; k++) { total += beatBefore(k); }
        return total;
    }

    function startTyping() {
        if (typing || !glyphCount) { return; }
        typing = true;
        signal('typed', 0);
        signal('state', 'typing');
        arm(tLead);
        watchdog = window.setTimeout(forceComplete, typingDuration() * 1.8 + 2500);
    }

    /* --------------------------------------------------------------------
       2. Entrance — reveal once, when the headline is (or becomes) visible.
       This also starts the typing above: without it the headline is plain,
       fully readable, static text (JS off) rather than 17 hidden glyphs.
    -------------------------------------------------------------------- */
    var played = false;
    function play() {
        if (played) { return; }
        played = true;
        addClass(header, 'hero-3d-in');
        signal('entrance', 'played');
        startTyping();
    }

    if (window.IntersectionObserver) {
        var io = new window.IntersectionObserver(function (entries) {
            for (var i = 0; i < entries.length; i++) {
                if (entries[i].isIntersecting) {
                    play();
                    try { io.disconnect(); } catch (e) { /* noop */ }
                    return;
                }
            }
        }, { threshold: 0.2 });

        try { io.observe(title); } catch (e) { play(); }
    } else {
        play();
    }
    /* Safety net: the words must never stay hidden if the observer never fires
       (a stale layout, an exotic browser). Without `.hero-3d-in` there is no
       animation at all, i.e. plain visible text - so this is belt and braces.
       It also re-runs the legacy-reveal release, in case a late script put
       `animated fadeInUp` / inline opacity back on the <h2>. */
    window.setTimeout(function () {
        releaseLegacyReveal();
        play();
    }, 2500);

    /* --------------------------------------------------------------------
       3. Pointer depth — inertial tilt on the <h2> + per-word parallax
    -------------------------------------------------------------------- */
    var MAX_RX = 6;      /* deg, up/down tilt   */
    var MAX_RY = 9;      /* deg, left/right tilt */
    var EASE = 0.13;     /* per-frame easing    */
    var EPS = 0.02;      /* settle threshold    */

    var tRX = 0, tRY = 0, tMX = 0, tMY = 0, tMZ = 0;   /* targets  */
    var cRX = 0, cRY = 0, cMX = 0, cMY = 0, cMZ = 0;   /* eased    */
    var rafId = 0;
    var inView = true;
    var hasVar = !!(header.style && header.style.setProperty);
    if (!hasVar) { return; }

    function write() {
        header.style.setProperty('--hero-rx', cRX.toFixed(3) + 'deg');
        header.style.setProperty('--hero-ry', cRY.toFixed(3) + 'deg');
        header.style.setProperty('--hero-mx', cMX.toFixed(3));
        header.style.setProperty('--hero-my', cMY.toFixed(3));
        header.style.setProperty('--hero-mz', cMZ.toFixed(3));
    }

    function step() {
        rafId = 0;
        cRX += (tRX - cRX) * EASE;
        cRY += (tRY - cRY) * EASE;
        cMX += (tMX - cMX) * EASE;
        cMY += (tMY - cMY) * EASE;
        cMZ += (tMZ - cMZ) * EASE;

        var settled =
            Math.abs(tRX - cRX) < EPS && Math.abs(tRY - cRY) < EPS &&
            Math.abs(tMX - cMX) < EPS && Math.abs(tMY - cMY) < EPS &&
            Math.abs(tMZ - cMZ) < EPS;

        if (settled) {                                  /* park the loop */
            cRX = tRX; cRY = tRY; cMX = tMX; cMY = tMY; cMZ = tMZ;
        }
        write();
        if (!settled) { start(); }
    }

    function start() {
        if (rafId || !inView || document.hidden) { return; }
        rafId = window.requestAnimationFrame(step);
    }

    function onMove(e) {
        if (e.pointerType === 'touch') { return; }        /* no jank while scrolling */
        var r = hero.getBoundingClientRect();
        if (!r.width || !r.height) { return; }

        var px = (e.clientX - r.left) / r.width;          /* 0..1 across the hero */
        var py = (e.clientY - r.top) / r.height;
        px = px < 0 ? 0 : (px > 1 ? 1 : px);
        py = py < 0 ? 0 : (py > 1 ? 1 : py);

        tRX = (0.5 - py) * MAX_RX * 2;                    /* pointer high -> lean back */
        tRY = (px - 0.5) * MAX_RY * 2;
        tMX = (0.5 - px) * 16;                            /* depth parallax, in px */
        tMY = (0.5 - py) * 12;
        tMZ = (0.5 - py) * 18;
        start();
    }

    function onLeave() {
        tRX = 0; tRY = 0; tMX = 0; tMY = 0; tMZ = 0;      /* ease smoothly back home */
        start();
    }

    function onVisibility() {
        if (document.hidden) {
            if (rafId) { window.cancelAnimationFrame(rafId); rafId = 0; }
            /* pause the typing too: a glyph written while the tab is hidden would
               burn its entrance where nobody can see it. It resumes from the
               same glyph on show. */
            if (!typedDone && typeTimer) {
                window.clearTimeout(typeTimer);
                typeTimer = 0;
                typedPaused = true;
            }
        } else {
            if (typedPaused && !typedDone) { typedPaused = false; arm(tStep); }
            start();
        }
    }

    var moveEvent = window.PointerEvent ? 'pointermove' : 'mousemove';
    var leaveEvent = window.PointerEvent ? 'pointerleave' : 'mouseleave';
    hero.addEventListener(moveEvent, onMove, false);
    hero.addEventListener(leaveEvent, onLeave, false);
    document.addEventListener('visibilitychange', onVisibility, false);

    /* stop tilting while the hero is scrolled out of view */
    if (window.IntersectionObserver) {
        var vio = new window.IntersectionObserver(function (entries) {
            for (var i = 0; i < entries.length; i++) {
                inView = !!entries[i].isIntersecting;
            }
            if (inView) { start(); }
        }, { threshold: 0 });
        try { vio.observe(hero); } catch (e) { /* noop */ }
    }

    write();                                             /* publish the 0-state */
    signal('depth', 'ready');
}());
