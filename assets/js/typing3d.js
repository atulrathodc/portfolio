/* ==========================================================================
   typing3d.js — a REAL Three.js (WebGL) CHARACTER TYPING animation for the
   hero headline ("i am Atul Rathod")

   Scene
     - A dedicated WebGL scene (vendored assets/js/three.min.js r128 — no build
       step, no module system, no addons, no font loader, no network) rendered
       into a canvas that is laid EXACTLY over the hero <h2>, so the typed name
       lands on the DOM headline's own box.
     - Every glyph of "hi , i am Atul Rathod ." is its own THREE.Mesh: a
       PlaneGeometry carrying a THREE.CanvasTexture drawn offscreen from the
       SAME computed font the DOM uses. THREE has no text primitive, and an
       offscreen 2-D canvas per glyph is the only honest way to get real type
       into WebGL without a font asset to download: it works offline/static and
       the glyphs are genuine framed 3-D meshes (rotate/scale/translateZ), not a
       CSS filter.
     - The camera is a THREE.PerspectiveCamera whose distance is derived from the
       canvas height, so 1 world unit == 1 CSS pixel at z = 0 while translateZ
       still changes scale: the stamp really drops in from the depth plane.
     - Characters only, by design: no caret, no insertion bar, no cursor. The
       WebGL layer draws glyph meshes and nothing else (the live path never
       creates a caret mesh, and the -caret hook is pinned to 'off').
     - Per-glyph idle float + pointer parallax (eased, inertial) keep the typed
       name alive in 3-D after the typing has landed.

   Behaviour
     - The typing is DRIVEN BY THE EXISTING PROTOCOL, not a copy of it: hero3d.js
       types the semantic headline by adding `.hero-3d__l--typed` glyph by glyph
       (and publishes `data-hero3d-*` hooks). This file observes those class
       changes and stamps the matching WebGL glyph in the same tick, so the CSS
       layer and the WebGL layer are never out of phase. If hero3d.js is absent
       or its loop stalls, the watchdog below takes the typing over itself
       (adding the same documented `hero-3d-in` / `.hero-3d__l--typed` classes).
     - While the WebGL layer paints, the CSS glyphs are held invisible with
       OPACITY ONLY (`.typing3d-active` on the <h2>): every layout box - the
       headline, the copy under it, the CTA row - stays exactly where it was.
       The instant the WebGL layer stops for ANY reason (context loss, renderer
       error, window.TYPING3D.handover()), the class is dropped and the canvas
       removed, so the CSS/hero3d.js headline takes the hero straight back.

   Guarantees
     - ES5 IIFE, no dependencies beyond window/document/THREE.
     - Bails out early (no errors, no canvas, no WebGL context) when the hero
       markup, window.THREE or a WebGL context is missing.
     - prefers-reduced-motion AND `?motion=reduce` / `#motion=reduce` (the same
       gate as hero3d.js / astra3d.js / parallax3d.js) -> no canvas at all: the
       headline simply renders statically as DOM text.
     - `?three=off` forces that CSS-only path on any device.
     - `?speed=N` (N>0) divides every WebGL beat as well as the DOM cadence, so
       an automated run can watch a whole pass quickly (same flag hero3d.js has).
     - The canvas is pointer-events:none and aria-hidden, so nothing becomes
       clickable/selectable through it and assistive tech reads the real <h2>
       (aria-label) and never the decoration.
     - Never touches `.hero-cta`: the pointer listeners sit on the SECTION
       (no preventDefault) and no hover transform is added to the links, so the
       hero buttons must not move on hover.
     - Every animated value is a transform / opacity inside the drawing buffer:
       the page never reflows, and no rAF loop runs while the hero is out of
       view or the tab is hidden.
     - Observation hooks (read-only attributes on #welcome-hero, nothing styles
       from them): data-typing3d-mode (off|static|live|handover), -state
       (ready|typing|typed|idle), -glyphs, -typed, -frames, -ink (non-transparent
       pixels the GPU actually painted, sampled with gl.readPixels straight after
       render), -caret (always 'off' - the animation draws characters only),
       -drive (dom|self), -canvas (yes|no),
       -size (WxH), -reason.
     - window.TYPING3D exposes the same state plus handover(reason) so a QA run
       can exercise the CSS fallback deterministically.
   ========================================================================== */
