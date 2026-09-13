$(document).ready(function(){
	"use strict";
    
        /*==================================
* Author        : "ThemeSine"
* Template Name : Khanas HTML Template
* Version       : 1.0
==================================== */



/*=========== TABLE OF CONTENTS ===========
1. Scroll To Top 
2. Smooth Scroll spy
3. Progress-bar
4. owl carousel
5. welcome animation support
======================================*/

    // 1. Scroll To Top 
		$(window).on('scroll',function () {
			if ($(this).scrollTop() > 600) {
				$('.return-to-top').fadeIn();
			} else {
				$('.return-to-top').fadeOut();
			}
		});
		$('.return-to-top').on('click',function(){
				$('html, body').animate({
				scrollTop: 0
			}, 1500);
			return false;
		});
	
	
	
	// 2. Smooth Scroll spy
		
		$('.header-area').sticky({
           topSpacing:0
        });
		
		//=============

		$('li.smooth-menu a').bind("click", function(event) {
			event.preventDefault();
			var anchor = $(this);
			$('html, body').stop().animate({
				scrollTop: $(anchor.attr('href')).offset().top - 0
			}, 1200,'easeInOutExpo');
		});
		
		$('body').scrollspy({
			target:'.navbar-collapse',
			offset:0
		});

	// 3. Progress-bar
	
		var dataToggleTooTip = $('[data-toggle="tooltip"]');
		var progressBar = $(".progress-bar");
		if (progressBar.length) {
			progressBar.appear(function () {
				dataToggleTooTip.tooltip({
					trigger: 'manual'
				}).tooltip('show');
				progressBar.each(function () {
					var each_bar_width = $(this).attr('aria-valuenow');
					$(this).width(each_bar_width + '%');
				});
			});
		}
	
	// 4. client carousel (now a custom 3D coverflow slider, see the
	//    `clients3D` module at the bottom of this file - the old flat Owl
	//    Carousel init for `#client` was removed with the broken markup).
		if (window.clients3D && typeof window.clients3D.init === 'function') {
			window.clients3D.init();
		}


    // 5. welcome animation support

        $(window).load(function(){
        	$(".header-text h2,.header-text p").removeClass("animated fadeInUp").css({'opacity':'0'});
            $(".header-text a").removeClass("animated fadeInDown").css({'opacity':'0'});
        });

        $(window).load(function(){
        	$(".header-text h2,.header-text p").addClass("animated fadeInUp").css({'opacity':'0'});
            $(".header-text a").addClass("animated fadeInDown").css({'opacity':'0'});
        });

});


