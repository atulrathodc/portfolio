/* ==========================================================================
   astra3d.js — real-time WebGL background for #p3d-stage  ("Astra" class)

   A genuine GPU-rendered 3-D scene (Three.js r128, vendored at
   assets/js/three.min.js — no build step, no module system, ES5 IIFE).

   Scene
     - deep 3-shell additive starfield (custom GLSL, per-point size + drift)
     - volumetric nebula cloud (additive sprites, procedural canvas texture)
     - 3-D focal "core": morphing particle shell + wireframe icosahedron
       crystal + fresnel rim glow + orbiting rings + tumbling satellite
     - exponential fog + near/far falloff for a depth-of-field feel
     - hand-rolled bloom (bright-pass -> separable gaussian ping-pong ->
       additive composite). No addons required.

   Behaviour
     - pointer + scroll parallax with inertial easing, driving a camera rig
     - devicePixelRatio capped at 2, resize safe, tab-hidden pause,
       IntersectionObserver pause, WebGL context-loss handling
     - prefers-reduced-motion -> a single static frame, no rAF loop
     - no WebGL / no Three.js -> degrade to the CSS parallax stage
       (assets/css/parallax3d.css + assets/js/parallax3d.js)

   The stage is position:fixed; z-index:-1; pointer-events:none (CSS), so the
   page stays fully clickable and the copy stays readable.
   ========================================================================== */
