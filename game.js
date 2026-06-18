/* =============================================
   ASTEROIDS — PLANET DESTROYER EDITION v2
   + Secondary nav planets, nebulae, black holes
   Pure JS/Canvas — No frameworks — 60 FPS
   ============================================= */

(function () {
  'use strict';

  /* ── DOM ─────────────────────────────────── */
  const canvas      = document.getElementById('gameCanvas');
  const ctx         = canvas.getContext('2d');
  const startScreen = document.getElementById('start-screen');
  const gameoverScr = document.getElementById('gameover-screen');
  const winScreen   = document.getElementById('win-screen');
  const finalScore  = document.getElementById('final-score');
  const winScore    = document.getElementById('win-score');

  /* ── CONSTANTS ───────────────────────────── */
  const FPS          = 60;
  const SHIP_SIZE    = 18;
  const SHIP_THRUST  = 0.22;
  const SHIP_ROTATE  = 0.065;
  const FRICTION     = 0.988;
  const BULLET_SPEED = 9;
  const BULLET_LIFE  = 52;
  const PLANET_HP    = 40;
  const PLANET_R     = 55;
  const ASTEROID_MAX = 8;
  const ASTEROID_SPAWN_INTERVAL = 180;

  /* ── SECONDARY PLANETS CONFIG ────────────── */
  // Placed relative to canvas size — computed in buildSecondaryPlanets()
  const NAV_PLANET_DEFS = [
    { label: 'ABOUT',    href: '/about',    color: [100, 180, 255],  ringCount: 2  },
    { label: 'WORK',     href: '/work',     color: [255, 160,  80],  ringCount: 0  },
    { label: 'CONTACT',  href: '/contact',  color: [120, 255, 160],  ringCount: 0  },
    { label: 'BLOG',     href: '/blog',     color: [220, 100, 255],  ringCount: 0  },
    { label: 'PROJECTS', href: '/projects', color: [255, 255, 100],  ringCount: 0  },
  ];

  /* ── STATE ───────────────────────────────── */
  let W, H;
  let gameState   = 'start';
  let score       = 0;
  let lives       = 3;
  let planetHP    = PLANET_HP;
  let flickerNoise = 0;
  let tick        = 0;

  /* ── ENTITY POOLS ────────────────────────── */
  let ship, bullets, asteroids, particles, planetFragments;
  let secondaryPlanets = [];
  let nebulae          = [];
  let blackHoles       = [];
  let spawnTimer  = 0;
  let invincTimer = 0;

  /* ── KEYS ────────────────────────────────── */
  const keys = { left: false, right: false, up: false, space: false };
  let spaceWasUp = true;

  /* ── AUDIO ───────────────────────────────── */
  let audioCtx = null;

  function ensureAudio() {
    if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    if (audioCtx.state === 'suspended') audioCtx.resume();
  }
  function playTone(freq, type, dur, vol = 0.18, detune = 0) {
    if (!audioCtx) return;
    const osc = audioCtx.createOscillator();
    const gain = audioCtx.createGain();
    osc.connect(gain); gain.connect(audioCtx.destination);
    osc.type = type;
    osc.frequency.setValueAtTime(freq, audioCtx.currentTime);
    osc.detune.setValueAtTime(detune, audioCtx.currentTime);
    gain.gain.setValueAtTime(vol, audioCtx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.0001, audioCtx.currentTime + dur);
    osc.start(audioCtx.currentTime); osc.stop(audioCtx.currentTime + dur);
  }
  function soundShoot()     { ensureAudio(); playTone(880,'sawtooth',0.08,0.12); playTone(440,'square',0.06,0.08,-20); }
  function soundHitPlanet() { ensureAudio(); playTone(120,'sawtooth',0.18,0.2); playTone(80,'square',0.22,0.15,10); }
  function soundShipDie()   { ensureAudio(); for(let i=0;i<5;i++) setTimeout(()=>playTone(200-i*30,'sawtooth',0.12,0.22),i*60); }
  function soundExplosion(large=false) {
    ensureAudio();
    const n = large ? 8 : 4;
    for(let i=0;i<n;i++) setTimeout(()=>{ playTone(80+Math.random()*60,'sawtooth',0.15,0.25); playTone(40+Math.random()*30,'square',0.2,0.2); },i*(large?80:40));
  }
  function soundThrust() {
    if(!audioCtx) return;
    const buf = audioCtx.createBuffer(1, audioCtx.sampleRate*0.04, audioCtx.sampleRate);
    const d   = buf.getChannelData(0);
    for(let i=0;i<d.length;i++) d[i]=(Math.random()*2-1)*0.15;
    const src=audioCtx.createBufferSource(), gain=audioCtx.createGain();
    src.buffer=buf; src.connect(gain); gain.connect(audioCtx.destination);
    gain.gain.setValueAtTime(0.4,audioCtx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.0001,audioCtx.currentTime+0.04);
    src.start();
  }

  /* ── RESIZE ──────────────────────────────── */
  function resize() {
    W = canvas.width  = window.innerWidth;
    H = canvas.height = window.innerHeight;
    buildSecondaryPlanets();
    buildNebulae();
    buildBlackHoles();
    buildStarField();
  }
  window.addEventListener('resize', resize);

  /* ── NEBULAE ─────────────────────────────── */
  // Pre-baked onto an offscreen canvas so they cost nothing per frame
  let nebulaCanvas = null;

  const NEBULA_DEFS = [
    { rx: 0.12, ry: 0.18, r: 260, color: [80, 40, 180],  alpha: 0.13 },
    { rx: 0.85, ry: 0.25, r: 200, color: [180, 30, 80],   alpha: 0.11 },
    { rx: 0.22, ry: 0.78, r: 220, color: [20, 100, 180],  alpha: 0.10 },
    { rx: 0.75, ry: 0.72, r: 190, color: [80, 160, 40],   alpha: 0.09 },
    { rx: 0.50, ry: 0.15, r: 160, color: [160, 80, 20],   alpha: 0.08 },
  ];

  function buildNebulae() {
    nebulaCanvas        = document.createElement('canvas');
    nebulaCanvas.width  = W;
    nebulaCanvas.height = H;
    const nc = nebulaCanvas.getContext('2d');

    for (const def of NEBULA_DEFS) {
      const cx  = def.rx * W;
      const cy  = def.ry * H;
      const r   = def.r * Math.min(W, H) / 900;
      const [dr, dg, db] = def.color;

      // Multi-layer radial blobs — organic nebula shape
      for (let layer = 0; layer < 4; layer++) {
        const ox  = (Math.random() - 0.5) * r * 0.5;
        const oy  = (Math.random() - 0.5) * r * 0.5;
        const lr  = r * (0.5 + Math.random() * 0.7);
        const grad = nc.createRadialGradient(cx + ox, cy + oy, 0, cx + ox, cy + oy, lr);
        const a0  = def.alpha * (0.6 + Math.random() * 0.4);
        grad.addColorStop(0,   `rgba(${dr},${dg},${db},${a0})`);
        grad.addColorStop(0.4, `rgba(${dr},${dg},${db},${a0 * 0.4})`);
        grad.addColorStop(1,   `rgba(${dr},${dg},${db},0)`);
        nc.fillStyle = grad;
        nc.beginPath();
        nc.ellipse(cx + ox, cy + oy, lr, lr * (0.55 + Math.random() * 0.45), Math.random() * Math.PI, 0, Math.PI * 2);
        nc.fill();
      }

      // Bright core wisp
      const coreGrad = nc.createRadialGradient(cx, cy, 0, cx, cy, r * 0.25);
      coreGrad.addColorStop(0, `rgba(${Math.min(255,dr+120)},${Math.min(255,dg+120)},${Math.min(255,db+120)},${def.alpha * 0.55})`);
      coreGrad.addColorStop(1, `rgba(${dr},${dg},${db},0)`);
      nc.fillStyle = coreGrad;
      nc.beginPath();
      nc.arc(cx, cy, r * 0.25, 0, Math.PI * 2);
      nc.fill();
    }
    nebulae = NEBULA_DEFS; // store for reference
  }

  /* ── BLACK HOLES ─────────────────────────── */
  const BH_DEFS = [
    { rx: 0.08,  ry: 0.55, r: 28 },
    { rx: 0.92,  ry: 0.44, r: 22 },
    { rx: 0.45,  ry: 0.88, r: 20 },
  ];

  function buildBlackHoles() {
    blackHoles = BH_DEFS.map(d => ({
      x:    d.rx * W,
      y:    d.ry * H,
      r:    d.r * Math.min(W, H) / 900,
      rot:  Math.random() * Math.PI * 2,
      pulse: Math.random() * Math.PI * 2,
    }));
  }

  /* ── SECONDARY NAV PLANETS ───────────────── */
  function buildSecondaryPlanets() {
    // Place them in a rough orbit around the center, avoiding overlap
    const cx = W / 2, cy = H / 2;
    const margin  = 0.15;  // keep away from edges
    const minEdge = Math.min(W, H);

    // Fixed angular positions spread evenly but offset so they don't cluster
    const baseAngles = [
      Math.PI * 0.18,   // top-right area
      Math.PI * 0.72,   // right
      Math.PI * 1.15,   // bottom-right
      Math.PI * 1.55,   // bottom-left
      Math.PI * 1.9,    // left
    ];

    const orbitR = minEdge * 0.36;

    secondaryPlanets = NAV_PLANET_DEFS.map((def, i) => {
      const ang = baseAngles[i];
      const dist = orbitR * (0.88 + (i % 2) * 0.18);
      const pr   = 18 + (i % 3) * 6;   // radius 18–30
      const x    = Math.min(Math.max(cx + Math.cos(ang) * dist, W * margin + pr), W * (1 - margin) - pr);
      const y    = Math.min(Math.max(cy + Math.sin(ang) * dist, H * margin + pr), H * (1 - margin) - pr);
      const maxHp = 15;
      return {
        x, y,
        r:        pr,
        label:    def.label,
        href:     def.href,
        color:    def.color,
        rot:      Math.random() * Math.PI * 2,
        rotSpeed: 0.003 + Math.random() * 0.004,
        rings:    def.ringCount,
        pulse:    Math.random() * Math.PI * 2,
        hovered:  false,
        hp:       maxHp,
        maxHp:    maxHp,
        dead:     false,
        deathTimer: 0,
        fragments: [],
      };
    });
  }

  /* ── SHIP ────────────────────────────────── */
  function createShip() {
    return { x: W/2, y: H/2, vx:0, vy:0, angle: -Math.PI/2, thrusting:false, dead:false };
  }

  /* ── ASTEROID SHAPES ─────────────────────── */
  const AST_SIZES  = [52, 28, 14];
  const AST_SPEEDS = [0.6, 1.0, 1.6];

  function randAsteroidShape(r) {
    const verts = 10 + Math.floor(Math.random() * 5);
    return Array.from({length: verts}, (_, i) => {
      const angle  = (i / verts) * Math.PI * 2;
      const jitter = r * (0.72 + Math.random() * 0.28);
      return { x: Math.cos(angle) * jitter, y: Math.sin(angle) * jitter };
    });
  }

  function spawnAsteroid(size = 0) {
    const r = AST_SIZES[size], spd = AST_SPEEDS[size] * (0.7 + Math.random() * 0.6);
    const angle = Math.random() * Math.PI * 2;
    const edge  = Math.floor(Math.random() * 4);
    let x, y;
    if      (edge === 0) { x = Math.random() * W; y = -r; }
    else if (edge === 1) { x = W + r; y = Math.random() * H; }
    else if (edge === 2) { x = Math.random() * W; y = H + r; }
    else                 { x = -r;   y = Math.random() * H; }
    asteroids.push({ x, y, vx: Math.cos(angle)*spd, vy: Math.sin(angle)*spd,
      r, size, rot: Math.random()*Math.PI*2, rotSpeed:(Math.random()-0.5)*0.025,
      shape: randAsteroidShape(r) });
  }

  function spawnAsteroidAt(x, y, size) {
    const r = AST_SIZES[size], spd = AST_SPEEDS[size] * (0.7 + Math.random() * 0.6);
    const angle = Math.random() * Math.PI * 2;
    asteroids.push({ x, y, vx: Math.cos(angle)*spd, vy: Math.sin(angle)*spd,
      r, size, rot: Math.random()*Math.PI*2, rotSpeed:(Math.random()-0.5)*0.03,
      shape: randAsteroidShape(r) });
  }

  /* ── PARTICLES ───────────────────────────── */
  function spawnParticles(x, y, count, maxSpd, life) {
    for (let i = 0; i < count; i++) {
      const ang = Math.random() * Math.PI * 2, spd = Math.random() * maxSpd;
      particles.push({ x, y, vx: Math.cos(ang)*spd, vy: Math.sin(ang)*spd, life, maxLife: life });
    }
  }

  /* ── PLANET FRAGMENTS ────────────────────── */
  function spawnPlanetFragments() {
    const cx = W/2, cy = H/2;
    for (let i = 0; i < 28; i++) {
      const ang = Math.random()*Math.PI*2, spd = 1.5+Math.random()*3.5;
      const length = 8+Math.random()*30;
      planetFragments.push({
        x: cx+(Math.random()-0.5)*PLANET_R, y: cy+(Math.random()-0.5)*PLANET_R,
        vx: Math.cos(ang)*spd, vy: Math.sin(ang)*spd,
        rot: Math.random()*Math.PI*2, rotSpeed:(Math.random()-0.5)*0.08,
        length, alpha:1, life:90+Math.random()*60, maxLife:90+Math.random()*60,
      });
    }
  }

  /* ── INIT GAME ───────────────────────────── */
  function initGame() {
    score=0; lives=3; planetHP=PLANET_HP; tick=0;
    ship=createShip(); bullets=[]; asteroids=[]; particles=[]; planetFragments=[];
    spawnTimer=0; invincTimer=0;
    // Reset secondary planet HP
    for (const sp of secondaryPlanets) {
      sp.hp=sp.maxHp; sp.dead=false; sp.deathTimer=0; sp.fragments=[]; sp.flash=0;
    }
    for (let i=0;i<4;i++) spawnAsteroid(0);
  }

  /* ── INPUT ───────────────────────────────── */
  document.addEventListener('keydown', e => {
    if (e.key==='ArrowLeft'  || e.key==='a') keys.left  = true;
    if (e.key==='ArrowRight' || e.key==='d') keys.right = true;
    if (e.key==='ArrowUp'    || e.key==='w') keys.up    = true;
    if (e.key===' ') { keys.space=true; e.preventDefault(); }
  });
  document.addEventListener('keyup', e => {
    if (e.key==='ArrowLeft'  || e.key==='a') keys.left  = false;
    if (e.key==='ArrowRight' || e.key==='d') keys.right = false;
    if (e.key==='ArrowUp'    || e.key==='w') keys.up    = false;
    if (e.key===' ') { keys.space=false; spaceWasUp=true; }
  });

  /* ── HELPERS ─────────────────────────────── */
  function wrap(v, max)           { return v<0 ? v+max : v>max ? v-max : v; }
  function dist(ax,ay,bx,by)      { return Math.hypot(ax-bx,ay-by); }

  /* ── UPDATE ──────────────────────────────── */
  function update() {
    if (gameState !== 'playing') return;
    tick++;
    flickerNoise = Math.random() * 0.018;

    // Animate black holes
    for (const bh of blackHoles) { bh.rot += 0.008; bh.pulse += 0.03; }
    // Animate secondary planets
    for (const p of secondaryPlanets) { p.rot += p.rotSpeed; p.pulse += 0.04; }

    // Ship controls
    if (keys.left)  ship.angle -= SHIP_ROTATE;
    if (keys.right) ship.angle += SHIP_ROTATE;
    ship.thrusting = keys.up;
    if (ship.thrusting) {
      ship.vx += Math.cos(ship.angle)*SHIP_THRUST;
      ship.vy += Math.sin(ship.angle)*SHIP_THRUST;
      if (Math.random() < 0.35) soundThrust();
    }
    ship.vx *= FRICTION; ship.vy *= FRICTION;
    ship.x = wrap(ship.x+ship.vx, W);
    ship.y = wrap(ship.y+ship.vy, H);

    // Shoot
    if (keys.space && spaceWasUp && gameState==='playing') {
      spaceWasUp = false;
      bullets.push({
        x:  ship.x+Math.cos(ship.angle)*SHIP_SIZE,
        y:  ship.y+Math.sin(ship.angle)*SHIP_SIZE,
        vx: Math.cos(ship.angle)*BULLET_SPEED+ship.vx*0.5,
        vy: Math.sin(ship.angle)*BULLET_SPEED+ship.vy*0.5,
        life: BULLET_LIFE,
      });
      soundShoot();
    }

    // Bullets
    for (let i=bullets.length-1; i>=0; i--) {
      const b = bullets[i];
      b.x = wrap(b.x+b.vx, W); b.y = wrap(b.y+b.vy, H); b.life--;
      if (b.life <= 0) { bullets.splice(i,1); continue; }

      // Bullet ↔ main planet
      if (planetHP>0 && dist(b.x,b.y,W/2,H/2) < PLANET_R+4) {
        bullets.splice(i,1); planetHP--; score+=10;
        soundHitPlanet(); spawnParticles(W/2,H/2,6,2.5,20);
        if (planetHP<=0) { triggerWin(); return; }
        continue;
      }

      // Bullet ↔ secondary planets (HP system)
      let hitSecondary = false;
      for (const sp of secondaryPlanets) {
        if (!sp.dead && dist(b.x,b.y,sp.x,sp.y) < sp.r+3) {
          bullets.splice(i,1);
          sp.hp--;
          score += 5;
          soundHitPlanet();
          spawnParticles(sp.x, sp.y, 5, 2.5, 18);
          if (sp.hp <= 0) {
            sp.dead = true;
            sp.deathTimer = 120;
            soundExplosion(false);
            spawnParticles(sp.x, sp.y, 28, 4, 55);
            // spawn nav-planet fragments
            for (let f=0; f<16; f++) {
              const fa=Math.random()*Math.PI*2, fs=1.2+Math.random()*3;
              sp.fragments.push({
                x: sp.x+(Math.random()-0.5)*sp.r,
                y: sp.y+(Math.random()-0.5)*sp.r,
                vx: Math.cos(fa)*fs, vy: Math.sin(fa)*fs,
                rot: Math.random()*Math.PI*2, rotSpeed:(Math.random()-0.5)*0.1,
                len: 4+Math.random()*14, alpha:1, life:80+Math.random()*40, maxLife:80+Math.random()*40,
              });
            }
            setTimeout(() => { window.location.href = sp.href; }, 2200);
          }
          hitSecondary = true;
          break;
        }
      }
      if (hitSecondary) continue;

      // Bullet ↔ asteroid
      for (let j=asteroids.length-1; j>=0; j--) {
        const a = asteroids[j];
        if (dist(b.x,b.y,a.x,a.y) < a.r) {
          bullets.splice(i,1);
          spawnParticles(a.x,a.y,8,2.5,25);
          soundExplosion(a.size===0);
          if (a.size<2) for(let k=0;k<2;k++) spawnAsteroidAt(a.x,a.y,a.size+1);
          asteroids.splice(j,1); break;
        }
      }
    }

    // Asteroid spawn
    spawnTimer++;
    if (spawnTimer>=ASTEROID_SPAWN_INTERVAL && asteroids.length<ASTEROID_MAX) {
      spawnTimer=0; spawnAsteroid(0);
    }
    for (const a of asteroids) {
      a.x=wrap(a.x+a.vx,W); a.y=wrap(a.y+a.vy,H); a.rot+=a.rotSpeed;
    }

    // Ship ↔ asteroid collision
    if (invincTimer>0) { invincTimer--; }
    else {
      for (const a of asteroids) {
        if (dist(ship.x,ship.y,a.x,a.y) < a.r+SHIP_SIZE*0.7) { shipHit(); break; }
      }
    }

    // Particles
    for (let i=particles.length-1;i>=0;i--) {
      const p=particles[i]; p.x+=p.vx; p.y+=p.vy; p.life--;
      if(p.life<=0) particles.splice(i,1);
    }
    // Planet fragments
    for (let i=planetFragments.length-1;i>=0;i--) {
      const f=planetFragments[i]; f.x+=f.vx; f.y+=f.vy; f.rot+=f.rotSpeed;
      f.life--; f.alpha=f.life/f.maxLife;
      if(f.life<=0) planetFragments.splice(i,1);
    }
    // Flash / death countdown on secondary planets
    for (const sp of secondaryPlanets) {
      if (sp.flash > 0) sp.flash--;
      if (sp.dead) {
        sp.deathTimer--;
        for (let f=sp.fragments.length-1; f>=0; f--) {
          const fr=sp.fragments[f];
          fr.x+=fr.vx; fr.y+=fr.vy; fr.rot+=fr.rotSpeed; fr.life--;
          fr.alpha=fr.life/fr.maxLife;
          if(fr.life<=0) sp.fragments.splice(f,1);
        }
      }
    }
  }

  function shipHit() {
    soundShipDie(); spawnParticles(ship.x,ship.y,18,3.5,40); lives--;
    if(lives<=0) {
      gameState='gameover'; finalScore.textContent=score;
      setTimeout(()=>{ gameoverScr.classList.remove('hidden'); },600); return;
    }
    ship=createShip(); invincTimer=180;
  }

  function triggerWin() {
    gameState='win'; soundExplosion(true);
    spawnParticles(W/2,H/2,60,5,90); spawnPlanetFragments();
    winScore.textContent=score;
    setTimeout(()=>{ winScreen.classList.remove('hidden'); },600);
    setTimeout(()=>{ window.location.href='/home'; },4000);
  }

  /* ── DRAW HELPERS ────────────────────────── */
  function setLine(alpha=1, lw=1.4) {
    const a = Math.max(0, Math.min(1, alpha-flickerNoise));
    ctx.strokeStyle = `rgba(255,255,255,${a})`;
    ctx.fillStyle   = `rgba(255,255,255,${a})`;
    ctx.lineWidth   = lw;
    ctx.lineCap     = 'round';
    ctx.lineJoin    = 'round';
  }

  /* ── DRAW: BLACK HOLES ───────────────────── */
  function drawBlackHoles() {
    for (const bh of blackHoles) {
      ctx.save();
      ctx.translate(bh.x, bh.y);

      // Accretion disk — colored gradient rings
      const diskColors = [
        [255, 160,  40],
        [255, 100,  20],
        [180,  60, 200],
      ];
      const diskIdx = blackHoles.indexOf(bh) % diskColors.length;
      const [dr, dg, db] = diskColors[diskIdx];

      // Outer glow
      const glow = ctx.createRadialGradient(0,0,bh.r*0.8,0,0,bh.r*3.5);
      glow.addColorStop(0,   `rgba(${dr},${dg},${db},0.18)`);
      glow.addColorStop(0.5, `rgba(${dr},${dg},${db},0.07)`);
      glow.addColorStop(1,   `rgba(${dr},${dg},${db},0)`);
      ctx.fillStyle = glow;
      ctx.beginPath();
      ctx.arc(0,0,bh.r*3.5,0,Math.PI*2);
      ctx.fill();

      // Accretion disk rings — elliptical, rotating
      ctx.rotate(bh.rot);
      for (let ring=0; ring<3; ring++) {
        const rScale = 1.6 + ring * 0.7;
        const alpha  = (0.22 - ring*0.06) * (0.85 + 0.15*Math.sin(bh.pulse+ring));
        ctx.strokeStyle = `rgba(${dr},${dg},${db},${alpha})`;
        ctx.lineWidth   = 1.5 - ring*0.3;
        ctx.beginPath();
        ctx.ellipse(0,0, bh.r*rScale, bh.r*rScale*0.25, 0, 0, Math.PI*2);
        ctx.stroke();
      }

      // Event horizon — solid black circle with white border
      ctx.fillStyle   = '#000';
      ctx.strokeStyle = `rgba(255,255,255,0.5)`;
      ctx.lineWidth   = 1;
      ctx.beginPath(); ctx.arc(0,0,bh.r,0,Math.PI*2);
      ctx.fill(); ctx.stroke();

      // Lensing arcs
      ctx.strokeStyle = `rgba(255,255,255,0.12)`;
      ctx.lineWidth   = 0.7;
      for (let arc=0; arc<4; arc++) {
        const startAng = (arc/4)*Math.PI*2 + bh.rot*0.5;
        ctx.beginPath();
        ctx.arc(0,0, bh.r*1.35, startAng, startAng+Math.PI*0.4);
        ctx.stroke();
      }

      ctx.restore();
    }
  }

  /* ── DRAW: SECONDARY PLANETS ─────────────── */
  function drawSecondaryPlanets() {
    const fontSize = Math.round(Math.min(W,H)*0.014+6);

    for (const sp of secondaryPlanets) {
      const [cr,cg,cb] = sp.color;

      // Draw death fragments even after dead
      if (sp.dead) {
        for (const fr of sp.fragments) {
          ctx.save();
          ctx.globalAlpha = fr.alpha;
          ctx.translate(fr.x, fr.y);
          ctx.rotate(fr.rot);
          ctx.strokeStyle = `rgba(${cr},${cg},${cb},${fr.alpha})`;
          ctx.lineWidth = 1.2;
          ctx.beginPath();
          ctx.moveTo(-fr.len/2, 0); ctx.lineTo(fr.len/2, 0);
          ctx.stroke();
          ctx.restore();
        }
        ctx.globalAlpha = 1;
        // "REDIRECTING" text while dead
        if (sp.deathTimer > 0) {
          const blinkOn = Math.floor(sp.deathTimer / 8) % 2 === 0;
          if (blinkOn) {
            ctx.save();
            ctx.font = `${fontSize*0.85}px 'Share Tech Mono', monospace`;
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';
            ctx.fillStyle = `rgba(${cr},${cg},${cb},0.9)`;
            ctx.fillText('REDIRECTING...', sp.x, sp.y);
            ctx.restore();
          }
        }
        continue;
      }

      const hpRatio    = sp.hp / sp.maxHp;
      const flashing   = sp.flash > 0;
      const flashAlpha = flashing ? (sp.flash % 6 < 3 ? 1 : 0.2) : 1;
      // Shake intensifies as HP drops
      const shake  = (1 - hpRatio) * 1.8;
      const sox    = (Math.random()-0.5)*shake;
      const soy    = (Math.random()-0.5)*shake;

      ctx.save();
      ctx.translate(sp.x + sox, sp.y + soy);

      // Atmospheric glow — dims with HP
      const atmGrad = ctx.createRadialGradient(0,0,sp.r*0.7,0,0,sp.r*2.8);
      atmGrad.addColorStop(0,   `rgba(${cr},${cg},${cb},${0.12*hpRatio*flashAlpha})`);
      atmGrad.addColorStop(0.5, `rgba(${cr},${cg},${cb},${0.05*hpRatio*flashAlpha})`);
      atmGrad.addColorStop(1,   `rgba(${cr},${cg},${cb},0)`);
      ctx.fillStyle = atmGrad;
      ctx.beginPath(); ctx.arc(0,0,sp.r*2.8,0,Math.PI*2); ctx.fill();

      // Outer circle
      ctx.strokeStyle = `rgba(${cr},${cg},${cb},${0.85*flashAlpha})`;
      ctx.lineWidth   = 1.4;
      ctx.beginPath(); ctx.arc(0,0,sp.r,0,Math.PI*2); ctx.stroke();

      // Wireframe
      ctx.save();
      ctx.rotate(sp.rot);
      for (let lat=-2;lat<=2;lat++) {
        const ly   = (lat/2.8)*sp.r;
        const xExt = Math.sqrt(Math.max(0,sp.r*sp.r-ly*ly));
        ctx.strokeStyle = `rgba(${cr},${cg},${cb},${0.35*flashAlpha})`;
        ctx.lineWidth   = 0.8;
        ctx.beginPath();
        for (let s=0;s<=30;s++) {
          const t=s/30*Math.PI*2;
          const px=Math.cos(t)*xExt, py=Math.sin(t)*(xExt*0.28)+ly;
          s===0 ? ctx.moveTo(px,py) : ctx.lineTo(px,py);
        }
        ctx.stroke();
      }
      ctx.strokeStyle = `rgba(${cr},${cg},${cb},${0.3*flashAlpha})`;
      ctx.beginPath();
      for (let s=0;s<=30;s++) {
        const t=s/30*Math.PI*2;
        const px=Math.sin(t)*sp.r*0.3, py=-Math.cos(t)*sp.r;
        s===0 ? ctx.moveTo(px,py) : ctx.lineTo(px,py);
      }
      ctx.stroke();
      ctx.restore();

      // Saturn rings
      if (sp.rings > 0) {
        ctx.save();
        ctx.rotate(sp.rot * 0.4);
        ctx.strokeStyle = `rgba(${cr},${cg},${cb},${0.4*flashAlpha})`;
        ctx.lineWidth = 1.2;
        ctx.beginPath();
        ctx.ellipse(0,0, sp.r*1.85, sp.r*0.42, 0, 0, Math.PI*2);
        ctx.stroke();
        ctx.strokeStyle = `rgba(${cr},${cg},${cb},${0.22*flashAlpha})`;
        ctx.lineWidth = 0.7;
        ctx.beginPath();
        ctx.ellipse(0,0, sp.r*2.1, sp.r*0.48, 0, 0, Math.PI*2);
        ctx.stroke();
        ctx.restore();
      }

      // ── HP BAR (below planet) ──────────────
      const barW  = sp.r * 2.4;
      const barH  = 4;
      const barX  = -barW / 2;
      const barY  = sp.r + 9;
      const segs  = sp.maxHp;
      const segW  = (barW - (segs-1)*1) / segs;

      ctx.strokeStyle = `rgba(${cr},${cg},${cb},${0.45*flashAlpha})`;
      ctx.lineWidth   = 0.7;
      ctx.strokeRect(barX-2, barY-2, barW+4, barH+4);

      for (let s=0; s<segs; s++) {
        if (s < sp.hp) {
          // colour shifts red when low
          const rr = hpRatio > 0.4 ? cr : 255;
          const rg = hpRatio > 0.4 ? cg : Math.round(cg * hpRatio * 2);
          const rb = hpRatio > 0.4 ? cb : Math.round(cb * hpRatio * 2);
          ctx.fillStyle = `rgba(${rr},${rg},${rb},${flashAlpha})`;
          ctx.fillRect(barX + s*(segW+1), barY, segW, barH);
        }
      }

      // ── LABEL (above planet) ──────────────
      ctx.font         = `${fontSize}px 'Share Tech Mono', monospace`;
      ctx.textAlign    = 'center';
      ctx.textBaseline = 'bottom';

      const lw = ctx.measureText(sp.label).width;
      const labelY = -sp.r - fontSize * 0.8;

      // Brackets
      ctx.strokeStyle = `rgba(${cr},${cg},${cb},${0.5*flashAlpha})`;
      ctx.lineWidth   = 0.8;
      ctx.beginPath();
      ctx.moveTo(-lw/2 - 6, labelY + fontSize*0.1);
      ctx.lineTo(-lw/2 - 6, labelY - fontSize*0.55);
      ctx.lineTo(-lw/2,     labelY - fontSize*0.55);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo( lw/2 + 6, labelY + fontSize*0.1);
      ctx.lineTo( lw/2 + 6, labelY - fontSize*0.55);
      ctx.lineTo( lw/2,     labelY - fontSize*0.55);
      ctx.stroke();

      ctx.fillStyle = `rgba(${cr},${cg},${cb},${flashAlpha})`;
      ctx.fillText(sp.label, 0, labelY);

      // Pulse dot
      const pAlpha = 0.5 + 0.5*Math.sin(sp.pulse);
      ctx.fillStyle = `rgba(${cr},${cg},${cb},${pAlpha*flashAlpha})`;
      ctx.beginPath();
      ctx.arc(0, sp.r + barH + 20, 2, 0, Math.PI*2);
      ctx.fill();

      ctx.restore();
    }
  }

  /* ── DRAW: SHIP ──────────────────────────── */
  function drawShip() {
    if (gameState!=='playing' && gameState!=='win') return;
    if (invincTimer>0 && Math.floor(invincTimer/6)%2===0) return;
    ctx.save();
    ctx.translate(ship.x, ship.y);
    ctx.rotate(ship.angle);
    setLine(1);
    ctx.beginPath();
    ctx.moveTo(SHIP_SIZE, 0);
    ctx.lineTo(-SHIP_SIZE*0.7, -SHIP_SIZE*0.55);
    ctx.lineTo(-SHIP_SIZE*0.4, -SHIP_SIZE*0.18);
    ctx.lineTo(-SHIP_SIZE*0.4,  SHIP_SIZE*0.18);
    ctx.lineTo(-SHIP_SIZE*0.7,  SHIP_SIZE*0.55);
    ctx.closePath(); ctx.stroke();
    if (ship.thrusting && Math.random()>0.3) {
      setLine(0.85+Math.random()*0.15);
      const fl = SHIP_SIZE*(0.55+Math.random()*0.35);
      ctx.beginPath();
      ctx.moveTo(-SHIP_SIZE*0.4,-SHIP_SIZE*0.12);
      ctx.lineTo(-SHIP_SIZE*0.4-fl, 0);
      ctx.lineTo(-SHIP_SIZE*0.4, SHIP_SIZE*0.12);
      ctx.stroke();
    }
    ctx.restore();
  }

  /* ── DRAW: ASTEROID ──────────────────────── */
  function drawAsteroid(a) {
    ctx.save(); ctx.translate(a.x,a.y); ctx.rotate(a.rot); setLine(1);
    ctx.beginPath();
    const pts = a.shape;
    ctx.moveTo(pts[0].x,pts[0].y);
    for(let i=1;i<pts.length;i++) ctx.lineTo(pts[i].x,pts[i].y);
    ctx.closePath(); ctx.stroke(); ctx.restore();
  }

  /* ── DRAW: MAIN PLANET ───────────────────── */
  function drawPlanet() {
    if (planetHP<=0) return;
    const cx=W/2, cy=H/2, hp=planetHP/PLANET_HP;
    const shake=(1-hp)*2.5;
    const ox=(Math.random()-0.5)*shake, oy=(Math.random()-0.5)*shake;
    ctx.save(); ctx.translate(cx+ox,cy+oy);

    setLine(1); ctx.beginPath(); ctx.arc(0,0,PLANET_R,0,Math.PI*2); ctx.stroke();

    setLine(0.5);
    for(let lat=-3;lat<=3;lat++) {
      const y=lat/4*PLANET_R, xExt=Math.sqrt(Math.max(0,PLANET_R*PLANET_R-y*y));
      ctx.beginPath();
      for(let s=0;s<=40;s++){
        const t=s/40*Math.PI*2, px=Math.cos(t)*xExt, py=Math.sin(t)*(xExt*0.28);
        s===0?ctx.moveTo(px,py+y):ctx.lineTo(px,py+y);
      }
      ctx.stroke();
    }
    for(let lon=0;lon<6;lon++){
      setLine(0.45); ctx.save(); ctx.rotate(lon/6*Math.PI);
      ctx.beginPath();
      for(let s=0;s<=40;s++){
        const t=s/40*Math.PI*2, px=Math.sin(t)*PLANET_R*0.35, py=-Math.cos(t)*PLANET_R;
        s===0?ctx.moveTo(px,py):ctx.lineTo(px,py);
      }
      ctx.stroke(); ctx.restore();
    }

    // HP bar
    const barW=PLANET_R*2.2, barH=6, barX=-barW/2, barY=PLANET_R+16;
    const segs=PLANET_HP, segW=(barW-(segs-1)*1.5)/segs;
    setLine(0.6); ctx.strokeRect(barX-3,barY-3,barW+6,barH+6);
    for(let s=0;s<segs;s++){
      if(s<planetHP){ setLine(1); ctx.fillRect(barX+s*(segW+1.5),barY,segW,barH); }
    }
    setLine(0.7);
    ctx.font=`${Math.round(9*Math.min(W,H)/800+7)}px 'Share Tech Mono', monospace`;
    ctx.textAlign='center'; ctx.fillText(`DESTROY TO ENTER  HP:${planetHP}`,0,barY+barH+18);
    ctx.restore();
  }

  /* ── DRAW: BULLETS ───────────────────────── */
  function drawBullets() {
    setLine(1);
    for(const b of bullets){ ctx.beginPath(); ctx.arc(b.x,b.y,1.8,0,Math.PI*2); ctx.fill(); }
  }

  /* ── DRAW: PARTICLES ─────────────────────── */
  function drawParticles() {
    for(const p of particles){
      const a=p.life/p.maxLife; setLine(a);
      ctx.beginPath(); ctx.arc(p.x,p.y,1.2,0,Math.PI*2); ctx.fill();
    }
  }

  /* ── DRAW: PLANET FRAGMENTS ──────────────── */
  function drawPlanetFragments() {
    for(const f of planetFragments){
      ctx.save(); ctx.globalAlpha=f.alpha; ctx.translate(f.x,f.y); ctx.rotate(f.rot);
      setLine(f.alpha);
      ctx.beginPath(); ctx.moveTo(-f.length/2,0); ctx.lineTo(f.length/2,0); ctx.stroke();
      ctx.restore();
    }
    ctx.globalAlpha=1;
  }

  /* ── DRAW: HUD ───────────────────────────── */
  function drawHUD() {
    if(gameState!=='playing' && gameState!=='win' && gameState!=='gameover') return;
    const fontSize=Math.round(Math.min(W,H)*0.022+8);
    ctx.font=`${fontSize}px 'Share Tech Mono', monospace`;
    ctx.textAlign='left'; setLine(0.9-flickerNoise);
    const pad=Math.max(14,W*0.025), top=pad+fontSize;
    ctx.fillText(`SCORE  ${String(score).padStart(5,'0')}`, pad, top);
    const liveLabel='LIVES  ', labelW=ctx.measureText(liveLabel).width;
    ctx.fillText(liveLabel, pad, top+fontSize*1.4);
    for(let i=0;i<lives;i++){
      const lx=pad+labelW+i*(SHIP_SIZE*0.9+4), ly=top+fontSize*1.4, sz=SHIP_SIZE*0.55;
      ctx.save(); ctx.translate(lx+sz*0.6,ly-sz*0.5); ctx.rotate(-Math.PI/2);
      setLine(0.85); ctx.lineWidth=1.2;
      ctx.beginPath();
      ctx.moveTo(sz,0); ctx.lineTo(-sz*0.7,-sz*0.55); ctx.lineTo(-sz*0.4,-sz*0.18);
      ctx.lineTo(-sz*0.4,sz*0.18); ctx.lineTo(-sz*0.7,sz*0.55);
      ctx.closePath(); ctx.stroke(); ctx.restore();
    }
    ctx.textAlign='right'; setLine(0.9-flickerNoise);
    ctx.fillText(`PLANET HP  ${planetHP>0?String(planetHP).padStart(2,'0'):'--'}`, W-pad, top);
  }

  /* ── DRAW: STARS ─────────────────────────── */
  let starField=[];
  function buildStarField() {
    starField=[];
    const count=Math.floor((W*H)/3000);
    for(let i=0;i<count;i++) starField.push({ x:Math.random()*W, y:Math.random()*H, a:0.15+Math.random()*0.45 });
  }
  function drawStars() {
    for(const s of starField){ ctx.globalAlpha=s.a; ctx.fillStyle='#fff'; ctx.fillRect(s.x,s.y,1,1); }
    ctx.globalAlpha=1;
  }

  /* ── RENDER ──────────────────────────────── */
  function render() {
    ctx.clearRect(0,0,W,H);
    ctx.fillStyle='#000'; ctx.fillRect(0,0,W,H);

    // Layer 1: nebulae (pre-baked)
    if (nebulaCanvas) {
      ctx.globalAlpha = 1;
      ctx.drawImage(nebulaCanvas, 0, 0);
    }

    // Layer 2: stars
    drawStars();

    if (gameState==='playing' || gameState==='win' || gameState==='gameover') {
      // Layer 3: black holes (behind everything)
      drawBlackHoles();
      // Layer 4: secondary nav planets
      drawSecondaryPlanets();
      // Layer 5: main planet
      drawPlanet();
      drawPlanetFragments();
      // Layer 6: gameplay objects
      for(const a of asteroids) drawAsteroid(a);
      drawBullets();
      drawParticles();
      drawShip();
      // Layer 7: HUD on top
      drawHUD();
    }
  }

  /* ── LOOP ────────────────────────────────── */
  let lastTime=0;
  function loop(ts) {
    requestAnimationFrame(loop);
    if(ts-lastTime < 1000/(FPS+2)) return;
    lastTime=ts; update(); render();
  }

  /* ── SCREEN TRANSITIONS ──────────────────── */
  function showStart() {
    gameState='start';
    startScreen.classList.remove('hidden');
    gameoverScr.classList.add('hidden');
    winScreen.classList.add('hidden');
  }
  function startGame() {
    startScreen.classList.add('hidden');
    gameoverScr.classList.add('hidden');
    winScreen.classList.add('hidden');
    initGame(); gameState='playing';
  }

  document.addEventListener('keydown', e => {
    if(e.key!==' ') return;
    e.preventDefault(); ensureAudio();
    if(gameState==='start')    startGame();
    else if(gameState==='gameover') { gameoverScr.classList.add('hidden'); startGame(); }
  });

  /* ── BOOT ────────────────────────────────── */
  resize();
  showStart();
  requestAnimationFrame(loop);

})();
