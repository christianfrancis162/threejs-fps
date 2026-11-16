// Bots: two teams of three. The player plus two friendly bots (ink/white) against three
// enemy bots (accent/orange). Simple AI: patrol waypoints, engage the nearest visible
// enemy inside range and field of view, strafe while firing in bursts. Shots are raycast
// against the world; a hit on the player or a bot applies damage through callbacks.
import * as THREE from 'three';
import { PALETTE } from './palette.js';

const HEALTH = 100;
const EYE = 1.5;
const CHEST = 1.2;
const RADIUS = 0.34;
const PATROL_SPEED = 2.6;
const ENGAGE_SPEED = 2.1;
const SIGHT_RANGE = 30;
const SIGHT_HALF_FOV = 0.96; // ~55 degrees each side
const SHOT_DAMAGE = 15;
const BURST_MIN = 3;
const BURST_MAX = 5;
const SHOT_GAP = 0.13;
const FALL_SECONDS = 0.4;

const NAMES_BLUE = ['Ghost', 'Viper'];
const NAMES_RED = ['Rook', 'Havoc', 'Blitz'];

const WAYPOINTS = [
  [-9, -9], [0, -9], [9, -9],
  [-9, -4], [-4, -4], [4, -4], [9, -4],
  [-9, 0], [0, 0], [9, 0],
  [-9, 4], [-4, 4], [4, 4], [9, 4],
  [-9, 9], [0, 9], [9, 9],
];

const BLUE_SPAWNS = [[-3, 9.5], [3, 9.5]];
const RED_SPAWNS = [[-4, -9.5], [0, -9.5], [4, -9.5]];

const FRIENDLY_COLOR = new THREE.Color(PALETTE.ink);
const ENEMY_COLOR = new THREE.Color(PALETTE.accent);
const DARK = new THREE.Color(PALETTE.hairline);