(function () {
    'use strict';

    var stage = document.getElementById('p3d-stage');
    var canvas = document.getElementById('astra-stage');
    if (!stage || !canvas) { return; }

    var html = document.documentElement;

    /* prefers-reduced-motion -> single static frame. Also honour an explicit
       `?motion=reduce` / `#motion=reduce` override so the reduced path can be
       exercised on any device (QA / motion-sensitive visitors). */
    var forceReduce = /[?&]motion=reduce(&|$)/.test(window.location.search) ||
        /motion=reduce/.test(window.location.hash);
    var reduced = forceReduce || !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches);

    function raf(cb) { return window.requestAnimationFrame(cb); }
    function caf(id) { return window.cancelAnimationFrame(id); }
    function rand(a, b) { return a + Math.random() * (b - a); }
    function clamp(v, a, b) { return v < a ? a : (v > b ? b : v); }
    function glsl(src) { return typeof src === 'string' ? src : src.join('\n'); }

    /* Expose live engine state on the stage element as data-astra-* attributes.
       Purely observational (no styling depends on it) - it gives CSS hooks, and
       lets a headless run read the real runtime state straight from the DOM. */
    function signal(key, value) {
        try { stage.setAttribute('data-astra-' + key, String(value)); } catch (e) { /* noop */ }
    }
    function lowPower() {
        var w = window.innerWidth || 1024;
        return w <= 767 || (navigator.userAgent || '').indexOf('Mobile') > -1;
    }

    /* --------------------------------------------------------------------
       0. WebGL capability gate
    -------------------------------------------------------------------- */
    function webglAvailable() {
        try {
            var c = document.createElement('canvas');
            var ctx = c.getContext('webgl') || c.getContext('experimental-webgl');
            if (!ctx) { return false; }
            if (!window.WebGLRenderingContext) { return false; }
            return true;
        } catch (e) { return false; }
    }

    /* --------------------------------------------------------------------
       1. CSS fallback branch (keeps the old parallax stage working)
    -------------------------------------------------------------------- */
    var cssFallbackLoaded = false;
    function activateCssFallback(reason) {
        stopLoop();

        try {
            if (canvas && canvas.parentNode) { canvas.parentNode.removeChild(canvas); }
        } catch (e) { /* noop */ }

        window.P3D_WEBGL_ACTIVE = false;
        if (stage.classList) {
            stage.classList.remove('p3d-webgl');
            stage.classList.add('p3d-fallback-on');
        }

        if (window.ASTRA) {
            window.ASTRA.mode = 'css-fallback';
            window.ASTRA.reason = reason || 'unknown';
            window.ASTRA.webgl = false;
            window.ASTRA.running = false;
        }
        signal('mode', 'css-fallback');
        signal('reason', reason || 'unknown');
        signal('running', 0);

        /* parallax3d.js bails out when the WebGL flag is set, so if it has not
           initialised yet (or ran during a WebGL session) pull it in now. */
        if (!window.P3D && !cssFallbackLoaded) {
            cssFallbackLoaded = true;
            var s = document.createElement('script');
            s.src = 'assets/js/parallax3d.js';
            s.async = false;
            document.body.appendChild(s);
        }
    }

    if (!window.THREE) {
        activateCssFallback('no-three');
        return;
    }
    if (!webglAvailable()) {
        activateCssFallback('no-webgl');
        return;
    }

    /* --------------------------------------------------------------------
       2. Renderer / scene / camera
    -------------------------------------------------------------------- */
    var renderer;
    try {
        renderer = new THREE.WebGLRenderer({
            canvas: canvas,
            antialias: false,
            alpha: false,
            powerPreference: 'high-performance',
            stencil: false
        });
        renderer.setClearColor(0x05060f, 1);
        renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    } catch (err) {
        activateCssFallback('renderer-failed');
        return;
    }
    if (!renderer.getContext || !renderer.getContext()) {
        activateCssFallback('no-context');
        return;
    }

    var PALETTE = {
        bg: 0x05060f,
        purple: new THREE.Color(0xb636ff),
        violet: new THREE.Color(0x8b5cf6),
        cyan: new THREE.Color(0x00ccff),
        ice: new THREE.Color(0x9ff0ff),
        deep: new THREE.Color(0x1a2456)
    };

    var scene = new THREE.Scene();
    scene.fog = new THREE.FogExp2(0x05060f, 0.00135);

    var camera = new THREE.PerspectiveCamera(62, 1, 0.1, 2000);
    camera.position.set(0, 0, 0);

    var rig = new THREE.Group();          /* pointer + scroll driven "camera rig" */
    rig.add(camera);
    scene.add(rig);

    /* --------------------------------------------------------------------
       3. Procedural sprite texture (soft radial glow) — no image assets
    -------------------------------------------------------------------- */
    function glowTexture(size, power) {
        var c = document.createElement('canvas');
        c.width = c.height = size;
        var ctx = c.getContext('2d');
        var g = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
        g.addColorStop(0.0, 'rgba(255,255,255,1)');
        g.addColorStop(0.22, 'rgba(255,255,255,0.55)');
        g.addColorStop(0.55, 'rgba(255,255,255,0.14)');
        g.addColorStop(1.0, 'rgba(255,255,255,0)');
        ctx.fillStyle = g;
        ctx.fillRect(0, 0, size, size);
        void power;
        var t = new THREE.CanvasTexture(c);
        t.minFilter = THREE.LinearFilter;
        t.magFilter = THREE.LinearFilter;
        t.needsUpdate = true;
        return t;
    }
    var TEX_GLOW = glowTexture(128);
    var TEX_NEBULA = glowTexture(256);

    /* --------------------------------------------------------------------
       4. Starfield — 3 additive shells with a custom shader
    -------------------------------------------------------------------- */
    var STAR_VERT = glsl([
        'attribute float aSize;',
        'attribute float aPhase;',
        'attribute vec3  aColor;',
        'uniform float uTime;',
        'uniform float uPixelRatio;',
        'uniform float uDrift;',
        'varying vec3  vColor;',
        'varying float vAlpha;',
        'void main() {',
        '    vec3 p = position;',
        '    p.x += sin(uTime * 0.18 + aPhase * 6.2831) * uDrift;',
        '    p.y += cos(uTime * 0.23 + aPhase * 4.1121) * uDrift;',
        '    p.z += sin(uTime * 0.11 + aPhase * 9.713) * uDrift * 0.5;',
        '    vec4 mv = modelViewMatrix * vec4(p, 1.0);',
        '    float dist = max(-mv.z, 1.0);',
        '    gl_Position = projectionMatrix * mv;',
        '    float tw = 0.5 + 0.5 * sin(uTime * 1.7 + aPhase * 32.0);',
        '    float sizeAtten = 320.0 / dist;',
        '    gl_PointSize = clamp(aSize * uPixelRatio * sizeAtten * (0.72 + 0.55 * tw), 1.0, 42.0);',
        '    vColor = aColor;',
        '    vAlpha = clamp((0.35 + 0.65 * tw) * (1.0 - smoothstep(420.0, 980.0, dist)), 0.0, 1.0);',
        '}'
    ].join('\n'));

    var STAR_FRAG = glsl([
        'varying vec3  vColor;',
        'varying float vAlpha;',
        'void main() {',
        '    vec2 uv = gl_PointCoord - vec2(0.5);',
        '    float d = length(uv);',
        '    if (d > 0.5) discard;',
        '    float g = pow(smoothstep(0.5, 0.0, d), 1.9);',
        '    float core = pow(smoothstep(0.16, 0.0, d), 1.2);',
        '    vec3 col = vColor + vec3(core) * 0.9;',
        '    gl_FragColor = vec4(col * g * vAlpha, g * vAlpha);',
        '}'
    ].join('\n'));

    var starUniforms = {
        uTime: { value: 0 },
        uPixelRatio: { value: Math.min(window.devicePixelRatio || 1, 2) },
        uDrift: { value: 7 }
    };

    function buildStarShell(opts) {
        var count = opts.count;
        var pos = new Float32Array(count * 3);
        var col = new Float32Array(count * 3);
        var siz = new Float32Array(count);
        var pha = new Float32Array(count);
        var c = new THREE.Color();
        var i, r, a, z, t;

        for (i = 0; i < count; i++) {
            /* cylindrical volume: dense near the axis, wide + deep */
            r = Math.pow(Math.random(), 0.62) * opts.radius;
            a = Math.random() * Math.PI * 2;
            z = -(opts.zNear + Math.random() * (opts.zFar - opts.zNear));
            /* two spiral arms for structure */
            a += (z * 0.0016) + (Math.sin(r * 0.02) * 0.6);

            pos[i * 3] = Math.cos(a) * r;
            pos[i * 3 + 1] = Math.sin(a) * r * (opts.flat || 0.85);
            pos[i * 3 + 2] = z;

            t = Math.pow(Math.random(), 1.6);
            c.copy(PALETTE.cyan).lerp(PALETTE.purple, Math.min(1, t + opts.tint));
            if (Math.random() < 0.10) { c.lerp(PALETTE.ice, 0.6); }
            col[i * 3] = c.r; col[i * 3 + 1] = c.g; col[i * 3 + 2] = c.b;

            siz[i] = rand(opts.sizeMin, opts.sizeMax);
            pha[i] = Math.random();
        }

        var geo = new THREE.BufferGeometry();
        geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
        geo.setAttribute('aColor', new THREE.BufferAttribute(col, 3));
        geo.setAttribute('aSize', new THREE.BufferAttribute(siz, 1));
        geo.setAttribute('aPhase', new THREE.BufferAttribute(pha, 1));

        var mat = new THREE.ShaderMaterial({
            uniforms: starUniforms,
            vertexShader: STAR_VERT,
            fragmentShader: STAR_FRAG,
            transparent: true,
            depthWrite: false,
            depthTest: true,
            blending: THREE.AdditiveBlending
        });

        var points = new THREE.Points(geo, mat);
        points.frustumCulled = false;
        return points;
    }

    var small = lowPower();
    var starField = new THREE.Group();
    starField.add(buildStarShell({ count: small ? 2600 : 9000, radius: 620, zNear: 60, zFar: 900, sizeMin: 0.9, sizeMax: 3.4, tint: -0.25, flat: 0.92 }));
    starField.add(buildStarShell({ count: small ? 900 : 2800, radius: 320, zNear: 30, zFar: 520, sizeMin: 1.4, sizeMax: 5.0, tint: 0.15, flat: 0.8 }));
    starField.add(buildStarShell({ count: small ? 160 : 420, radius: 180, zNear: 12, zFar: 200, sizeMin: 2.6, sizeMax: 8.5, tint: 0.42, flat: 0.75 }));
    scene.add(starField);

    /* --------------------------------------------------------------------
       5. Volumetric nebula — additive drifting sprites
    -------------------------------------------------------------------- */
    var nebula = new THREE.Group();
    var nebulaSprites = [];
    (function buildNebula() {
        var layout = [
            { x: -190, y: 60, z: -520, s: 760, c: PALETTE.violet, o: 0.30 },
            { x: 210, y: -70, z: -600, s: 880, c: PALETTE.purple, o: 0.24 },
            { x: 30, y: 150, z: -780, s: 1000, c: PALETTE.deep, o: 0.55 },
            { x: -60, y: -160, z: -430, s: 620, c: PALETTE.cyan, o: 0.20 },
            { x: 120, y: 40, z: -320, s: 520, c: PALETTE.violet, o: 0.16 },
            { x: -140, y: -30, z: -260, s: 460, c: PALETTE.cyan, o: 0.12 }
        ];
        var i, mat, m, sp;
        var count = small ? 4 : layout.length;

        for (i = 0; i < count; i++) {
            mat = new THREE.SpriteMaterial({
                map: TEX_NEBULA,
                color: layout[i].c,
                transparent: true,
                opacity: layout[i].o,
                blending: THREE.AdditiveBlending,
                depthWrite: false,
                depthTest: true,
                fog: true
            });
            sp = new THREE.Sprite(mat);
            sp.position.set(layout[i].x, layout[i].y, layout[i].z);
            sp.scale.set(layout[i].s, layout[i].s * rand(0.72, 1.0), 1);
            sp.userData.spin = rand(-0.02, 0.02);
            sp.userData.baseY = layout[i].y;
            sp.userData.baseOpacity = layout[i].o;
            sp.userData.phase = Math.random() * Math.PI * 2;
            nebula.add(sp);
            nebulaSprites.push(sp);
        }

        /* extra random haze for density */
        if (!small) {
            for (i = 0; i < 14; i++) {
                mat = new THREE.SpriteMaterial({
                    map: TEX_NEBULA,
                    color: Math.random() < 0.5 ? PALETTE.purple : PALETTE.cyan,
                    transparent: true,
                    opacity: rand(0.05, 0.13),
                    blending: THREE.AdditiveBlending,
                    depthWrite: false,
                    depthTest: true
                });
                var haze = new THREE.Sprite(mat);
                haze.position.set(rand(-320, 320), rand(-220, 220), rand(-820, -200));
                var hs = rand(260, 620);
                haze.scale.set(hs, hs, 1);
                haze.userData.spin = rand(-0.03, 0.03);
                haze.userData.baseY = haze.position.y;
                haze.userData.baseOpacity = haze.material.opacity;
                haze.userData.phase = Math.random() * Math.PI * 2;
                nebula.add(haze);
                nebulaSprites.push(haze);
            }
        }

        m = nebula;
        m.rotation.z = 0.06;
        scene.add(nebula);
    })();

    /* --------------------------------------------------------------------
       6. Focal element — morphing particle shell + crystal + glow + rings
    -------------------------------------------------------------------- */
    var focal = new THREE.Group();
    focal.position.set(0, 0, -18);
    scene.add(focal);

    /* 6a. particle shell (fibonacci sphere, displaced in the vertex shader) */
    var SHELL_VERT = glsl([
        'attribute float aPhase;',
        'attribute float aWeight;',
        'uniform float uTime;',
        'uniform float uPixelRatio;',
        'uniform float uMorph;',
        'varying float vGlow;',
        'varying float vWeight;',
        'void main() {',
        '    vec3 n = normalize(position);',
        '    float w1 = sin(n.x * 3.1 + uTime * 0.9 + aPhase * 6.2831);',
        '    float w2 = sin(n.y * 2.7 - uTime * 0.7 + aPhase * 4.1121);',
        '    float w3 = sin(n.z * 3.6 + uTime * 1.15 + aPhase * 2.7182);',
        '    float ripple = (w1 * 0.45 + w2 * 0.35 + w3 * 0.28) * uMorph;',
        '    float r = 1.0 + ripple * 0.28 + sin(uTime * 0.5) * 0.03;',
        '    vec3 p = n * r;',
        '    p += n * sin(aPhase * 40.0 + uTime * 1.6) * 0.02;',
        '    vec4 mv = modelViewMatrix * vec4(p, 1.0);',
        '    float dist = max(-mv.z, 1.0);',
        '    gl_Position = projectionMatrix * mv;',
        '    gl_PointSize = clamp((1.3 + aWeight * 2.6) * uPixelRatio * (46.0 / dist), 1.0, 22.0);',
        '    vGlow = 0.45 + 0.55 * clamp(ripple * 0.8 + 0.5, 0.0, 1.0);',
        '    vWeight = aWeight;',
        '}'
    ].join('\n'));

    var SHELL_FRAG = glsl([
        'uniform vec3  uColorA;',
        'uniform vec3  uColorB;',
        'varying float vGlow;',
        'varying float vWeight;',
        'void main() {',
        '    vec2 uv = gl_PointCoord - vec2(0.5);',
        '    float d = length(uv);',
        '    if (d > 0.5) discard;',
        '    float g = pow(smoothstep(0.5, 0.0, d), 1.7);',
        '    vec3 col = mix(uColorA, uColorB, vWeight) * vGlow;',
        '    col += vec3(pow(smoothstep(0.12, 0.0, d), 1.3)) * 0.8;',
        '    gl_FragColor = vec4(col * g, g);',
        '}'
    ].join('\n'));

    var shellUniforms = {
        uTime: { value: 0 },
        uPixelRatio: { value: Math.min(window.devicePixelRatio || 1, 2) },
        uMorph: { value: 1.0 },
        uColorA: { value: PALETTE.purple.clone() },
        uColorB: { value: PALETTE.cyan.clone() }
    };

    var shell = (function buildShell() {
        var count = small ? 1400 : 4200;
        var pos = new Float32Array(count * 3);
        var pha = new Float32Array(count);
        var wgt = new Float32Array(count);
        var GA = Math.PI * (3 - Math.sqrt(5));
        var i, y, rad, th;

        for (i = 0; i < count; i++) {
            y = 1 - (i / (count - 1)) * 2;
            rad = Math.sqrt(Math.max(0, 1 - y * y));
            th = GA * i;
            pos[i * 3] = Math.cos(th) * rad;
            pos[i * 3 + 1] = y;
            pos[i * 3 + 2] = Math.sin(th) * rad;
            pha[i] = Math.random();
            wgt[i] = Math.pow(Math.random(), 1.4);
        }

        var geo = new THREE.BufferGeometry();
        geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
        geo.setAttribute('aPhase', new THREE.BufferAttribute(pha, 1));
        geo.setAttribute('aWeight', new THREE.BufferAttribute(wgt, 1));

        var pts = new THREE.Points(geo, new THREE.ShaderMaterial({
            uniforms: shellUniforms,
            vertexShader: SHELL_VERT,
            fragmentShader: SHELL_FRAG,
            transparent: true,
            depthWrite: false,
            blending: THREE.AdditiveBlending
        }));
        pts.scale.setScalar(6.4);
        pts.frustumCulled = false;
        focal.add(pts);
        return pts;
    })();

    /* 6b. wireframe crystal (icosahedron edges, additive) */
    var CRYSTAL_VERT = glsl([
        'attribute float aSeed;',
        'uniform float uTime;',
        'uniform float uPulse;',
        'varying float vFade;',
        'void main() {',
        '    vec3 n = normalize(position);',
        '    float d = sin(n.x * 2.3 + uTime * 0.8) * cos(n.y * 2.1 - uTime * 0.6) * sin(n.z * 2.6 + uTime * 0.95);',
        '    vec3 p = position * (1.0 + d * 0.12 + uPulse * 0.05);',
        '    vec4 mv = modelViewMatrix * vec4(p, 1.0);',
        '    gl_Position = projectionMatrix * mv;',
        '    vFade = 0.55 + 0.45 * (d * 0.5 + 0.5) + aSeed * 0.0;',
        '}'
    ].join('\n'));

    var CRYSTAL_FRAG = glsl([
        'uniform vec3 uColor;',
        'uniform float uOpacity;',
        'varying float vFade;',
        'void main() {',
        '    gl_FragColor = vec4(uColor * vFade, vFade * uOpacity);',
        '}'
    ].join('\n'));

    var crystalUniforms = {
        uTime: { value: 0 },
        uPulse: { value: 0 },
        uColor: { value: PALETTE.cyan.clone() },
        uOpacity: { value: 0.62 }
    };

    var crystal = (function buildCrystal() {
        var base = new THREE.IcosahedronGeometry(1, 1);
        var geo = new THREE.EdgesGeometry(base);
        var n = geo.attributes.position.count;
        var seed = new Float32Array(n);
        var i;
        for (i = 0; i < n; i++) { seed[i] = Math.random(); }
        geo.setAttribute('aSeed', new THREE.BufferAttribute(seed, 1));

        var lines = new THREE.LineSegments(geo, new THREE.ShaderMaterial({
            uniforms: crystalUniforms,
            vertexShader: CRYSTAL_VERT,
            fragmentShader: CRYSTAL_FRAG,
            transparent: true,
            depthWrite: false,
            blending: THREE.AdditiveBlending
        }));
        lines.scale.setScalar(4.4);
        focal.add(lines);
        return lines;
    })();

    /* 6c. fresnel rim glow sphere */
    var glow = (function buildGlow() {
        var mat = new THREE.ShaderMaterial({
            uniforms: {
                uTime: { value: 0 },
                uColorA: { value: PALETTE.purple.clone() },
                uColorB: { value: PALETTE.cyan.clone() }
            },
            vertexShader: glsl([
                'varying vec3 vN;',
                'varying vec3 vPos;',
                'void main() {',
                '    vN = normalize(normalMatrix * normal);',
                '    vec4 mv = modelViewMatrix * vec4(position, 1.0);',
                '    vPos = mv.xyz;',
                '    gl_Position = projectionMatrix * mv;',
                '}'
            ].join('\n')),
            fragmentShader: glsl([
                'uniform float uTime;',
                'uniform vec3 uColorA;',
                'uniform vec3 uColorB;',
                'varying vec3 vN;',
                'varying vec3 vPos;',
                'void main() {',
                '    vec3 viewDir = normalize(-vPos);',
                '    float f = pow(1.0 - clamp(dot(vN, viewDir), 0.0, 1.0), 2.4);',
                '    float band = 0.6 + 0.4 * sin(vN.y * 5.0 + uTime * 1.2);',
                '    vec3 col = mix(uColorA, uColorB, band) * f;',
                '    gl_FragColor = vec4(col * 1.35, f);',
                '}'
            ].join('\n')),
            transparent: true,
            depthWrite: false,
            blending: THREE.AdditiveBlending,
            side: THREE.FrontSide
        });
        var mesh = new THREE.Mesh(new THREE.SphereGeometry(3.05, 48, 32), mat);
        focal.add(mesh);
        return mesh;
    })();

    /* 6d. inner hot core */
    var core = (function buildCore() {
        var mat = new THREE.MeshBasicMaterial({
            color: 0xdff3ff,
            transparent: true,
            opacity: 0.9,
            blending: THREE.AdditiveBlending,
            depthWrite: false
        });
        var mesh = new THREE.Mesh(new THREE.IcosahedronGeometry(0.62, 1), mat);
        focal.add(mesh);
        return mesh;
    })();

    /* 6e. orbiting rings */
    var RING_DEFS = [
        { r: 7.0, t: 0.035, color: PALETTE.cyan, rx: 1.18, ry: 0.2, speed: 0.10 },
        { r: 8.6, t: 0.028, color: PALETTE.purple, rx: -0.75, ry: 0.55, speed: -0.07 },
        { r: 10.4, t: 0.022, color: PALETTE.violet, rx: 0.42, ry: -1.05, speed: 0.05 }
    ];
    var ringGeo = new THREE.TorusGeometry(1, 0.006, 6, 220);
    var rings = [];
    RING_DEFS.forEach(function (def) {
        var mesh = new THREE.Mesh(ringGeo, new THREE.MeshBasicMaterial({
            color: def.color,
            transparent: true,
            opacity: 0.55,
            blending: THREE.AdditiveBlending,
            depthWrite: false
        }));
        mesh.scale.set(def.r, def.r, def.r);
        mesh.rotation.set(def.rx, def.ry, 0);
        mesh.userData = def;
        focal.add(mesh);
        rings.push(mesh);
    });

    /* 6f. tumbling satellite */
    var satellite = (function () {
        var mesh = new THREE.Mesh(
            new THREE.OctahedronGeometry(0.85, 0),
            new THREE.MeshBasicMaterial({
                color: 0xa9f3ff,
                transparent: true,
                opacity: 0.95,
                blending: THREE.AdditiveBlending,
                depthWrite: false
            })
        );
        var satGlow = new THREE.Sprite(new THREE.SpriteMaterial({
            map: TEX_GLOW,
            color: PALETTE.cyan,
            transparent: true,
            opacity: 0.5,
            blending: THREE.AdditiveBlending,
            depthWrite: false
        }));
        satGlow.scale.set(9, 9, 1);
        mesh.add(satGlow);
        focal.add(mesh);
        return mesh;
    })();

    /* 6g. halo sprite behind the focal object (soft bloom bed) */
    var halo = new THREE.Sprite(new THREE.SpriteMaterial({
        map: TEX_GLOW,
        color: PALETTE.violet,
        transparent: true,
        opacity: 0.34,
        blending: THREE.AdditiveBlending,
        depthWrite: false
    }));
    halo.scale.set(34, 34, 1);
    halo.position.copy(focal.position);
    scene.add(halo);

    /* --------------------------------------------------------------------
       7. Post-processing — hand-rolled bloom (bright-pass + blur + composite)
    -------------------------------------------------------------------- */
    var quadCam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
    var quadScene = new THREE.Scene();
    var quadMesh = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), null);
    quadMesh.frustumCulled = false;
    quadScene.add(quadMesh);

    var QUAD_VERT = glsl([
        'varying vec2 vUv;',
        'void main() {',
        '    vUv = uv;',
        '    gl_Position = vec4(position.xy, 0.0, 1.0);',
        '}'
    ].join('\n'));

    var brightMat = new THREE.ShaderMaterial({
        uniforms: { tDiffuse: { value: null }, uThreshold: { value: 0.28 }, uSoft: { value: 0.55 } },
        vertexShader: QUAD_VERT,
        fragmentShader: glsl([
            'uniform sampler2D tDiffuse;',
            'uniform float uThreshold;',
            'uniform float uSoft;',
            'varying vec2 vUv;',
            'void main() {',
            '    vec3 c = texture2D(tDiffuse, vUv).rgb;',
            '    float l = max(c.r, max(c.g, c.b));',
            '    float f = smoothstep(uThreshold, uThreshold + uSoft, l);',
            '    gl_FragColor = vec4(c * f, 1.0);',
            '}'
        ].join('\n')),
        depthTest: false,
        depthWrite: false
    });

    var blurMat = new THREE.ShaderMaterial({
        uniforms: { tDiffuse: { value: null }, uDir: { value: new THREE.Vector2(1, 0) }, uTexel: { value: new THREE.Vector2(1 / 256, 1 / 256) } },
        vertexShader: QUAD_VERT,
        fragmentShader: glsl([
            'uniform sampler2D tDiffuse;',
            'uniform vec2 uDir;',
            'uniform vec2 uTexel;',
            'varying vec2 vUv;',
            'void main() {',
            '    vec2 o = uDir * uTexel;',
            '    vec3 s = texture2D(tDiffuse, vUv).rgb * 0.2270270270;',
            '    s += texture2D(tDiffuse, vUv + o * 1.3846153846).rgb * 0.3162162162;',
            '    s += texture2D(tDiffuse, vUv - o * 1.3846153846).rgb * 0.3162162162;',
            '    s += texture2D(tDiffuse, vUv + o * 3.2307692308).rgb * 0.0702702703;',
            '    s += texture2D(tDiffuse, vUv - o * 3.2307692308).rgb * 0.0702702703;',
            '    gl_FragColor = vec4(s, 1.0);',
            '}'
        ].join('\n')),
        depthTest: false,
        depthWrite: false
    });

    var compMat = new THREE.ShaderMaterial({
        uniforms: {
            tScene: { value: null },
            tBloom: { value: null },
            uIntensity: { value: 1.35 },
            uVignette: { value: 0.55 },
            uTime: { value: 0 }
        },
        vertexShader: QUAD_VERT,
        fragmentShader: glsl([
            'uniform sampler2D tScene;',
            'uniform sampler2D tBloom;',
            'uniform float uIntensity;',
            'uniform float uVignette;',
            'uniform float uTime;',
            'varying vec2 vUv;',
            'void main() {',
            '    vec3 base = texture2D(tScene, vUv).rgb;',
            '    vec3 bloom = texture2D(tBloom, vUv).rgb;',
            '    vec3 col = base + bloom * uIntensity;',
            '    /* gentle filmic compression keeps highlights from clipping */',
            '    col = col / (vec3(1.0) + col * 0.62);',
            '    col *= 1.28;',
            '    /* faint chromatic grid shimmer, very subtle */',
            '    float scan = 0.985 + 0.015 * sin(vUv.y * 900.0 + uTime * 8.0);',
            '    col *= scan;',
            '    float d = length(vUv - vec2(0.5));',
            '    col *= 1.0 - uVignette * d * d;',
            '    gl_FragColor = vec4(col, 1.0);',
            '}'
        ].join('\n')),
        depthTest: false,
        depthWrite: false
    });

    var post = true;
    var rtScene = null, rtA = null, rtB = null;
    var renderSize = { w: 1, h: 1 };

    function makeTarget(w, h) {
        var rt = new THREE.WebGLRenderTarget(Math.max(2, w | 0), Math.max(2, h | 0), {
            minFilter: THREE.LinearFilter,
            magFilter: THREE.LinearFilter,
            format: THREE.RGBAFormat,
            depthBuffer: true,
            stencilBuffer: false
        });
        rt.texture.generateMipmaps = false;
        return rt;
    }

    try {
        renderSize.w = Math.max(2, stage.clientWidth || window.innerWidth);
        renderSize.h = Math.max(2, stage.clientHeight || window.innerHeight);
        rtScene = makeTarget(renderSize.w, renderSize.h);
        rtA = makeTarget(renderSize.w / 4, renderSize.h / 4);
        rtB = makeTarget(renderSize.w / 4, renderSize.h / 4);
    } catch (e) {
        post = false;
    }

    function draw() {
        if (!post || !rtScene) {
            renderer.setRenderTarget(null);
            renderer.render(scene, camera);
            return;
        }
        try {
            renderer.setRenderTarget(rtScene);
            renderer.render(scene, camera);

            brightMat.uniforms.tDiffuse.value = rtScene.texture;
            quadMesh.material = brightMat;
            renderer.setRenderTarget(rtA);
            renderer.render(quadScene, quadCam);

            var i;
            for (i = 0; i < 2; i++) {
                blurMat.uniforms.tDiffuse.value = rtA.texture;
                blurMat.uniforms.uDir.value.set(1, 0);
                quadMesh.material = blurMat;
                renderer.setRenderTarget(rtB);
                renderer.render(quadScene, quadCam);

                blurMat.uniforms.tDiffuse.value = rtB.texture;
                blurMat.uniforms.uDir.value.set(0, 1);
                renderer.setRenderTarget(rtA);
                renderer.render(quadScene, quadCam);
            }

            compMat.uniforms.tScene.value = rtScene.texture;
            compMat.uniforms.tBloom.value = rtA.texture;
            quadMesh.material = compMat;
            renderer.setRenderTarget(null);
            renderer.render(quadScene, quadCam);
        } catch (e) {
            post = false;
            renderer.setRenderTarget(null);
            renderer.render(scene, camera);
        }
    }

    /* --------------------------------------------------------------------
       8. Sizing
    -------------------------------------------------------------------- */
    function resize() {
        var w = Math.max(1, stage.clientWidth || window.innerWidth || 1);
        var h = Math.max(1, stage.clientHeight || window.innerHeight || 1);
        var dpr = Math.min(window.devicePixelRatio || 1, 2);

        renderer.setPixelRatio(dpr);
        renderer.setSize(w, h, false);

        camera.aspect = w / h;
        camera.updateProjectionMatrix();

        starUniforms.uPixelRatio.value = dpr;
        shellUniforms.uPixelRatio.value = dpr;

        renderSize.w = w; renderSize.h = h;
        if (rtScene) { rtScene.setSize(w, h); }
        if (rtA) { rtA.setSize(Math.max(2, (w / 4) | 0), Math.max(2, (h / 4) | 0)); }
        if (rtB) { rtB.setSize(Math.max(2, (w / 4) | 0), Math.max(2, (h / 4) | 0)); }
        if (blurMat) {
            blurMat.uniforms.uTexel.value.set(1 / Math.max(2, (w / 4) | 0), 1 / Math.max(2, (h / 4) | 0));
        }

        if (reduced) { draw(); }
    }

    /* --------------------------------------------------------------------
       9. Interaction state (pointer + scroll, inertial easing)
    -------------------------------------------------------------------- */
    var state = {
        tPointerX: 0, tPointerY: 0, pointerX: 0, pointerY: 0,
        tScroll: 0, scroll: 0, lastScroll: 0, velocity: 0,
        maxScroll: 1, time: 0, rafId: 0, running: false, visible: true, onscreen: true,
        fps: 0, frames: 0, fpsAt: 0
    };

    var LERP_POINTER = 0.055;
    var LERP_SCROLL = 0.075;

    function readScroll() {
        return window.pageYOffset || html.scrollTop || document.body.scrollTop || 0;
    }

    function onPointer(e) {
        var w = window.innerWidth || 1;
        var h = window.innerHeight || 1;
        state.tPointerX = ((e.clientX / w) - 0.5) * 2;
        state.tPointerY = ((e.clientY / h) - 0.5) * 2;
    }

    function onScroll() {
        state.tScroll = readScroll();
    }

    function onResize() {
        resize();
        state.maxScroll = Math.max(1, (document.documentElement.scrollHeight || 0) - (window.innerHeight || 0));
    }

    /* --------------------------------------------------------------------
       10. Animation loop
    -------------------------------------------------------------------- */
    function applyScene(dt) {
        var px = state.pointerX, py = state.pointerY;
        var progress = Math.min(1, state.scroll / state.maxScroll);
        var spin = clamp(Math.abs(state.velocity) * 0.02, 0, 1.6);

        /* camera rig: pointer parallax + scroll dolly/rotation */
        rig.rotation.y = -px * 0.22 + progress * 0.10;
        rig.rotation.x = -py * 0.14 - progress * 0.06;
        rig.position.y = py * 1.6 + state.scroll * 0.0055;
        rig.position.x = px * 1.1;
        rig.position.z = progress * 10.0;

        state.time += dt;

        /* starfield: shared time uniforms + slow global drift */
        starUniforms.uTime.value = state.time;
        starField.rotation.z = state.time * 0.006 + px * 0.02;
        starField.rotation.y = state.scroll * 0.00012;

        /* nebula breathing */
        var i, sp;
        for (i = 0; i < nebulaSprites.length; i++) {
            sp = nebulaSprites[i];
            sp.position.y = sp.userData.baseY + Math.sin(state.time * 0.18 + sp.userData.phase) * 12;
            sp.material.rotation = state.time * sp.userData.spin + sp.userData.phase;
            /* breathe around the authored opacity, never above it */
            sp.material.opacity = sp.userData.baseOpacity *
                (0.82 + 0.18 * Math.sin(state.time * 0.35 + sp.userData.phase));
        }
        nebula.rotation.y = px * 0.05;
        nebula.rotation.x = py * 0.04;

        /* focal element — genuinely 3-D, multi-axis rotation */
        shellUniforms.uTime.value = state.time;
        shellUniforms.uMorph.value = 1.0 + spin * 1.4 + progress * 0.5;
        crystalUniforms.uTime.value = state.time;
        crystalUniforms.uPulse.value = (Math.sin(state.time * 1.4) * 0.5 + 0.5) + spin;
        glow.material.uniforms.uTime.value = state.time;

        focal.rotation.y += dt * (0.09 + spin * 0.30);
        focal.rotation.x = Math.sin(state.time * 0.13) * 0.22 + py * 0.18;
        focal.rotation.z = Math.cos(state.time * 0.09) * 0.12 + px * 0.12;

        shell.rotation.y -= dt * 0.16;
        shell.rotation.z += dt * 0.05;
        crystal.rotation.y += dt * 0.11;
        crystal.rotation.z -= dt * 0.07;
        crystal.scale.setScalar(4.4 + Math.sin(state.time * 1.1) * 0.14 + spin * 0.5);

        core.scale.setScalar(1 + Math.sin(state.time * 2.0) * 0.06 + spin * 0.15);

        for (i = 0; i < rings.length; i++) {
            rings[i].rotation.z += dt * rings[i].userData.speed * (1 + spin * 3);
            rings[i].rotation.y += dt * rings[i].userData.speed * 0.35;
        }

        /* tumbling satellite on an inclined orbit */
        var oa = state.time * (0.32 + spin * 0.6);
        satellite.position.set(Math.cos(oa) * 11.5, Math.sin(oa * 1.3) * 5.0, Math.sin(oa) * 6.5);
        satellite.rotation.x += dt * 0.7;
        satellite.rotation.y += dt * 0.9;

        halo.material.opacity = 0.28 + 0.10 * Math.sin(state.time * 0.9) + spin * 0.12;
        halo.position.y = Math.sin(state.time * 0.35) * 0.6;

        compMat.uniforms.uTime.value = state.time;
        compMat.uniforms.uVignette.value = 0.42 + progress * 0.22;
    }

    function frame(now) {
        state.rafId = 0;
        if (!state.running) { return; }

        var dt = state.last ? Math.min(0.05, (now - state.last) / 1000) : 0.016;
        state.last = now;

        /* inertial easing */
        state.pointerX += (state.tPointerX - state.pointerX) * LERP_POINTER;
        state.pointerY += (state.tPointerY - state.pointerY) * LERP_POINTER;
        state.scroll += (state.tScroll - state.scroll) * LERP_SCROLL;
        state.velocity = state.scroll - state.lastScroll;
        state.lastScroll = state.scroll;

        applyScene(dt);
        draw();

        /* lightweight fps meter (exposed for the runtime smoke test) */
        state.frames++;
        if (now - state.fpsAt > 1000) {
            state.fps = Math.round(state.frames * 1000 / (now - state.fpsAt));
            state.frames = 0;
            state.fpsAt = now;
        }

        schedule();
    }

    function schedule() {
        if (state.rafId || !state.running) { return; }
        state.rafId = raf(frame);
    }

    function startLoop() {
        if (state.running || reduced) { return; }
        state.running = true;
        state.last = 0;
        schedule();
    }

    function stopLoop() {
        state.running = false;
        if (state.rafId) { caf(state.rafId); state.rafId = 0; }
    }

    /* --------------------------------------------------------------------
       11. Lifecycle — visibility, on-screen, resize, context loss, motion pref
    -------------------------------------------------------------------- */
    function canRun() {
        return state.visible && state.onscreen && !reduced;
    }

    function sync() {
        if (canRun()) { startLoop(); } else { stopLoop(); }
    }

    document.addEventListener('visibilitychange', function () {
        state.visible = !document.hidden;
        sync();
    }, false);

    if (window.IntersectionObserver) {
        try {
            new IntersectionObserver(function (entries) {
                state.onscreen = entries.length ? entries[0].isIntersecting : true;
                sync();
            }, { threshold: 0 }).observe(stage);
        } catch (e) { state.onscreen = true; }
    }

    window.addEventListener('resize', onResize, false);
    window.addEventListener('orientationchange', onResize, false);
    window.addEventListener('scroll', onScroll, { passive: true });
    window.addEventListener('mousemove', onPointer, false);
    window.addEventListener('pointermove', onPointer, false);

    canvas.addEventListener('webglcontextlost', function (e) {
        e.preventDefault();
        activateCssFallback('context-lost');
    }, false);

    if (window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').addEventListener) {
        try {
            window.matchMedia('(prefers-reduced-motion: reduce)').addEventListener('change', function (e) {
                reduced = e.matches;
                if (reduced) { stopLoop(); draw(); } else { sync(); }
            });
        } catch (e2) { /* older browsers */ }
    }

    /* --------------------------------------------------------------------
       12. Boot
    -------------------------------------------------------------------- */
    stage.classList.add('p3d-webgl');
    window.P3D_WEBGL_ACTIVE = true;

    onResize();

    /* a couple of warm-up frames so the first paint is never empty */
    applyScene(0.016);
    draw();

    if (reduced) {
        state.running = false;
    } else {
        startLoop();
    }

    /* data URIs / no-layout environments can report 0 size on boot */
    window.setTimeout(function () {
        if (stage.clientWidth && renderer.domElement.width < 2) { resize(); }
        applyScene(0.016);
        draw();
    }, 120);

    /* inspection hook for smoke tests / debugging */
    window.ASTRA = {
        mode: 'webgl',
        webgl: true,
        three: (THREE && THREE.REVISION) || '0',
        reduced: reduced,
        post: post,
        small: small,
        stars: small ? 2600 + 900 + 160 : 9000 + 2800 + 420,
        state: state,
        renderer: renderer,
        scene: scene,
        camera: camera,
        dpr: function () { return renderer.getPixelRatio(); },
        renderOnce: function () { applyScene(0.016); draw(); },
        snapshot: function (x, y) {
            /* read a pixel from the composited canvas (for pixel-level checks) */
            try {
                var gl = renderer.getContext();
                var px = new Uint8Array(4);
                var sx = Math.max(0, Math.min(gl.drawingBufferWidth - 1, x | 0));
                var sy = Math.max(0, Math.min(gl.drawingBufferHeight - 1, y | 0));
                gl.readPixels(sx, gl.drawingBufferHeight - 1 - sy, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px);
                return [px[0], px[1], px[2], px[3]];
            } catch (e) { return null; }
        },
        fallbackCheck: function () { activateCssFallback('manual-test'); return window.ASTRA.mode; }
    };
})();
