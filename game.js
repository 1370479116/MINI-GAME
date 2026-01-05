// game.js（重写版：保证可运行、逻辑清晰）

// ===== Canvas =====
const canvas = document.getElementById('gameCanvas');
const ctx = canvas.getContext('2d');

canvas.width = 800;
canvas.height = 600;

// ===== 基础工具 =====
const clamp = (v, min, max) => Math.max(min, Math.min(max, v));
const rand = (min, max) => Math.random() * (max - min) + min;

// ===== 音频（延迟初始化，避免浏览器拦截） =====
let audioContext = null;
// BGM 系统
const bgm = {
  audioEl: null,
  current: null, // 'common' | 'boss' | null
  loopTimer: null
};

function initAudio() {
  if (audioContext) return;
  try {
    audioContext = new (window.AudioContext || window.webkitAudioContext)();
  } catch (e) {
    console.log('AudioContext 创建失败，将静音', e);
    audioContext = null;
  }
}

const sfx = {
  powerUp() {
    if (!audioContext) return;
    const o = audioContext.createOscillator();
    const g = audioContext.createGain();
    o.connect(g);
    g.connect(audioContext.destination);
    o.type = 'sine';
    o.frequency.value = 800;
    g.gain.setValueAtTime(0.25, audioContext.currentTime);
    g.gain.exponentialRampToValueAtTime(0.01, audioContext.currentTime + 0.18);
    o.start();
    o.stop(audioContext.currentTime + 0.18);
  },
  hurt() {
    if (!audioContext) return;
    const o = audioContext.createOscillator();
    const g = audioContext.createGain();
    o.connect(g);
    g.connect(audioContext.destination);
    o.type = 'sawtooth';
    o.frequency.value = 200;
    g.gain.setValueAtTime(0.25, audioContext.currentTime);
    g.gain.exponentialRampToValueAtTime(0.01, audioContext.currentTime + 0.25);
    o.start();
    o.stop(audioContext.currentTime + 0.25);
  }
};

function ensureBgmElements() {
  if (!bgm.commonEl) {
    bgm.commonEl = new Audio('music/common.mp4');
    bgm.commonEl.loop = true;
    bgm.commonEl.volume = 0.5;
  }
  if (!bgm.bossEl) {
    bgm.bossEl = new Audio('music/boss.mp3');
    bgm.bossEl.loop = false; // 我们手动做“只循环前60秒”
    bgm.bossEl.volume = 0.6;
  }
}

function stopAllBgm() {
  if (bgm.bossLoopTimer) {
    clearInterval(bgm.bossLoopTimer);
    bgm.bossLoopTimer = null;
  }
  if (bgm.commonEl) {
    try { bgm.commonEl.pause(); } catch (_) {}
  }
  if (bgm.bossEl) {
    try { bgm.bossEl.pause(); } catch (_) {}
  }
  bgm.current = null;
}

function startCommonBgm() {
  ensureBgmElements();
  if (bgm.current === 'common') return;

  // 切换
  stopAllBgm();
  bgm.current = 'common';

  try {
    bgm.commonEl.currentTime = 0;
  } catch (_) {}

  const p = bgm.commonEl.play();
  if (p && typeof p.catch === 'function') {
    p.catch(() => console.log('common BGM播放被浏览器拦截（需要用户交互）'));
  }
}

function startBossBgm() {
  ensureBgmElements();
  if (bgm.current === 'boss') return;

  // 切换
  stopAllBgm();
  bgm.current = 'boss';

  // Boss战音乐：只重复播放前60秒
  try {
    bgm.bossEl.currentTime = 0;
  } catch (_) {}

  const p = bgm.bossEl.play();
  if (p && typeof p.catch === 'function') {
    p.catch(() => console.log('boss BGM播放被浏览器拦截（需要用户交互）'));
  }

  // 每250ms检查一次，超过60秒就跳回0
  bgm.bossLoopTimer = setInterval(() => {
    if (!bgm.bossEl) return;
    if (bgm.current !== 'boss') return;
    if (bgm.bossEl.currentTime >= 60) {
      try {
        bgm.bossEl.currentTime = 0;
      } catch (_) {}
    }
  }, 250);
}

function stopBossBgm() {
  // Boss结束时不直接静音，而是切回common
  startCommonBgm();
}



// ===== 对话框日志 =====
const dialogLog = {
  maxLines: 6,
  lines: []
};

function logDialog(text) {
  const linesEl = document.getElementById('dialogLines');
  const timeTag = new Date().toLocaleTimeString().slice(0, 8);
  dialogLog.lines.push(`[${timeTag}] ${text}`);
  if (dialogLog.lines.length > dialogLog.maxLines) {
    dialogLog.lines.splice(0, dialogLog.lines.length - dialogLog.maxLines);
  }
  if (linesEl) {
    linesEl.innerHTML = dialogLog.lines.map(l => `<div class="dialog-line">${l}</div>`).join('');
  }
}

// ===== 游戏状态 =====
const keys = {};

const state = {
  running: false,
  gameOver: false,
  score: 0,
  lives: 20,
  level: 1,
  time: 0,

  // 道具累积规则
  bulletPowerUpCount: 0
};

const player = {
  x: canvas.width / 2,
  y: canvas.height - 90,
  w: 50,
  h: 50,
  speed: 15, // 我方移动速度加一倍

  bulletCount: 1, // 上限 10
  missileCount: 0, // 上限 5

  shootCd: 0,
  shootInterval: 8,

  shield: false,
  shieldFrames: 0
};

const bullets = []; // 玩家子弹
const missiles = []; // 追踪导弹
const enemyBullets = [];
const enemies = [];
const powerUps = [];
const particles = [];
const allies = []; // 僚机

// Boss 嘲讽文本
// （已移除Boss嘲讽文案）
const taunt = {
  text: '',
  until: 0
};

function showBossTaunt() {
  // no-op
}

const boss = {
  active: false,
  phase: 1,
  x: canvas.width / 2,
  y: -140,
  w: 120,
  h: 120,
  hp: 0,
  maxHp: 0,
  moveDir: 1,
  moveSpeed: 2,
  enterSpeed: 0.8,
  shootCd: 0,
  shootInterval: 30,
  teleportCd: 180,
  // Boss战掉落道具：每隔一段时间随机掉落
  lastDropTime: 0,
  dropIntervalMs: 1200,
  // 一阶段随机激光
  laserCd: 0,
  // 阶段过渡（已移除）
  transitioning: false,
  transitionUntil: 0
};

