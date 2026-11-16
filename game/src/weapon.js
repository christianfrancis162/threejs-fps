// Three weapons, one view model: pistol, SMG and rifle. Each has its own magazine,
// reserve, fire rate, damage and spread. main.js owns the ray and the damage numbers;
// this module owns the model, the timings and the ammo state per weapon.
import * as THREE from 'three';
import { PALETTE } from './palette.js';
import { WEAPONS } from './rounds.js';

const MUZZLE_TIME = 0.06;

export function createWeapon(camera) {
  const grip = new THREE.MeshStandardMaterial({ color: new THREE.Color(PALETTE.hairline), roughness: 0.7, metalness: 0.2 });
  const body = new THREE.MeshStandardMaterial({ color: new THREE.Color(PALETTE.ink), roughness: 0.5, metalness: 0.35 });

  const model = new THREE.Group();
  const receiver = new THREE.Mesh(new THREE.BoxGeometry(0.09, 0.1, 0.42), body);
  const barrel = new THREE.Mesh(new THREE.BoxGeometry(0.045, 0.045, 0.4), grip);
  barrel.position.set(0, 0.025, -0.38);
  const stock = new THREE.Mesh(new THREE.BoxGeometry(0.075, 0.08, 0.22), grip);
  stock.position.set(0, -0.02, 0.3);
  model.add(receiver, barrel, stock);
  model.position.set(0.24, -0.2, -0.42);
  camera.add(model);

  const flash = new THREE.Mesh(
    new THREE.PlaneGeometry(0.24, 0.24),
    new THREE.MeshBasicMaterial({ color: new THREE.Color(PALETTE.accent), transparent: true, opacity: 0.9, depthWrite: false, side: THREE.DoubleSide }),
  );
  flash.position.set(0.24, -0.18, -0.95);
  flash.visible = false;
  camera.add(flash);

  const flashLight = new THREE.PointLight(new THREE.Color(PALETTE.accent), 0, 5);
  flashLight.position.set(0.24, -0.16, -0.6);
  camera.add(flashLight);

  // Per-weapon ammo state, so switching back keeps what was left.
  const ammo = {};
  for (const [key, w] of Object.entries(WEAPONS)) ammo[key] = { mag: w.mag, reserve: w.reserve };
  let current = 'pistol';
  const state = { cooldown: 0, reloadLeft: 0, reloadTime: 0, flash: 0, kick: 0 };

  function stats() { return WEAPONS[current]; }
  function magState() { return ammo[current]; }

  function applyModel() {
    const w = stats();
    barrel.scale.z = w.barrel / 0.4;
    barrel.position.z = -0.38 - (0.4 - w.barrel) / 2;
    receiver.scale.z = current === 'pistol' ? 0.7 : 1;
    stock.visible = current !== 'pistol';
    model.position.y = current === 'pistol' ? -0.22 : -0.2;
  }

  function step(dt) {
    state.cooldown = Math.max(0, state.cooldown - dt);
    state.flash = Math.max(0, state.flash - dt);
    state.kick += (0 - state.kick) * Math.min(1, dt * 14);
    model.position.z = -0.42 + state.kick;
    model.rotation.x = state.kick * 2.2;
    flash.visible = state.flash > 0;
    flash.rotation.z = state.flash * 30;
    flashLight.intensity = state.flash > 0 ? 18 : 0;
    if (state.reloadLeft > 0) {
      state.reloadLeft = Math.max(0, state.reloadLeft - dt);
      model.rotation.x = -0.55 * Math.min(1, (state.reloadTime - state.reloadLeft) * 2);
      if (state.reloadLeft === 0) {
        const m = magState();
        const need = stats().mag - m.mag;
        const take = Math.min(need, m.reserve);
        m.mag += take;
        m.reserve -= take;
      }
    }
  }

  applyModel();

  return {
    get type() { return current; },
    get stats() { return stats(); },
    get state() { return { mag: magState().mag, reserve: magState().reserve, cooldown: state.cooldown, reloadLeft: state.reloadLeft, flash: state.flash, kick: state.kick }; },
    step,
    ready() {
      return magState().mag > 0 && state.cooldown === 0 && state.reloadLeft === 0;
    },
    pullTrigger() {
      state.cooldown = stats().fireGap;
      state.flash = MUZZLE_TIME;
      state.kick = 0.055;
    },
    takeRound() {
      const m = magState();
      if (m.mag <= 0) return false;
      m.mag -= 1;
      return true;
    },
    reload() {
      const m = magState();
      if (state.reloadLeft > 0 || m.mag === stats().mag || m.reserve === 0) return;
      state.reloadLeft = stats().reloadTime;
      state.reloadTime = stats().reloadTime;
    },
    spread(speed) {
      const w = stats();
      return w.spreadStill + Math.min(1, speed / 5.2) * w.spreadMoving;
    },
    equip(type) {
      if (!WEAPONS[type]) return false;
      current = type;
      state.cooldown = 0;
      state.reloadLeft = 0;
      state.flash = 0;
      state.kick = 0;
      applyModel();
      return true;
    },
    refill() {
      for (const [key, w] of Object.entries(WEAPONS)) {
        ammo[key] = { mag: w.mag, reserve: w.reserve };
      }
      state.cooldown = 0;
      state.reloadLeft = 0;
      state.flash = 0;
      state.kick = 0;
    },
    refillCurrent() {
      const m = magState();
      m.mag = stats().mag;
      m.reserve = stats().reserve;
    },
  };
}
