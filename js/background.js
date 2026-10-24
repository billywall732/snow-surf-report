// Animated page backgrounds, drawn on one full-screen <canvas> behind everything.
//   Snow tab: snowflakes falling past a faint mountain skyline, plus a
//             snowboarder who rides by and does a backflip every 30 seconds.
//   Surf tab: layers of rolling water whose level follows today's tide,
//             plus a big wave that rolls across the screen every 30 seconds.
//
// How canvas animation works: about 60 times a second the browser calls our
// loop() (via requestAnimationFrame). Each time, we move everything a little
// (update) and repaint the whole picture (draw). Browsers pause this
// automatically when the tab is in the background, so it costs nothing then.
//
// People who turn on "reduce motion" in their system settings get a still
// picture instead: same scene, no movement.

let canvas, ctx;
let width = 0;
let height = 0;
let scene = 'snow';

let snowIntensity = 1; // 0.6 (quiet) .. 2 (dumping)
let flakes = [];
let ridges = []; // mountain skyline points, regenerated on resize

// The snowboarder: every RIDE_EVERY seconds a rider crosses the foreground
// snowfield, hits a kicker, and does a backflip.
const RIDE_EVERY = 30; // seconds between runs
const AIR_TIME = 1.35; // seconds in the air
let rideStart = null; // when the current run started, or null
let nextRide = 3; // when the next run is due
let landed = false; // has this run's landing puff happened yet?
let puffs = []; // powder kicked up on landing

let tideTarget = 0.5; // 0 = today's lowest tide, 1 = today's highest
let tideLevel = 0.5; // eases toward tideTarget so changes glide instead of jump
let waveScale = 1; // bigger surf -> bigger background swell
let foam = []; // foam bubbles and spray particles

// The big wave: every SET_EVERY seconds a swell rolls across the screen.
const SET_EVERY = 30; // seconds between big waves
const SET_DURATION = 8; // seconds for one to cross the screen
let clock = 0; // seconds since the page opened (from the animation loop)
let setStart = null; // when the current big wave started, or null
let nextSet = 2; // when the next one is due

const reduceMotion = matchMedia('(prefers-reduced-motion: reduce)');
const darkMode = matchMedia('(prefers-color-scheme: dark)');

// Colors for each scene in light and dark mode.
const PALETTE = {
  light: {
    snowSky: ['#c6d4e2', '#dfe7ee', '#eef1f3'],
    ridgeFar: 'rgba(110, 130, 158, 0.22)',
    ridgeNear: 'rgba(90, 110, 138, 0.26)',
    flake: 'rgba(255, 255, 255, 1)',
    flakeEdge: 'rgba(100, 120, 148, 0.45)',
    snowfield: 'rgba(250, 252, 255, 0.85)',
    rider: '#1f2933',
    jacket: '#d95926',
    surfSky: ['#e3eff6', '#f1f6f8', '#f9f9f7'],
    water: ['rgba(42, 120, 214, 0.10)', 'rgba(42, 120, 214, 0.16)', 'rgba(30, 100, 190, 0.22)'],
    foam: 'rgba(255, 255, 255, 0.9)',
  },
  dark: {
    snowSky: ['#0b1420', '#0d121a', '#0d0d0d'],
    ridgeFar: 'rgba(120, 145, 180, 0.10)',
    ridgeNear: 'rgba(140, 165, 200, 0.14)',
    flake: 'rgba(235, 242, 250, 0.75)',
    flakeEdge: 'rgba(0, 0, 0, 0)',
    snowfield: 'rgba(200, 215, 235, 0.14)',
    rider: '#dfe7f0',
    jacket: '#eb6834',
    surfSky: ['#08131d', '#0b1016', '#0d0d0d'],
    water: ['rgba(57, 135, 229, 0.10)', 'rgba(57, 135, 229, 0.15)', 'rgba(57, 135, 229, 0.22)'],
    foam: 'rgba(220, 235, 250, 0.55)',
  },
};
// The page's theme switch (data-theme on <html>) wins; "Auto" follows the system.
function isDark() {
  const theme = document.documentElement.dataset.theme;
  return theme ? theme === 'dark' : darkMode.matches;
}
const colors = () => PALETTE[isDark() ? 'dark' : 'light'];

