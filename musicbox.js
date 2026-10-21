/* MusicBox — original music-box loop, Web Audio only. F major, 76 BPM, 4/4, 16 bars.
   A (bars 1-8):  vi–IV–I–V ×2 (Dm Bb F C)  — wistful
   B (bars 9-16): I–vi–IV–V ×2 (F Dm Bb C)  — warm, higher register; V→vi on loop. */
(function () {
  'use strict';
  var BPM = 76, STEP = 60 / BPM / 2, STEPS_PER_BAR = 8, LEVEL = 0.18;
  var LOOKAHEAD = 0.1, TICK_MS = 25;

  // Melody: MIDI per eighth note, 0 = let ring. 16 bars x 8 steps.
  var MELODY = [
    74,0,72,69, 0,0,69,72,   74,0,0,77, 74,0,72,0,    72,0,69,0, 65,0,67,69,   67,0,0,0, 64,0,67,0,
    69,0,74,0, 72,69,0,72,   70,0,69,0, 67,0,65,67,   69,0,72,0, 77,0,76,74,   72,0,0,0, 0,0,67,72,
    77,0,76,77, 0,0,72,0,    74,0,77,0, 81,0,79,77,   79,0,77,74, 0,0,70,74,   76,0,0,0, 72,0,74,76,
    77,0,81,0, 79,0,77,76,   74,0,72,74, 0,0,77,0,    74,0,72,70, 69,0,67,0,   72,0,0,0, 67,0,72,74
  ];
  // Chord per bar: [bass root, pad triad...]
  var Dm = [38, 50, 53, 57], Bb = [34, 50, 53, 58], F = [41, 53, 57, 60], C = [36, 52, 55, 60];
  var CHORDS = [Dm, Bb, F, C, Dm, Bb, F, C, F, Dm, Bb, C, F, Dm, Bb, C];
  var TOTAL = MELODY.length;

  var ctx = null, master, bus, verbIn, timer = null, stopTimer = null;
  var step = 0, nextTime = 0, playing = false, pausedByHide = false;

  function hz(m) { return 440 * Math.pow(2, (m - 69) / 12); }

  function build() {
    var AC = window.AudioContext || window.webkitAudioContext;
    ctx = new AC();
    var comp = ctx.createDynamicsCompressor();          // safety net against clipping
    comp.threshold.value = -12; comp.ratio.value = 4;
    master = ctx.createGain(); master.gain.value = 0;
    master.connect(comp); comp.connect(ctx.destination);
    bus = ctx.createGain(); bus.gain.value = 0.8; bus.connect(master);
    // Light reverb: two cross-fed damped delays (tiny FDN), wet mixed under dry.
    verbIn = ctx.createGain(); verbIn.gain.value = 0.3;
    var wet = ctx.createGain(); wet.gain.value = 0.35; wet.connect(master);
    var dA = ctx.createDelay(1), dB = ctx.createDelay(1);
    dA.delayTime.value = 0.311; dB.delayTime.value = 0.467;
    var lpA = ctx.createBiquadFilter(), lpB = ctx.createBiquadFilter();
    lpA.frequency.value = lpB.frequency.value = 2600;
    var fbA = ctx.createGain(), fbB = ctx.createGain();
    fbA.gain.value = fbB.gain.value = 0.38;            // < 0.5 total loop gain: stable
    verbIn.connect(dA); verbIn.connect(dB);
    dA.connect(lpA); lpA.connect(fbA); fbA.connect(dB);
    dB.connect(lpB); lpB.connect(fbB); fbB.connect(dA);
    lpA.connect(wet); lpB.connect(wet);
    bus.connect(verbIn);
  }

  function env(t, peak, attack, decay) {
    var g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(peak, t + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, t + attack + decay);
    g.connect(bus);
    return g;
  }

  function osc(type, f, t, end, dest, detune) {
    var o = ctx.createOscillator();
    o.type = type; o.frequency.value = f;
    if (detune) o.detune.value = detune;
    o.connect(dest); o.start(t); o.stop(end);
  }

  // Music-box tine: sine fundamental + triangle octave + faint bell partial.
  function tine(t, m, vel) {
    var f = hz(m), d = 1.6 + (84 - m) * 0.03, end = t + d + 0.05;
    osc('sine', f, t, end, env(t, 0.22 * vel, 0.004, d));
    osc('triangle', f * 2, t, end, env(t, 0.05 * vel, 0.003, d * 0.5));
    osc('sine', f * 3, t, end, env(t, 0.025 * vel, 0.002, d * 0.25), 4);
  }

  // Soft pad (filtered triangles, slow swell) + sine bass for one bar.
  function chord(t, c, len) {
    var lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 900;
    var g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.03, t + 0.7);
    g.gain.exponentialRampToValueAtTime(0.0001, t + len + 0.4);
    lp.connect(g); g.connect(bus);
    for (var i = 1; i < c.length; i++) {
      osc('triangle', hz(c[i]), t, t + len + 0.5, lp, -5);
      osc('triangle', hz(c[i]), t, t + len + 0.5, lp, 5);
    }
    osc('sine', hz(c[0]), t, t + len + 0.1, env(t, 0.12, 0.02, len));
  }

  function schedule() {
    while (nextTime < ctx.currentTime + LOOKAHEAD) {
      if (step % STEPS_PER_BAR === 0) chord(nextTime, CHORDS[step / STEPS_PER_BAR], STEP * STEPS_PER_BAR);
      var m = MELODY[step];
      if (m) tine(nextTime, m, step % 2 ? 0.8 : 1);   // offbeats slightly softer
      nextTime += STEP;
      step = (step + 1) % TOTAL;                       // seamless loop
    }
  }

  function start() {
    if (!ctx) build();
    if (stopTimer) { clearTimeout(stopTimer); stopTimer = null; }
    if (ctx.state === 'suspended') ctx.resume();
    var t = ctx.currentTime;
    master.gain.cancelScheduledValues(t);
    master.gain.setValueAtTime(master.gain.value, t);
    master.gain.linearRampToValueAtTime(LEVEL, t + 2);  // 2s fade in
    if (!timer) {
      step = 0; nextTime = t + 0.08;
      timer = setInterval(schedule, TICK_MS);
    }
    playing = true;
  }

  function stop() {
    if (!ctx || !playing) return;
    playing = false;
    var t = ctx.currentTime;
    master.gain.cancelScheduledValues(t);
    master.gain.setValueAtTime(master.gain.value, t);
    master.gain.linearRampToValueAtTime(0, t + 1);      // 1s fade out
    stopTimer = setTimeout(function () {
      clearInterval(timer); timer = null; stopTimer = null;
      ctx.suspend();
    }, 1100);
  }

  function toggle() { playing ? stop() : start(); }

  // Pause with the tab; suspended context freezes currentTime so the schedule stays valid.
  document.addEventListener('visibilitychange', function () {
    if (!ctx) return;
    if (document.hidden && playing) { pausedByHide = true; ctx.suspend(); }
    else if (!document.hidden && pausedByHide) { pausedByHide = false; ctx.resume(); }
  });

  window.MusicBox = {
    start: start, stop: stop, toggle: toggle,
    get isPlaying() { return playing; }
  };
})();