(function () {
    'use strict';

    var hero = document.getElementById('welcome-hero');
    if (!hero) { return; }
    var header = hero.querySelector('.header-text');
    if (!header) { return; }
    var title = header.querySelector('.hero-title');
    if (!title) { return; }

    var letters = title.querySelectorAll('.hero-3d__l');
    var GLYPHS = letters.length;

    /* --------------------------------------------------------------------
       Observation hooks (identical idea to astra3d.js / hero3d.js)
    -------------------------------------------------------------------- */
    function signal(key, value) {
        try { hero.setAttribute('data-typing3d-' + key, String(value)); } catch (e) { /* noop */ }
    }
    function addClass(el, cls) {
        if ((' ' + el.className + ' ').indexOf(' ' + cls + ' ') === -1) { el.className += ' ' + cls; }
    }
    function delClass(el, cls) {
        var parts = String(el.className || '').split(/\s+/);
        var out = [];
        for (var i = 0; i < parts.length; i++) {
            if (parts[i] && parts[i] !== cls) { out.push(parts[i]); }
        }
        el.className = out.join(' ');
    }
    function hasClass(el, cls) {
        return !!el && (' ' + el.className + ' ').indexOf(' ' + cls + ' ') !== -1;
    }
    function now() {
        return (window.performance && window.performance.now) ? window.performance.now() : Date.now();
    }

    signal('glyphs', GLYPHS);
    if (!GLYPHS) { signal('mode', 'off'); signal('reason', 'no-glyphs'); return; }

    /* --------------------------------------------------------------------
       0. Gates — exactly the same switches the rest of the hero uses
    -------------------------------------------------------------------- */
    var search = window.location.search || '';
    var hash = window.location.hash || '';
    var forceReduce = /[?&]motion=reduce(&|$)/.test(search) || /motion=reduce/.test(hash);
    var mq = window.matchMedia ? window.matchMedia('(prefers-reduced-motion: reduce)') : null;
    var reduced = forceReduce || !!(mq && mq.matches);
    var threeOff = /[?&]three=off(&|$)/.test(search);

    if (reduced) {
        /* No WebGL at all on this path: the DOM headline stays fully readable and
           static (hero3d.js bails out the same way, and the reduced-motion block
           in style.css pins the glyphs opaque). */
        signal('mode', 'static');
        signal('canvas', 'no');
        signal('state', 'static');
        return;
    }
    if (threeOff) {
        signal('mode', 'off');
        signal('canvas', 'no');
        signal('reason', 'three-off');
        signal('state', 'ready');
        return;
    }
    if (!window.THREE) {
        signal('mode', 'off');
        signal('canvas', 'no');
        signal('reason', 'no-three');
        signal('state', 'ready');
        return;
    }

    function webglAvailable() {
        try {
            var c = document.createElement('canvas');
            var ctx = c.getContext('webgl') || c.getContext('experimental-webgl');
            if (!ctx || !window.WebGLRenderingContext) { return false; }
            return true;
        } catch (e) { return false; }
    }
    if (!webglAvailable()) {
        signal('mode', 'off');
        signal('canvas', 'no');
        signal('reason', 'no-webgl');
        signal('state', 'ready');
        return;
    }

    /* `?speed=N` divides every beat, the same URL flag hero3d.js honours. */
    var speedMatch = /[?&]speed=([0-9]*\.?[0-9]+)/.exec(search);
    var speed = speedMatch ? parseFloat(speedMatch[1]) : 1;
    if (!(speed > 0)) { speed = 1; }
    if (speed > 8) { speed = 8; }
    function fast(ms) { return ms / speed; }

    /* --------------------------------------------------------------------
       1. Motion tokens (authored in style.css / responsive.css, read here)
       Keeping the timing in CSS is what lets the phone breakpoint re-time the
       WebGL typing by overriding a few values - no schedule duplicated in JS.
    -------------------------------------------------------------------- */
    function tokenMs(name, fallback) {
        var raw = '';
        try { raw = window.getComputedStyle(header).getPropertyValue(name) || ''; } catch (e) { raw = ''; }
        var value = parseFloat(raw);
        if (isNaN(value)) { return fallback; }
        if (/s\s*$/.test(raw) && !/ms\s*$/.test(raw)) { value *= 1000; }   /* "1.2s" */
        return value;
    }
    function tokenNum(name, fallback) {
        var raw = '';
        try { raw = window.getComputedStyle(header).getPropertyValue(name) || ''; } catch (e) { raw = ''; }
        var value = parseFloat(raw);
        return isNaN(value) ? fallback : value;
    }
    function readTokens() {
        return {
            stamp: fast(tokenMs('--t3d-stamp', 440)),          /* per-glyph entrance  */
            float: tokenMs('--t3d-float', 5200),               /* idle float period   */
            lift: tokenNum('--t3d-lift', 140),                 /* depth drop-in (px)  */
            depth: tokenNum('--t3d-depth', 1),                 /* parallax amplitude  */
            /* settle beat before the hero drops to the idle state */
            rest: fast(tokenMs('--t3d-caret-hold', tokenMs('--tl-caret-rest', 3400))),
            step: fast(tokenMs('--tl-step', 78)),              /* self-drive only     */
            lead: fast(tokenMs('--tl-in-delay', 220)),
            word: fast(tokenMs('--tl-pause-word', 150)),
            line: fast(tokenMs('--tl-pause-line', 260))
        };
    }
    var TK = readTokens();

    /* --------------------------------------------------------------------
       2. Canvas (created by JS, so with JS off the headline is untouched)
       `.typing3d-host` makes .header-text the positioning context; the canvas
       is then pinned over the <h2> box and painted with alpha, so the only
       thing behind it is the page itself.
    -------------------------------------------------------------------- */
    addClass(header, 'typing3d-host');
    var canvas = document.createElement('canvas');
    canvas.id = 'typing3d-stage';
    canvas.className = 'typing3d-canvas';
    canvas.setAttribute('aria-hidden', 'true');
    header.appendChild(canvas);
    signal('canvas', 'yes');

    var renderer = null;
    try {
        renderer = new THREE.WebGLRenderer({
            canvas: canvas,
            antialias: true,
            alpha: true,
            premultipliedAlpha: true,
            depth: true,
            stencil: false,
            powerPreference: 'high-performance'
        });
        renderer.setClearColor(0x000000, 0);
    } catch (err) {
        renderer = null;
    }
    if (!renderer || !renderer.getContext || !renderer.getContext()) {
        release('renderer-failed');
        return;
    }

    var scene = new THREE.Scene();
    var FOV = 42;
    var camera = new THREE.PerspectiveCamera(FOV, 1, 1, 6000);
    var group = new THREE.Group();               /* held so the pointer can tilt  */
    scene.add(group);

    var W = 1, H = 1, dist = 1;
    var meshes = [];
    var FONT = '';
    var typed = 0, typingDone = false, typingDoneAt = 0;
    var caretSig = 'off';            /* pinned: characters only, never a bar */
    var drive = (hero.getAttribute('data-hero3d-mode') === 'live') ? 'dom' : 'self';
    var running = false, rafId = 0, frames = 0, inkMax = 0;
    var active = false, onScreen = true;
    var ptrX = 0, ptrY = 0, easeX = 0, easeY = 0, rotX = 0, rotY = 0;
    var pollId = 0, mo = null, watchId = 0;
    var released = false;

    /* --------------------------------------------------------------------
       3. Text -> texture (the honest part: THREE has no text primitive)
    -------------------------------------------------------------------- */
    function fontCSS() {
        var cs = window.getComputedStyle(title);
        var size = parseFloat(cs.fontSize) || 48;
        var family = cs.fontFamily || 'sans-serif';
        var weight = cs.fontWeight || '700';
        var style = cs.fontStyle || 'normal';
        return { size: size, css: style + ' ' + weight + ' ' + size + 'px ' + family };
    }

    /* the aurora-lit glyphs (the punctuation accents and the name), so a canvas
       glyph carries the same paint the CSS layer gives `.hero-3d__in--name` */
    var AURORA = ['#67e8f9', '#22d3ee', '#ecfeff', '#a78bfa', '#8b5cf6', '#d946ef'];
    function litOf(el) {
        var node = el;
        while (node && node !== title) {
            if (hasClass(node, 'hero-3d__in--name') || hasClass(node, 'hero-3d__in--accent')) { return true; }
            node = node.parentNode;
        }
        return false;
    }
    /* the word's authored --d depth token (same one the CSS parallax uses) */
    function depthOf(el) {
        var node = el;
        while (node && node !== title) {
            if (hasClass(node, 'hero-3d__w')) {
                var raw = '';
                try { raw = node.style.getPropertyValue('--d'); } catch (e) { raw = ''; }
                var v = parseFloat(raw);
                return isNaN(v) ? 1 : v;
            }
            node = node.parentNode;
        }
        return 1;
    }
    function wordOf(el) {
        var node = el;
        while (node && node !== title) {
            if (hasClass(node, 'hero-3d__w')) { return node; }
            node = node.parentNode;
        }
        return null;
    }

    var DPR = 1;
    function glyphTexture(ch, w, h, lit, font) {
        var padX = Math.ceil(h * 0.30) + 4;          /* room for the flip / italic */
        var padY = Math.ceil(h * 0.34) + 4;
        var tw = Math.max(4, w + padX * 2);
        var th = Math.max(4, h + padY * 2);
        var c = document.createElement('canvas');
        c.width = Math.max(2, Math.ceil(tw * DPR));
        c.height = Math.max(2, Math.ceil(th * DPR));
        var ctx = c.getContext('2d');
        if (!ctx) { return null; }
        ctx.scale(DPR, DPR);
        ctx.textAlign = 'center';
        ctx.textBaseline = 'alphabetic';
        ctx.font = font.css;

        /* The DOM glyph span is an inline-block, i.e. its box IS the font's own
           content box, so the ascent/descent ratio puts the baseline back exactly
           where the browser had it - which is what keeps the WebGL glyphs sitting
           on the same line as the (hidden) DOM glyphs. */
        var m = ctx.measureText(ch);
        var asc = m.fontBoundingBoxAscent;
        var desc = m.fontBoundingBoxDescent;
        if (typeof asc !== 'number' || !asc) { asc = m.actualBoundingBoxAscent || h * 0.78; }
        if (typeof desc !== 'number' || !desc) { desc = m.actualBoundingBoxDescent || h * 0.22; }
        var boxH = (asc + desc) || 1;
        var baseline = padY + asc * (h / boxH);

        if (lit) {
            var grad = ctx.createLinearGradient(padX, padY + h, padX + w, padY);
            for (var i = 0; i < AURORA.length; i++) {
                grad.addColorStop(i / (AURORA.length - 1), AURORA[i]);
            }
            ctx.fillStyle = grad;
            ctx.shadowColor = 'rgba(34, 211, 238, 0.45)';
            ctx.shadowBlur = Math.max(2, h * 0.16);
        } else {
            ctx.fillStyle = '#ffffff';
        }
        ctx.fillText(ch, tw / 2, baseline);

        var tex = new THREE.CanvasTexture(c);
        if (THREE.LinearFilter) { tex.minFilter = THREE.LinearFilter; }
        if (THREE.LinearMipMapLinearFilter) { tex.magFilter = THREE.LinearFilter; }
        tex.generateMipmaps = false;
        tex.needsUpdate = true;
        return { texture: tex, width: tw, height: th };
    }

    /* NOTE: there is deliberately NO caretTexture()/buildCaret() here. The
       animation must show characters only - a typing bar over the name is
       explicitly not wanted - so the live path builds glyph meshes only. */

    /* --------------------------------------------------------------------
       4. Layout — canvas box over the <h2>, one mesh per glyph
    -------------------------------------------------------------------- */
    function layoutCanvas() {
        W = Math.max(1, title.offsetWidth);
        H = Math.max(1, title.offsetHeight);
        DPR = Math.min(window.devicePixelRatio || 1, 2);
        canvas.style.left = title.offsetLeft + 'px';
        canvas.style.top = title.offsetTop + 'px';
        canvas.style.width = W + 'px';
        canvas.style.height = H + 'px';
        renderer.setPixelRatio(DPR);
        renderer.setSize(W, H, false);
        /* distance chosen so that 1 world unit == 1 CSS pixel at z = 0, while a
           translateZ still changes apparent scale (real perspective depth). */
        dist = (H / 2) / Math.tan((FOV * Math.PI / 180) / 2);
        camera.aspect = W / H;
        camera.position.set(0, 0, dist);
        camera.updateProjectionMatrix();
        signal('size', W + 'x' + H);
    }

    function disposeGlyphs() {
        for (var i = 0; i < meshes.length; i++) {
            var mesh = meshes[i];
            if (!mesh) { continue; }
            try {
                if (mesh.geometry) { mesh.geometry.dispose(); }
                if (mesh.material) { if (mesh.material.map) { mesh.material.map.dispose(); } mesh.material.dispose(); }
                group.remove(mesh);
            } catch (e) { /* noop */ }
        }
        meshes = [];
        typed = 0;
        /* NOTE: the `.hero-3d__l--typed` classes are the DOM headline's own state
           (hero3d.js owns them) - they are deliberately NOT stripped here, so the
           rebuild below can re-stamp every glyph that has already been written
           and the headline can never go blank across a resize. */
    }

    function placeGlyph(mesh) {
        var d = mesh.userData;
        var el = d.el;
        var w = d.w, h = d.h;
        var cx = el.offsetLeft + w / 2;
        var cy = el.offsetTop + h / 2;
        d.base.x = cx - W / 2;
        d.base.y = H / 2 - cy;
        mesh.position.set(d.base.x, d.base.y, 0);
    }

    function buildGlyphs() {
        var font = fontCSS();
        FONT = font.css;
        for (var i = 0; i < GLYPHS; i++) {
            var el = letters[i];
            var w = Math.max(2, el.offsetWidth);
            var h = Math.max(2, el.offsetHeight);
            var g = glyphTexture(el.textContent, w, h, litOf(el), font);
            if (!g) { continue; }
            var geo = new THREE.PlaneGeometry(g.width, g.height);
            var mat = new THREE.MeshBasicMaterial({
                map: g.texture,
                transparent: true,
                side: THREE.FrontSide,
                depthTest: false,
                depthWrite: false,
                opacity: 0
            });
            var mesh = new THREE.Mesh(geo, mat);
            mesh.visible = false;
            mesh.renderOrder = i + 1;
            mesh.userData = {
                idx: i,
                el: el,
                w: w,
                h: h,
                typed: false,
                t0: 0,
                depth: depthOf(el),
                base: { x: 0, y: 0 },
                pan: 0
            };
            group.add(mesh);
            meshes[i] = mesh;
            placeGlyph(mesh);
        }
    }

    /* --------------------------------------------------------------------
       5. The type-in: keyed to the same beats as the CSS hero-3d-type-in
          keyframes, so both layers read as one gesture at a hand-over.
          Reference z values are for a 140px drop-in and are scaled by --t3d-lift.
    -------------------------------------------------------------------- */
    var KEYS = [
        /* p     opacity scale  y(px)  z(px)   rotX(deg) rotY(deg) */
        [0.00, 0.0, 0.62, 8, -140, -58, -70],
        [0.55, 1.0, 0.86, 2, -50, -18, -22],
        [0.76, 1.0, 1.07, -2, 16, 9, 7],
        [1.00, 1.0, 1.00, 0, 0, 0, 0]
    ];
    function lerp(a, b, t) { return a + (b - a) * t; }
    function poseAt(p) {
        var i = 1;
        while (i < KEYS.length - 1 && p > KEYS[i][0]) { i++; }
        var a = KEYS[i - 1], b = KEYS[i];
        var span = (b[0] - a[0]) || 1;
        var t = (p - a[0]) / span;
        t = t < 0 ? 0 : (t > 1 ? 1 : t);
        t = t * t * (3 - 2 * t);                              /* smoothstep */
        return {
            o: lerp(a[1], b[1], t),
            s: lerp(a[2], b[2], t),
            y: lerp(a[3], b[3], t),
            z: lerp(a[4], b[4], t),
            rx: lerp(a[5], b[5], t),
            ry: lerp(a[6], b[6], t)
        };
    }

    /* --------------------------------------------------------------------
       6. Typing — stamped by the DOM protocol (hero3d.js) or self-driven
    -------------------------------------------------------------------- */
    function activate() {
        if (active) { return; }
        active = true;
        addClass(title, 'typing3d-active');    /* paint-only hide of the CSS glyphs */
        addClass(canvas, 'typing3d-canvas--on');
    }

    function stamp(i) {
        var mesh = meshes[i];
        if (!mesh) { return; }
        var d = mesh.userData;
        if (d.typed) { return; }
        d.typed = true;
        d.t0 = now();
        mesh.visible = true;
        mesh.material.opacity = 0;
        typed++;
        activate();
        if (typed === 1) {
            signal('state', 'typing');
            start();
        }
        signal('typed', typed);
        if (typed >= GLYPHS) { finishTyping(); }
    }

    function finishTyping() {
        if (typingDone) { return; }
        typingDone = true;
        typingDoneAt = now();
        signal('state', 'typed');
        /* characters only: nothing blinks, nothing fades - after a short rest
           the hero simply settles into its idle state */
        window.setTimeout(function () {
            if (typingDone) { signal('state', 'idle'); }
        }, TK.rest);
    }

    function syncFromDom() {
        for (var i = 0; i < GLYPHS; i++) {
            if (meshes[i] && !meshes[i].userData.typed && hasClass(letters[i], 'hero-3d__l--typed')) {
                stamp(i);
            }
        }
    }

    function isLineStart(word) {
        var node = word ? word.previousSibling : null;
        while (node && node.nodeType === 3 && !/\S/.test(node.nodeValue || '')) { node = node.previousSibling; }
        return !!(node && node.nodeName === 'BR');
    }
    function beatFor(i) {
        if (i >= GLYPHS) { return 0; }
        var prev = letters[i - 1], cur = letters[i];
        var beat = 0;
        var sibling = prev.nextSibling;
        var spaced = !!(sibling && sibling.nodeType === 3 && /\s/.test(sibling.nodeValue || ''));
        if (spaced || wordOf(prev) !== wordOf(cur)) {
            beat += TK.word;
            if (isLineStart(wordOf(cur))) { beat += TK.line; }
        }
        return beat;
    }

    /* Self-driven path: only used when hero3d.js is missing or its own typing
       loop never starts. It writes the SAME documented classes, so the CSS layer
       and this scene stay one animation. */
    function selfDrive() {
        if (selfDriveStarted) { return; }
        selfDriveStarted = true;
        drive = 'self';
        signal('drive', 'self');
        addClass(header, 'hero-3d-in');
        signal('state', 'ready');
        var i = 0;
        function nextGlyph() {
            if (i >= GLYPHS) { return; }
            addClass(letters[i], 'hero-3d__l--typed');
            stamp(i);
            i++;
            window.setTimeout(nextGlyph, TK.step + beatFor(i));
        }
        window.setTimeout(nextGlyph, TK.lead);
    }
    var selfDriveStarted = false;

    if (drive === 'dom') {
        signal('drive', 'dom');
        if (window.MutationObserver) {
            mo = new window.MutationObserver(syncFromDom);
            mo.observe(title, { subtree: true, attributes: true, attributeFilter: ['class'] });
        } else {
            pollId = window.setInterval(syncFromDom, 160);
        }
        syncFromDom();
        /* Watchdog: hero3d.js types at a lead of ~220ms --tl-in-delay. If nothing
           has been written well past that, its loop is not coming - take over. */
        watchId = window.setTimeout(function () {
            if (typed === 0 && !typingDone) { selfDrive(); }
        }, Math.max(fast(2600), TK.lead * 4 + 1200));
    } else {
        selfDrive();
    }
    signal('state', 'ready');

    /* --------------------------------------------------------------------
       7. Render loop — per-glyph 3-D stamp, idle float, pointer depth
    -------------------------------------------------------------------- */
    function step(tms) {
        rafId = 0;
        frames++;

        /* inertial pointer parallax (targets set by the pointer listener) */
        easeX += (ptrX - easeX) * 0.09;
        easeY += (ptrY - easeY) * 0.09;
        rotY = easeX * 0.17;
        rotX = -easeY * 0.11;
        group.rotation.y = rotY;
        group.rotation.x = rotX;

        var i, mesh, d, pose, p, amp = TK.depth, L = TK.lift / 140;
        for (i = 0; i < meshes.length; i++) {
            mesh = meshes[i];
            if (!mesh || !mesh.userData.typed) { continue; }
            d = mesh.userData;
            p = Math.min(1, (tms - d.t0) / Math.max(1, TK.stamp));
            pose = poseAt(p);

            /* continuous idle float, phased per glyph, fading in as it lands */
            var ph = (tms / Math.max(200, TK.float)) * Math.PI * 2 + d.idx * 0.62;
            var idle = Math.min(1, p * 1.6) * amp * d.depth;
            var fy = Math.sin(ph) * 2.4 * idle;
            var fz = Math.cos(ph * 0.9) * 7 * idle;
            var fry = Math.sin(ph * 0.7) * 0.05 * idle;

            /* the pointer pushes each glyph by its word's --d depth token */
            var ox = -easeX * amp * d.depth * 9;
            var oy = easeY * amp * d.depth * 7;
            var oz = -easeY * amp * d.depth * 12;

            mesh.material.opacity = pose.o;
            mesh.position.x = d.base.x + ox;
            mesh.position.y = d.base.y + pose.y + fy + oy;
            mesh.position.z = pose.z * L + fz + oz;
            mesh.rotation.x = pose.rx * Math.PI / 180;
            mesh.rotation.y = pose.ry * Math.PI / 180 + fry;
            mesh.scale.set(pose.s, pose.s, 1);
        }

        /* no caret pass here on purpose: the frame draws glyph meshes only */

        try {
            renderer.render(scene, camera);
        } catch (e) {
            release('render-failed');
            return;
        }
        /* Proof the GPU really drew glyph ink: sample the drawing buffer in the
           same task as the render (before it is presented). */
        if (frames % 30 === 1 && (typed > 0) && (!typingDone || (tms - typingDoneAt) < 1600)) {
            sampleInk();
        }
        if (frames % 15 === 0) { signal('frames', frames); if (window.TYPING3D) { window.TYPING3D.frames = frames; } }

        if (running) { rafId = window.requestAnimationFrame(step); }
    }

    function sampleInk() {
        try {
            var gl = renderer.getContext();
            var bw = renderer.domElement.width, bh = renderer.domElement.height;
            if (!bw || !bh) { return; }
            var y0 = Math.max(0, Math.floor(bh * 0.12));
            var hh = Math.max(1, Math.floor(bh * 0.76));
            var buf = new Uint8Array(bw * hh * 4);
            gl.readPixels(0, y0, bw, hh, gl.RGBA, gl.UNSIGNED_BYTE, buf);
            var n = 0;
            for (var i = 3; i < buf.length; i += 16) { if (buf[i] > 8) { n++; } }
            if (n > inkMax) {
                inkMax = n;
                signal('ink', inkMax);
                if (window.TYPING3D) { window.TYPING3D.ink = inkMax; }
            }
        } catch (e) { /* noop */ }
    }

    function start() {
        if (rafId || !running) { return; }
        rafId = window.requestAnimationFrame(step);
    }
    function stop() {
        if (rafId) { window.cancelAnimationFrame(rafId); rafId = 0; }
    }

    /* --------------------------------------------------------------------
       8. Hand-over — the CSS/hero3d.js headline takes the hero straight back
    -------------------------------------------------------------------- */
    function release(reason) {
        if (released) { return; }
        released = true;
        running = false;
        stop();
        delClass(title, 'typing3d-active');
        if (mo) { try { mo.disconnect(); } catch (e) { /* noop */ } mo = null; }
        if (pollId) { window.clearInterval(pollId); pollId = 0; }
        if (watchId) { window.clearTimeout(watchId); watchId = 0; }
        if (canvas && canvas.parentNode) {
            try { canvas.parentNode.removeChild(canvas); } catch (e) { /* noop */ }
        }
        signal('mode', 'handover');
        signal('reason', reason || 'handover');
        signal('canvas', 'no');
        signal('caret', 'off');
        if (window.TYPING3D) {
            window.TYPING3D.mode = 'handover';
            window.TYPING3D.reason = reason || 'handover';
        }
    }

    /* WebGL context loss -> put the CSS headline straight back */
    canvas.addEventListener('webglcontextlost', function (e) {
        if (e && e.preventDefault) { e.preventDefault(); }
        release('context-lost');
    }, false);
    window.addEventListener('error', function (ev) {
        if (ev && ev.target === canvas) { release('canvas-error'); }
    }, true);

    /* --------------------------------------------------------------------
       9. Sizing / fonts / lifecycle
    -------------------------------------------------------------------- */
    function relayout() {
        if (released) { return; }
        layoutCanvas();
        if (fontCSS().css !== FONT) {
            /* a breakpoint change (or a late web font) changed the type size:
               rebuild the glyph planes against the measured boxes */
            disposeGlyphs();
            buildGlyphs();
            syncFromDom();
        } else {
            for (var i = 0; i < meshes.length; i++) {
                if (meshes[i]) {
                    meshes[i].userData.w = Math.max(2, letters[i].offsetWidth);
                    meshes[i].userData.h = Math.max(2, letters[i].offsetHeight);
                    placeGlyph(meshes[i]);
                }
            }
        }
        if (!running) { renderer.render(scene, camera); }
    }
    var resizeTimer = 0;
    function onResize() {
        if (resizeTimer) { window.clearTimeout(resizeTimer); }
        resizeTimer = window.setTimeout(function () { resizeTimer = 0; relayout(); }, 140);
    }

    function onVisibility() {
        if (document.hidden) {
            running = false;
            stop();
        } else if (onScreen && !released) {
            running = true;
            start();
        }
    }

    function onPointer(e) {
        if (e.pointerType === 'touch') { return; }           /* no jank while scrolling */
        var r = hero.getBoundingClientRect ?
            hero.getBoundingClientRect() : { left: 0, top: 0, width: 1, height: 1 };
        var cx = r.left + r.width / 2, cy = r.top + r.height / 2;
        var nx = (e.clientX - cx) / Math.max(1, r.width / 2);
        var ny = (e.clientY - cy) / Math.max(1, r.height / 2);
        ptrX = nx < -1 ? -1 : (nx > 1 ? 1 : nx);
        ptrY = ny < -1 ? -1 : (ny > 1 ? 1 : ny);
        start();
    }
    function onPointerLeave() { ptrX = 0; ptrY = 0; start(); }

    /* --------------------------------------------------------------------
       10. Boot
    -------------------------------------------------------------------- */
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    layoutCanvas();
    buildGlyphs();
    syncFromDom();

    running = true;
    signal('mode', 'live');
    /* characters only: the -caret hook stays 'off' for the whole run */
    signal('caret', 'off');
    start();

    var moveEvent = window.PointerEvent ? 'pointermove' : 'mousemove';
    var leaveEvent = window.PointerEvent ? 'pointerleave' : 'mouseleave';
    hero.addEventListener(moveEvent, onPointer, false);
    hero.addEventListener(leaveEvent, onPointerLeave, false);
    document.addEventListener('visibilitychange', onVisibility, false);
    window.addEventListener('resize', onResize, false);
    window.addEventListener('orientationchange', onResize, false);

    if (window.IntersectionObserver) {
        var io = new window.IntersectionObserver(function (entries) {
            for (var i = 0; i < entries.length; i++) { onScreen = !!entries[i].isIntersecting; }
            if (released) { return; }
            if (onScreen && !document.hidden) { running = true; start(); } else { running = false; stop(); }
        }, { threshold: 0 });
        try { io.observe(hero); } catch (e) { /* noop */ }
    }
    if (document.fonts && document.fonts.ready && document.fonts.ready.then) {
        try { document.fonts.ready.then(function () { relayout(); }, function () { /* noop */ }); } catch (e) { /* noop */ }
    }

    /* Read-only state snapshot + an explicit hand-over hook for QA. */
    window.TYPING3D = {
        version: '1.0.0',
        mode: 'live',
        drive: drive,
        glyphs: GLYPHS,
        typed: 0,
        frames: 0,
        ink: 0,
        reason: '',
        state: function () {
            return {
                mode: released ? 'handover' : 'live',
                drive: drive,
                glyphs: GLYPHS,
                typed: typed,
                frames: frames,
                ink: inkMax,
                caret: caretSig,
                size: W + 'x' + H,
                canvas: !!canvas && !!canvas.parentNode
            };
        },
        handover: function (reason) { release(reason || 'api'); }
    };
}());