// Called by app.js when the theme switch changes, so a still picture repaints.
export function refreshBackground() {
  drawStill();
}

export function startBackground() {
  canvas = document.createElement('canvas');
  canvas.className = 'bg-canvas';
  canvas.setAttribute('aria-hidden', 'true'); // decoration only; screen readers skip it
  document.body.prepend(canvas);
  ctx = canvas.getContext('2d');

  resize();
  window.addEventListener('resize', resize);
  darkMode.addEventListener('change', drawStill);
  reduceMotion.addEventListener('change', drawStill);
  requestAnimationFrame(loop);
}

// Called by app.js when the tab changes.
export function setScene(name, opts = {}) {
  if (name === 'snow' && scene !== 'snow') {
    rideStart = null;
    nextRide = clock + 3; // first rider shortly after you open the Snow tab
  }
  if (name === 'surf' && scene !== 'surf') {
    setStart = null;
    nextSet = clock + 2; // first big wave shortly after you open the Surf tab
  }
  scene = name;
  if (opts.snowIntensity != null) {
    snowIntensity = opts.snowIntensity;
    makeFlakes();
  }
  if (opts.waveScale != null) waveScale = opts.waveScale;
  drawStill();
}

// Called by app.js with the current tide as a fraction of today's range.
export function setTideLevel(fraction) {
  tideTarget = Math.max(0, Math.min(1, fraction));
  if (reduceMotion.matches) tideLevel = tideTarget;
  drawStill();
}

// ---------- Setup ----------

function resize() {
  // Draw at the screen's real pixel density so it stays crisp on phones.
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  width = window.innerWidth;
  height = window.innerHeight;
  canvas.width = Math.round(width * dpr);
  canvas.height = Math.round(height * dpr);
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  makeFlakes();
  makeRidges();
  drawStill();
}

function makeFlakes() {
  if (!width) return;
  const count = Math.min(260, Math.round((width * height) / 12000 * snowIntensity));
  flakes = Array.from({ length: count }, () => newFlake(Math.random() * height));
}

function newFlake(y) {
  const depth = Math.random(); // 0 = far away (small, slow), 1 = close (big, fast)
  return {
    x: Math.random() * width,
    y,
    r: 0.8 + depth * 2.6,
    speed: 18 + depth * 55, // pixels per second
    sway: 10 + Math.random() * 25,
    phase: Math.random() * Math.PI * 2,
    alpha: 0.35 + depth * 0.65,
  };
}

// A jagged skyline: points along the width with random peak heights.
function makeRidges() {
  const layer = (baseFrac, rough, step) => {
    const pts = [];
    let y = height * baseFrac;
    for (let x = -step; x <= width + step; x += step) {
      y += (Math.random() - 0.5) * rough;
      y = Math.max(height * (baseFrac - 0.12), Math.min(height * (baseFrac + 0.06), y));
      pts.push([x, y]);
    }
    return pts;
  };
  ridges = [layer(0.72, 90, 60), layer(0.84, 70, 45)];
}

// ---------- Animation loop ----------

let last = 0;
function loop(time) {
  const dt = Math.min(0.05, (time - last) / 1000 || 0); // seconds since last frame (capped)
  last = time;
  clock = time / 1000;
  if (!reduceMotion.matches) {
    update(dt, time / 1000);
    draw(time / 1000);
  }
  requestAnimationFrame(loop);
}

function drawStill() {
  if (ctx && reduceMotion.matches) draw(0);
}