export function createBots(scene, world, hooks) {
  const random = hooks.random || Math.random;
  const raycaster = new THREE.Raycaster();
  raycaster.far = 80;
  const dir = new THREE.Vector3();
  const toTarget = new THREE.Vector3();
  const eye = new THREE.Vector3();
  const aim = new THREE.Vector3();
  const probe = new THREE.Box3();

  // A small pool of tracer lines so gunfire reads in the frame and in screenshots.
  const tracers = [];
  const tracerMat = new THREE.LineBasicMaterial({ color: new THREE.Color(PALETTE.accent), transparent: true, opacity: 0 });
  for (let i = 0; i < 16; i += 1) {
    const geo = new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(), new THREE.Vector3()]);
    const line = new THREE.Line(geo, tracerMat.clone());
    line.visible = false;
    line.frustumCulled = false;
    scene.add(line);
    tracers.push({ line, life: 0 });
  }
  let tracerNext = 0;

  function fireTracer(from, to) {
    const t = tracers[tracerNext];
    tracerNext = (tracerNext + 1) % tracers.length;
    const pos = t.line.geometry.attributes.position;
    pos.setXYZ(0, from.x, from.y, from.z);
    pos.setXYZ(1, to.x, to.y, to.z);
    pos.needsUpdate = true;
    t.line.visible = true;
    t.line.material.opacity = 0.85;
    t.life = 0.07;
  }

  function buildMesh(team) {
    const color = team === 'blue' ? FRIENDLY_COLOR : ENEMY_COLOR;
    const bodyMat = new THREE.MeshStandardMaterial({ color, roughness: 0.6, metalness: 0.05 });
    const darkMat = new THREE.MeshStandardMaterial({ color: DARK, roughness: 0.8 });
    const group = new THREE.Group();
    const torso = new THREE.Mesh(new THREE.BoxGeometry(0.52, 0.78, 0.3), bodyMat);
    torso.position.y = 1.0;
    torso.userData.part = 'torso';
    const head = new THREE.Mesh(new THREE.SphereGeometry(0.155, 16, 12), bodyMat);
    head.position.y = 1.53;
    head.userData.part = 'head';
    const legL = new THREE.Mesh(new THREE.BoxGeometry(0.18, 0.55, 0.2), darkMat);
    legL.position.set(-0.14, 0.28, 0);
    const legR = new THREE.Mesh(new THREE.BoxGeometry(0.18, 0.55, 0.2), darkMat);
    legR.position.set(0.14, 0.28, 0);
    const gun = new THREE.Mesh(new THREE.BoxGeometry(0.07, 0.09, 0.55), darkMat);
    gun.position.set(0.2, 1.25, -0.3);
    const ring = new THREE.Mesh(
      new THREE.CylinderGeometry(0.46, 0.46, 0.02, 24),
      new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.55 }),
    );
    ring.position.y = 0.02;
    group.add(torso, head, legL, legR, gun, ring);
    group.traverse((mesh) => {
      if (mesh.isMesh) { mesh.castShadow = true; mesh.receiveShadow = true; }
    });
    scene.add(group);
    return { group, torso, head };
  }

  const bots = [];
  function addBot(team, name, spawn) {
    const { group, torso, head } = buildMesh(team);
    const bot = {
      id: bots.length,
      name,
      team,
      position: new THREE.Vector3(spawn[0], 0, spawn[1]),
      yaw: team === 'blue' ? Math.PI : 0,
      health: HEALTH,
      armor: false,
      alive: true,
      state: 'patrol',
      waypoint: new THREE.Vector3(spawn[0], 0, spawn[1]),
      waypointTimer: 0,
      losTimer: random() * 0.15,
      target: null,
      burstLeft: 0,
      burstPause: 0,
      strafeDir: random() > 0.5 ? 1 : -1,
      strafeTimer: 0,
      fall: 0,
      group,
      torso,
      head,
      home: new THREE.Vector3(spawn[0], 0, spawn[1]),
    };
    torso.userData.bot = bot;
    head.userData.bot = bot;
    group.position.copy(bot.position);
    bots.push(bot);
    return bot;
  }

  BLUE_SPAWNS.forEach((spawn, i) => addBot('blue', NAMES_BLUE[i], spawn));
  RED_SPAWNS.forEach((spawn, i) => addBot('red', NAMES_RED[i], spawn));

  function overlaps(x, z) {
    probe.min.set(x - RADIUS, 0.02, z - RADIUS);
    probe.max.set(x + RADIUS, 1.7, z + RADIUS);
    for (const c of world.colliders) if (probe.intersectsBox(c)) return true;
    return false;
  }

  function moveToward(bot, tx, tz, dt, speed) {
    const dx = tx - bot.position.x;
    const dz = tz - bot.position.z;
    const len = Math.hypot(dx, dz);
    if (len < 0.15) return true;
    const stepX = (dx / len) * speed * dt;
    const stepZ = (dz / len) * speed * dt;
    const nx = bot.position.x + stepX;
    if (!overlaps(nx, bot.position.z)) bot.position.x = nx;
    const nz = bot.position.z + stepZ;
    if (!overlaps(bot.position.x, nz)) bot.position.z = nz;
    return false;
  }

  function hasLineOfSight(from, to) {
    eye.set(from.x, from.y + EYE, from.z);
    toTarget.set(to.x - eye.x, to.y + EYE - eye.y, to.z - eye.z);
    const dist = toTarget.length();
    if (dist > SIGHT_RANGE) return false;
    dir.copy(toTarget).normalize();
    raycaster.set(eye, dir);
    const hit = raycaster.intersectObjects(world.shootables, false)[0];
    return !hit || hit.distance > dist - 0.3;
  }

  function visibleEnemy(bot, playerState) {
    // Nearest visible enemy: the player if they are red-team hostile, else blue bots.
    let best = null;
    let bestDist = Infinity;
    const consider = (pos, ref) => {
      const dx = pos.x - bot.position.x;
      const dz = pos.z - bot.position.z;
      const dist = Math.hypot(dx, dz);
      if (dist >= bestDist || dist > SIGHT_RANGE) return;
      // Field of view: the bot must roughly face its target.
      const ang = Math.atan2(-dx, -dz);
      let diff = ang - bot.yaw;
      while (diff > Math.PI) diff -= Math.PI * 2;
      while (diff < -Math.PI) diff += Math.PI * 2;
      if (Math.abs(diff) > SIGHT_HALF_FOV) return;
      if (!hasLineOfSight(bot.position, pos)) return;
      best = ref;
      bestDist = dist;
    };
    if (bot.team === 'red' && playerState.alive) consider(playerState.position, { kind: 'player' });
    for (const other of bots) {
      if (!other.alive || other.team === bot.team) continue;
      consider(other.position, { kind: 'bot', bot: other });
    }
    return best;
  }

  function botShoot(bot, target, time) {
    // Aim at the target chest with spread that grows with distance.
    const targetPos = target.kind === 'player' ? hooks.getPlayerPos() : target.bot.position;
    const dist = Math.hypot(targetPos.x - bot.position.x, targetPos.z - bot.position.z);
    const spread = 0.035 + dist * 0.0028;
    aim.set(targetPos.x, CHEST, targetPos.z);
    aim.x += (random() * 2 - 1) * spread * dist * 0.5;
    aim.y += (random() * 2 - 1) * spread * dist * 0.3;
    aim.z += (random() * 2 - 1) * spread * dist * 0.5;
    eye.set(bot.position.x, bot.position.y + EYE, bot.position.z);
    dir.copy(aim).sub(eye).normalize();
    raycaster.set(eye, dir);
    const wall = raycaster.intersectObjects(world.shootables, false)[0];
    const wallDist = wall ? wall.distance : Infinity;
    // Perpendicular distance from the target chest to the shot ray.
    toTarget.set(targetPos.x, CHEST, targetPos.z).sub(eye);
    const along = toTarget.dot(dir);
    const closest = Math.sqrt(Math.max(0, toTarget.lengthSq() - along * along));
    const muzzle = eye.clone().addScaledVector(dir, 0.6);
    const end = eye.clone().addScaledVector(dir, Math.min(wallDist, 40));
    fireTracer(muzzle, end);
    hooks.onBotShotFired?.(bot);
    if (along > 0 && closest < 0.5 && along < wallDist) {
      if (target.kind === 'player') hooks.onDamagePlayer(SHOT_DAMAGE, bot);
      else damageBot(target.bot, SHOT_DAMAGE, 'torso', bot);
    }
  }

  function damageBot(bot, amount, part, killer) {
    if (!bot.alive) return false;
    bot.health -= amount;
    if (bot.health > 0) return false;
    bot.alive = false;
    bot.fall = 0;
    bot.state = 'dead';
    hooks.onKill?.(killer, bot);
    return true;
  }

  function pickWaypoint(bot) {
    const wp = WAYPOINTS[Math.floor(random() * WAYPOINTS.length)];
    bot.waypoint.set(wp[0], 0, wp[1]);
    bot.waypointTimer = 0;
  }

  function stepBot(bot, dt, time, playerState) {
    if (!bot.alive) {
      bot.fall = Math.min(1, bot.fall + dt / FALL_SECONDS);
      bot.group.rotation.x = -bot.fall * 1.45;
      bot.group.position.y = -bot.fall * 0.08;
      return;
    }
    bot.losTimer -= dt;
    if (bot.losTimer <= 0) {
      bot.losTimer = 0.15;
      bot.target = visibleEnemy(bot, playerState);
      bot.state = bot.target ? 'engage' : 'patrol';
    }
    if (bot.state === 'engage' && bot.target) {
      const targetPos = bot.target.kind === 'player' ? hooks.getPlayerPos() : bot.target.bot.position;
      if (bot.target.kind === 'bot' && !bot.target.bot.alive) { bot.target = null; bot.state = 'patrol'; }
      else {
        const dx = targetPos.x - bot.position.x;
        const dz = targetPos.z - bot.position.z;
        const wantYaw = Math.atan2(-dx, -dz);
        let diff = wantYaw - bot.yaw;
        while (diff > Math.PI) diff -= Math.PI * 2;
        while (diff < -Math.PI) diff += Math.PI * 2;
        bot.yaw += diff * Math.min(1, dt * 10);
        // Strafe perpendicular to the target, switching direction regularly.
        bot.strafeTimer -= dt;
        if (bot.strafeTimer <= 0) {
          bot.strafeTimer = 0.8 + random() * 0.9;
          bot.strafeDir = random() > 0.5 ? 1 : -1;
        }
        const px = -dz;
        const pz = dx;
        const plen = Math.hypot(px, pz) || 1;
        moveToward(bot, bot.position.x + (px / plen) * bot.strafeDir, bot.position.z + (pz / plen) * bot.strafeDir, dt, ENGAGE_SPEED);
        // Fire in bursts.
        bot.burstPause -= dt;
        if (bot.burstLeft > 0) {
          bot.shootTimer -= dt;
          if (bot.shootTimer <= 0) {
            bot.shootTimer = SHOT_GAP;
            bot.burstLeft -= 1;
            botShoot(bot, bot.target, time);
            if (bot.burstLeft === 0) bot.burstPause = 1.0 + random() * 0.8;
          }
        } else if (bot.burstPause <= 0) {
          bot.burstLeft = BURST_MIN + Math.floor(random() * (BURST_MAX - BURST_MIN + 1));
          bot.shootTimer = 0;
        }
      }
    } else {
      bot.waypointTimer += dt;
      const arrived = moveToward(bot, bot.waypoint.x, bot.waypoint.z, dt, PATROL_SPEED);
      const dx = bot.waypoint.x - bot.position.x;
      const dz = bot.waypoint.z - bot.position.z;
      if (Math.hypot(dx, dz) > 0.3) {
        const wantYaw = Math.atan2(-dx, -dz);
        let diff = wantYaw - bot.yaw;
        while (diff > Math.PI) diff -= Math.PI * 2;
        while (diff < -Math.PI) diff += Math.PI * 2;
        bot.yaw += diff * Math.min(1, dt * 6);
      }
      if (arrived || bot.waypointTimer > 14) pickWaypoint(bot);
    }
    bot.group.position.copy(bot.position);
    bot.group.rotation.y = bot.yaw;
  }

  return {
    bots,
    get hitMeshes() {
      const out = [];
      for (const b of bots) if (b.alive) out.push(b.torso, b.head);
      return out;
    },
    step(dt, time, playerState) {
      for (const t of tracers) {
        if (t.life > 0) {
          t.life -= dt;
          t.line.material.opacity = Math.max(0, t.life / 0.07) * 0.85;
          if (t.life <= 0) t.line.visible = false;
        }
      }
      for (const bot of bots) stepBot(bot, dt, time, playerState);
    },
    damage(bot, amount, part, killer) {
      return damageBot(bot, amount, part, killer);
    },
    resetRound() {
      for (const bot of bots) {
        bot.health = HEALTH;
        bot.armor = false;
        bot.alive = true;
        bot.state = 'patrol';
        bot.target = null;
        bot.burstLeft = 0;
        bot.burstPause = 0.5 + random();
        bot.fall = 0;
        bot.position.copy(bot.home);
        bot.group.position.copy(bot.position);
        bot.group.rotation.set(0, bot.yaw, 0);
        bot.yaw = bot.team === 'blue' ? Math.PI : 0;
        bot.group.rotation.y = bot.yaw;
        pickWaypoint(bot);
      }
    },
    aliveCount(team) {
      return bots.filter((b) => b.team === team && b.alive).length;
    },
    setPositionsForShot() {
      // Deterministic spread for screenshots: friendlies mid-map, enemies near cover.
      const spots = {
        Ghost: [-2, 2], Viper: [3, 3],
        Rook: [-4, -4], Havoc: [0, -6], Blitz: [5, -5],
      };
      for (const bot of bots) {
        const s = spots[bot.name];
        if (!s) continue;
        bot.position.set(s[0], 0, s[1]);
        bot.yaw = bot.team === 'blue' ? Math.PI : 0;
        bot.group.position.copy(bot.position);
        bot.group.rotation.y = bot.yaw;
      }
    },
  };
}
