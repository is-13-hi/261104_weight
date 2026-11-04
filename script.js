(() => {
'use strict';

/* =====================================================
   設定（先生が変えられるところ）
   ===================================================== */
const HOLD_SECONDS = 5;   // 全員そろってEnterを押し続ける秒数
const REDUCED = window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches;
const EMOJI_FONT = '"Apple Color Emoji","Segoe UI Emoji","Noto Color Emoji","Twemoji Mozilla",sans-serif';

const $ = (id) => document.getElementById(id);
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const lerp = (a, b, t) => a + (b - a) * t;
const rand = (a, b) => a + Math.random() * (b - a);
const easeOut = (t) => 1 - Math.pow(1 - t, 3);
const easeInOut = (t) => (t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2);
const easeOutBack = (t) => { const c1 = 1.70158, c3 = c1 + 1; return 1 + c3 * Math.pow(t - 1, 3) + c1 * Math.pow(t - 1, 2); };

/* =====================================================
   おと（WebAudio と よみあげ）
   ===================================================== */
const Sound = {
  ctx: null,
  enabled: true,
  init() {
    if (!this.ctx) {
      try { this.ctx = new (window.AudioContext || window.webkitAudioContext)(); } catch (e) { this.ctx = null; }
    }
    if (this.ctx && this.ctx.state === 'suspended') this.ctx.resume();
  },
  tone(freq, dur = 0.2, type = 'sine', vol = 0.2, slideTo = null, delay = 0) {
    if (!this.enabled || !this.ctx) return;
    const t = this.ctx.currentTime + delay;
    const o = this.ctx.createOscillator();
    const g = this.ctx.createGain();
    o.type = type;
    o.frequency.setValueAtTime(freq, t);
    if (slideTo) o.frequency.exponentialRampToValueAtTime(slideTo, t + dur);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(vol, t + 0.01);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g).connect(this.ctx.destination);
    o.start(t);
    o.stop(t + dur + 0.05);
  },
  speak(text) {
    if (!this.enabled || !('speechSynthesis' in window)) return;
    try {
      speechSynthesis.cancel();
      const u = new SpeechSynthesisUtterance(text);
      u.lang = 'ja-JP';
      u.rate = 0.9;
      speechSynthesis.speak(u);
    } catch (e) { /* ignore */ }
  },
  stopSpeak() {
    if ('speechSynthesis' in window) { try { speechSynthesis.cancel(); } catch (e) { /* ignore */ } }
  },
  pullTick(frac) { this.tone(95 + frac * 90, 0.14, 'triangle', 0.22, 70 + frac * 40); },
  join(i) {
    const notes = [262, 294, 330, 392, 440, 523];
    const f = notes[i % notes.length];
    this.tone(f, 0.35, 'triangle', 0.25);
    this.tone(f * 2, 0.25, 'sine', 0.1, null, 0.04);
  },
  fanfare() {
    [523, 659, 784, 1047].forEach((f, i) => this.tone(f, 0.28, 'triangle', 0.25, null, i * 0.13));
    this.tone(1047, 0.7, 'sine', 0.2, null, 0.55);
    this.tone(784, 0.7, 'sine', 0.15, null, 0.55);
  },
  impact(kg) {
    const lr = Math.log10(kg);                    // -1.5 〜 4.5
    const f = 420 - (lr + 1.5) * 55;              // かるい=たかい 〜 おもい=ひくい
    const dur = 0.12 + (lr + 1.5) * 0.07;
    this.tone(f, dur, 'sine', 0.35, f * 0.5);
    if (lr > 1) this.tone(f * 0.5, dur * 1.2, 'triangle', 0.25, f * 0.3);
    if (navigator.vibrate) { try { navigator.vibrate(Math.round(20 + (lr + 1.5) * 25)); } catch (e) { /* ignore */ } }
  },
  ding() { this.tone(660, 0.25, 'sine', 0.2); this.tone(880, 0.3, 'sine', 0.15, null, 0.08); },
  tick() { this.tone(520, 0.06, 'sine', 0.12); }
};

/* =====================================================
   がめん きりかえ・キー入力
   ===================================================== */
let mode = 'kabu';
const pullSources = new Set();   // 'key' / 'ptr' … どれかが押されていれば「ひっぱっている」

function setMode(m) {
  mode = m;
  $('kabuView').hidden = m !== 'kabu';
  $('weightView').hidden = m !== 'weight';
  $('tabKabu').classList.toggle('active', m === 'kabu');
  $('tabWeight').classList.toggle('active', m === 'weight');
  $('tabKabu').setAttribute('aria-selected', String(m === 'kabu'));
  $('tabWeight').setAttribute('aria-selected', String(m === 'weight'));
  pullSources.clear();
  Sound.stopSpeak();
  if (m === 'weight') { renderPalette(); renderSlots(); }
}

$('tabKabu').addEventListener('click', (e) => { Sound.init(); setMode('kabu'); e.currentTarget.blur(); });
$('tabWeight').addEventListener('click', (e) => { Sound.init(); setMode('weight'); e.currentTarget.blur(); });

$('soundBtn').addEventListener('click', (e) => {
  Sound.init();
  Sound.enabled = !Sound.enabled;
  e.currentTarget.setAttribute('aria-pressed', String(Sound.enabled));
  e.currentTarget.textContent = Sound.enabled ? '🔊 おと' : '🔇 おと';
  if (!Sound.enabled) Sound.stopSpeak(); else Sound.tick();
  e.currentTarget.blur();
});

$('fullBtn').addEventListener('click', (e) => {
  if (!document.fullscreenElement) { if (document.documentElement.requestFullscreen) document.documentElement.requestFullscreen(); }
  else if (document.exitFullscreen) document.exitFullscreen();
  e.currentTarget.blur();
});

const HANDLED_KEYS = ['Enter', ' ', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Escape', 'Backspace'];

document.addEventListener('keydown', (e) => {
  if (e.ctrlKey || e.metaKey || e.altKey) return;
  const k = e.key;
  if (HANDLED_KEYS.includes(k)) e.preventDefault();   // スクロールやボタン作動をふせぐ
  if (e.repeat) return;
  Sound.init();
  if (k === '1') { setMode('kabu'); return; }
  if (k === '2') { setMode('weight'); return; }
  if (mode === 'kabu') kabuKeyDown(k); else weightKeyDown(k);
});

document.addEventListener('keyup', (e) => {
  if (e.key === ' ') e.preventDefault();
  if (e.key === 'Enter' || e.key === ' ') { pullSources.delete('key'); $('pullBtn').classList.remove('held'); }
});

window.addEventListener('blur', () => { pullSources.clear(); $('pullBtn').classList.remove('held'); });

/* =====================================================
   1. おおきなかぶ
   ===================================================== */
const CHARACTERS = [
  { name: 'おじいさん', emoji: '👴', size: 120 },
  { name: 'おばあさん', emoji: '👵', size: 120 },
  { name: 'まご',       emoji: '🧒', size: 100 },
  { name: 'いぬ',       emoji: '🐕', size: 100 },
  { name: 'ねこ',       emoji: '🐈', size: 90 },
  { name: 'ねずみ',     emoji: '🐁', size: 70 }
];
const NCHAR = CHARACTERS.length;

const canvas = $('kabuCanvas');
const ctx = canvas.getContext('2d');
const W = 1280, H = 720;
const GROUND = 500;     // じめんの たかさ
const KX = 230;         // かぶの よこいち
const KR = 130;         // かぶの はんけい
const FEET = 625;       // なかまの あしもと
const RISE_PX = 115;    // かぶが ぬける ときの うごき
const charX = (i) => 470 + i * 128;

const K = {
  n: 1, p: 0, target: 0, riseD: 0,
  state: 'play', outT: 0, time: 0,
  joinT: [99, 99, 99, 99, 99, 99],
  lean: 0, wasPulling: false,
  pullClock: 0, tick: -1, bubbleN: -1, dust: 0,
  strainHint: false,
  particles: [], confetti: []
};

/* --- UI（なかまチップ・ほし） --- */
const crewEl = $('crew');
const starsEl = $('stars');
CHARACTERS.forEach((c) => {
  const li = document.createElement('li');
  li.className = 'chip off';
  li.innerHTML = `<span class="e">${c.emoji}</span><span class="n">${c.name}</span>`;
  crewEl.appendChild(li);
});
for (let i = 0; i < HOLD_SECONDS; i++) {
  const s = document.createElement('span');
  s.className = 's';
  s.textContent = '★';
  starsEl.appendChild(s);
}
let lastLit = -1;

function refreshCrewUI() {
  [...crewEl.children].forEach((li, i) => li.classList.toggle('off', i >= K.n));
}
function refreshStars() {
  const full = K.n === NCHAR;
  let lit = 0;
  if (K.state === 'out') lit = HOLD_SECONDS;
  else if (full) lit = Math.floor(K.p + 0.0001);
  if (lit !== lastLit) {
    lastLit = lit;
    [...starsEl.children].forEach((s, i) => s.classList.toggle('on', i < lit));
  }
}
refreshCrewUI();

/* --- そうさ --- */
function addMember() {
  if (K.state === 'out' || K.n >= NCHAR) return;
  K.joinT[K.n] = 0;
  Sound.join(K.n);
  Sound.speak(CHARACTERS[K.n].name);
  K.n++;
  refreshCrewUI();
}
function removeMember() {
  if (K.n <= 1) return;
  K.n--;
  K.joinT[K.n] = 99;
  resetRound();
  refreshCrewUI();
  Sound.tick();
}
function resetRound() {
  K.state = 'play';
  K.p = 0; K.target = 0; K.riseD = 0; K.outT = 0;
  K.confetti = [];
  K.pullClock = 0; K.tick = -1; K.bubbleN = -1;
  Sound.stopSpeak();
}
function resetAll() {
  K.n = 1;
  K.joinT = [99, 99, 99, 99, 99, 99];
  resetRound();
  refreshCrewUI();
}
function kabuPullStart(src) {
  if (K.state === 'out') {
    if (K.outT > 2.5) resetRound(); else return;
  }
  pullSources.add(src);
  $('pullBtn').classList.add('held');
}
function kabuKeyDown(k) {
  if (k === 'Enter' || k === ' ') kabuPullStart('key');
  else if (k === 'ArrowUp') addMember();
  else if (k === 'ArrowDown') removeMember();
  else if (k === 'Escape' || k === 'Backspace') resetAll();
}

/* --- がめんの ボタン（マウス・タッチ） --- */
(function setupKabuButtons() {
  const pb = $('pullBtn');
  const end = () => { pullSources.delete('ptr'); pb.classList.remove('held'); };
  pb.addEventListener('pointerdown', (e) => {
    e.preventDefault();
    Sound.init();
    try { pb.setPointerCapture(e.pointerId); } catch (err) { /* ignore */ }
    kabuPullStart('ptr');
  });
  pb.addEventListener('pointerup', end);
  pb.addEventListener('pointercancel', end);
  pb.addEventListener('lostpointercapture', end);
  pb.addEventListener('contextmenu', (e) => e.preventDefault());
  pb.addEventListener('keydown', (e) => e.preventDefault());

  $('addBtn').addEventListener('click', (e) => { Sound.init(); addMember(); e.currentTarget.blur(); });
})();

/* --- こうしん --- */
function spawnConfetti(n) {
  const colors = ['#ff6b6b', '#ffb400', '#4cc9a4', '#4d96ff', '#c77dff', '#ff8fab'];
  for (let i = 0; i < n; i++) {
    K.confetti.push({
      x: rand(150, 1150), y: rand(-80, -10),
      vx: rand(-40, 40), vy: rand(110, 230),
      r: rand(0, 6.28), vr: rand(-3, 3),
      w: rand(12, 22), h: rand(8, 14),
      c: colors[(Math.random() * colors.length) | 0]
    });
  }
}

function success() {
  K.state = 'out';
  K.outT = 0;
  K.target = 1;
  Sound.fanfare();
  Sound.speak('ぬけた！');
  if (!REDUCED) spawnConfetti(70);
}

function updateKabu(dt) {
  K.time += dt;
  for (let i = 0; i < NCHAR; i++) K.joinT[i] += dt;

  const full = K.n === NCHAR;
  const pulling = pullSources.size > 0 && K.state === 'play';

  if (pulling && !K.wasPulling) { K.pullClock = 0; K.tick = -1; K.bubbleN = -1; }
  K.wasPulling = pulling;

  if (K.state === 'play') {
    if (pulling) { K.p = Math.min(HOLD_SECONDS, K.p + dt); K.pullClock += dt; }
    else K.p = Math.max(0, K.p - dt * 2);

    const frac = K.p / HOLD_SECONDS;
    const cap = full ? 1 : Math.min(0.5, (K.n - 1) * 0.1);   // にんずうが たりないと とちゅうで とまる
    K.target = Math.min(frac, cap);

    if (pulling) {
      const tIdx = Math.floor(K.pullClock / 0.5);
      if (tIdx !== K.tick) { K.tick = tIdx; Sound.pullTick(frac); }
      const bIdx = Math.floor(K.pullClock / 1.3);
      if (bIdx !== K.bubbleN) { K.bubbleN = bIdx; Sound.speak(bIdx % 2 === 0 ? 'うんとこしょ' : 'どっこいしょ'); }

      K.dust += dt;
      if (K.dust > 0.07) {
        K.dust = 0;
        K.particles.push({ x: KX + rand(-150, 150), y: GROUND + 6, vx: rand(-60, 60), vy: rand(-120, -40), life: 0.6, max: 0.6, r: rand(8, 16) });
      }
    }
    K.strainHint = pulling && !full && K.pullClock > 1.5;

    if (full && K.p >= HOLD_SECONDS && pulling) success();
  } else {
    K.outT += dt;
    K.strainHint = false;
    if (!REDUCED && K.outT < 2.5) spawnConfetti(2);
  }

  K.riseD += (K.target - K.riseD) * Math.min(1, dt * (K.state === 'out' ? 9 : 5));

  const leanT = pulling ? 0.3 : 0;
  K.lean += (leanT - K.lean) * Math.min(1, dt * 8);

  for (const p of K.particles) { p.life -= dt; p.x += p.vx * dt; p.y += p.vy * dt; p.vy += 120 * dt; }
  K.particles = K.particles.filter((p) => p.life > 0);
  for (const c of K.confetti) { c.x += c.vx * dt + Math.sin(K.time * 3 + c.r) * 0.6; c.y += c.vy * dt; c.r += c.vr * dt; }
  K.confetti = K.confetti.filter((c) => c.y < H + 40);

  $('addBtn').classList.toggle('nudge', K.strainHint);
  refreshStars();
}

/* --- えがく --- */
function ellipse(x, y, rx, ry) { ctx.beginPath(); ctx.ellipse(x, y, rx, ry, 0, 0, Math.PI * 2); }

function cloud(x, y, s) {
  ctx.fillStyle = 'rgba(255,255,255,0.95)';
  [[0, 0, 44], [46, -14, 54], [98, 0, 42], [48, 12, 46]].forEach(([dx, dy, r]) => {
    ctx.beginPath(); ctx.arc(x + dx * s, y + dy * s, r * s, 0, Math.PI * 2); ctx.fill();
  });
}

function drawBackground() {
  const g = ctx.createLinearGradient(0, 0, 0, GROUND);
  g.addColorStop(0, '#aee3ff');
  g.addColorStop(1, '#fff6d8');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, W, H);

  ctx.fillStyle = '#ffd84d';
  ctx.beginPath(); ctx.arc(1140, 110, 62, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = 'rgba(255,216,77,0.3)';
  ctx.beginPath(); ctx.arc(1140, 110, 86, 0, Math.PI * 2); ctx.fill();

  const drift = REDUCED ? 0 : K.time * 8;
  cloud(((300 + drift) % (W + 300)) - 150, 130, 1);
  cloud(((820 + drift * 0.7) % (W + 300)) - 150, 80, 0.8);

  const hill = (x0, x1, cx, top, color) => {
    ctx.fillStyle = color;
    ctx.beginPath(); ctx.moveTo(x0, GROUND); ctx.quadraticCurveTo(cx, top, x1, GROUND); ctx.closePath(); ctx.fill();
  };
  hill(-100, 520, 210, 330, '#b7e6a3');
  hill(380, 1100, 740, 350, '#a2dc8c');
  hill(900, 1400, 1150, 360, '#b7e6a3');
}

function drawKabuBody(cx, cy, mood, rot) {
  ctx.save();
  ctx.translate(cx, cy);
  ctx.rotate(rot);

  // ね
  ctx.fillStyle = '#efe3cc';
  ctx.strokeStyle = '#cdbb99';
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.moveTo(-26, KR * 0.75);
  ctx.quadraticCurveTo(-8, KR * 1.5, 0, KR * 2.1);
  ctx.quadraticCurveTo(8, KR * 1.5, 26, KR * 0.75);
  ctx.closePath(); ctx.fill(); ctx.stroke();

  // は
  const leaves = [[-0.95, 0.9], [-0.5, 1.05], [0, 1.15], [0.5, 1.05], [0.95, 0.9]];
  ctx.fillStyle = '#3fae49';
  ctx.strokeStyle = '#2c8a38';
  ctx.lineWidth = 4;
  for (const [a, len] of leaves) {
    const sway = Math.sin(K.time * 3 + a * 3) * 0.03 * (mood === 'pull' ? 3 : 1);
    ctx.save();
    ctx.translate(0, -KR * 0.85);
    ctx.rotate(a + sway);
    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.quadraticCurveTo(-42, -KR * len * 0.55, 0, -KR * len);
    ctx.quadraticCurveTo(42, -KR * len * 0.55, 0, 0);
    ctx.fill(); ctx.stroke();
    ctx.restore();
  }

  // ほんたい
  const bg = ctx.createRadialGradient(-35, -40, 10, 0, 0, KR);
  bg.addColorStop(0, '#ffffff');
  bg.addColorStop(1, '#ece6f0');
  ctx.fillStyle = bg;
  ellipse(0, 0, KR, KR * 0.92); ctx.fill();

  ctx.save();
  ellipse(0, 0, KR, KR * 0.92); ctx.clip();
  const pg = ctx.createLinearGradient(0, -KR, 0, -KR * 0.15);
  pg.addColorStop(0, 'rgba(190,80,160,0.95)');
  pg.addColorStop(1, 'rgba(190,80,160,0)');
  ctx.fillStyle = pg;
  ctx.fillRect(-KR, -KR, KR * 2, KR * 0.9);
  ctx.restore();

  ctx.strokeStyle = '#b9a9c4';
  ctx.lineWidth = 4;
  ellipse(0, 0, KR, KR * 0.92); ctx.stroke();

  // かお
  ctx.strokeStyle = '#4a3a4f';
  ctx.fillStyle = '#4a3a4f';
  ctx.lineWidth = 7;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  const ey = -62, ex = 44;
  if (mood === 'pull') {
    ctx.beginPath(); ctx.moveTo(-ex - 14, ey - 12); ctx.lineTo(-ex + 10, ey); ctx.lineTo(-ex - 14, ey + 12); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(ex + 14, ey - 12); ctx.lineTo(ex - 10, ey); ctx.lineTo(ex + 14, ey + 12); ctx.stroke();
  } else if (mood === 'happy') {
    ctx.beginPath(); ctx.arc(-ex, ey + 8, 14, Math.PI * 1.1, Math.PI * 1.9); ctx.stroke();
    ctx.beginPath(); ctx.arc(ex, ey + 8, 14, Math.PI * 1.1, Math.PI * 1.9); ctx.stroke();
  } else {
    ctx.beginPath(); ctx.arc(-ex, ey, 9, 0, Math.PI * 2); ctx.fill();
    ctx.beginPath(); ctx.arc(ex, ey, 9, 0, Math.PI * 2); ctx.fill();
  }
  ctx.beginPath();
  if (mood === 'pull') { ctx.moveTo(-18, -26); ctx.lineTo(18, -26); }
  else { ctx.arc(0, -40, 20, 0.15 * Math.PI, 0.85 * Math.PI); }
  ctx.stroke();

  ctx.fillStyle = 'rgba(255,130,150,0.45)';
  ellipse(-76, -34, 16, 10); ctx.fill();
  ellipse(76, -34, 16, 10); ctx.fill();

  ctx.restore();
}

function poseOf(i) {
  const c = CHARACTERS[i];
  const pulling = pullSources.size > 0 && K.state === 'play';
  let ang, yOff = 0, xOff = 0;
  if (K.state === 'play') {
    const wob = pulling && !REDUCED ? Math.sin(K.time * 14 + i * 0.8) * 0.025 : 0;
    ang = K.lean + wob;
    if (!pulling) yOff = Math.sin(K.time * 2 + i) * 2;
  } else {
    const t = K.outT - i * 0.07;
    const fall = easeOut(clamp(t / 0.5, 0, 1));
    const up = easeInOut(clamp((t - 2.2) / 0.7, 0, 1));
    ang = (0.3 + (1.45 - 0.3) * fall) * (1 - up);
    xOff = 30 * fall * (1 - up);
    if (t > 3.0) yOff = -Math.abs(Math.sin((t - 3.0) * 5 + i)) * 22;
  }
  const pop = easeOutBack(clamp(K.joinT[i] / 0.45, 0, 1));
  return { x: charX(i) + xOff, y: FEET + yOff, ang, pop, size: c.size };
}

function drawKabuScene() {
  const pulling = pullSources.size > 0 && K.state === 'play';
  const out = K.state === 'out';
  const frac = K.p / HOLD_SECONDS;

  drawBackground();

  // かぶ
  let kcy = GROUND - K.riseD * RISE_PX;
  let shake = 0, rot = 0;
  if (pulling && !REDUCED) {
    shake = Math.sin(K.time * 38) * (3 + 6 * frac);
    rot = Math.sin(K.time * 30) * 0.02;
  }
  if (out) kcy -= Math.abs(Math.sin(K.outT * 7)) * 70 * Math.exp(-K.outT * 2.2);
  const mood = out ? 'happy' : (pulling ? 'pull' : 'normal');
  drawKabuBody(KX + shake, kcy, mood, rot);

  // じめん
  const gg = ctx.createLinearGradient(0, GROUND, 0, H);
  gg.addColorStop(0, '#6fcf5a');
  gg.addColorStop(1, '#4aa83e');
  ctx.fillStyle = gg;
  ctx.fillRect(0, GROUND, W, H - GROUND);
  ctx.fillStyle = 'rgba(255,255,255,0.12)';
  ctx.fillRect(0, GROUND, W, 6);

  // つち
  ctx.fillStyle = '#8b6b4a';
  ellipse(KX, GROUND + 4, 180, 26); ctx.fill();
  if (out) { ctx.fillStyle = '#4e3622'; ellipse(KX, GROUND + 6, 110, 15); ctx.fill(); }

  // ほこり
  for (const p of K.particles) {
    ctx.fillStyle = `rgba(201,176,138,${clamp(p.life / p.max, 0, 1) * 0.8})`;
    ctx.beginPath(); ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2); ctx.fill();
  }

  // なかま
  const poses = [];
  for (let i = 0; i < K.n; i++) poses.push(poseOf(i));

  // ロープ
  const stalk = { x: KX + 20, y: kcy - KR * 0.85 };
  const pts = [stalk];
  poses.forEach((p) => {
    const hx = -p.size * 0.3, hy = -p.size * 0.55;
    pts.push({
      x: p.x + hx * Math.cos(p.ang) - hy * Math.sin(p.ang),
      y: p.y + hx * Math.sin(p.ang) + hy * Math.cos(p.ang)
    });
  });
  const sag = out ? 34 : 22 * (1 - K.lean / 0.3 * 0.9);
  ctx.strokeStyle = '#9c6b3a';
  ctx.lineWidth = 9;
  ctx.lineCap = 'round';
  for (let i = 0; i < pts.length - 1; i++) {
    const a = pts[i], b = pts[i + 1];
    ctx.beginPath();
    ctx.moveTo(a.x, a.y);
    ctx.quadraticCurveTo((a.x + b.x) / 2, (a.y + b.y) / 2 + sag, b.x, b.y);
    ctx.stroke();
  }

  // かげ・キャラ（うしろから まえへ）
  for (let i = K.n - 1; i >= 0; i--) {
    const p = poses[i];
    ctx.fillStyle = 'rgba(0,0,0,0.16)';
    ellipse(p.x, FEET + 6, p.size * 0.42 * Math.max(p.pop, 0), 10); ctx.fill();
    ctx.save();
    ctx.translate(p.x, p.y);
    ctx.rotate(p.ang);
    ctx.scale(Math.max(p.pop, 0.01), Math.max(p.pop, 0.01));
    ctx.font = `${p.size}px ${EMOJI_FONT}`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = '#000';
    ctx.fillText(CHARACTERS[i].emoji, 0, -p.size * 0.5);
    ctx.restore();
  }

  // ふきだし
  if (pulling && K.pullClock > 0.05) {
    const text = K.bubbleN % 2 === 0 ? 'うんとこしょ！' : 'どっこいしょ！';
    const mid = (charX(0) + charX(K.n - 1)) / 2;
    const bx = clamp(mid, 560, 960), by = 300, bw = 430, bh = 96;
    ctx.fillStyle = '#fff';
    ctx.strokeStyle = '#2b2a33';
    ctx.lineWidth = 5;
    ctx.beginPath();
    ctx.roundRect(bx - bw / 2, by - bh / 2, bw, bh, 36);
    ctx.fill(); ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(bx - 20, by + bh / 2 - 2);
    ctx.lineTo(bx, by + bh / 2 + 34);
    ctx.lineTo(bx + 24, by + bh / 2 - 2);
    ctx.closePath();
    ctx.fillStyle = '#fff'; ctx.fill(); ctx.stroke();
    ctx.fillStyle = '#fff';
    ctx.fillRect(bx - 17, by + bh / 2 - 6, 38, 8);
    ctx.fillStyle = '#2b2a33';
    ctx.font = `800 56px "BIZ UDPGothic","Hiragino Maru Gothic ProN","Yu Gothic UI","Meiryo",sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(text, bx, by + 2);
  }

  // かみふぶき
  for (const c of K.confetti) {
    ctx.save();
    ctx.translate(c.x, c.y);
    ctx.rotate(c.r);
    ctx.fillStyle = c.c;
    ctx.fillRect(-c.w / 2, -c.h / 2, c.w, c.h);
    ctx.restore();
  }

  // ぬけた！
  if (out) {
    const s = Math.max(0.01, easeOutBack(clamp(K.outT / 0.5, 0, 1)));
    ctx.save();
    ctx.translate(640, 190);
    ctx.scale(s, s);
    ctx.font = `800 170px "BIZ UDPGothic","Hiragino Maru Gothic ProN","Yu Gothic UI","Meiryo",sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.lineJoin = 'round';
    ctx.lineWidth = 22;
    ctx.strokeStyle = '#fff';
    ctx.strokeText('ぬけた！', 0, 0);
    ctx.fillStyle = '#ff5a1f';
    ctx.fillText('ぬけた！', 0, 0);
    ctx.restore();
  }
}

/* =====================================================
   2. おもさくらべ（てんびん）
   ===================================================== */
const PET_SVG = `
  <rect x="42" y="6" width="16" height="9" rx="2" fill="#2a7de1"/>
  <rect x="43" y="14" width="14" height="10" fill="#d8efff" stroke="#6aa6d4" stroke-width="2"/>
  <path d="M43 22 Q29 32 29 46 L29 86 Q29 95 38 95 L62 95 Q71 95 71 86 L71 46 Q71 32 57 22 Z" fill="#d8efff" stroke="#6aa6d4" stroke-width="3"/>
  <path d="M29 56 L71 56 L71 86 Q71 95 62 95 L38 95 Q29 95 29 86 Z" fill="#7cc6ff"/>
  <rect x="29" y="62" width="42" height="16" fill="#fff" opacity="0.92"/>
  <rect x="29" y="68" width="42" height="4" fill="#2a7de1"/>`;

const SUITO_SVG = `
  <rect x="33" y="8" width="34" height="18" rx="5" fill="#ffb300" stroke="#c98200" stroke-width="2"/>
  <rect x="29" y="25" width="42" height="68" rx="9" fill="#2aa5a0" stroke="#1d7c78" stroke-width="3"/>
  <rect x="29" y="48" width="42" height="12" fill="#ffffff" opacity="0.55"/>
  <path d="M29 38 Q8 54 29 82" fill="none" stroke="#555" stroke-width="4" stroke-linecap="round"/>`;

// kg：げんじつの おもさの めやす（「やく」の かず）
const ITEMS = [
  { id: 'nezumi', name: 'ねずみ',       kg: 0.03,  label: 'やく 30グラム',  emoji: '🐁' },
  { id: 'ringo',  name: 'りんご',       kg: 0.25,  label: 'やく 250グラム', emoji: '🍎' },
  { id: 'ehon',   name: 'えほん',       kg: 0.3,   label: 'やく 300グラム', emoji: '📖' },
  { id: 'pet',    name: 'ペットボトル', kg: 0.5,   label: 'やく 500グラム', svg: PET_SVG },
  { id: 'suito',  name: 'すいとう',     kg: 0.6,   label: 'やく 600グラム', svg: SUITO_SVG },
  { id: 'randsel',name: 'ランドセル',   kg: 1.2,   label: 'やく 1キロ',     emoji: '🎒' },
  { id: 'neko',   name: 'ねこ',         kg: 4,     label: 'やく 4キロ',     emoji: '🐈' },
  { id: 'inu',    name: 'いぬ',         kg: 10,    label: 'やく 10キロ',    emoji: '🐕' },
  { id: 'kuruma', name: 'くるま',       kg: 1200,  label: 'やく 1トン',     emoji: '🚗' },
  { id: 'zou',    name: 'ぞう',         kg: 4000,  label: 'やく 4トン',     emoji: '🐘' },
  { id: 'bus',    name: 'バス',         kg: 10000, label: 'やく 10トン',    emoji: '🚌' },
  { id: 'densha', name: 'でんしゃ',     kg: 30000, label: 'やく 30トン',    emoji: '🚃' }
];

function iconInner(item) {
  if (item.svg) return item.svg;
  return `<text x="50" y="54" font-size="78" text-anchor="middle" dominant-baseline="central" font-family='${EMOJI_FONT}'>${item.emoji}</text>`;
}

const SVGNS = 'http://www.w3.org/2000/svg';
const BAL = { cx: 640, cy: 220, L: 360 };
const MAX_DEG = 18;

const B = {
  ang: 0, vel: 0, target: 0,
  slots: [null, null],
  drop: [99, 99],
  impacted: [true, true],
  next: 0,
  cursor: 0,
  settle: 99,
  revealed: false,
  showNum: true
};

const beamEl = $('beam');
const panEls = [$('panL'), $('panR')];
const bannerEls = [$('bannerL'), $('bannerR')];
const itemGs = [];
const weightTexts = [];
const badgeEls = [];
const nameTexts = [];

function buildPan(g, side) {
  const dish = side === 0 ? '#8fd69f' : '#c3a8f7';
  const rim = side === 0 ? '#2e9e5b' : '#7b4fd0';
  g.innerHTML = `
    <line x1="0" y1="0" x2="-112" y2="140" stroke="#6b4e31" stroke-width="4"/>
    <line x1="0" y1="0" x2="112" y2="140" stroke="#6b4e31" stroke-width="4"/>
    <path d="M -126 142 L 126 142 Q 106 192 0 192 Q -106 192 -126 142 Z" fill="${dish}" stroke="${rim}" stroke-width="5"/>
    <rect x="-132" y="134" width="264" height="14" rx="7" fill="${rim}"/>
    <g class="item"></g>
    <text class="wt" x="0" y="238" text-anchor="middle" font-size="30" font-weight="800" fill="#5b5346"></text>
    <rect x="-135" y="20" width="270" height="190" fill="transparent"/>`;
  itemGs[side] = g.querySelector('.item');
  weightTexts[side] = g.querySelector('.wt');
  g.addEventListener('click', () => { Sound.init(); removeSlot(side); });
}

function buildBanner(g, side) {
  const col = side === 0 ? '#2e9e5b' : '#7b4fd0';
  g.innerHTML = `
    <text class="nm" y="40" text-anchor="middle" font-size="38" font-weight="800" fill="${col}"></text>
    <g class="badge" transform="translate(0 50)" visibility="hidden">
      <rect x="-84" y="0" width="168" height="46" rx="23" fill="#e0452b"></rect>
      <text y="35" text-anchor="middle" font-size="31" font-weight="800" fill="#fff"></text>
    </g>`;
  nameTexts[side] = g.querySelector('.nm');
  badgeEls[side] = g.querySelector('.badge');
}

panEls.forEach((g, i) => buildPan(g, i));
bannerEls.forEach((g, i) => buildBanner(g, i));

/* --- パレット --- */
const paletteEl = $('palette');
const cardEls = [];
ITEMS.forEach((it, i) => {
  const li = document.createElement('li');
  const b = document.createElement('button');
  b.type = 'button';
  b.className = 'card';
  b.setAttribute('aria-label', `${it.name}（${it.label}）`);
  b.innerHTML = `
    <svg class="icon" viewBox="0 0 100 100" aria-hidden="true">${iconInner(it)}</svg>
    <span class="name">${it.name}</span>
    <span class="kg">${it.label}</span>
    <span class="tag"></span>`;
  b.addEventListener('click', (e) => {
    Sound.init();
    B.cursor = i;
    placeItem(i);
    e.currentTarget.blur();
  });
  li.appendChild(b);
  paletteEl.appendChild(li);
  cardEls.push(b);
});

function renderPalette() {
  cardEls.forEach((el, i) => {
    el.classList.toggle('sel', i === B.cursor);
    el.classList.toggle('inL', B.slots[0] === i);
    el.classList.toggle('inR', B.slots[1] === i && B.slots[0] !== i);
    const tag = el.querySelector('.tag');
    let t = '';
    if (B.slots[0] === i) t = 'ひだり';
    if (B.slots[1] === i) t = B.slots[0] === i ? 'ひだり・みぎ' : 'みぎ';
    tag.textContent = t;
    if (B.slots[0] === i && B.slots[1] === i) el.classList.add('inR');
  });
  paletteEl.classList.toggle('hide-kg', !B.showNum);
}

function renderSlots() {
  for (let s = 0; s < 2; s++) {
    const idx = B.slots[s];
    if (idx === null) {
      itemGs[s].innerHTML = '';
      nameTexts[s].textContent = '';
      weightTexts[s].textContent = '';
    } else {
      const it = ITEMS[idx];
      itemGs[s].innerHTML = `<svg x="-62" y="24" width="124" height="124" viewBox="0 0 100 100">${iconInner(it)}</svg>`;
      nameTexts[s].textContent = it.name;
      weightTexts[s].textContent = B.showNum ? it.label : '';
    }
    badgeEls[s].setAttribute('visibility', 'hidden');
  }
  renderPalette();
}

/* --- ロジック --- */
function weightOf(s) { return B.slots[s] === null ? null : ITEMS[B.slots[s]].kg; }

function computeTarget() {
  const l = weightOf(0), r = weightOf(1);
  if (l === null && r === null) return 0;
  const wl = l === null ? 0.005 : l;
  const wr = r === null ? 0.005 : r;
  if (l !== null && r !== null && wl === wr) return 0;
  const lr = Math.log10(Math.max(wl, wr) / Math.min(wl, wr));
  const mag = 6 + (MAX_DEG - 6) * Math.min(1, lr / 3);
  return (wl > wr ? -1 : 1) * mag * Math.PI / 180;   // マイナス＝ひだりが さがる
}

function lightness(kg) { return clamp((Math.log10(kg) + 1.6) / 6.1, 0, 1); }

function placeItem(idx) {
  const s = B.next;
  B.slots[s] = idx;
  B.next = 1 - s;
  B.drop[s] = 0;
  B.impacted[s] = false;
  B.revealed = false;
  badgeEls.forEach((b) => b.setAttribute('visibility', 'hidden'));
  renderSlots();
  Sound.speak(ITEMS[idx].name);
}

function removeSlot(s) {
  if (B.slots[s] === null) return;
  B.slots[s] = null;
  B.drop[s] = 99;
  B.impacted[s] = true;
  B.next = s;
  B.target = computeTarget();
  B.settle = 0;
  B.revealed = false;
  renderSlots();
  Sound.tick();
}

function clearAll() {
  B.slots = [null, null];
  B.drop = [99, 99];
  B.impacted = [true, true];
  B.next = 0;
  B.target = 0;
  B.settle = 0;
  B.revealed = false;
  Sound.stopSpeak();
  renderSlots();
  Sound.tick();
}

function moveCursor(delta) {
  B.cursor = (B.cursor + delta + ITEMS.length) % ITEMS.length;
  renderPalette();
  cardEls[B.cursor].scrollIntoView({ block: 'nearest', behavior: REDUCED ? 'auto' : 'smooth' });
  Sound.speak(ITEMS[B.cursor].name);
}

function paletteCols() {
  const cols = getComputedStyle(paletteEl).gridTemplateColumns.split(' ').filter(Boolean).length;
  return Math.max(1, cols);
}

function weightKeyDown(k) {
  if (k === 'ArrowRight') moveCursor(1);
  else if (k === 'ArrowLeft') moveCursor(-1);
  else if (k === 'ArrowDown') moveCursor(paletteCols());
  else if (k === 'ArrowUp') moveCursor(-paletteCols());
  else if (k === 'Enter' || k === ' ') placeItem(B.cursor);
  else if (k === 'Escape' || k === 'Backspace') clearAll();
}

function showBadges() {
  const wl = weightOf(0), wr = weightOf(1);
  const res = wl === wr ? ['same', 'same'] : (wl > wr ? ['heavy', 'light'] : ['light', 'heavy']);
  const label = { heavy: 'おもい', light: 'かるい', same: 'おなじ' };
  const color = { heavy: '#e0452b', light: '#2f7de1', same: '#d9a400' };
  res.forEach((r, s) => {
    const b = badgeEls[s];
    b.querySelector('rect').setAttribute('fill', color[r]);
    b.querySelector('text').textContent = label[r];
    b.setAttribute('visibility', 'visible');
  });
  Sound.ding();
  const a = ITEMS[B.slots[0]].name, c = ITEMS[B.slots[1]].name;
  if (wl === wr) Sound.speak(`${a}と${c}は、おなじ おもさ`);
  else if (wl > wr) Sound.speak(`${a}は おもい。${c}は かるい。`);
  else Sound.speak(`${c}は おもい。${a}は かるい。`);
}

function dropOffset(t, kg) {
  if (t >= 90) return 0;
  const fall = 0.35;
  if (t < fall) { const u = t / fall; return -230 * (1 - u * u); }
  const amp = 4 + 22 * (1 - lightness(kg));
  const bt = t - fall;
  return -amp * Math.abs(Math.sin(bt * 9)) * Math.exp(-bt * 5);
}

function updateBalance(dt) {
  for (let s = 0; s < 2; s++) {
    if (B.slots[s] === null) continue;
    B.drop[s] += dt;
    if (!B.impacted[s] && B.drop[s] >= 0.35) {
      B.impacted[s] = true;
      Sound.impact(ITEMS[B.slots[s]].kg);
      B.target = computeTarget();
      B.settle = 0;
      B.revealed = false;
    }
  }
  const k = 55, c = 5.5;
  const acc = k * (B.target - B.ang) - c * B.vel;
  B.vel += acc * dt;
  B.ang += B.vel * dt;
  B.settle += dt;

  if (!B.revealed && B.slots[0] !== null && B.slots[1] !== null &&
      B.impacted[0] && B.impacted[1] && B.settle > 1.3) {
    B.revealed = true;
    showBadges();
  }
}

function renderBalance() {
  const a = B.ang;
  beamEl.setAttribute('transform', `translate(${BAL.cx} ${BAL.cy}) rotate(${(a * 180 / Math.PI).toFixed(3)})`);
  const dx = BAL.L * Math.cos(a), dy = BAL.L * Math.sin(a);
  panEls[0].setAttribute('transform', `translate(${(BAL.cx - dx).toFixed(2)} ${(BAL.cy - dy).toFixed(2)})`);
  panEls[1].setAttribute('transform', `translate(${(BAL.cx + dx).toFixed(2)} ${(BAL.cy + dy).toFixed(2)})`);
  for (let s = 0; s < 2; s++) {
    if (B.slots[s] === null) continue;
    const off = dropOffset(B.drop[s], ITEMS[B.slots[s]].kg);
    itemGs[s].setAttribute('transform', `translate(0 ${off.toFixed(2)})`);
  }
}

// おもさの かず ひょうじ きりかえ
$('numBtn').addEventListener('click', (e) => {
  B.showNum = !B.showNum;
  e.currentTarget.setAttribute('aria-pressed', String(B.showNum));
  renderSlots();
  e.currentTarget.blur();
});
$('placeBtn').addEventListener('click', (e) => { Sound.init(); placeItem(B.cursor); e.currentTarget.blur(); });
$('clearBtn').addEventListener('click', (e) => { Sound.init(); clearAll(); e.currentTarget.blur(); });
$('placeBtn').addEventListener('keydown', (e) => e.preventDefault());

/* =====================================================
   メインループ
   ===================================================== */
let last = performance.now();
function frame(now) {
  const dt = Math.min(0.05, (now - last) / 1000);
  last = now;
  if (mode === 'kabu') { updateKabu(dt); drawKabuScene(); }
  else { updateBalance(dt); renderBalance(); }
  requestAnimationFrame(frame);
}

// ctx.roundRect が ない ふるい ブラウザ ようの ほせい
if (!CanvasRenderingContext2D.prototype.roundRect) {
  CanvasRenderingContext2D.prototype.roundRect = function (x, y, w, h, r) {
    const rr = Math.min(r, w / 2, h / 2);
    this.moveTo(x + rr, y);
    this.arcTo(x + w, y, x + w, y + h, rr);
    this.arcTo(x + w, y + h, x, y + h, rr);
    this.arcTo(x, y + h, x, y, rr);
    this.arcTo(x, y, x + w, y, rr);
    this.closePath();
  };
}

renderPalette();
renderSlots();
requestAnimationFrame(frame);

})();