/* ================================================================
   clients3D - dependency-free 3D coverflow slider for the portfolio
   "Clients" section (#client3d). Replaces the old flat Owl Carousel
   strip whose markup had drifted out of sync.

   - true depth: perspective + translateZ/rotateY/scale per ring
   - autoplay that pauses on hover, focus, hidden tab or off-screen
   - drag / swipe, keyboard arrows, generated dots, hover lift
   - responsive card size + visible rings, no horizontal overflow
   - honours prefers-reduced-motion (no autoplay, no transform anim)

   Defensive by design: if the markup (or any part of it) is missing it
   silently no-ops, and it never touches anything outside #client3d.
   Public API: window.clients3D.init() / .refresh()
================================================================ */
(function (window, document) {
    'use strict';

    var ROOT_SELECTOR = '#client3d';
    var AUTOPLAY_MS = 3600;      // dwell time per slide
    var SPACING = 0.62;          // ring spacing as a fraction of the card width
    var DEPTH_STEP = 220;        // px of translateZ per ring (the real depth)
    var MAX_ROTATE = 62;         // deg, hard cap on the coverflow rotation
    var DRAG_FRACTION = 0.42;    // how far you must drag before it flips

    /* [minimum stage width, card width, visible rings] - widest first. */
    var BREAKPOINTS = [
        [1180, 268, 3],
        [900, 240, 3],
        [640, 208, 2],
        [0, 176, 2]
    ];

    function init() {
        var root = document.querySelector(ROOT_SELECTOR);
        if (!root) return null;
        if (root.__clients3d) return root.__clients3d;

        var stage = root.querySelector('.client-3d__stage');
        if (!stage) return null;

        var slides = [].slice.call(stage.querySelectorAll('.client-3d__slide'));
        if (!slides.length) return null;

        var dotsWrap = root.querySelector('[data-client-dots]');
        var prevBtn = root.querySelector('[data-client-prev]');
        var nextBtn = root.querySelector('[data-client-next]');
        var count = slides.length;

        var index = 0;
        var cardW = 0;
        var ring = BREAKPOINTS[BREAKPOINTS.length - 1][2];
        var timer = null;
        var paused = false;
        var inView = true;
        var suppressClick = false;
        var dragX = null;
        var dragUsed = false;
        var rafId = null;
        var dots = [];

        var reduce = window.matchMedia
            ? window.matchMedia('(prefers-reduced-motion: reduce)')
            : { matches: false };

        /* ---------- dots (generated, so the markup stays clean) ---------- */
        if (dotsWrap) {
            for (var d = 0; d < count; d++) {
                var dot = document.createElement('button');
                dot.type = 'button';
                dot.className = 'client-3d__dot';
                dot.setAttribute('role', 'tab');
                dot.setAttribute('data-client-dot', String(d));
                dot.setAttribute('aria-label', 'Client ' + (d + 1) + ' of ' + count);
                dotsWrap.appendChild(dot);
                dots.push(dot);
            }
            dotsWrap.addEventListener('click', function (e) {
                var t = e.target && e.target.closest ? e.target.closest('[data-client-dot]') : null;
                if (!t) return;
                goTo(parseInt(t.getAttribute('data-client-dot'), 10), true);
            });
        }

        /* ---------- layout ---------- */
        function measure() {
            var w = stage.clientWidth || root.clientWidth || window.innerWidth || 0;
            var pick = BREAKPOINTS[BREAKPOINTS.length - 1];
            for (var i = 0; i < BREAKPOINTS.length; i++) {
                if (w >= BREAKPOINTS[i][0]) { pick = BREAKPOINTS[i]; break; }
            }
            cardW = pick[1];
            ring = pick[2];
            root.style.setProperty('--c3d-card-w', cardW + 'px');
        }

        /* shortest signed distance from the active slide, with wrap-around */
        function offsetOf(i) {
            var o = i - index;
            var half = count / 2;
            if (o > half) o -= count;
            if (o < -half) o += count;
            return o;
        }

        function apply(animate) {
            root.classList.toggle('is-animating', !!animate && !reduce.matches);
            for (var i = 0; i < count; i++) {
                var slide = slides[i];
                var o = offsetOf(i);
                var a = Math.abs(o);
                var sign = o < 0 ? -1 : (o > 0 ? 1 : 0);
                var x = sign * a * cardW * SPACING;
                var z = -a * DEPTH_STEP;
                var ry = -sign * Math.min(a * 26, MAX_ROTATE);
                var sc = Math.max(0.6, 1 - a * 0.1);
                var visible = a <= ring;

                slide.style.transform =
                    'translate(-50%, -50%)' +
                    ' translateX(' + x.toFixed(1) + 'px)' +
                    ' translateZ(' + z + 'px)' +
                    ' rotateY(' + ry.toFixed(1) + 'deg)' +
                    ' scale(' + sc.toFixed(3) + ')';
                slide.style.opacity = visible
                    ? String(a === 0 ? 1 : Math.max(0.16, 0.84 - (a - 1) * 0.34))
                    : '0';
                slide.style.zIndex = String(100 - a);
                slide.style.pointerEvents = visible ? 'auto' : 'none';

                slide.setAttribute('data-pos', String(a));
                slide.setAttribute('aria-hidden', visible ? 'false' : 'true');

                var link = slide.querySelector('a');
                if (link) link.setAttribute('tabindex', visible ? '0' : '-1');
            }

            for (var k = 0; k < dots.length; k++) {
                var on = k === index;
                dots[k].setAttribute('aria-selected', on ? 'true' : 'false');
                dots[k].setAttribute('tabindex', on ? '0' : '-1');
            }
            root.setAttribute('data-index', String(index));
        }

        /* ---------- navigation ---------- */
        function goTo(i, animate) {
            if (!count) return;
            index = ((i % count) + count) % count;
            apply(animate !== false);
            schedule();
        }

        function go(delta) { goTo(index + delta, true); }

        /* ---------- autoplay: pauses on hover, focus, hidden tab, off-screen */
        function stop() {
            if (timer) { window.clearTimeout(timer); timer = null; }
        }

        function schedule() {
            stop();
            if (reduce.matches || paused || !inView || count < 2) return;
            timer = window.setTimeout(function () {
                timer = null;
                go(1);
            }, AUTOPLAY_MS);
        }

        /* ---------- events ---------- */
        function bind() {
            if (prevBtn) prevBtn.addEventListener('click', function () { go(-1); });
            if (nextBtn) nextBtn.addEventListener('click', function () { go(1); });

            stage.addEventListener('keydown', function (e) {
                var k = e.key;
                if (k === 'ArrowLeft') { e.preventDefault(); go(-1); }
                else if (k === 'ArrowRight') { e.preventDefault(); go(1); }
                else if (k === 'Home') { e.preventDefault(); goTo(0, true); }
                else if (k === 'End') { e.preventDefault(); goTo(count - 1, true); }
            });

            stage.addEventListener('focusin', function (e) {
                paused = true;
                stop();
                var s = e.target && e.target.closest ? e.target.closest('.client-3d__slide') : null;
                if (!s) return;
                var i = slides.indexOf(s);
                if (i >= 0 && i !== index) goTo(i, true);
            });
            stage.addEventListener('focusout', function () {
                paused = false;
                schedule();
            });

            root.addEventListener('mouseenter', function () { paused = true; stop(); });
            root.addEventListener('mouseleave', function () { paused = false; schedule(); });

            /* pointer / touch drag */
            stage.addEventListener('pointerdown', function (e) {
                if (e.pointerType === 'mouse' && e.button !== 0) return;
                dragX = e.clientX;
                dragUsed = false;
                root.classList.add('is-dragging');
            });
            stage.addEventListener('pointermove', function (e) {
                if (dragX === null || dragUsed) return;
                var dx = e.clientX - dragX;
                if (Math.abs(dx) > Math.max(28, cardW * DRAG_FRACTION)) {
                    dragUsed = true;
                    suppressClick = true;
                    go(dx < 0 ? 1 : -1);
                }
            });
            function endDrag() {
                dragX = null;
                root.classList.remove('is-dragging');
            }
            stage.addEventListener('pointerup', endDrag);
            stage.addEventListener('pointercancel', endDrag);
            stage.addEventListener('pointerleave', endDrag);
            stage.addEventListener('dragstart', function (e) { e.preventDefault(); });
            /* swallow the click that ends a real drag so links do not fire */
            stage.addEventListener('click', function (e) {
                if (!suppressClick) return;
                suppressClick = false;
                e.preventDefault();
                e.stopPropagation();
            }, true);

            document.addEventListener('visibilitychange', function () {
                if (document.hidden) { stop(); } else { schedule(); }
            });

            if ('IntersectionObserver' in window) {
                var io = new window.IntersectionObserver(function (entries) {
                    var entry = entries[0];
                    inView = !!(entry && entry.isIntersecting);
                    if (inView) { schedule(); } else { stop(); }
                }, { threshold: 0.15 });
                io.observe(root);
            }

            function relayout() {
                if (rafId) return;
                rafId = window.requestAnimationFrame(function () {
                    rafId = null;
                    var before = cardW;
                    measure();
                    if (cardW !== before) apply(false);
                });
            }
            window.addEventListener('resize', relayout);
            window.addEventListener('orientationchange', relayout);
            if ('ResizeObserver' in window) {
                new window.ResizeObserver(relayout).observe(stage);
            }

            if (reduce.addEventListener) {
                reduce.addEventListener('change', function () {
                    paused = false;
                    schedule();
                });
            }
        }

        /* ---------- mount ---------- */
        measure();
        root.classList.add('is-ready');
        bind();
        apply(false);
        schedule();

        var api = {
            go: go,
            goTo: goTo,
            refresh: function () { measure(); apply(false); return api; },
            stop: stop
        };
        root.__clients3d = api;
        return api;
    }

    window.clients3D = {
        init: init,
        refresh: function () {
            var api = init();
            return api ? api.refresh() : null;
        }
    };

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }
}(window, document));
	
	