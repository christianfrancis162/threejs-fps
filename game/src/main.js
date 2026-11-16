// Boot and the one loop: a fixed 60 Hz simulation feeding a render at the display's rate.
// Tactical FPS: you plus two friendly bots against three enemy bots, rounds, money, buy menu.
// ?shot=start|play|end with &seed=N sets up a deterministic frame for a capture, renders it
// twice, then freezes it and sets window.__shotReady.
import * as THREE from 'three';
import { PALETTE } from './palette.js';
import { createWorld } from './world.js';
import { createInput } from './input.js';
import { createPlayer } from './player.js';
import { createWeapon } from './weapon.js';
import { createBots } from './bots.js';
import { createRounds, WEAPONS, ARMOR_PRICE, BUY_SECONDS } from './rounds.js';
import { createHud } from './hud.js';
import { createSounds } from './sounds.js';

const FIXED_STEP = 1 / 60;
const params = new URLSearchParams(window.location.search);
const shot = params.get('shot');
const seed = Number.parseInt(params.get('seed') ?? '1', 10) || 1;

function mulberry32(initial) {
  let a = initial;
  return function random() {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const random = mulberry32(seed);

const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFShadowMap;
document.getElementById('game').appendChild(renderer.domElement);

const scene = new THREE.Scene();
scene.background = new THREE.Color(PALETTE.canvas);
scene.fog = new THREE.Fog(new THREE.Color(PALETTE.canvas), 18, 46);
const camera = new THREE.PerspectiveCamera(74, window.innerWidth / window.innerHeight, 0.05, 140);
scene.add(camera);

const sounds = createSounds();
const world = createWorld(scene);
const weapon = createWeapon(camera);
const hud = createHud();
const player = createPlayer(world.colliders);
const input = createInput(renderer.domElement, onLockChange);
const raycaster = new THREE.Raycaster();
raycaster.far = 80;
const direction = new THREE.Vector3();

const body = player.state;
const markerHoldMs = shot ? 4000 : 90;
let kills = 0;
let playerHealth = 100;
let playerArmor = false;
let playerAlive = true;
let elapsed = 0;
let frozen = false;
let started = false;
let accumulator = 0;
let lastTime = performance.now();
let wasFiring = false;
let bPressed = false;
let buyMenuVisible = false;

function aliveCounts() {
  return {
    blue: bots.aliveCount('blue') + (playerAlive ? 1 : 0),
    red: bots.aliveCount('red'),
  };
}

const bots = createBots(scene, world, {
  random,
  getPlayerPos() { return player.state.position; },
  onDamagePlayer(amount, bot) {
    if (shot || !playerAlive) return;
    const final = playerArmor ? Math.ceil(amount / 2) : amount;
    playerHealth -= final;
    hud.setHealth(playerHealth);
    hud.damageFlash();
    sounds.hurt();
    if (playerHealth <= 0) {
      playerHealth = 0;
      hud.setHealth(0);
      onPlayerDeath(bot);
    }
  },
  onKill(killer, victim) {
    const killerName = killer === 'player' ? 'You' : killer.name;
    const killerTeam = killer === 'player' ? 'blue' : killer.team;
    hud.killFeed(`${killerName} ✕ ${victim.name}`, killerTeam);
    if (killer === 'player') {
      kills += 1;
      rounds.addKillReward();
      hud.setScore(kills);
      hud.setMoney(rounds.state.money);
      sounds.kill();
    }
  },
  onBotShotFired(bot) {
    if (shot) return;
    const d = bot.position.distanceTo(player.state.position);
    if (d < 28) sounds.enemyShoot();
  },
});

const rounds = createRounds({
  onBuyPhase(round, money) {
    playerAlive = true;
    playerHealth = 100;
    playerArmor = rounds.state.armor;
    player.state.position.set(0, 0, 9.5);
    player.state.velocity.set(0, 0, 0);
    player.state.yaw = 0;
    player.state.pitch = 0;
    weapon.refillCurrent();
    bots.resetRound();
    hud.setHealth(100);
    hud.setMoney(money);
    hud.setAmmo(weapon.state.mag, weapon.state.reserve, weapon.stats.name);
    hud.setTimer(BUY_SECONDS);
    hud.setRoundScore(rounds.state.wins.blue, rounds.state.wins.red, round);
    hud.setTeams(3, 3);
    if (!shot) {
      hud.showOverlay('start', kills);
      hud.setPlayLabel(`Deploy — Round ${round}`);
      renderBuyMenu(money);
      buyMenuVisible = true;
      if (document.pointerLockElement) document.exitPointerLock();
    }
  },
  onCombatStart(round) {
    hud.showBanner(`ROUND ${round}`, 'Eliminate the enemy team', 2000);
    hud.hideBuyMenu();
    buyMenuVisible = false;
    sounds.roundStart();
  },
  onRoundEnd(winner, reason, wins, round) {
    if (winner === 'blue') {
      hud.showBanner('ROUND WON', reason, 3200);
      sounds.roundWin();
    } else if (winner === 'red') {
      hud.showBanner('ROUND LOST', reason, 3200);
      sounds.roundLose();
    } else {
      hud.showBanner('ROUND DRAW', reason, 3200);
      sounds.roundLose();
    }
    if (document.pointerLockElement) document.exitPointerLock();
  },
  onMatchEnd(winner, wins) {
    const result = winner === 'blue' ? 'VICTORY!' : winner === 'red' ? 'DEFEAT.' : 'DRAW.';
    const score = `Final score ${wins.blue} — ${wins.red}.`;
    hud.showOverlay('end', kills, `${result} ${score}`);
    if (document.pointerLockElement) document.exitPointerLock();
    if (winner === 'blue') sounds.roundWin();
    else sounds.roundLose();
  },
  onBuy(type, money) {
    hud.setMoney(money);
  },
});

function renderBuyMenu(money) {
  const items = [
    { id: 'pistol', name: 'Pistol', desc: 'Standard sidearm. 25 damage, 12-round mag.', price: WEAPONS.pistol.price, owned: rounds.state.weapon === 'pistol' },
    { id: 'smg', name: 'SMG', desc: 'Fast fire, 22 damage, 30-round mag. Close quarters.', price: WEAPONS.smg.price, owned: rounds.state.weapon === 'smg' },
    { id: 'rifle', name: 'Rifle', desc: 'High damage, 34 damage, accurate at range.', price: WEAPONS.rifle.price, owned: rounds.state.weapon === 'rifle' },
    { id: 'armor', name: 'Armor', desc: 'Halves incoming damage until you die.', price: ARMOR_PRICE, owned: rounds.state.armor },
  ];
  const buyMoneyEl = document.getElementById('buy-money');
  if (buyMoneyEl) buyMoneyEl.textContent = `Your money: $${money} — kills pay $300, round win $1000, loss $500.`;
  hud.showBuyMenu(items, money, (id) => {
    let res;
    if (id === 'armor') res = rounds.buyArmor();
    else res = rounds.buyWeapon(id);
    if (!res.ok) {
      hud.showBuyHint(res.reason);
      sounds.deny();
      return;
    }
    if (id !== 'armor') weapon.equip(id);
    playerArmor = rounds.state.armor;
    hud.setMoney(rounds.state.money);
    hud.setAmmo(weapon.state.mag, weapon.state.reserve, weapon.stats.name);
    sounds.buy();
    renderBuyMenu(rounds.state.money);
  });
}

function onPlayerDeath(killer) {
  playerAlive = false;
  if (!shot) {
    hud.showOverlay('dead', kills);
    if (document.pointerLockElement) document.exitPointerLock();
  }
}

function resetMatch() {
  kills = 0;
  playerHealth = 100;
  playerArmor = false;
  playerAlive = true;
  player.state.position.set(0, 0, 9.5);
  player.state.velocity.set(0, 0, 0);
  player.state.yaw = 0;
  player.state.pitch = 0;
  weapon.refill();
  weapon.equip('pistol');
  hud.setScore(0);
  hud.setHealth(100);
  rounds.resetMatch();
}

hud.setAmmo(weapon.state.mag, weapon.state.reserve, weapon.stats.name);
hud.setHealth(100);
hud.setMoney(800);
hud.setScore(0);
hud.setTimer(BUY_SECONDS);
hud.setRoundScore(0, 0, 1);
hud.setTeams(3, 3);

hud.onPlay(() => {
  if (shot) return;
  sounds.unlock();
  const phase = rounds.state.phase;
  if (phase === 'matchEnd') {
    resetMatch();
    return;
  }
  if (phase === 'buy') {
    rounds.startCombat();
    hud.hideOverlay();
    hud.hideBuyMenu();
    buyMenuVisible = false;
    input.requestLock();
    return;
  }
  if (phase === 'combat') {
    if (playerAlive) input.requestLock();
    else hud.hideOverlay();
    return;
  }
  hud.hideOverlay();
});

renderer.domElement.addEventListener('click', () => {
  if (shot) return;
  if (rounds.state.phase === 'combat' && playerAlive && !input.state.locked) input.requestLock();
});

function onLockChange(locked) {
  if (shot) return;
  if (locked) {
    started = true;
    hud.hideOverlay();
    sounds.unlock();
  } else if (rounds.state.phase === 'combat' && playerAlive) {
    hud.showOverlay('paused', kills);
  }
}

function syncCamera() {
  camera.position.set(body.position.x, body.position.y + body.eye, body.position.z);
  camera.rotation.set(body.pitch, body.yaw, 0, 'YXZ');
}

function aimAt(point) {
  const dx = point.x - body.position.x;
  const dy = point.y - (body.position.y + body.eye);
  const dz = point.z - body.position.z;
  const length = Math.hypot(dx, dy, dz) || 1;
  body.yaw = Math.atan2(-dx, -dz);
  body.pitch = Math.asin(Math.max(-1, Math.min(1, dy / length)));
  syncCamera();
}

function shoot(spread) {
  if (!weapon.takeRound()) return false;
  camera.getWorldDirection(direction);
  direction.x += (random() * 2 - 1) * spread;
  direction.y += (random() * 2 - 1) * spread;
  direction.z += (random() * 2 - 1) * spread;
  direction.normalize();
  scene.updateMatrixWorld(true);
  raycaster.set(camera.position, direction);
  const shootables = world.shootables.concat(bots.hitMeshes);
  const hit = raycaster.intersectObjects(shootables, false)[0];
  if (hit) {
    const bot = hit.object.userData.bot;
    if (bot) {
      const part = hit.object.userData.part;
      const dmg = part === 'head' ? weapon.stats.headDamage : weapon.stats.damage;
      const killed = bots.damage(bot, dmg, part, 'player');
      hud.hitMarker(killed, markerHoldMs);
      if (!killed) sounds.hit();
    }
  }
  weapon.pullTrigger();
  sounds.shoot(weapon.type);
  player.recoil(0.009 + random() * 0.004, (random() * 2 - 1) * 0.004);
  hud.setAmmo(weapon.state.mag, weapon.state.reserve, weapon.stats.name);
  return true;
}

function step(dt) {
  elapsed += dt;
  const phase = rounds.state.phase;
  if (phase === 'combat') {
    if (playerAlive) player.step(dt, input.state.keys);
    weapon.step(dt);
    bots.step(dt, elapsed, { position: player.state.position, alive: playerAlive });
  } else {
    weapon.step(dt);
  }
  const alive = aliveCounts();
  rounds.step(dt, alive);
  hud.setTimer(rounds.state.phaseTime);
  hud.setRoundScore(rounds.state.wins.blue, rounds.state.wins.red, rounds.state.round);
  hud.setTeams(alive.blue, alive.red);
  hud.setMoney(rounds.state.money);
}

function frame(now) {
  requestAnimationFrame(frame);
  const dt = Math.min((now - lastTime) / 1000, 0.1);
  lastTime = now;
  if (!frozen) {
    const look = input.takeLook();
    if (playerAlive && input.state.locked) player.look(look.x, look.y);
    if (playerAlive && input.state.locked && rounds.state.phase === 'combat') {
      const firing = input.state.firing;
      const auto = weapon.stats.auto;
      if (firing && (auto || !wasFiring) && weapon.ready()) shoot(weapon.spread(player.groundSpeed()));
      wasFiring = firing;
      if (input.state.keys.has('KeyR')) weapon.reload();
    } else {
      wasFiring = false;
    }
    if (input.state.keys.has('KeyB') && !bPressed) {
      bPressed = true;
      if (rounds.state.phase === 'buy') {
        if (buyMenuVisible) { hud.hideBuyMenu(); buyMenuVisible = false; }
        else { renderBuyMenu(rounds.state.money); buyMenuVisible = true; }
      } else if (rounds.state.phase === 'combat') {
        hud.showBuyHint('Buy menu is only available between rounds.');
      }
    }
    if (!input.state.keys.has('KeyB')) bPressed = false;
    accumulator += dt;
    let steps = 0;
    while (accumulator >= FIXED_STEP && steps < 5) {
      step(FIXED_STEP);
      accumulator -= FIXED_STEP;
      steps += 1;
    }
    if (accumulator > FIXED_STEP * 5) accumulator = 0;
    syncCamera();
  }
  renderer.render(scene, camera);
}

function settle(steps) {
  for (let index = 0; index < steps; index += 1) step(FIXED_STEP);
}

function runShot(name) {
  hud.hideOverlay();
  hud.hideBuyMenu();
  body.pitch = 0;
  body.yaw = 0;
  bots.setPositionsForShot();
  if (name === 'start') {
    body.position.set(0.6, 0, 8.6);
    settle(20);
    aimAt(new THREE.Vector3(0, 1.5, -6));
    hud.setHealth(100);
    hud.setMoney(800);
    hud.setAmmo(weapon.state.mag, weapon.state.reserve, weapon.stats.name);
    hud.setTimer(BUY_SECONDS);
    hud.setRoundScore(0, 0, 1);
    hud.setTeams(3, 3);
    hud.setScore(0);
    hud.showOverlay('start', 0);
    hud.setPlayLabel('Deploy — Round 1');
    renderBuyMenu(800);
    buyMenuVisible = true;
  } else if (name === 'play') {
    weapon.equip('rifle');
    rounds.state.phase = 'combat';
    rounds.state.phaseTime = 87;
    rounds.state.round = 2;
    rounds.state.wins = { blue: 1, red: 0 };
    rounds.state.money = 1800;
    body.position.set(0, 0, -5);
    settle(20);
    const target = bots.bots.find((b) => b.name === 'Blitz');
    if (target) {
      // Re-aim before every shot: the bot moves between steps, so a stale aim point misses.
      for (let r = 0; r < 3; r += 1) {
        aimAt(new THREE.Vector3(target.position.x, 1.2, target.position.z));
        shoot(0);
      }
    }
    settle(12);
    const other = bots.bots.find((b) => b.name === 'Rook' && b.alive);
    if (other) aimAt(new THREE.Vector3(other.position.x, 1.2, other.position.z));
    playerHealth = 82;
    hud.setHealth(82);
    hud.setMoney(rounds.state.money);
    hud.setTimer(87);
    hud.setRoundScore(1, 0, 2);
    hud.setTeams(3, 2);
    hud.setScore(kills);
    hud.setAmmo(weapon.state.mag, weapon.state.reserve, weapon.stats.name);
  } else {
    rounds.state.phase = 'roundEnd';
    rounds.state.wins = { blue: 2, red: 1 };
    rounds.state.round = 3;
    const rook = bots.bots.find((b) => b.name === 'Rook');
    const havoc = bots.bots.find((b) => b.name === 'Havoc');
    for (const b of [rook, havoc]) {
      if (!b) continue;
      b.alive = false;
      b.fall = 1;
      b.group.rotation.x = -1.45;
      b.group.position.y = -0.08;
    }
    body.position.set(0, 0, -5);
    settle(20);
    aimAt(new THREE.Vector3(0, 1.2, -6));
    playerHealth = 64;
    hud.setHealth(64);
    hud.setMoney(3100);
    hud.setTimer(0);
    hud.setRoundScore(2, 1, 3);
    hud.setTeams(2, 1);
    hud.setScore(3);
    hud.setAmmo(weapon.state.mag, weapon.state.reserve, weapon.stats.name);
    hud.showBanner('ROUND WON', 'Enemy team eliminated.', 60000);
  }
  paintTwiceThenReady();
}

function paintTwiceThenReady() {
  let painted = 0;
  function paint() {
    requestAnimationFrame(paint);
    syncCamera();
    renderer.render(scene, camera);
    painted += 1;
    if (painted === 2) {
      window.__shotReady = true;
      frozen = true;
    }
  }
  requestAnimationFrame(paint);
}

window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});

syncCamera();
if (shot) runShot(shot);
else {
  hud.showOverlay('start', 0);
  hud.setPlayLabel('Deploy — Round 1');
  renderBuyMenu(800);
  buyMenuVisible = true;
  requestAnimationFrame(frame);
}
