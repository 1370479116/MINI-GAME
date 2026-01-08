// Space War - 太空飞机大战（重写：支持 file:// 也能播放音乐）
// 关键点（摘要）：
// - 我方子弹白色、敌方子弹暖色
// - 追踪导弹：锁定最近敌机（优先小兵，其次Boss），命中伤害0.5
// - Boss二阶段红温：无敌+反弹玩家子弹/导弹

(() => {
  // ===== 配色 =====
  const COLOR_PLAYER_BULLET = '#ffffff';
  const COLOR_PLAYER_MISSILE = '#ffffff';

  // 敌方暖色（来自你给的色卡）
  const COLOR_ENEMY_BULLET = '#f3a361';
  const COLOR_ENEMY_SPECIAL = '#e7c66b';
  const COLOR_ENEMY_DANGER = '#e66d50';

  // ===== 全局错误显示 =====
  window.addEventListener('error', (ev) => {
    try {
      const sl = document.getElementById('statusLine');
      const msg = (ev && ev.message) ? String(ev.message) : '脚本运行错误';
      if (sl) sl.textContent = '错误：' + msg;
    } catch (_) {}
  });

  // ===== DOM =====
  const canvas = document.getElementById('game');
  if (!canvas) throw new Error('找不到 canvas#game');
const ctx = canvas.getContext('2d');

  const overlay = document.getElementById('overlay');
  const ovTitle = document.getElementById('ovTitle');
  const ovText = document.getElementById('ovText');
  const btnStart = document.getElementById('btnStart');
  const btnRestart = document.getElementById('btnRestart');

  const uiScore = document.getElementById('uiScore');
  const uiHp = document.getElementById('uiHp');
  const uiBullets = document.getElementById('uiBullets');
  const uiMissiles = document.getElementById('uiMissiles');

  const statusLine = document.getElementById('statusLine');
  const statusSub = document.getElementById('statusSub');

  const btnAttack = document.getElementById('btnAttack');
  const btnBomber = document.getElementById('btnBomber');

  canvas.width = 900;
canvas.height = 600;

  // ===== Utils =====
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const rand = (a, b) => Math.random() * (b - a) + a;
  const randi = (a, b) => Math.floor(rand(a, b + 1));

  // ===== Input =====
  const keys = Object.create(null);
  window.addEventListener('keydown', (e) => {
    if (['ArrowUp','ArrowDown','ArrowLeft','ArrowRight',' '].includes(e.key)) e.preventDefault();
    keys[e.key === ' ' ? 'Space' : e.key] = true;
  }, { passive: false });
  window.addEventListener('keyup', (e) => {
    if (['ArrowUp','ArrowDown','ArrowLeft','ArrowRight',' '].includes(e.key)) e.preventDefault();
    keys[e.key === ' ' ? 'Space' : e.key] = false;
  }, { passive: false });

  function bindHold(el, keyName) {
    if (!el) return;
    const down = (ev) => {
      ev.preventDefault();
      keys[keyName] = true;
      el.classList.add('pressed');
    };
    const up = (ev) => {
      ev.preventDefault();
      keys[keyName] = false;
      el.classList.remove('pressed');
    };
    el.addEventListener('pointerdown', down);
    el.addEventListener('pointerup', up);
    el.addEventListener('pointercancel', up);
    el.addEventListener('pointerleave', (ev) => {
      if (keys[keyName]) up(ev);
    });
  }

  for (const b of Array.from(document.querySelectorAll('.pad[data-key]'))) {
    bindHold(b, b.getAttribute('data-key'));
  }
  bindHold(btnAttack, 'Space');

  // ===== BGM（用户选择文件，支持 file://） =====
const bgm = {
    common: new Audio(),
    boss2: new Audio(),
    current: null,
    urls: { common: null, boss2: null },
    ready: false
  };
  bgm.common.loop = true; bgm.common.volume = 0.65;
  bgm.boss2.loop = true; bgm.boss2.volume = 0.75;

  function stopAllBgm() {
    for (const a of [bgm.common, bgm.boss2]) {
      try { a.pause(); } catch (_) {}
    }
    bgm.current = null;
  }

  // ===== Game State =====
  const WORLD = { w: canvas.width, h: canvas.height };
  const game = {
    running: false,
    over: false,
    t: 0,
    last: 0,
    frame: 0,
    score: 0,
    minute1: 60_000,
    statusUntil: 0,
    statusText: '准备就绪',
    spawnAcc: 0,
    bossSpawned: false
  };

  function setStatus(msg, holdMs = 1800) {
    game.statusText = msg;
    game.statusUntil = game.t + holdMs;
    if (statusLine) statusLine.textContent = msg;
  }

  async function safePlayAudio(el, label) {
    try {
      el.muted = false;
      const p = el.play();
      if (p && typeof p.then === 'function') await p;
      return true;
    } catch (err) {
      console.log(label + ' 播放失败：', err);
      setStatus(label + '播放失败（请检查浏览器是否静音/系统音量）', 2600);
      return false;
    }
  }

  async function playBgm(which) {
    if (!bgm.ready) return;
    if (bgm.current === which) return;
    stopAllBgm();
    bgm.current = which;
    const el = which === 'common' ? bgm.common : bgm.boss2;
    try { el.currentTime = 0; } catch (_) {}
    const ok = await safePlayAudio(el, which === 'common' ? 'common音乐' : 'boss2音乐');
    if (ok) setStatus((which === 'common' ? '播放：common' : '播放：boss2'), 800);
  }

  function pickFile(accept = 'audio/*') {
    return new Promise((resolve) => {
      const input = document.createElement('input');
      input.type = 'file';
      input.accept = accept;
      input.style.display = 'none';
      document.body.appendChild(input);
      input.addEventListener('change', () => {
        const file = input.files && input.files[0];
        document.body.removeChild(input);
        resolve(file || null);
      });
      input.click();
    });
  }

  async function setupBgmByPickingBoth() {
    if (bgm.ready) return true;

    setStatus('请选择 common.mp3（背景音乐）…', 3000);
    const commonFile = await pickFile('audio/mpeg,audio/*');
    if (!commonFile) {
      setStatus('未选择 common.mp3，音乐将保持关闭');
      return false;
  }

    setStatus('请选择 boss2.mp3（Boss二阶段音乐）…', 3000);
    const boss2File = await pickFile('audio/mpeg,audio/*');
    if (!boss2File) {
      setStatus('未选择 boss2.mp3，音乐将保持关闭');
      return false;
  }

    if (bgm.urls.common) URL.revokeObjectURL(bgm.urls.common);
    if (bgm.urls.boss2) URL.revokeObjectURL(bgm.urls.boss2);

    bgm.urls.common = URL.createObjectURL(commonFile);
    bgm.urls.boss2 = URL.createObjectURL(boss2File);

    bgm.common.src = bgm.urls.common;
    bgm.boss2.src = bgm.urls.boss2;

    bgm.ready = true;
    setStatus('音乐已加载：common / boss2', 1200);

    // 预热
    await safePlayAudio(bgm.common, 'common音乐');
    try { bgm.common.pause(); bgm.common.currentTime = 0; } catch (_) {}

    return true;
}

  function getSpawnIntervalMs() {
    const t = game.t;
    if (t <= 10_000) return 2000;
    if (t >= 60_000) return 500;
    const p = (t - 10_000) / 50_000;
    return 2000 + (500 - 2000) * p;
  }

  // ===== Player =====
  const PLAYER_HALF_W = 9;
  const PLAYER_HALF_H = 14;
  const PLAYER_RECT = { w: 18, h: 28 };

  const player = {
    x: WORLD.w / 2,
    y: WORLD.h - 90,
    hp: 30,
    hpMax: 50,
    bulletCount: 1,
    missiles: 0,
    bomberCharges: 0,
    bomberMaxCharges: 2,
    speed: 6.6,
    shootCd: 0,
    shootEvery: 95,
    invulnUntil: 0
  };

  const bomber = {
    active: false,
    until: 0,
    x: 0,
    y: 0,
    shootCd: 0,
    shootEvery: 95
  };

  function playerRect() {
    return { x: player.x - PLAYER_HALF_W, y: player.y - PLAYER_HALF_H, w: PLAYER_RECT.w, h: PLAYER_RECT.h };
}

  function updateBomberBtnText() {
    btnBomber.textContent = `召唤轰炸机（${player.bomberCharges}/${player.bomberMaxCharges}）`;
    btnBomber.disabled = !(game.running && player.bomberCharges > 0 && !bomber.active);
  }

  function updateStatusSub() {
    if (!statusSub) return;
    const bossMsg = boss.active ? (boss.phase === 1 ? 'Boss阶段1' : (boss.rageActive ? 'Boss二阶段(红温)' : 'Boss二阶段')) : '无Boss';
    statusSub.textContent = `子弹x${player.bulletCount}/10 · 导弹x${player.missiles}/3 · 生命${player.hp}/${player.hpMax} · 轰炸机${player.bomberCharges}/${player.bomberMaxCharges} · ${bossMsg}`;
  }

  function syncUI() {
    uiScore.textContent = String(game.score);
    uiHp.textContent = String(player.hp);
    uiBullets.textContent = String(player.bulletCount);
    uiMissiles.textContent = String(player.missiles);
    updateStatusSub();
    updateBomberBtnText();
  }

  btnBomber.addEventListener('click', (e) => {
    e.preventDefault();
    if (!game.running) return;
    if (player.bomberCharges <= 0) return;
    if (bomber.active) return;
    summonBomber();
  });

  // ===== Entities =====
  const pBullets = [];
  const pMissiles = [];
  const eBullets = [];
const enemies = [];
  const drops = [];

  // ===== Drops =====
  const DROP = {
    bullet: { p: 0.20, color: '#57d0ff', label: '⚡' },
    missile: { p: 0.10, color: '#c957ff', label: '🚀' },
    bomber: { p: 0.20, color: '#ffd257', label: '✈' },
    hp: { p: 0.30, color: '#4dff88', label: '❤' }
  };

  function canDrop(id) {
    if (id === 'bullet') return player.bulletCount < 10;
    if (id === 'missile') return player.missiles < 3;
    if (id === 'bomber') return player.bomberCharges < player.bomberMaxCharges;
    if (id === 'hp') return true;
    return false;
  }

  function rollDropOne() {
    const opts = Object.entries(DROP).filter(([id]) => canDrop(id));
    if (!opts.length) return null;
    const total = opts.reduce((s, [,v]) => s + v.p, 0);
    if (Math.random() > total) return null;
    let r = Math.random() * total;
    for (const [id, v] of opts) {
      r -= v.p;
      if (r <= 0) return id;
    }
    return null;
  }

  function spawnDrop(x, y, id) {
    const cfg = DROP[id];
    drops.push({ id, x, y, r: 12, vy: 1.8, color: cfg.color, label: cfg.label });
  }

  function applyDrop(id) {
    if (id === 'bullet' && player.bulletCount < 10) {
      player.bulletCount++;
      setStatus(`获得道具：子弹 +1（${player.bulletCount}/10）`);
    } else if (id === 'missile' && player.missiles < 3) {
      player.missiles++;
      setStatus(`获得道具：导弹 +1（${player.missiles}/3）`);
    } else if (id === 'bomber') {
      if (player.bomberCharges < player.bomberMaxCharges) {
        player.bomberCharges++;
        setStatus(`获得道具：轰炸机次数 +1（${player.bomberCharges}/${player.bomberMaxCharges}）`);
      } else {
        setStatus(`轰炸机次数已满（${player.bomberMaxCharges}/${player.bomberMaxCharges}）`);
      }
    } else if (id === 'hp') {
      player.hp = Math.min(player.hpMax, player.hp + 5);
      setStatus('获得道具：生命 +5');
    }
    syncUI();
  }

  // ===== Enemies =====
  const ENEMY_KIND = { DOUBLE: 1, DODGE: 2, BOMB: 3, HARD: 4, FAST: 5 };

  function getMobBaseHp() {
    return 2 + Math.floor(game.t / 10000);
  }

  function getMobExtraHp() {
    if (game.t >= 30_000) return 8;
    if (game.t >= 20_000) return 5;
    return 0;
  }

  function spawnEnemyFirstMinute() {
    const kind = randi(1, 5);

    const baseHp = getMobBaseHp() + getMobExtraHp();
    const typeMult = (kind === ENEMY_KIND.HARD) ? 2 : 1;
    const hp = baseHp * typeMult;

    const baseVy = 0.8;

    enemies.push({
      kind,
      x: rand(40, WORLD.w - 40),
      y: -60,
      vx: rand(-0.8, 0.8),
      vy: baseVy * (kind === ENEMY_KIND.FAST ? 2 : 1),
      hp,
      maxHp: hp,
      shootCd: rand(300, 800),
      shootEvery: rand(650, 950),
      bombUsed: false,
      color: {
        1:'#ffb74a',
        2:'#7cf6ff',
        3:'#ff5d7a',
        4:'#c8c8ff',
        5:'#8cff7a'
      }[kind]
    });
  }

  // ===== Boss =====
const boss = {
  active: false,
  phase: 1,
    x: WORLD.w / 2,
  y: -140,
    w: 140,
    h: 140,
  hp: 0,
  maxHp: 0,
    vx: 0,
    vy: 0,
    nextMoveAt: 0,
    enterSpeed: 0.9,
  shootCd: 0,
  shootInterval: 30,
    rageActive: false,
    rageUntil: 0,
    nextRageAt: 0
};

  const BOSS_HP_MULT = 0.5;
  const BOSS_DMG_MULT = 8;

  function spawnBoss() {
    if (boss.active) return;
    boss.active = true;
    boss.phase = 1;
    boss.w = 150;
    boss.h = 150;
    boss.x = WORLD.w / 2;
    boss.y = -140;
    boss.maxHp = Math.floor(1000 * 3 * BOSS_HP_MULT);
    boss.hp = boss.maxHp;
    boss.vx = 0;
    boss.vy = 0;
    boss.nextMoveAt = game.t + 300;
    boss.shootCd = 30;
    boss.rageActive = false;
    boss.rageUntil = 0;
    boss.nextRageAt = 0;
    playBgm('common');
    setStatus('Boss出现了！', 2400);
  }

  function enterBossPhase2() {
    boss.phase = 2;
    playBgm('boss2');
    setStatus('Boss进入了二阶段！', 2600);
    boss.w = 190;
    boss.h = 190;
    boss.maxHp = Math.floor(800 * 3 * BOSS_HP_MULT);
    boss.hp = boss.maxHp;
    boss.nextMoveAt = game.t + 200;
    boss.rageActive = false;
    boss.rageUntil = 0;
    boss.nextRageAt = game.t + 5000;
    }

  // ===== Collision =====
  function circleRectHit(cx, cy, cr, rx, ry, rw, rh) {
    const x = clamp(cx, rx, rx + rw);
    const y = clamp(cy, ry, ry + rh);
    const dx = cx - x;
    const dy = cy - y;
    return dx * dx + dy * dy <= cr * cr;
  }

  // ===== Shooting =====
  function shootPlayer(fromX, fromY, bulletCount, missileCount, bulletColor = COLOR_PLAYER_BULLET) {
    const n = Math.max(1, bulletCount);
    if (n === 1) {
      pBullets.push({ x: fromX, y: fromY, vx: 0, vy: -7.8, r: 4.5, color: bulletColor, dmg: 1 });
  } else {
      const spread = Math.min(260, 18 * (n - 1));
      for (let i = 0; i < n; i++) {
        const ox = -spread / 2 + (spread * i) / (n - 1);
        const vx = ox * 0.03;
        pBullets.push({ x: fromX + ox, y: fromY, vx, vy: -7.8, r: 4.5, color: bulletColor, dmg: 1 });
}
    }

    for (let i = 0; i < missileCount && pMissiles.length < 3; i++) {
      pMissiles.push({ x: fromX + (i - (missileCount - 1) / 2) * 18, y: fromY, vx: 0, vy: -6, r: 7, speed: 6.2, color: COLOR_PLAYER_MISSILE, dmg: 0.5, target: null });
    }
  }

  function enemyShoot(e) {
    const cx = e.x;
    const cy = e.y + 14;
    const sp = 2.7;

    for (const i of [-1, 1]) {
      const a = i * 0.22;
      eBullets.push({ x: cx, y: cy, vx: Math.sin(a) * sp * 0.8, vy: Math.cos(a) * sp * 0.8, r: 5, color: COLOR_ENEMY_BULLET, dmg: 4 });
    }

    if (e.kind === ENEMY_KIND.DOUBLE) {
      const sp2 = 3.0;
      for (const i of [-1, 1]) {
        const a = i * 0.28 + 0.12;
        eBullets.push({ x: cx, y: cy, vx: Math.sin(a) * sp2 * 0.8, vy: Math.cos(a) * sp2 * 0.8, r: 4, color: COLOR_ENEMY_SPECIAL, dmg: 2 });
      }
    }
  }

  // Boss红温反弹弹
  function spawnReflectedBullet(px, py, vx, vy) {
    eBullets.push({ x: px, y: py, vx, vy, r: 5, color: COLOR_ENEMY_DANGER, dmg: 0.5, reflected: true });
  }

  function bossShoot() {
    const cx = boss.x;
    const cy = boss.y + boss.h / 2;

    const fireMul = (boss.phase === 2 && boss.rageActive) ? 2 : 1;

    // 一阶段6发
    const phase1Offsets = [-25, -15, -5, 5, 15, 25];
    const sp = boss.phase === 1 ? 2.6 : 3.2;

    for (let t = 0; t < fireMul; t++) {
      if (boss.phase === 1) {
        for (const ox of phase1Offsets) {
          const a = (ox / 25) * 0.18 + rand(-0.05, 0.05);
          eBullets.push({ x: cx + ox, y: cy, vx: Math.sin(a) * sp * 0.8, vy: Math.cos(a) * sp * 0.8, r: 6, color: COLOR_ENEMY_DANGER, dmg: 2 * BOSS_DMG_MULT, fromBoss: true });
  }
      } else {
        for (let i = -1; i <= 1; i++) {
          const a = i * 0.22 + rand(-0.07, 0.07);
          eBullets.push({ x: cx + i * 10, y: cy, vx: Math.sin(a) * sp * 0.8, vy: Math.cos(a) * sp * 0.8, r: 6, color: COLOR_ENEMY_BULLET, dmg: 2 * BOSS_DMG_MULT, fromBoss: true });
        }
      }
    }

    if (boss.phase === 2) {
      for (let t = 0; t < fireMul; t++) {
        const n = 10;
        const base = rand(0, Math.PI * 2);
        for (let k = 0; k < n; k++) {
          const a = base + (k * Math.PI * 2) / n;
          eBullets.push({ x: cx, y: cy, vx: Math.cos(a) * 2.1 * 0.8, vy: Math.sin(a) * 2.1 * 0.8, r: 4, color: COLOR_ENEMY_SPECIAL, dmg: 2 * BOSS_DMG_MULT, fromBoss: true });
        }
      }
    }
}

  // ===== Combat helpers =====
  function takeDamage(dmg) {
    if (game.t < player.invulnUntil) return;
    player.hp -= dmg;
    player.invulnUntil = game.t + 350;
    if (player.hp <= 0) {
      player.hp = 0;
      syncUI();
      return gameOver();
    }
    setStatus(`受到伤害 -${dmg}`);
  }

  function killEnemy(e) {
    game.score += 10;
    if (game.t < game.minute1) {
      const id = rollDropOne();
      if (id) spawnDrop(e.x, e.y, id);
    }
  }

  // ===== Draw =====
  function drawBackground() {
    const g = ctx.createLinearGradient(0, 0, 0, WORLD.h);
    g.addColorStop(0, '#070a14');
    g.addColorStop(0.4, '#0b1030');
    g.addColorStop(1, '#02030a');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, WORLD.w, WORLD.h);

    ctx.save();
    for (let i = 0; i < 180; i++) {
      const x = (i * 73 + game.frame * 0.7) % WORLD.w;
      const y = (i * 37 + game.frame * 0.35) % WORLD.h;
      const s = (i % 3) + 1;
      ctx.globalAlpha = 0.25 + ((i * 17) % 100) / 100 * 0.6;
      ctx.fillStyle = i % 7 === 0 ? '#fff7b8' : '#dce8ff';
      ctx.fillRect(x, y, s * 0.6, s * 0.6);
    }
    ctx.restore();
  }

  function drawCircle(x, y, r, c) {
    ctx.fillStyle = c;
  ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
  ctx.fill();
  }

  function drawPlayerShip(x, y, alpha = 1, tint = '#57d0ff') {
    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.translate(x, y);
    ctx.scale(0.5, 0.5);

    ctx.fillStyle = 'rgba(87,208,255,.45)';
  ctx.beginPath();
    ctx.ellipse(0, 30, 10, 16, 0, 0, Math.PI * 2);
  ctx.fill();

    const body = ctx.createLinearGradient(0, -30, 0, 30);
    body.addColorStop(0, '#cfe8ff');
    body.addColorStop(0.5, tint);
    body.addColorStop(1, '#1a2a66');
    ctx.fillStyle = body;
  ctx.beginPath();
    ctx.moveTo(0, -34);
    ctx.lineTo(-16, 24);
    ctx.lineTo(0, 14);
    ctx.lineTo(16, 24);
    ctx.closePath();
  ctx.fill();

  ctx.restore();
}

  function drawEnemy(e) {
  ctx.save();
    ctx.translate(e.x, e.y);
    ctx.fillStyle = e.color;
  ctx.beginPath();
    ctx.moveTo(0, 18);
    ctx.lineTo(-16, -18);
    ctx.lineTo(0, -10);
    ctx.lineTo(16, -18);
    ctx.closePath();
  ctx.fill();
  ctx.restore();
}

  function drawBoss() {
  ctx.save();
    const cx = boss.x;
    const cy = boss.y + boss.h / 2;
  ctx.translate(cx, cy);

    const shield = (boss.phase === 2 && boss.rageActive);
    const r = boss.w * 0.46;

    ctx.shadowBlur = shield ? 36 : 24;
    ctx.shadowColor = shield ? 'rgba(255,60,60,.55)' : (boss.phase === 1 ? 'rgba(255,123,232,.35)' : 'rgba(87,208,255,.35)');

    const grad = ctx.createRadialGradient(0, 0, 10, 0, 0, r);
    if (shield) {
      grad.addColorStop(0, '#ffd6d6');
      grad.addColorStop(0.4, '#ff3c3c');
      grad.addColorStop(1, '#4a0000');
    } else if (boss.phase === 1) {
      grad.addColorStop(0, '#ffd0ff');
      grad.addColorStop(0.35, '#ff7be8');
      grad.addColorStop(1, '#45004a');
    } else {
      grad.addColorStop(0, '#d7fbff');
      grad.addColorStop(0.35, '#57d0ff');
      grad.addColorStop(1, '#003245');
    }

    ctx.fillStyle = grad;
  ctx.beginPath();
    ctx.arc(0, 0, r, 0, Math.PI * 2);
  ctx.fill();

    // ===== Boss 血条（含数字） =====
    const bw = 320;
    const bh = 10;
    const hpRatio = Math.max(0, Math.min(1, boss.hp / boss.maxHp));

    // 背景
    ctx.shadowBlur = 0;
    ctx.fillStyle = 'rgba(0,0,0,0.55)';
    ctx.fillRect(-bw / 2, -r - 28, bw, bh);

    // 前景
    ctx.fillStyle = shield ? '#ff3c3c' : '#ffffff';
    ctx.fillRect(-bw / 2, -r - 28, bw * hpRatio, bh);

    // 边框
    ctx.strokeStyle = 'rgba(255,255,255,0.75)';
    ctx.lineWidth = 1;
    ctx.strokeRect(-bw / 2, -r - 28, bw, bh);

    // 数字
    ctx.font = '14px Arial';
    ctx.fillStyle = shield ? '#ffd6d6' : '#ffffff';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'bottom';
    ctx.fillText(`${Math.ceil(boss.hp)} / ${boss.maxHp}`, 0, -r - 32);

    if (shield) {
      // 红温护盾圈
      ctx.globalAlpha = 0.75;
      ctx.strokeStyle = 'rgba(255,60,60,0.9)';
      ctx.lineWidth = 4;
      ctx.beginPath();
      ctx.arc(0, 0, r + 10, 0, Math.PI * 2);
      ctx.stroke();
      ctx.globalAlpha = 1;
    }

  ctx.restore();
}

  function draw() {
    drawBackground();

    for (const e of enemies) drawEnemy(e);
    if (boss.active) drawBoss();

    if (game.running) {
      const blink = game.t < player.invulnUntil ? (Math.floor(game.frame / 4) % 2 === 0 ? 0.35 : 1) : 1;
      drawPlayerShip(player.x, player.y, blink);
      if (bomber.active) drawPlayerShip(bomber.x, bomber.y, 0.75, '#8fe8ff');
  }

    for (const b of pBullets) drawCircle(b.x, b.y, b.r, b.color);
    for (const m of pMissiles) drawCircle(m.x, m.y, m.r, m.color);
    for (const b of eBullets) drawCircle(b.x, b.y, b.r, b.color);

    for (const d of drops) {
      ctx.save();
      ctx.shadowBlur = 14;
      ctx.shadowColor = d.color;
      ctx.fillStyle = d.color;
  ctx.beginPath();
      ctx.arc(d.x, d.y, d.r, 0, Math.PI * 2);
  ctx.fill();
  ctx.shadowBlur = 0;
      ctx.fillStyle = '#fff';
      ctx.font = '16px Arial';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(d.label, d.x, d.y + 1);
  ctx.restore();
}
  }

  // ===== Missile target helper =====
  function findNearestEnemy(x, y) {
    let best = null;
    let bestD = Infinity;
    for (const e of enemies) {
      const dx = e.x - x;
      const dy = e.y - y;
      const d = dx * dx + dy * dy;
      if (d < bestD) {
        bestD = d;
        best = e;
      }
    }
    return best;
  }

  // ===== Update =====
  function update(dt) {
    if (!game.running) return;

    game.t += dt;
    game.frame++;

    if (game.t > game.statusUntil && statusLine && statusLine.textContent === game.statusText) {
      statusLine.textContent = boss.active ? (boss.phase === 1 ? 'Boss战：小心弹幕！' : (boss.rageActive ? 'Boss红温！无敌！' : 'Boss二阶段！')) : '战斗中…';
    }

    // move player
    const mvx = (keys['ArrowRight'] ? 1 : 0) - (keys['ArrowLeft'] ? 1 : 0);
    const mvy = (keys['ArrowDown'] ? 1 : 0) - (keys['ArrowUp'] ? 1 : 0);
    player.x = clamp(player.x + mvx * player.speed, PLAYER_HALF_W, WORLD.w - PLAYER_HALF_W);
    player.y = clamp(player.y + mvy * player.speed, WORLD.h * 0.45 + PLAYER_HALF_H, WORLD.h - PLAYER_HALF_H);

    // shoot
    player.shootCd -= dt;
    if (keys['Space'] && player.shootCd <= 0) {
      shootPlayer(player.x, player.y - 18, player.bulletCount, player.missiles, COLOR_PLAYER_BULLET);
      player.shootCd = player.shootEvery;
}

    // bomber
    if (bomber.active) {
      if (game.t >= bomber.until) {
        bomber.active = false;
        setStatus('轰炸机支援结束');
        syncUI();
    } else {
        const tx = clamp(player.x + 150, 60, WORLD.w - 60);
        const ty = clamp(player.y + 10, WORLD.h * 0.55, WORLD.h - 60);
        bomber.x += (tx - bomber.x) * 0.06;
        bomber.y += (ty - bomber.y) * 0.06;

        bomber.shootCd -= dt;
        if (bomber.shootCd <= 0) {
          shootPlayer(bomber.x, bomber.y - 18, player.bulletCount, player.missiles, COLOR_PLAYER_BULLET);
          bomber.shootCd = bomber.shootEvery;
      }
    }
  }

    // spawn mobs
    game.spawnAcc += dt;
    const interval = getSpawnIntervalMs();
    if (game.t < game.minute1 && !boss.active) {
      while (game.spawnAcc >= interval) {
        game.spawnAcc -= interval;
        spawnEnemyFirstMinute();
      }
    }

    // spawn boss
    if (!game.bossSpawned && game.t >= game.minute1) {
      game.bossSpawned = true;
      spawnBoss();
}

    updateBomberBtnText();

    const pr = playerRect();

    // enemies update
    for (let i = enemies.length - 1; i >= 0; i--) {
      const e = enemies[i];
      e.x += e.vx;
      e.y += e.vy;

      if (e.x < 30) { e.x = 30; e.vx = Math.abs(e.vx); }
      if (e.x > WORLD.w - 30) { e.x = WORLD.w - 30; e.vx = -Math.abs(e.vx); }

      e.shootCd -= dt;
      if (e.shootCd <= 0) {
        enemyShoot(e);
        e.shootCd = e.shootEvery;
    }

      if (circleRectHit(e.x, e.y, 18, pr.x, pr.y, pr.w, pr.h)) {
        takeDamage(8);
        enemies.splice(i, 1);
        continue;
  }

      if (e.y > WORLD.h + 80) enemies.splice(i, 1);
}

    // boss update
    if (boss.active) {
      boss.y += boss.enterSpeed;
      if (boss.y > 30) boss.y = 30;

      if (boss.phase === 2) {
        if (!boss.rageActive && game.t >= boss.nextRageAt) {
          boss.rageActive = true;
          boss.rageUntil = game.t + 1000;
          boss.nextRageAt = game.t + 5000;
          setStatus('Boss红温！无敌！子弹翻倍！', 1200);
        }
        if (boss.rageActive && game.t >= boss.rageUntil) {
          boss.rageActive = false;
  }
      }

      if (game.t >= boss.nextMoveAt) {
        const ang = rand(0, Math.PI * 2);
        const sp = boss.phase === 2 ? 2.8 : 2.2;
        boss.vx = Math.cos(ang) * sp;
        boss.vy = Math.sin(ang) * sp;
        boss.nextMoveAt = game.t + rand(450, 1100);
      }

      boss.x += boss.vx;
      boss.y += boss.vy;

      const minX = boss.w / 2;
      const maxX = WORLD.w - boss.w / 2;
      const minY = 10;
      const maxY = WORLD.h * 0.5 - boss.h - 10;
      boss.x = clamp(boss.x, minX, maxX);
      boss.y = clamp(boss.y, minY, Math.max(minY, maxY));

      boss.shootCd--;
      if (boss.shootCd <= 0) {
        bossShoot();
        boss.shootCd = boss.shootInterval;
    }
  }

    // player bullets update + hit
    for (let i = pBullets.length - 1; i >= 0; i--) {
      const b = pBullets[i];
    b.x += b.vx;
    b.y += b.vy;
      if (b.y < -60 || b.x < -80 || b.x > WORLD.w + 80) {
        pBullets.splice(i, 1);
      continue;
    }

      // hit enemies
    for (let j = enemies.length - 1; j >= 0; j--) {
      const e = enemies[j];
        if (circleRectHit(b.x, b.y, b.r, e.x - 20, e.y - 20, 40, 46)) {
          e.hp -= b.dmg;
          pBullets.splice(i, 1);
        if (e.hp <= 0) {
            killEnemy(e);
          enemies.splice(j, 1);
        }
        break;
      }
    }

      // hit boss
    if (boss.active) {
        const br = { x: boss.x - boss.w/2, y: boss.y, w: boss.w, h: boss.h };
        if (circleRectHit(b.x, b.y, b.r, br.x, br.y, br.w, br.h)) {
          if (boss.phase === 2 && boss.rageActive) {
            spawnReflectedBullet(b.x, b.y, b.vx, Math.abs(b.vy));
          } else {
            boss.hp -= b.dmg;
            if (boss.phase === 1 && boss.hp <= 0) enterBossPhase2();
            else if (boss.phase === 2 && boss.hp <= 0) win();
          }
          pBullets.splice(i, 1);
        }
      }
    }

    // homing missiles update + hit (damage 0.5)
    for (let i = pMissiles.length - 1; i >= 0; i--) {
      const m = pMissiles[i];

      // acquire / validate target
      if (!m.target || m.target.dead) {
        m.target = findNearestEnemy(m.x, m.y) || (boss.active ? boss : null);
    }

      // steer towards target
    if (m.target) {
        const tx = (m.target === boss) ? boss.x : m.target.x;
        const ty = (m.target === boss) ? (boss.y + boss.h / 2) : m.target.y;
      const dx = tx - m.x;
      const dy = ty - m.y;
        const dist = Math.hypot(dx, dy) || 1;
        const sp = m.speed;
        m.vx = (dx / dist) * sp;
        m.vy = (dy / dist) * sp;
    }

    m.x += m.vx;
    m.y += m.vy;

      if (m.y < -120 || m.y > WORLD.h + 120 || m.x < -120 || m.x > WORLD.w + 120) {
        pMissiles.splice(i, 1);
      continue;
    }

      // hit enemy
      let hit = false;
      for (let j = enemies.length - 1; j >= 0; j--) {
        const e = enemies[j];
        if (circleRectHit(m.x, m.y, m.r, e.x - 20, e.y - 20, 40, 46)) {
          e.hp -= 0.5;
          pMissiles.splice(i, 1);
          hit = true;
        if (e.hp <= 0) {
            killEnemy(e);
            enemies.splice(j, 1);
        }
          break;
      }
      }
      if (hit) continue;

      // hit boss
      if (boss.active) {
        const br = { x: boss.x - boss.w/2, y: boss.y, w: boss.w, h: boss.h };
        if (circleRectHit(m.x, m.y, m.r, br.x, br.y, br.w, br.h)) {
          if (boss.phase === 2 && boss.rageActive) {
            spawnReflectedBullet(m.x, m.y, m.vx, Math.abs(m.vy));
      } else {
            boss.hp -= 0.5;
            if (boss.phase === 1 && boss.hp <= 0) enterBossPhase2();
            else if (boss.phase === 2 && boss.hp <= 0) win();
          }
          pMissiles.splice(i, 1);
        }
      }
    }

    // enemy bullets update + hit player
    for (let i = eBullets.length - 1; i >= 0; i--) {
      const b = eBullets[i];
    b.x += b.vx;
    b.y += b.vy;
      if (b.y > WORLD.h + 120 || b.x < -120 || b.x > WORLD.w + 120 || b.y < -160) {
        eBullets.splice(i, 1);
      continue;
    }
      if (circleRectHit(b.x, b.y, b.r, pr.x, pr.y, pr.w, pr.h)) {
        eBullets.splice(i, 1);
        takeDamage(b.dmg ?? 2);
      }
    }

    // drops update
    for (let i = drops.length - 1; i >= 0; i--) {
      const d = drops[i];
      d.y += d.vy;
      if (d.y > WORLD.h + 60) {
        drops.splice(i, 1);
      continue;
    }
      if (circleRectHit(d.x, d.y, d.r, pr.x, pr.y, pr.w, pr.h)) {
        applyDrop(d.id);
        drops.splice(i, 1);
    }
    }

    syncUI();
  }

  // ===== Damage / End =====
  function gameOver() {
    game.running = false;
    game.over = true;
    stopAllBgm();
    overlay.classList.remove('hidden');
    ovTitle.textContent = '游戏结束';
    ovText.textContent = `最终得分：${game.score}`;
    btnStart.style.display = 'none';
    btnRestart.style.display = 'inline-block';
}

  function win() {
    game.running = false;
    game.over = true;
    stopAllBgm();
    overlay.classList.remove('hidden');
    ovTitle.textContent = '胜利！';
    ovText.textContent = `你击败了Boss！\n最终得分：${game.score}`;
    btnStart.style.display = 'none';
    btnRestart.style.display = 'inline-block';
  }

  // ===== Reset/Start =====
  function reset() {
    game.running = false;
    game.over = false;
    game.t = 0;
    game.last = 0;
    game.frame = 0;
    game.score = 0;
    game.spawnAcc = 0;
    game.bossSpawned = false;

    player.x = WORLD.w / 2;
    player.y = WORLD.h - 90;
    player.hp = 30;
    player.bulletCount = 1;
    player.missiles = 0;
    player.bomberCharges = 0;

    bomber.active = false;

    boss.active = false;

    pBullets.length = 0;
    pMissiles.length = 0;
    eBullets.length = 0;
    enemies.length = 0;
    drops.length = 0;

    // 不在 reset 里强行停止音乐：避免刚选择音乐后又被 reset 打断

    setStatus('准备就绪');
    syncUI();
  }

  async function start() {
    game.running = true;
    game.over = false;
    overlay.classList.add('hidden');
    btnStart.style.display = 'inline-block';
    btnRestart.style.display = 'none';

    await playBgm('common');
    setStatus('开始战斗！');
    syncUI();
}

  function loop(ts) {
    if (!game.last) game.last = ts;
    const dt = ts - game.last;
    game.last = ts;

    if (game.running) update(dt);
  draw();

  requestAnimationFrame(loop);
}

  async function handleStart() {
    const ok = await setupBgmByPickingBoth();
    if (!ok) setStatus('未加载音乐：仍可开始游戏');

    reset();
    await start();
  }

  btnStart.addEventListener('click', () => { handleStart(); });
  btnRestart.addEventListener('click', () => { handleStart(); });

  // init
  reset();
  overlay.classList.remove('hidden');
  ovTitle.textContent = 'Space War';
  ovText.textContent = '点击开始游戏，然后先点击音乐common，然后再点击boss2，就可以开始游玩了';

  requestAnimationFrame(loop);
})();