function update(dt, t) {
  if (scene === 'snow') {
    for (const f of flakes) {
      f.y += f.speed * dt;
      f.x += Math.sin(t * 0.8 + f.phase) * f.sway * dt;
      if (f.y > height + 5) Object.assign(f, newFlake(-5));
      if (f.x > width + 5) f.x = -5;
      if (f.x < -5) f.x = width + 5;
    }

    // Time for a snowboarder?
    if (rideStart === null && t >= nextRide) {
      rideStart = t;
      nextRide = t + RIDE_EVERY;
      landed = false;
    }
    const r = riderState();
    if (rideStart !== null && !r) rideStart = null; // rode off the screen
    if (r && r.justLanded && !landed) {
      landed = true;
      for (let n = 0; n < 28; n++) {
        puffs.push({
          x: r.x + (Math.random() - 0.5) * 20, y: r.y,
          vx: (Math.random() - 0.3) * 120, vy: -30 - Math.random() * 80,
          r: 1.5 + Math.random() * 3, life: 1,
        });
      }
    }
    for (const p of puffs) {
      p.life -= dt * 0.9;
      p.vy += 140 * dt;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
    }
    puffs = puffs.filter((p) => p.life > 0);
  } else {
    tideLevel += (tideTarget - tideLevel) * Math.min(1, dt * 1.2);
    // Time for a big wave?
    if (setStart === null && t >= nextSet) {
      setStart = t;
      nextSet = t + SET_EVERY;
    }
    if (setStart !== null && t - setStart > SET_DURATION) setStart = null;

    // Foam bubbles drift up from the front wave and fade out.
    if (Math.random() < dt * 6) {
      const x = Math.random() * width;
      foam.push({ x, y: waveY(2, x, t), life: 1, r: 1 + Math.random() * 2.5, vx: (Math.random() - 0.5) * 12, vy: -8, g: 0 });
    }

    // While the big wave passes: spray flies off its crest (and falls back
    // under gravity), and whitewater bubbles are left behind it.
    const crest = bigWave();
    if (crest) {
      const sprayRate = 90 * crest.strength; // particles per second
      for (let n = 0; n < sprayRate * dt; n++) {
        const x = crest.x + (Math.random() - 0.2) * crest.width * 0.5;
        foam.push({
          x, y: waveY(2, x, t), life: 1, r: 1 + Math.random() * 2,
          vx: 30 + Math.random() * 60, vy: -40 - Math.random() * 70 * crest.strength, g: 120,
        });
      }
      for (let n = 0; n < 40 * crest.strength * dt; n++) {
        const x = crest.x - Math.random() * crest.width * 1.2;
        foam.push({ x, y: waveY(2, x, t) + Math.random() * 10, life: 1, r: 1.5 + Math.random() * 3, vx: -10, vy: -4, g: 0 });
      }
    }

    for (const b of foam) {
      b.life -= dt * 0.6;
      b.vy += b.g * dt;
      b.x += b.vx * dt;
      b.y += b.vy * dt;
    }
    foam = foam.filter((b) => b.life > 0);
  }
}

// ---------- Drawing ----------

function sky(stops) {
  const g = ctx.createLinearGradient(0, 0, 0, height);
  stops.forEach((c, i) => g.addColorStop(i / (stops.length - 1), c));
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, width, height);
}