// ===== UI =====
function updateUI() {
  const scoreEl = document.getElementById('score');
  const livesEl = document.getElementById('lives');
  const levelEl = document.getElementById('level');
  if (scoreEl) scoreEl.textContent = String(state.score);
  if (livesEl) livesEl.textContent = String(state.lives);
  if (levelEl) levelEl.textContent = String(state.level);

  const powerupInfo = document.getElementById('powerupInfo');
  const powerupText = document.getElementById('powerupText');
  if (powerupInfo && powerupText) {
    if (player.bulletCount > 1 || player.missileCount > 0) {
      let text = `⚡ 子弹x${player.bulletCount}`;
      if (player.missileCount > 0) text += ` 🚀 导弹x${player.missileCount}`;
      powerupText.textContent = text;
      powerupInfo.style.display = 'block';
    } else {
      powerupInfo.style.display = 'none';
    }
  }
}

function showOverlay(title, message) {
  const overlay = document.getElementById('gameOverlay');
  const titleEl = document.getElementById('overlayTitle');
  const msgEl = document.getElementById('overlayMessage');
  const startBtn = document.getElementById('startButton');
  const restartBtn = document.getElementById('restartButton');

  overlay.classList.remove('hidden');
  titleEl.textContent = title;
  msgEl.innerHTML = String(message).replace(/\n/g, '<br>');

  if (state.gameOver) {
    if (startBtn) startBtn.style.display = 'none';
    if (restartBtn) restartBtn.style.display = 'block';
  } else {
    if (startBtn) startBtn.style.display = 'block';
    if (restartBtn) restartBtn.style.display = 'none';
  }
}

function hideOverlay() {
  const overlay = document.getElementById('gameOverlay');
  overlay.classList.add('hidden');
}

