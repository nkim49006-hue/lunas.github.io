/* LUNAS — WebGL shader background
 * Vanilla WebGL1, zero dependencies, zero paid services.
 * Own implementation — no third-party code, no license obligations.
 *
 * Palette is strictly achromatic: #000000, #0a0a0a, #151515, dark grey,
 * weak white-grey bloom. No hue channels are ever driven above 0.
 */
(function () {
  'use strict';

  var mount = document.getElementById('glbg');
  if (!mount) return;

  /* ---------- static fallback: pure CSS black-grey gradient ---------- */
  function fallback() {
    mount.remove();
    document.documentElement.classList.add('glbg-fallback');
  }

  /* ---------- capability + device tier ---------- */
  var canvas = document.createElement('canvas');
  canvas.id = 'glbg-canvas';
  canvas.setAttribute('aria-hidden', 'true');
  canvas.style.cssText = [
  'position:fixed', 'inset:0', 'width:100%', 'height:100%',
  'display:block', 'z-index:-2', 'pointer-events:none',
  'background:linear-gradient(180deg,#000000 0%,#0a0a0a 45%,#151515 100%)'
].join(';');

  var opts = { quality: 'low', dpr: 1, fps: 30, scale: 0.5 };
  var gl = null;
  try {
    gl = canvas.getContext('webgl', {
      alpha: false, antialias: false, depth: false, stencil: false,
      premultipliedAlpha: false, preserveDrawingBuffer: false,
      powerPreference: 'low-power', failIfMajorPerformanceCaveat: false
    }) || canvas.getContext('experimental-webgl', { alpha: false, antialias: false, depth: false, stencil: false });
  } catch (e) { gl = null; }
  if (!gl) { fallback(); return; }

  var coarse = false;
  try { coarse = window.matchMedia('(pointer: coarse)').matches; } catch (e) { }
  var narrow = Math.min(window.innerWidth || 0, window.innerHeight || 0) < 760;
  var cores = navigator.hardwareConcurrency || 4;
  var smallMem = (navigator.deviceMemory || 4) <= 4;
  var mobile = narrow || (coarse && cores <= 4) || cores <= 2;
  var reduceMotion = false;
  try { reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches; } catch (e) { }

  if (mobile || cores <= 2) { opts.quality = 'low'; opts.dpr = 1; opts.fps = 30; opts.scale = 0.34; }
  else if (narrow || smallMem || cores <= 4) { opts.quality = 'mid'; opts.dpr = Math.min(window.devicePixelRatio || 1, 1.5); opts.fps = 45; opts.scale = 0.6; }
  else { opts.quality = 'high'; opts.dpr = Math.min(window.devicePixelRatio || 1, 2); opts.fps = 60; opts.scale = 0.8; }

  /* ---------- shaders ---------- */
  var VERT = [
    'attribute vec2 aPos;',
    'void main(){ gl_Position = vec4(aPos, 0.0, 1.0); }'
  ].join('\n');

  var OCTAVES = { low: 3, mid: 4, high: 5 }[opts.quality];

  var FRAG = [
    'precision highp float;',
    'uniform vec2  uRes;',
    'uniform float uTime;',
    'uniform vec2  uMouse;',
    'uniform float uOct;',
    '',
    'float hash(vec2 p){',
    '  p = fract(p * vec2(123.34, 456.21));',
    '  p += dot(p, p + 45.32);',
    '  return fract(p.x * p.y);',
    '}',
    '',
    'float vnoise(vec2 p){',
    '  vec2 i = floor(p);',
    '  vec2 f = fract(p);',
    '  vec2 u = f * f * (3.0 - 2.0 * f);',
    '  float a = hash(i);',
    '  float b = hash(i + vec2(1.0, 0.0));',
    '  float c = hash(i + vec2(0.0, 1.0));',
    '  float d = hash(i + vec2(1.0, 1.0));',
    '  return mix(mix(a, b, u.x), mix(c, d, u.x), u.y);',
    '}',
    '',
    'float fbm(vec2 p){',
    '  float v = 0.0;',
    '  float a = 0.5;',
    '  mat2 rot = mat2(1.62, 1.20, -1.20, 1.62);',
    '  for (int i = 0; i < 5; i++) {',
    '    if (float(i) >= uOct) break;',
    '    v += a * vnoise(p);',
    '    p = rot * p;',
    '    a *= 0.5;',
    '  }',
    '  return v;',
    '}',
    '',
    'void main(){',
    '  vec2 uv = gl_FragCoord.xy / uRes.xy;',
    '  float aspect = uRes.x / max(uRes.y, 1.0);',
    '  vec2 p = vec2(uv.x * aspect, uv.y);',
    '  vec2 ctr = vec2(aspect * 0.5, 0.5);',
    '  p -= ctr;',
    '',
    /* very light parallax drift toward the pointer, max ~0.09 world units */
    '  vec2 m = (uMouse - 0.5) * 0.18;',
    '  p -= m * (0.55 + 0.45 * dot(p, p));',
    '',
    /* slow, non-repeating-feeling time: two incommensurate clocks */
    '  float t = uTime * 0.028;',
    '  float t2 = uTime * 0.017;',
    '',
    /* domain warp -> liquid / smoke */
    '  vec2 q = vec2(fbm(p * 1.05 + vec2(0.0, t)),',
    '                fbm(p * 1.05 + vec2(4.7, -t2)));',
    '  vec2 r = vec2(fbm(p * 1.45 + 2.6 * q + vec2(t2, 0.0)),',
    '                fbm(p * 1.45 + 2.6 * q + vec2(0.0, -t)));',
    '  float w = fbm(p * 1.55 + 2.9 * r) * 0.90;',
    '  w += 0.26 * length(r);',
    '',
    /* finer smoke detail so the waves have internal structure */
    '  float det = fbm(p * 3.30 - 1.5 * q);',
    '  w += (det - 0.47) * 0.30;',
    '',
    /* depth: darker toward the edges, faint soft core */
    '  float rad = length(vec2(uv.x - 0.5, uv.y - 0.5) * vec2(1.06, 1.0));',
    '  float depth = smoothstep(1.05, 0.06, rad);',
    '  float core = smoothstep(0.90, 0.08, rad);',
    '',
    /* tonal ramp — every stop is a neutral grey, R==G==B by construction */
    '  float v = w * 0.76 + depth * 0.18 + core * 0.08;',
    '  v = clamp((v - 0.46) * 1.34 + 0.46, 0.0, 1.0);',
    '  vec3 col = vec3(0.0);',
    '  col = mix(col, vec3(0.0392), smoothstep(0.02, 0.40, v));',
    '  col = mix(col, vec3(0.0824), smoothstep(0.30, 0.64, v));',
    '  col = mix(col, vec3(0.1451), smoothstep(0.56, 0.86, v));',
    '  col = mix(col, vec3(0.2059), smoothstep(0.82, 1.00, v));',
    '',
    /* weak white-grey bloom, tightly bounded */
    '  float bloom = pow(smoothstep(0.78, 1.06, v), 2.2) * 0.105;',
    '  col += vec3(bloom);',
    '',
    /* soft vignette for depth */
    '  col *= 1.0 - smoothstep(0.55, 1.25, rad) * 0.58;',
    '',
    /* global exposure — keeps the field inside #0a0a0a..#151515 with dark-grey
       crests and only a faint white-grey bloom above that */
    '  col *= 1.0;',
    '',
    '  gl_FragColor = vec4(clamp(col, 0.0, 1.0), 1.0);',
    '}'
  ].join('\n');

  /* ---------- program ---------- */
  function compile(type, src) {
    var s = gl.createShader(type);
    gl.shaderSource(s, src);
    gl.compileShader(s);
    if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) {
      console.warn('[glbg] shader compile failed:', gl.getShaderInfoLog(s));
      return null;
    }
    return s;
  }
  var vs = compile(gl.VERTEX_SHADER, VERT);
  var fs = compile(gl.FRAGMENT_SHADER, FRAG);
  if (!vs || !fs) { fallback(); return; }

  var prog = gl.createProgram();
  gl.attachShader(prog, vs);
  gl.attachShader(prog, fs);
  gl.bindAttribLocation(prog, 0, 'aPos');
  gl.linkProgram(prog);
  if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) {
    console.warn('[glbg] link failed:', gl.getProgramInfoLog(prog));
    fallback();
    return;
  }
  gl.useProgram(prog);

  var buf = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, buf);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
  gl.enableVertexAttribArray(0);
  gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);

  var U = {
    res: gl.getUniformLocation(prog, 'uRes'),
    time: gl.getUniformLocation(prog, 'uTime'),
    mouse: gl.getUniformLocation(prog, 'uMouse'),
    oct: gl.getUniformLocation(prog, 'uOct')
  };
  gl.uniform1f(U.oct, OCTAVES);
  gl.clearColor(0, 0, 0, 1);

  /* ---------- sizing ---------- */
  function resize() {
    var w = Math.max(1, Math.floor((window.innerWidth || 1) * opts.dpr * opts.scale));
    var h = Math.max(1, Math.floor((window.innerHeight || 1) * opts.dpr * opts.scale));
    /* hard ceiling so a 4K display cannot ask for a huge buffer */
    var maxPx = mobile ? 420000 : 1500000;
    if (w * h > maxPx) {
      var k = Math.sqrt(maxPx / (w * h));
      w = Math.max(1, Math.floor(w * k));
      h = Math.max(1, Math.floor(h * k));
    }
    if (canvas.width !== w || canvas.height !== h) {
      canvas.width = w;
      canvas.height = h;
      gl.viewport(0, 0, w, h);
      gl.uniform2f(U.res, w, h);
    }
  }
  resize();
  mount.parentNode.insertBefore(canvas, mount);
  mount.remove();

  /* ---------- pointer ---------- */
  var mx = 0.5, my = 0.5, tx = 0.5, ty = 0.5;
  window.addEventListener('pointermove', function (e) {
    tx = (e.clientX || 0) / Math.max(1, window.innerWidth);
    ty = 1 - (e.clientY || 0) / Math.max(1, window.innerHeight);
  }, { passive: true });
  window.addEventListener('pointerleave', function () { tx = 0.5; ty = 0.5; }, { passive: true });

  /* ---------- render loop ---------- */
  var t0 = 0, last = 0, raf = 0, alive = true, minFrame = 1000 / opts.fps;

  function frame(now) {
    if (!alive) return;
    raf = requestAnimationFrame(frame);
    if (!t0) { t0 = now; last = now; draw(now); return; }
    if (now - last < minFrame) return;
    /* gentle clock so tab-switch gaps never cause a visible jump */
    var dt = Math.min(64, now - last);
    last = now;
    clock += dt / 1000;
    draw(now);
  }
  var clock = 0;

  function draw() {
    mx += (tx - mx) * 0.035;
    my += (ty - my) * 0.035;
    gl.uniform1f(U.time, clock);
    gl.uniform2f(U.mouse, mx, my);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
  }

  function stop() {
    alive = false;
    if (raf) cancelAnimationFrame(raf);
  }

  function start() {
    if (alive || reduceMotion) return;
    alive = true;
    last = 0;
    raf = requestAnimationFrame(frame);
  }

  if (reduceMotion) {
    /* static single frame — same look, no motion */
    resize(); draw();
  } else {
    raf = requestAnimationFrame(frame);
  }

  /* ---------- lifecycle ---------- */
  var rt = 0;
  window.addEventListener('resize', function () {
    clearTimeout(rt);
    rt = setTimeout(function () { resize(); if (reduceMotion) draw(); }, 160);
  }, { passive: true });

  document.addEventListener('visibilitychange', function () {
    if (document.hidden) stop(); else start();
  });

  canvas.addEventListener('webglcontextlost', function (e) {
    e.preventDefault();
    stop();
    fallback();
  }, false);

  /* expose for diagnostics */
  window.__glbg = {
    quality: opts.quality, dpr: opts.dpr, fps: opts.fps,
    scale: opts.scale, octaves: OCTAVES, mobile: mobile,
    reduceMotion: reduceMotion,
    size: function () { return canvas.width + 'x' + canvas.height; }
  };
})();
