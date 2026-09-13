/* ==========================================================================
   parallax3d.js
   Scroll + mouse driven 3-D parallax for the #p3d-stage background.

   - No dependencies (plain ES5, works next to jQuery 1.x).
   - One requestAnimationFrame loop with lerp easing; the loop self-stops when
     the motion has settled and is re-armed by a passive, throttled handler.
   - Only transform is written -> no layout thrash.
   - Layers whose content is periodic (stars / sparks / shapes) wrap seamlessly
     by exactly one content period, so the page can be any length.
   - Honours prefers-reduced-motion (freezes, no loop, no tilt).
   ========================================================================== */
(function () {
    'use strict';

    var stage = document.getElementById('p3d-stage');
    if (!stage || !stage.querySelector) { return; }

    /* When the WebGL background (assets/js/astra3d.js) is driving the stage this
       CSS-parallax driver must stay completely out of the way - otherwise we get
       double motion and a second set of generated star/spark nodes. */
    if (window.P3D_WEBGL_ACTIVE) { return; }

    var camera = stage.querySelector('.p3d-camera');
    if (!camera) { return; }

    /* ---------- helpers ---------- */
    var raf = window.requestAnimationFrame ||
        window.webkitRequestAnimationFrame ||
        function (cb) { return window.setTimeout(cb, 16); };

    var caf = window.cancelAnimationFrame ||
        window.webkitCancelAnimationFrame ||
        function (id) { window.clearTimeout(id); };

    function rand(min, max) { return min + Math.random() * (max - min); }

    function reducedMotion() {
        return !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches);
    }

    /* Content is authored inside the vertical band [28%, 72%] of a 300%-tall
       layer and duplicated at +50%; the wrap period is therefore 50% of the
       layer height, which makes the wrap point invisible. */
    var BAND_TOP = 28;
    var BAND_SPAN = 44;
    var DUPLICATE_OFFSET = 50;

    var LERP = 0.09;
    var MOUSE_LERP = 0.07;
    var MAX_CAM_Z = 520;
    var MAX_CAM_SCALE = 0.14;

    var layers = [];
    var state = {
        scrollTarget: 0,
        scroll: 0,
        mouseX: 0,
        mouseY: 0,
        curMouseX: 0,
        curMouseY: 0,
        maxScroll: 1,
        rafId: 0,
        frozen: false
    };

    /* ---------- generated particles ---------- */
    function fillParticles(host, cls, count, withSize) {
        if (!host) { return; }
        var frag = document.createDocumentFragment();
        var half = Math.ceil(count / 2);
        var i, copy, el, size, top, left;

        for (i = 0; i < half; i++) {
            left = rand(0, 100);
            top = BAND_TOP + Math.random() * BAND_SPAN;
            for (copy = 0; copy < 2; copy++) {
                el = document.createElement('span');
                el.className = cls;
                el.setAttribute('aria-hidden', 'true');
                el.style.left = left.toFixed(2) + '%';
                el.style.top = (top + copy * DUPLICATE_OFFSET).toFixed(2) + '%';
                el.style.animationDelay = (-rand(0, 8)).toFixed(2) + 's';
                if (withSize) {
                    size = rand(1.6, 3.6);
                    el.style.width = size.toFixed(2) + 'px';
                    el.style.height = size.toFixed(2) + 'px';
                    el.style.animationDuration = rand(3.5, 8).toFixed(2) + 's';
                } else {
                    el.style.animationDuration = rand(11, 19).toFixed(2) + 's';
                }
                frag.appendChild(el);
            }
        }
        host.appendChild(frag);
    }

    function buildParticles() {
        var small = (window.innerWidth || 1024) <= 767;
        fillParticles(document.getElementById('p3d-stars'), 'p3d-star', small ? 26 : 70, true);
        fillParticles(document.getElementById('p3d-sparks'), 'p3d-spark', small ? 6 : 12, false);
    }

    /* ---------- measurements (never read layout inside the animation loop) ---------- */
    function measure() {
        var i, el, depth, z, h;

        for (i = 0; i < layers.length; i++) {
            el = layers[i];
            depth = parseFloat(el.getAttribute('data-depth'));
            z = parseFloat(el.getAttribute('data-z'));
            h = el.offsetHeight || window.innerHeight;

            el._depth = isNaN(depth) ? 0.1 : depth;
            el._z = isNaN(z) ? 0 : z;
            el._nowrap = el.getAttribute('data-nowrap') === '1';
            el._period = h / 2;                 /* 50% of the layer height */
            el._maxDisp = el._period * 0.35;    /* bounded travel for nowrap layers */
        }

        state.maxScroll = Math.max(1,
            (document.documentElement.scrollHeight || 0) - (window.innerHeight || 0));
    }

    function readScroll() {
        return window.pageYOffset ||
            document.documentElement.scrollTop ||
            document.body.scrollTop || 0;
    }

    /* ---------- render ---------- */
    function render() {
        state.rafId = 0;

        var target = state.scrollTarget;
        state.scroll += (target - state.scroll) * LERP;
        if (Math.abs(target - state.scroll) < 0.08) { state.scroll = target; }

        state.curMouseX += (state.mouseX - state.curMouseX) * MOUSE_LERP;
        state.curMouseY += (state.mouseY - state.curMouseY) * MOUSE_LERP;

        var scroll = state.scroll;
        var progress = Math.min(1, scroll / state.maxScroll);

        /* camera: depth zoom + mouse tilt + a slow "look up" as you scroll */
        var camZ = -Math.min(scroll * 0.05, MAX_CAM_Z);
        var camScale = 1 + progress * MAX_CAM_SCALE;
        var rotX = (state.curMouseY * -3.5) + (progress * 5.5);
        var rotY = state.curMouseX * 5.5;

        camera.style.transform =
            'translate3d(0px, 0px, ' + camZ.toFixed(1) + 'px) ' +
            'rotateX(' + rotX.toFixed(2) + 'deg) ' +
            'rotateY(' + rotY.toFixed(2) + 'deg) ' +
            'scale3d(' + camScale.toFixed(4) + ',' + camScale.toFixed(4) + ',1)';

        var i, l, disp, y;
        for (i = 0; i < layers.length; i++) {
            l = layers[i];
            disp = -scroll * l._depth;

            if (l._nowrap) {
                /* saturating travel: keeps huge pages from sliding the layer away */
                y = -l._maxDisp * (1 - Math.exp(-Math.abs(disp) / l._maxDisp));
            } else {
                /* seamless wrap over exactly one content period */
                y = disp % l._period;
                if (y > 0) { y -= l._period; }
            }

            l.style.transform = 'translate3d(0px,' + y.toFixed(2) + 'px,' + l._z + 'px)';
        }

        var settledScroll = Math.abs(state.scrollTarget - state.scroll) < 0.15;
        var settledMouse = Math.abs(state.mouseX - state.curMouseX) < 0.002 &&
            Math.abs(state.mouseY - state.curMouseY) < 0.002;

        if (!settledScroll || !settledMouse) { schedule(); }
    }

    function schedule() {
        if (state.rafId || state.frozen) { return; }
        state.rafId = raf(render);
    }

    /* ---------- throttled input handlers ---------- */
    function onScroll() {
        state.scrollTarget = readScroll();
        schedule();
    }

    function onResize() {
        measure();
        state.scrollTarget = readScroll();
        schedule();
    }

    function onPointer(e) {
        var w = window.innerWidth || 1;
        var h = window.innerHeight || 1;
        state.mouseX = ((e.clientX / w) - 0.5) * 2;
        state.mouseY = ((e.clientY / h) - 0.5) * 2;
        schedule();
    }

    /* ---------- reduced motion ---------- */
    function freeze() {
        state.frozen = true;
        if (state.rafId) { caf(state.rafId); state.rafId = 0; }
        camera.style.transform = '';
        var i;
        for (i = 0; i < layers.length; i++) { layers[i].style.transform = ''; }
    }

    function unfreeze() {
        if (!state.frozen) { return; }
        state.frozen = false;
        state.scroll = state.scrollTarget = readScroll();
        state.curMouseX = state.mouseX = 0;
        state.curMouseY = state.mouseY = 0;
        schedule();
    }

    function watchReducedMotion() {
        var mq = window.matchMedia ? window.matchMedia('(prefers-reduced-motion: reduce)') : null;
        if (!mq) { return; }
        var handler = function () { if (mq.matches) { freeze(); } else { unfreeze(); } };
        if (mq.addEventListener) { mq.addEventListener('change', handler); }
        else if (mq.addListener) { mq.addListener(handler); }
    }

    /* ---------- boot ---------- */
    function init() {
        if (!stage.querySelectorAll) { return; }

        var nodes = stage.querySelectorAll('.p3d-layer');
        var i;
        for (i = 0; i < nodes.length; i++) { layers.push(nodes[i]); }
        if (!layers.length) { return; }

        buildParticles();
        measure();

        window.addEventListener('scroll', onScroll, { passive: true });
        window.addEventListener('resize', onResize, false);
        window.addEventListener('orientationchange', onResize, false);
        window.addEventListener('mousemove', onPointer, false);
        watchReducedMotion();

        if (reducedMotion()) {
            freeze();
        } else {
            onScroll();
        }

        /* small debug/inspection hook (used by the smoke test) */
        window.P3D = {
            layers: layers,
            state: state,
            refresh: function () { measure(); schedule(); }
        };
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init, false);
    } else {
        init();
    }
})();