// ===== 背景（宇宙天空） =====
function drawBackground(frame) {
  // 绘制宇宙渐变（深蓝到黑色）
  const g = ctx.createLinearGradient(0, 0, 0, canvas.height);
  g.addColorStop(0, '#000033');
  g.addColorStop(0.35, '#000022');
  g.addColorStop(0.7, '#000011');
  g.addColorStop(1, '#000000');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  // 星云
  const neb1 = ctx.createRadialGradient(canvas.width * 0.3, canvas.height * 0.25, 0, canvas.width * 0.3, canvas.height * 0.25, 220);
  neb1.addColorStop(0, 'rgba(120, 60, 220, 0.30)');
  neb1.addColorStop(1, 'rgba(120, 60, 220, 0)');
  ctx.fillStyle = neb1;
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  const neb2 = ctx.createRadialGradient(canvas.width * 0.7, canvas.height * 0.6, 0, canvas.width * 0.7, canvas.height * 0.6, 180);
  neb2.addColorStop(0, 'rgba(220, 120, 60, 0.22)');
  neb2.addColorStop(1, 'rgba(220, 120, 60, 0)');
  ctx.fillStyle = neb2;
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  // 星星（伪随机稳定）
  ctx.fillStyle = '#ffffff';
  for (let i = 0; i < 200; i++) {
    const x = (i * 37) % canvas.width;
    const y = (i * 53 + frame * 0.15) % canvas.height;
    const size = (i % 3) * 0.6 + 0.6;
    const brightness = ((i * 13) % 100) / 100 * 0.5 + 0.5;
    ctx.globalAlpha = brightness;
    ctx.fillRect(x, y, size, size);
  }
  ctx.globalAlpha = 1;

  // 大星星闪烁
  for (let i = 0; i < 20; i++) {
    const x = (i * 127) % canvas.width;
    const y = (i * 89 + frame * 0.1) % canvas.height;
    const tw = Math.sin(frame * 0.1 + i) * 0.3 + 0.7;
    ctx.globalAlpha = tw;
    ctx.fillStyle = '#ffffaa';
    ctx.beginPath();
    ctx.arc(x, y, 2, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.globalAlpha = 1;

  // 远处行星
  ctx.fillStyle = 'rgba(60, 60, 120, 0.25)';
  ctx.beginPath();
  ctx.arc(canvas.width * 0.18, canvas.height * 0.32, 32, 0, Math.PI * 2);
  ctx.fill();

  ctx.fillStyle = 'rgba(120, 60, 60, 0.18)';
  ctx.beginPath();
  ctx.arc(canvas.width * 0.82, canvas.height * 0.72, 26, 0, Math.PI * 2);
  ctx.fill();
}

// ===== 画面绘制 =====
function drawPlayer() {
  ctx.save();
  const cx = player.x + player.w / 2;
  const cy = player.y + player.h / 2;
  ctx.translate(cx, cy);

  // 写实风格玩家飞机：机身 + 机头 + 机翼 + 座舱 + 引擎尾焰

  // 尾焰
  const flame = ctx.createRadialGradient(0, player.h / 2 + 8, 0, 0, player.h / 2 + 8, 22);
  flame.addColorStop(0, 'rgba(255,255,255,0.9)');
  flame.addColorStop(0.25, 'rgba(0,255,255,0.8)');
  flame.addColorStop(0.55, 'rgba(0,136,255,0.55)');
  flame.addColorStop(1, 'rgba(0,136,255,0)');
  ctx.fillStyle = flame;
  ctx.beginPath();
  ctx.ellipse(0, player.h / 2 + 10, 18, 10, 0, 0, Math.PI * 2);
  ctx.fill();

  // 阴影
  ctx.shadowBlur = 14;
  ctx.shadowColor = 'rgba(0,0,0,0.45)';
  ctx.shadowOffsetX = 2;
  ctx.shadowOffsetY = 3;

  // 机身渐变
  const body = ctx.createLinearGradient(0, -player.h / 2, 0, player.h / 2);
  body.addColorStop(0, '#7fb8ff');
  body.addColorStop(0.45, '#2b79d6');
  body.addColorStop(1, '#0a3d7a');
  ctx.fillStyle = body;

  // 机身（椭圆）
  ctx.beginPath();
  ctx.ellipse(0, 2, player.w * 0.34, player.h * 0.42, 0, 0, Math.PI * 2);
  ctx.fill();

  // 机头（更尖锐）
  ctx.beginPath();
  ctx.moveTo(0, -player.h * 0.48);
  ctx.lineTo(-player.w * 0.14, -player.h * 0.20);
  ctx.lineTo(0, -player.h * 0.12);
  ctx.lineTo(player.w * 0.14, -player.h * 0.20);
  ctx.closePath();
  ctx.fill();

  // 机翼
  const wing = ctx.createLinearGradient(-player.w / 2, 0, player.w / 2, 0);
  wing.addColorStop(0, '#06305f');
  wing.addColorStop(1, '#2b79d6');
  ctx.fillStyle = wing;

  // 左翼
  ctx.beginPath();
  ctx.moveTo(-player.w * 0.42, -player.h * 0.05);
  ctx.lineTo(-player.w * 0.62, player.h * 0.18);
  ctx.lineTo(-player.w * 0.18, player.h * 0.20);
  ctx.lineTo(-player.w * 0.20, player.h * 0.02);
  ctx.closePath();
  ctx.fill();

  // 右翼
  ctx.beginPath();
  ctx.moveTo(player.w * 0.42, -player.h * 0.05);
  ctx.lineTo(player.w * 0.62, player.h * 0.18);
  ctx.lineTo(player.w * 0.18, player.h * 0.20);
  ctx.lineTo(player.w * 0.20, player.h * 0.02);
  ctx.closePath();
  ctx.fill();

  // 取消阴影，绘制细节
  ctx.shadowBlur = 0;
  ctx.shadowOffsetX = 0;
  ctx.shadowOffsetY = 0;

  // 座舱玻璃
  const cockpit = ctx.createRadialGradient(0, -player.h * 0.18, 0, 0, -player.h * 0.18, 14);
  cockpit.addColorStop(0, 'rgba(180,230,255,0.95)');
  cockpit.addColorStop(1, 'rgba(40,110,180,0.9)');
  ctx.fillStyle = cockpit;
  ctx.beginPath();
  ctx.ellipse(0, -player.h * 0.18, player.w * 0.14, player.h * 0.12, 0, 0, Math.PI * 2);
  ctx.fill();

  // 高光
  ctx.fillStyle = 'rgba(255,255,255,0.25)';
  ctx.beginPath();
  ctx.ellipse(-player.w * 0.04, -player.h * 0.22, player.w * 0.07, player.h * 0.03, -0.3, 0, Math.PI * 2);
  ctx.fill();

  // 护盾
  if (player.shield) {
    const a = 0.35 + Math.sin(game.frame * 0.2) * 0.2;
    ctx.globalAlpha = a;
    ctx.strokeStyle = 'rgba(0,255,0,0.9)';
    ctx.lineWidth = 4;
    ctx.beginPath();
    ctx.arc(0, 0, player.w / 2 + 14, 0, Math.PI * 2);
    ctx.stroke();
    ctx.globalAlpha = 1;
  }

  ctx.restore();
}

function drawCircle(x, y, r, color, glow = 0) {
  ctx.save();
  ctx.fillStyle = color;
  if (glow > 0) {
    ctx.shadowBlur = glow;
    ctx.shadowColor = color;
  }
  ctx.beginPath();
  ctx.arc(x, y, r, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

function drawEnemy(e) {
  ctx.save();
  const cx = e.x + e.w / 2;
  const cy = e.y + e.h / 2;
  ctx.translate(cx, cy);

  // 写实风格敌机：更尖机头 + 机翼 + 引擎
  ctx.shadowBlur = 12;
  ctx.shadowColor = 'rgba(0,0,0,0.45)';
  ctx.shadowOffsetX = 2;
  ctx.shadowOffsetY = 3;

  // 敌机颜色（偏金属）
  const body = ctx.createLinearGradient(0, -e.h / 2, 0, e.h / 2);
  body.addColorStop(0, '#ffb3b3');
  body.addColorStop(0.45, e.color);
  body.addColorStop(1, '#6b0000');
  ctx.fillStyle = body;

  // 机身
  ctx.beginPath();
  ctx.ellipse(0, 2, e.w * 0.32, e.h * 0.40, 0, 0, Math.PI * 2);
  ctx.fill();

  // 机头
  ctx.beginPath();
  ctx.moveTo(0, e.h * 0.48);
  ctx.lineTo(-e.w * 0.16, e.h * 0.10);
  ctx.lineTo(0, e.h * 0.02);
  ctx.lineTo(e.w * 0.16, e.h * 0.10);
  ctx.closePath();
  ctx.fill();

  // 机翼
  const wing = ctx.createLinearGradient(-e.w / 2, 0, e.w / 2, 0);
  wing.addColorStop(0, '#3b0000');
  wing.addColorStop(1, '#b40000');
  ctx.fillStyle = wing;

  ctx.beginPath();
  ctx.moveTo(-e.w * 0.42, -e.h * 0.06);
  ctx.lineTo(-e.w * 0.62, -e.h * 0.24);
  ctx.lineTo(-e.w * 0.18, -e.h * 0.20);
  ctx.lineTo(-e.w * 0.20, -e.h * 0.02);
  ctx.closePath();
  ctx.fill();

  ctx.beginPath();
  ctx.moveTo(e.w * 0.42, -e.h * 0.06);
  ctx.lineTo(e.w * 0.62, -e.h * 0.24);
  ctx.lineTo(e.w * 0.18, -e.h * 0.20);
  ctx.lineTo(e.w * 0.20, -e.h * 0.02);
  ctx.closePath();
  ctx.fill();

  // 引擎光点
  ctx.shadowBlur = 0;
  ctx.shadowOffsetX = 0;
  ctx.shadowOffsetY = 0;
  ctx.fillStyle = 'rgba(255,160,80,0.9)';
  ctx.beginPath();
  ctx.arc(-e.w * 0.12, -e.h * 0.10, 3, 0, Math.PI * 2);
  ctx.fill();
  ctx.beginPath();
  ctx.arc(e.w * 0.12, -e.h * 0.10, 3, 0, Math.PI * 2);
  ctx.fill();

  // 血条（非满血显示）
  if (e.hp < e.maxHp) {
    const bw = e.w + 10;
    const bh = 5;
    ctx.fillStyle = 'rgba(0,0,0,0.5)';
    ctx.fillRect(-bw / 2, -e.h / 2 - 12, bw, bh);
    const p = e.hp / e.maxHp;
    ctx.fillStyle = p > 0.5 ? '#00ff00' : p > 0.2 ? '#ffff00' : '#ff0000';
    ctx.fillRect(-bw / 2, -e.h / 2 - 12, bw * p, bh);
    ctx.strokeStyle = '#fff';
    ctx.lineWidth = 1;
    ctx.strokeRect(-bw / 2, -e.h / 2 - 12, bw, bh);
  }

  ctx.restore();
}

function drawBoss() {
  if (!boss.active) return;
  ctx.save();
  ctx.translate(boss.x, boss.y + boss.h / 2);

  if (boss.phase === 2) {
    ctx.shadowBlur = 30;
    ctx.shadowColor = '#00ffff';
  }

  const g = ctx.createLinearGradient(0, -boss.h / 2, 0, boss.h / 2);
  if (boss.phase === 2) {
    // 二阶段改颜色：偏青蓝/电光感
    g.addColorStop(0, '#66ffff');
    g.addColorStop(0.3, '#00ffff');
    g.addColorStop(0.7, '#00cccc');
    g.addColorStop(1, '#006666');
  } else {
    g.addColorStop(0, '#ff00ff');
    g.addColorStop(0.35, '#cc00cc');
    g.addColorStop(0.75, '#990099');
    g.addColorStop(1, '#660066');
  }
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.ellipse(0, 0, boss.w / 2 - 3, boss.h / 2 - 3, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.shadowBlur = 0;

  // 血条
  const bw = boss.w + 20;
  const bh = 8;
  ctx.fillStyle = 'rgba(0,0,0,0.55)';
  ctx.fillRect(-bw / 2, -boss.h / 2 - 22, bw, bh);
  const p = boss.hp / boss.maxHp;
  const hg = ctx.createLinearGradient(-bw / 2, 0, bw / 2, 0);
  hg.addColorStop(0, p > 0.5 ? '#00ff00' : '#ffff00');
  hg.addColorStop(1, p > 0.5 ? '#00aa00' : '#ff0000');
  ctx.fillStyle = hg;
  ctx.fillRect(-bw / 2, -boss.h / 2 - 22, bw * p, bh);
  ctx.strokeStyle = '#fff';
  ctx.lineWidth = 2;
  ctx.strokeRect(-bw / 2, -boss.h / 2 - 22, bw, bh);

  ctx.restore();
}

function spawnExplosion(x, y, color, count = 15) {
  for (let i = 0; i < count; i++) {
    particles.push({
      x,
      y,
      vx: rand(-5, 5),
      vy: rand(-5, 5),
      r: rand(2, 6),
      life: 30,
      maxLife: 30,
      color
    });
  }
}

function drawParticles() {
  for (const p of particles) {
    const a = p.life / p.maxLife;
    ctx.globalAlpha = a;
    drawCircle(p.x, p.y, p.r, p.color, 0);
    ctx.globalAlpha = 1;
  }
}

// ===== 敌机/道具配置 =====
const ENEMY_TYPES = {
  // 普通阶段掉落概率减半
  small: { w: 30, h: 30, speed: 2.5, hp: 1, score: 10, color: '#ff4444', drop: 0.15 },
  medium: { w: 45, h: 45, speed: 1.8, hp: 2, score: 25, color: '#ff8844', drop: 0.25 },
  large: { w: 60, h: 60, speed: 1.2, hp: 4, score: 50, color: '#ff0000', drop: 0.35 }
};

const POWERUP_TYPES = {
  multiBullet: { color: '#00ffff', icon: '⚡' },
  shield: { color: '#00ff00', icon: '🛡️' },
  ally: { color: '#ffaa00', icon: '✈️' }
};

function spawnEnemy() {
  if (enemies.length >= 10) return;

  const r = Math.random();
  let type = 'small';
  if (r < 0.5) type = 'small';
  else if (r < 0.8) type = 'medium';
  else type = 'large';

  const cfg = ENEMY_TYPES[type];
  const timeMin = state.time / 60000;
  const mult = 1 + Math.floor(timeMin * 2);

  enemies.push({
    type,
    x: rand(0, canvas.width - cfg.w),
    y: -cfg.h,
    w: cfg.w,
    h: cfg.h,
    speed: cfg.speed,
    hp: cfg.hp * mult,
    maxHp: cfg.hp * mult,
    score: cfg.score,
    color: cfg.color,
    shootCd: rand(90, 160),
    // 左右移动
    vx: (Math.random() < 0.5 ? -1 : 1) * rand(0.6, 1.2)
  });
}

function spawnPowerUp(x, y) {
  // 子弹满了（10）后不再生成子弹道具
  const allowBullet = player.bulletCount < 10;

  const r = Math.random();
  let type = 'multiBullet';

  if (!allowBullet) {
    // 子弹满了：只在护盾/僚机里随机
    type = (Math.random() < 0.6) ? 'shield' : 'ally';
  } else {
    if (r < 0.4) type = 'multiBullet';
    else if (r < 0.7) type = 'shield';
    else type = 'ally';
  }

  const cfg = POWERUP_TYPES[type];
  powerUps.push({ x, y, type, color: cfg.color, icon: cfg.icon, r: 15, speed: 2, rot: 0 });
}

function activatePowerUp(type) {
  if (type === 'multiBullet') {
    // 子弹道具：每吃一个就 +1 子弹（最多 10）
    if (player.bulletCount < 10) {
      player.bulletCount++;
      logDialog('子弹 +1');
    } else {
      logDialog('该道具已到上限');
      // 超过 10 后：每吃 3 个子弹道具 +1 追踪导弹（最多 5）
      state.bulletPowerUpCount++;
      if (player.missileCount < 5 && state.bulletPowerUpCount % 3 === 0) {
        player.missileCount++;
        logDialog('追踪导弹 +1');
      }
    }
  } else if (type === 'shield') {
    state.lives += 20;
    logDialog('生命值 +20');
  } else if (type === 'ally') {
    // 飞机道具：增加一架僚机（状态与本体一致），持续 5 秒
    if (allies.length < 3) {
      allies.push({
        x: player.x + rand(-120, 120),
        y: player.y + rand(-60, 60),
        w: player.w,
        h: player.h,
        bulletCount: player.bulletCount,
        missileCount: player.missileCount,
        shootCd: 0,
        shootInterval: player.shootInterval,
        startTime: state.time,
        durationMs: 5000
      });
      logDialog('增加僚机');
    } else {
      logDialog('该道具已到上限');
    }
  }
  updateUI();
  sfx.powerUp();
}

// ===== 碰撞 =====
function rectHit(a, b) {
  return a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;
}

function pointInRect(px, py, r) {
  return px > r.x && px < r.x + r.w && py > r.y && py < r.y + r.h;
}

function circleRectHit(c, r) {
  const cx = clamp(c.x, r.x, r.x + r.w);
  const cy = clamp(c.y, r.y, r.y + r.h);
  const dx = c.x - cx;
  const dy = c.y - cy;
  return dx * dx + dy * dy < c.r * c.r;
}

// ===== 玩家射击 =====
function playerShoot() {
  const cx = player.x + player.w / 2;
  const cy = player.y;

  // 屏幕子弹上限（避免你加了子弹但看不出来）
  const MAX_PLAYER_BULLETS_ON_SCREEN = 50;

  if (bullets.length < MAX_PLAYER_BULLETS_ON_SCREEN) {
    if (player.bulletCount === 1) {
      bullets.push({ x: cx, y: cy, vx: 0, vy: -8, r: 5, color: '#00ffff' });
    } else {
      // 扇形发射：左右对称
      const spread = Math.min(player.bulletCount * 16, 260);
      const step = spread / (player.bulletCount - 1);
      for (let i = 0; i < player.bulletCount; i++) {
        if (bullets.length >= MAX_PLAYER_BULLETS_ON_SCREEN) break;
        const ox = (i - (player.bulletCount - 1) / 2) * step;
        // vx 与偏移相关，确保左右对称，不会只往左
        const vx = ox * 0.02;
        bullets.push({ x: cx + ox, y: cy, vx, vy: -8, r: 5, color: '#00ffff' });
      }
    }
  }

  // 追踪导弹最多 5
  for (let i = 0; i < player.missileCount && missiles.length < 5; i++) {
    const ox = (i - (player.missileCount - 1) / 2) * 26;
    missiles.push({ x: cx + ox, y: cy, vx: 0, vy: -6, r: 8, speed: 6, color: '#ff00ff', target: null });
  }
}

// ===== Boss =====
function spawnBoss() {
  if (boss.active) return;
  boss.active = true;
  boss.phase = 1;
  boss.w = 120;
  boss.h = 120;
  boss.x = canvas.width / 2;
  boss.y = -140;

  const timeMin = state.time / 60000;
  const mult = 1 + Math.floor(timeMin * 2);
  boss.maxHp = 50 * mult * state.level * 100 * 0.5; // 两阶段血量都减半（A策略的一阶段）
  boss.hp = boss.maxHp;

  boss.moveDir = 1;
  boss.shootCd = 30;
  boss.teleportCd = 180;
  boss.lastDropTime = state.time;
  boss.laserCd = 120;
  boss.transitioning = false;
  boss.transitionUntil = 0; // 已不再使用

  startBossBgm();
}

function bossShoot() {
  const cx = boss.x;
  const cy = boss.y + boss.h / 2;

  // 一阶段：直线 + 扇形
  for (let i = -1; i <= 1; i++) {
    enemyBullets.push({ x: cx + i * 20, y: cy, vx: 0, vy: 1, r: 6, color: '#ffaa00', isMissile: false });
  }

  const spread = boss.phase === 2 ? 13 : 7;
  for (let i = 0; i < spread; i++) {
    const a = (i - (spread - 1) / 2) * (boss.phase === 2 ? 0.06 : 0.08);
    enemyBullets.push({
      x: cx,
      y: cy,
      vx: Math.sin(a) * (boss.phase === 2 ? 1.1 : 0.8),
      vy: Math.cos(a) * (boss.phase === 2 ? 1.1 : 0.8),
      r: boss.phase === 2 ? 5 : 5,
      color: boss.phase === 2 ? '#ff33aa' : '#ff8844',
      isMissile: false
    });
  }

  if (boss.phase === 2) {
    // 二阶段额外弹道：螺旋圈 + 追踪弹
    const ring = 10;
    const base = (game.frame % 360) * (Math.PI / 180);
    for (let i = 0; i < ring; i++) {
      const ang = base + (i * Math.PI * 2) / ring;
      enemyBullets.push({
        x: cx,
        y: cy,
        vx: Math.cos(ang) * 0.9,
        vy: Math.sin(ang) * 0.9 + 0.6,
        r: 4,
        color: '#cc00ff',
        isMissile: false
      });
    }

    // 追踪弹（慢一点）
    const dx = (player.x + player.w / 2) - cx;
    const dy = (player.y + player.h / 2) - cy;
    const dist = Math.sqrt(dx * dx + dy * dy) || 1;
    enemyBullets.push({
      x: cx,
      y: cy,
      vx: (dx / dist) * 0.8,
      vy: (dy / dist) * 0.8,
      r: 6,
      color: '#ff00ff',
      tracking: true,
      isMissile: false
    });
  }
}

// ===== 主更新 =====
const game = {
  frame: 0,
  lastTime: 0,
  waveIndex: 0
};

function endGame() {
  state.running = false;
  state.gameOver = true;
  stopBossBgm();
  showOverlay('游戏结束', `最终得分: ${state.score}`);
}

function resetGame() {
  state.running = false;
  state.gameOver = false;
  state.score = 0;
  state.lives = 20;
  state.level = 1;
  state.time = 0;
  state.bulletPowerUpCount = 0;

  player.x = canvas.width / 2;
  player.y = canvas.height - 90;
  player.bulletCount = 1;
  player.missileCount = 0;
  player.shootCd = 0;
  player.shield = false;
  player.shieldFrames = 0;

  bullets.length = 0;
  missiles.length = 0;
  enemyBullets.length = 0;
  enemies.length = 0;
  powerUps.length = 0;
  particles.length = 0;
  allies.length = 0;

  boss.active = false;
  stopBossBgm();

  game.waveIndex = 0;
  game.frame = 0;

  updateUI();
  showOverlay('游戏开始', '使用方向键移动，空格键发射子弹\n击败敌机有概率获得道具！');
}

function startGame() {
  state.running = true;
  state.gameOver = false;
  hideOverlay();
}

function update(dt) {
  if (!state.running || state.gameOver) return;

  state.time += dt;
  game.frame++;

  // 移动
  if (keys['ArrowLeft']) player.x -= player.speed;
  if (keys['ArrowRight']) player.x += player.speed;
  if (keys['ArrowUp']) player.y -= player.speed;
  if (keys['ArrowDown']) player.y += player.speed;
  player.x = clamp(player.x, 0, canvas.width - player.w);
  player.y = clamp(player.y, 0, canvas.height - player.h);

  // 护盾倒计时（如以后需要）
  if (player.shield) {
    player.shieldFrames--;
    if (player.shieldFrames <= 0) player.shield = false;
  }

  // 射击（本体 + 僚机）
  player.shootCd--;
  if ((keys[' '] || keys['Space'] || keys['Spacebar']) && player.shootCd <= 0) {
    playerShoot();
    player.shootCd = player.shootInterval;
  }

  // 更新僚机（跟随 + 射击 + 超时移除）
  for (let i = allies.length - 1; i >= 0; i--) {
    const a = allies[i];
    if (state.time - a.startTime >= a.durationMs) {
      allies.splice(i, 1);
      continue;
    }

    // 状态与本体一致（实时同步）
    a.bulletCount = player.bulletCount;
    a.missileCount = player.missileCount;
    a.shootInterval = player.shootInterval;

    // 轻微滞后跟随
    const tx = player.x + rand(-120, 120);
    const ty = player.y + rand(-80, 60);
    a.x += (tx - a.x) * 0.04;
    a.y += (ty - a.y) * 0.04;
    a.x = clamp(a.x, 0, canvas.width - a.w);
    a.y = clamp(a.y, 0, canvas.height - a.h);

    // 僚机射击
    a.shootCd--;
    if (a.shootCd <= 0) {
      const cx = a.x + a.w / 2;
      const cy = a.y;

      // 普通子弹（复用同一 bullets 数组）
      const MAX_PLAYER_BULLETS_ON_SCREEN = 50;
      if (bullets.length < MAX_PLAYER_BULLETS_ON_SCREEN) {
        if (a.bulletCount === 1) {
          bullets.push({ x: cx, y: cy, vx: 0, vy: -8, r: 5, color: '#00ffff' });
        } else {
          // 与本体一致：扇形左右对称
          const spread = Math.min(a.bulletCount * 16, 260);
          const step = spread / (a.bulletCount - 1);
          for (let k = 0; k < a.bulletCount; k++) {
            if (bullets.length >= MAX_PLAYER_BULLETS_ON_SCREEN) break;
            const ox = (k - (a.bulletCount - 1) / 2) * step;
            const vx = ox * 0.02;
            bullets.push({ x: cx + ox, y: cy, vx, vy: -8, r: 5, color: '#00ffff' });
          }
        }
      }

      // 追踪导弹（复用同一 missiles 数组）
      for (let k = 0; k < a.missileCount && missiles.length < 5; k++) {
        const ox = (k - (a.missileCount - 1) / 2) * 26;
        missiles.push({ x: cx + ox, y: cy, vx: 0, vy: -6, r: 8, speed: 6, color: '#ff33ff', target: null });
      }

      a.shootCd = a.shootInterval;
    }
  }

  // 子弹更新
  for (let i = bullets.length - 1; i >= 0; i--) {
    const b = bullets[i];
    b.x += b.vx;
    b.y += b.vy;
    if (b.y < -20 || b.x < -50 || b.x > canvas.width + 50) {
      bullets.splice(i, 1);
      continue;
    }

    // 打中普通敌机
    let hit = false;
    for (let j = enemies.length - 1; j >= 0; j--) {
      const e = enemies[j];
      if (pointInRect(b.x, b.y, e)) {
        e.hp -= 1;
        bullets.splice(i, 1);
        hit = true;
        if (e.hp <= 0) {
          spawnExplosion(e.x + e.w / 2, e.y + e.h / 2, '#ff6600', 20);
          state.score += e.score;
          updateUI();
          if (Math.random() < ENEMY_TYPES[e.type].drop) {
            spawnPowerUp(e.x + e.w / 2, e.y + e.h / 2);
          }
          enemies.splice(j, 1);
        }
        break;
      }
    }
    if (hit) continue;

    // 打中Boss（不掉落道具）
    if (boss.active) {
      const bossRect = { x: boss.x - boss.w / 2, y: boss.y, w: boss.w, h: boss.h };
      if (pointInRect(b.x, b.y, bossRect)) {
        boss.hp -= 1;
        bullets.splice(i, 1);

        if (boss.phase === 1 && boss.hp <= 0) {
          // 直接进入二阶段（无过渡动画）
          boss.phase = 2;
          boss.maxHp = boss.maxHp * 3; // 二阶段倍率
          boss.maxHp = boss.maxHp * 0.5; // A：两阶段都减半（在倍率后再减半）
          boss.hp = boss.maxHp;
          boss.w = 180;
          boss.h = 180;
          boss.shootCd = 30;
          boss.teleportCd = 120;
          spawnExplosion(boss.x, boss.y + boss.h / 2, '#ff00ff', 60);
        } else if (boss.phase === 2 && boss.hp <= 0) {
          spawnExplosion(boss.x, boss.y + boss.h / 2, '#ff6600', 80);
          stopBossBgm();
          boss.active = false;
          state.level += 1;
          updateUI();
          showOverlay(`第 ${state.level} 关`, '准备迎接新的挑战！');
          setTimeout(() => {
            if (state.running && !state.gameOver) hideOverlay();
          }, 1200);
        }
      }
    }
  }

  // 追踪导弹更新
  for (let i = missiles.length - 1; i >= 0; i--) {
    const m = missiles[i];

    // 寻找目标（优先普通敌机，否则 Boss）
    if (!m.target || (m.target && m.target.dead)) {
      let best = null;
      let bestD = Infinity;
      for (const e of enemies) {
        const dx = (e.x + e.w / 2) - m.x;
        const dy = (e.y + e.h / 2) - m.y;
        const d = dx * dx + dy * dy;
        if (d < bestD) {
          bestD = d;
          best = e;
        }
      }
      m.target = best || (boss.active ? boss : null);
    }

    if (m.target) {
      const tx = m.target === boss ? boss.x : (m.target.x + m.target.w / 2);
      const ty = m.target === boss ? (boss.y + boss.h / 2) : (m.target.y + m.target.h / 2);
      const dx = tx - m.x;
      const dy = ty - m.y;
      const dist = Math.sqrt(dx * dx + dy * dy) || 1;
      m.vx = (dx / dist) * m.speed;
      m.vy = (dy / dist) * m.speed;
    }

    m.x += m.vx;
    m.y += m.vy;

    if (m.y < -30 || m.x < -60 || m.x > canvas.width + 60 || m.y > canvas.height + 60) {
      missiles.splice(i, 1);
      continue;
    }

    // 命中
    if (m.target && m.target !== boss) {
      const e = m.target;
      const hit = circleRectHit({ x: m.x, y: m.y, r: m.r }, e);
      if (hit) {
        e.hp -= 5;
        spawnExplosion(m.x, m.y, '#ff00ff', 18);
        missiles.splice(i, 1);
        if (e.hp <= 0) {
          state.score += e.score;
          updateUI();
          if (Math.random() < ENEMY_TYPES[e.type].drop) {
            spawnPowerUp(e.x + e.w / 2, e.y + e.h / 2);
          }
          enemies.splice(enemies.indexOf(e), 1);
        }
      }
    } else if (m.target === boss && boss.active) {
      const bossRect = { x: boss.x - boss.w / 2, y: boss.y, w: boss.w, h: boss.h };
      const hit = circleRectHit({ x: m.x, y: m.y, r: m.r }, bossRect);
      if (hit) {
        boss.hp -= 5;
        spawnExplosion(m.x, m.y, '#ff00ff', 18);
        missiles.splice(i, 1);

        if (boss.phase === 1 && boss.hp <= 0) {
          // 进入2秒过渡动画，再切二阶段
          boss.transitioning = true;
          boss.transitionUntil = state.time + 2000;
          boss.shootCd = 999999;
          boss.laserCd = 999999;
          spawnExplosion(boss.x, boss.y + boss.h / 2, '#ff00ff', 90);
        } else if (boss.phase === 2 && boss.hp <= 0) {
          spawnExplosion(boss.x, boss.y + boss.h / 2, '#ff6600', 80);
          stopBossBgm();
          boss.active = false;
          state.level += 1;
          updateUI();
          showOverlay(`第 ${state.level} 关`, '准备迎接新的挑战！');
          setTimeout(() => {
            if (state.running && !state.gameOver) hideOverlay();
          }, 1200);
        }
      }
    }
  }

  // 敌机生成：每 5 秒一波
  if (!boss.active) {
    const wave = Math.floor((state.time / 1000) / 5) + 1;
    if (wave > game.waveIndex) {
      game.waveIndex = wave;
      const count = Math.min(10, wave);
      for (let i = 0; i < count; i++) spawnEnemy();
    }
  }

  // Boss出现时间再提前一分钟：1 分钟刷 Boss（场上没怪时）
  if (!boss.active && enemies.length === 0 && state.time >= 60000) {
    spawnBoss();
  }

  // 敌机更新 + 射击
  for (let i = enemies.length - 1; i >= 0; i--) {
    const e = enemies[i];

    // 左右移动 + 简单躲避子弹
    if (typeof e.vx !== 'number') e.vx = (Math.random() < 0.5 ? -1 : 1) * rand(0.6, 1.2);

    // 躲避：如果正上方有玩家子弹接近，则横向加速闪避
    let dodge = 0;
    for (let bi = bullets.length - 1; bi >= 0; bi--) {
      const b = bullets[bi];
      // 只关注在敌机下方往上飞的子弹
      if (b.y < e.y + e.h + 180 && b.y > e.y - 40) {
        const dx = (e.x + e.w / 2) - b.x;
        const dy = (e.y + e.h / 2) - b.y;
        if (Math.abs(dx) < e.w * 0.9 && dy > 0 && dy < 160) {
          dodge += dx > 0 ? 1 : -1;
        }
      }
      if (bi < bullets.length - 20) break; // 限制计算量
    }

    e.x += e.vx + dodge * 1.6;
    // 边界反弹
    if (e.x <= 0) {
      e.x = 0;
      e.vx = Math.abs(e.vx);
    } else if (e.x >= canvas.width - e.w) {
      e.x = canvas.width - e.w;
      e.vx = -Math.abs(e.vx);
    }

    e.y += e.speed;
    e.shootCd--;
    if (e.shootCd <= 0) {
      const cx = e.x + e.w / 2;
      const cy = e.y + e.h;

      if (e.type === 'small') {
        // 直线子弹（速度需 > 敌机速度，同时整体仍偏慢）
        enemyBullets.push({ x: cx, y: cy, vx: 0, vy: 2.0, r: 4, color: '#ffaa00', isMissile: false });
      } else if (e.type === 'medium') {
        // 分散弹（三发扇形）
        for (let k = -1; k <= 1; k++) {
          const a = k * 0.22;
          enemyBullets.push({
            x: cx,
            y: cy,
            vx: Math.sin(a) * 1.1,
            vy: (Math.cos(a) * 1.1) + 1.1,
            r: 4,
            color: '#ff8844',
            isMissile: false
          });
        }
      } else {
        // large：射线（更快更粗的直线弹，表现为“激光”）
        enemyBullets.push({ x: cx, y: cy, vx: 0, vy: 2.6, r: 7, color: '#ff00ff', isLaser: true, isMissile: false });
      }

      // 子弹间隔更大一些，方便从弹幕缝隙中穿过
      e.shootCd = rand(110, 180);
    }

    if (e.y > canvas.height + 50) {
      enemies.splice(i, 1);
      continue;
    }

    // 撞玩家
    if (rectHit({ x: player.x, y: player.y, w: player.w, h: player.h }, e)) {
      spawnExplosion(player.x + player.w / 2, player.y + player.h / 2, '#00ff00', 18);
      state.lives -= 1;
      updateUI();
      enemies.splice(i, 1);
      if (state.lives <= 0) return endGame();
    }
  }

  // Boss 更新
  if (boss.active) {
    boss.y += boss.enterSpeed;
    if (boss.y > 50) boss.y = 50;

    boss.x += boss.moveSpeed * boss.moveDir;
    if (boss.x <= boss.w / 2) {
      boss.x = boss.w / 2;
      boss.moveDir = 1;
    } else if (boss.x >= canvas.width - boss.w / 2) {
      boss.x = canvas.width - boss.w / 2;
      boss.moveDir = -1;
    }

    boss.shootCd--;
    if (boss.shootCd <= 0) {
      bossShoot();
      boss.shootCd = boss.shootInterval;
    }

    // Boss战随机掉落道具
    if (state.time - boss.lastDropTime >= boss.dropIntervalMs) {
      spawnPowerUp(rand(20, canvas.width - 20), -20);
      boss.lastDropTime = state.time;
    }

    // Boss一阶段随机激光（命中扣2血）
    if (boss.phase === 1) {
      boss.laserCd--;
      if (boss.laserCd <= 0) {
        // 以一定概率发射
        if (Math.random() < 0.5) {
          enemyBullets.push({
            x: boss.x + rand(-boss.w * 0.35, boss.w * 0.35),
            y: boss.y + boss.h * 0.55,
            vx: 0,
            vy: 3.0, // 敌方速度已整体减半，此处仍保持比Boss移动快
            r: 10,
            color: '#ff00ff',
            isLaser: true,
            isBossLaser: true,
            isMissile: false
          });
        }
        boss.laserCd = 90;
      }
    }

    // 二阶段瞬移（更频繁）
    if (boss.phase === 2) {
      boss.teleportCd--;
      if (boss.teleportCd <= 0) {
        boss.x = rand(boss.w / 2, canvas.width - boss.w / 2);
        boss.y = rand(20, canvas.height * 0.25);
        boss.teleportCd = 120;
        spawnExplosion(boss.x, boss.y + boss.h / 2, '#00ffff', 30);
        logDialog('Boss使用了瞬移');
      }
    }
  }

  // 敌弹更新（含追踪弹）
  for (let i = enemyBullets.length - 1; i >= 0; i--) {
    const b = enemyBullets[i];

    // 追踪弹：轻微修正方向
    if (b.tracking) {
      const dx = (player.x + player.w / 2) - b.x;
      const dy = (player.y + player.h / 2) - b.y;
      const dist = Math.sqrt(dx * dx + dy * dy) || 1;
      const sp = Math.sqrt((b.vx || 0) * (b.vx || 0) + (b.vy || 0) * (b.vy || 0)) || 1.8;
      // 小幅转向
      b.vx = (b.vx * 0.9) + (dx / dist) * sp * 0.1;
      b.vy = (b.vy * 0.9) + (dy / dist) * sp * 0.1;
    }

    b.x += b.vx;
    b.y += b.vy;

    if (b.y > canvas.height + 60 || b.x < -60 || b.x > canvas.width + 60) {
      enemyBullets.splice(i, 1);
      continue;
    }

    const pr = { x: player.x, y: player.y, w: player.w, h: player.h };
    if (pointInRect(b.x, b.y, pr)) {
      enemyBullets.splice(i, 1);
      sfx.hurt();
      // Boss一阶段激光命中扣2滴血
      const damage = b.isBossLaser ? 2 : (b.isMissile ? 2 : 1);
      state.lives -= damage;
      updateUI();
      if (state.lives <= 0) return endGame();
    }
  }



  // 道具更新
  for (let i = powerUps.length - 1; i >= 0; i--) {
    const p = powerUps[i];
    p.y += p.speed;
    p.rot += 0.1;
    if (p.y > canvas.height + 40) {
      powerUps.splice(i, 1);
      continue;
    }

    if (circleRectHit({ x: p.x, y: p.y, r: p.r }, { x: player.x, y: player.y, w: player.w, h: player.h })) {
      activatePowerUp(p.type);
      powerUps.splice(i, 1);
    }
  }

  // 粒子更新
  for (let i = particles.length - 1; i >= 0; i--) {
    const p = particles[i];
    p.x += p.vx;
    p.y += p.vy;
    p.life--;
    if (p.life <= 0) particles.splice(i, 1);
  }
}

function draw() {
  drawBackground(game.frame);

  // boss
  if (boss.active) drawBoss();

  // 玩家（运行中才画）
  if (state.running && !state.gameOver) drawPlayer();

  // 僚机
  for (const a of allies) {
    // 临时复用玩家绘制：把 player 临时映射到 a 的位置（保持写实风格一致）
    ctx.save();
    const oldX = player.x, oldY = player.y;
    player.x = a.x;
    player.y = a.y;
    ctx.globalAlpha = 0.75;
    drawPlayer();
    ctx.globalAlpha = 1;
    player.x = oldX;
    player.y = oldY;
    ctx.restore();
  }

  // 子弹
  for (const b of bullets) drawCircle(b.x, b.y, b.r, b.color, 10);
  for (const m of missiles) drawCircle(m.x, m.y, m.r, m.color, 15);

  // 敌机
  for (const e of enemies) drawEnemy(e);

  // 敌弹
  for (const eb of enemyBullets) drawCircle(eb.x, eb.y, eb.r, eb.color, 8);


  // 道具
  for (const p of powerUps) {
    ctx.save();
    ctx.translate(p.x, p.y);
    ctx.rotate(p.rot);
    ctx.shadowBlur = 15;
    ctx.shadowColor = p.color;
    ctx.fillStyle = p.color;
    ctx.beginPath();
    ctx.arc(0, 0, p.r, 0, Math.PI * 2);
    ctx.fill();
    ctx.shadowBlur = 0;
    ctx.fillStyle = '#fff';
    ctx.font = '20px Arial';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(p.icon, 0, 1);
    ctx.restore();
  }

  drawParticles();
}

function loop(t) {
  const dt = game.lastTime ? (t - game.lastTime) : 16;
  game.lastTime = t;

  update(dt);
  draw();
  requestAnimationFrame(loop);
}

// ===== 输入与启动 =====
document.addEventListener('keydown', (e) => {
  keys[e.key] = true;
  if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', ' ', 'Space', 'Spacebar'].includes(e.key)) e.preventDefault();
});

document.addEventListener('keyup', (e) => {
  keys[e.key] = false;
  if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', ' ', 'Space', 'Spacebar'].includes(e.key)) e.preventDefault();
});

document.addEventListener('DOMContentLoaded', () => {
  const startBtn = document.getElementById('startButton');
  const restartBtn = document.getElementById('restartButton');

  if (startBtn) {
    startBtn.addEventListener('click', () => {
      initAudio();
      // 预解锁BGM播放权限（规避浏览器自动播放限制）
      try {
        ensureBgmElements();
        // 预解锁：common 和 boss 都尝试 play->pause
        const unlock = (el) => {
          if (!el) return;
          const p = el.play();
          if (p && typeof p.then === 'function') {
            p.then(() => {
              el.pause();
              el.currentTime = 0;
            }).catch(() => {});
          }
        };
        unlock(bgm.commonEl);
        unlock(bgm.bossEl);
      } catch (_) {}

      startCommonBgm();
      startGame();
    });
  }

  if (restartBtn) {
    restartBtn.addEventListener('click', () => {
      initAudio();
      resetGame();
      startCommonBgm();
      startGame();
    });
  }

  resetGame();
  requestAnimationFrame(loop);
});