function draw(t) {
  const c = colors();
  if (scene === 'snow') {
    sky(c.snowSky);
    // Mountains: fill the area under each skyline
    [c.ridgeFar, c.ridgeNear].forEach((fill, i) => {
      ctx.beginPath();
      ctx.moveTo(0, height);
      for (const [x, y] of ridges[i] ?? []) ctx.lineTo(x, y);
      ctx.lineTo(width, height);
      ctx.closePath();
      ctx.fillStyle = fill;
      ctx.fill();
    });
    // Flakes
    for (const f of flakes) {
      ctx.globalAlpha = f.alpha;
      ctx.beginPath();
      ctx.arc(f.x, f.y, f.r, 0, Math.PI * 2);
      ctx.fillStyle = c.flake;
      ctx.fill();
      ctx.strokeStyle = c.flakeEdge;
      ctx.lineWidth = 0.6;
      ctx.stroke();
    }
    ctx.globalAlpha = 1;

    // Foreground snowfield and the kicker (jump)
    ctx.beginPath();
    ctx.moveTo(0, height);
    for (let x = 0; x <= width + 8; x += 8) ctx.lineTo(x, groundY(x));
    ctx.lineTo(width, height);
    ctx.closePath();
    ctx.fillStyle = c.snowfield;
    ctx.fill();
    const jx = jumpX();
    ctx.beginPath();
    ctx.moveTo(jx - 40 * riderScale(), groundY(jx - 40 * riderScale()));
    ctx.lineTo(jx, groundY(jx) - 12 * riderScale());
    ctx.lineTo(jx, groundY(jx));
    ctx.closePath();
    ctx.fill();

    // Rider and landing powder
    const r = riderState();
    if (r) drawRider(r.x, r.y, r.angle, riderScale(), c);
    ctx.fillStyle = c.flake;
    for (const p of puffs) {
      ctx.globalAlpha = Math.max(0, p.life);
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalAlpha = 1;
  } else {
    sky(c.surfSky);
    // Three water layers, back to front
    for (let layer = 0; layer < 3; layer++) {
      ctx.beginPath();
      ctx.moveTo(0, height);
      for (let x = 0; x <= width + 8; x += 8) ctx.lineTo(x, waveY(layer, x, t));
      ctx.lineTo(width, height);
      ctx.closePath();
      ctx.fillStyle = c.water[layer];
      ctx.fill();
    }
    // A foam line along the front wave's crest
    ctx.beginPath();
    for (let x = 0; x <= width + 8; x += 8) ctx.lineTo(x, waveY(2, x, t));
    ctx.strokeStyle = c.foam;
    ctx.lineWidth = 2;
    ctx.stroke();
    // Foam bubbles
    ctx.fillStyle = c.foam;
    for (const b of foam) {
      ctx.globalAlpha = Math.max(0, b.life) * 0.8;
      ctx.beginPath();
      ctx.arc(b.x, b.y, b.r, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalAlpha = 1;
  }
}

// Height of a water layer at position x and time t.
// The water line sits between 22% (low tide) and 48% (high tide) up the screen.
// Each layer is two sine waves added together; a slow "set" rhythm makes the
// swell build and fade every ~15 seconds, like real sets rolling in.
function waveY(layer, x, t) {
  const base = height * (1 - (0.22 + 0.26 * tideLevel)) + layer * 18;
  const set = 0.75 + 0.25 * Math.sin(t * 0.42);
  const amp = (8 + layer * 5) * waveScale * set;
  const k = (2 * Math.PI) / (420 - layer * 90); // wavelength in px
  const speed = 0.5 + layer * 0.25;
  return base
    + Math.sin(x * k - t * speed + layer * 1.7) * amp
    + Math.sin(x * k * 2.3 + t * speed * 0.7 + layer) * amp * 0.35
    - bigWaveLift(layer, x);
}

// Where the big wave is right now: its crest position, width and strength (0..1).
// Returns null when no big wave is passing.
function bigWave() {
  if (setStart === null) return null;
  const p = (clock - setStart) / SET_DURATION; // 0 at the start, 1 at the end
  return {
    x: -0.3 * width + p * 1.6 * width, // starts off the left edge, exits off the right
    width: Math.max(140, width * 0.2),
    strength: Math.sin(Math.PI * p), // grows in, peaks mid-screen, fades out
  };
}

// How far the big wave lifts a layer at position x. The shape is a bump with a
// steep front face (right side, the way it travels) and a long gentle back.
function bigWaveLift(layer, x) {
  const crest = bigWave();
  if (!crest) return 0;
  const dx = x - crest.x;
  const spread = dx > 0 ? crest.width * 0.45 : crest.width * 1.3;
  const peak = Math.min(height * 0.13, 80) * waveScale * crest.strength;
  const layerWeight = [0.35, 0.65, 1][layer]; // the front layer rises most
  return peak * layerWeight * Math.exp(-((dx / spread) ** 2));
}

// ---------- Snowboarder ----------

// The foreground snowfield: a gentle downhill from left to right with soft rolls.
function groundY(x) {
  return height * 0.86 + (x / width) * height * 0.05 + Math.sin(x * 0.009) * 8;
}

const jumpX = () => width * 0.42;

// The surface the rider stands on: the snowfield, plus the kicker ramp,
// which rises 12px over the 40px before the take-off point.
function surfaceY(x) {
  const s = riderScale();
  const rampStart = jumpX() - 40 * s;
  const ramp = x > rampStart && x <= jumpX() ? (12 * s * (x - rampStart)) / (40 * s) : 0;
  return groundY(x) - ramp;
}
const riderScale = () => Math.max(0.8, Math.min(1.4, width / 700));

// Where the rider is right now: { x, y, angle, justLanded }, or null when no run is
// on screen. Worked out from the time since the run started (no step-by-step state),
// so it's easy to follow:
//   on the ground -> sits on the snowfield, board tilted to match the slope
//   in the air    -> follows an arc (a parabola) and rotates one full turn backwards
function riderState() {
  if (rideStart === null) return null;
  const e = clock - rideStart; // seconds into this run
  const speed = Math.max(130, width / 5.5); // pixels per second
  const x = -60 + speed * e;
  if (x > width + 60) return null;

  const takeoffX = jumpX();
  const tTakeoff = (takeoffX + 60) / speed;
  const landX = takeoffX + speed * AIR_TIME;

  if (e > tTakeoff && e < tTakeoff + AIR_TIME) {
    const p = (e - tTakeoff) / AIR_TIME; // 0..1 through the air
    const y0 = groundY(takeoffX) - 12 * riderScale(); // top of the kicker
    const y1 = groundY(landX);
    const lift = Math.min(height * 0.2, 150); // how high the jump goes
    const y = y0 + (y1 - y0) * p - 4 * lift * p * (1 - p);
    // Ease the spin so it starts and finishes slowly, like a real flip.
    const spin = p < 0.5 ? 2 * p * p : 1 - 2 * (1 - p) ** 2;
    return { x, y, angle: -Math.PI * 2 * spin, justLanded: false };
  }

  const slope = Math.atan2(surfaceY(x + 6) - surfaceY(x - 6), 12);
  return { x, y: surfaceY(x), angle: slope, justLanded: e >= tTakeoff + AIR_TIME };
}

// A simple rider made of lines and circles, drawn with (0, 0) at the middle
// of the board. ctx.translate/rotate move and spin the whole drawing at once.
function drawRider(x, y, angle, scale, c) {
  ctx.save();
  // Move to the rider's middle (16px above the board), spin there, then move
  // back down, so a flip turns around the body instead of around the feet.
  ctx.translate(x, y - 16 * scale);
  ctx.rotate(angle);
  ctx.translate(0, 16 * scale);
  ctx.scale(scale, scale);
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';

  // Board
  ctx.strokeStyle = c.rider;
  ctx.lineWidth = 3.5;
  ctx.beginPath();
  ctx.moveTo(-17, -1);
  ctx.lineTo(17, -1);
  ctx.stroke();

  // Legs (knees bent)
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.moveTo(-7, -3);
  ctx.lineTo(-4, -10);
  ctx.lineTo(-1, -15);
  ctx.moveTo(7, -3);
  ctx.lineTo(6, -10);
  ctx.lineTo(1, -15);
  ctx.stroke();

  // Jacket (torso) and arms out for balance
  ctx.strokeStyle = c.jacket;
  ctx.lineWidth = 5;
  ctx.beginPath();
  ctx.moveTo(0, -15);
  ctx.lineTo(2, -27);
  ctx.stroke();
  ctx.lineWidth = 2.5;
  ctx.beginPath();
  ctx.moveTo(-11, -20);
  ctx.lineTo(1, -25);
  ctx.lineTo(13, -22);
  ctx.stroke();

  // Helmet
  ctx.fillStyle = c.rider;
  ctx.beginPath();
  ctx.arc(3, -32, 4.5, 0, Math.PI * 2);
  ctx.fill();

  ctx.restore();
}
