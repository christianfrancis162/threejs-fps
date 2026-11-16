// Rounds and money: a Counter-Strike-style loop. Buy phase, combat, round end, match end.
// First to 5 round wins takes the match; after 8 rounds the leader wins, 4-4 is a draw.
export const BUY_SECONDS = 10;
export const ROUND_SECONDS = 100;
export const ROUND_END_SECONDS = 4;
export const WIN_ROUNDS = 5;
export const MAX_ROUNDS = 8;

export const WEAPONS = {
  pistol: { name: 'Pistol', price: 500, damage: 25, headDamage: 100, mag: 12, reserve: 36, fireGap: 0.18, reloadTime: 1.4, spreadStill: 0.004, spreadMoving: 0.03, auto: false, barrel: 0.22 },
  smg: { name: 'SMG', price: 1500, damage: 22, headDamage: 88, mag: 30, reserve: 90, fireGap: 0.075, reloadTime: 1.8, spreadStill: 0.008, spreadMoving: 0.035, auto: true, barrel: 0.3 },
  rifle: { name: 'Rifle', price: 2500, damage: 34, headDamage: 100, mag: 30, reserve: 90, fireGap: 0.096, reloadTime: 1.9, spreadStill: 0.0022, spreadMoving: 0.028, auto: true, barrel: 0.4 },
};
export const ARMOR_PRICE = 1000;
export const KILL_REWARD = 300;
export const WIN_REWARD = 1000;
export const LOSS_REWARD = 500;

export function createRounds(hooks) {
  const state = {
    phase: 'buy', // 'buy' | 'combat' | 'roundEnd' | 'matchEnd'
    phaseTime: BUY_SECONDS,
    round: 1,
    wins: { blue: 0, red: 0 },
    money: 800,
    weapon: 'pistol',
    armor: false,
    lastWinner: null,
    lastReason: '',
    matchWinner: null,
  };

  function startBuyPhase() {
    state.phase = 'buy';
    state.phaseTime = BUY_SECONDS;
    hooks.onBuyPhase?.(state.round, state.money);
  }

  function startCombat() {
    state.phase = 'combat';
    state.phaseTime = ROUND_SECONDS;
    hooks.onCombatStart?.(state.round);
  }

  function endRound(winner, reason) {
    if (state.phase !== 'combat') return;
    state.phase = 'roundEnd';
    state.phaseTime = ROUND_END_SECONDS;
    state.lastWinner = winner;
    state.lastReason = reason;
    if (winner === 'blue') {
      state.wins.blue += 1;
      state.money += WIN_REWARD;
    } else if (winner === 'red') {
      state.wins.red += 1;
      state.money += LOSS_REWARD;
    }
    hooks.onRoundEnd?.(winner, reason, { ...state.wins }, state.round);
  }

  function endMatch(winner) {
    state.phase = 'matchEnd';
    state.phaseTime = 0;
    state.matchWinner = winner;
    hooks.onMatchEnd?.(winner, { ...state.wins });
  }

  function step(dt, alive) {
    if (state.phase === 'matchEnd') return;
    state.phaseTime -= dt;
    if (state.phase === 'buy') {
      if (state.phaseTime <= 0) startCombat();
      return;
    }
    if (state.phase === 'combat') {
      if (alive.blue === 0 && alive.red > 0) endRound('red', 'Your team was eliminated.');
      else if (alive.red === 0 && alive.blue > 0) endRound('blue', 'Enemy team eliminated.');
      else if (alive.blue === 0 && alive.red === 0) endRound(null, 'Both teams eliminated.');
      else if (state.phaseTime <= 0) {
        if (alive.blue > alive.red) endRound('blue', 'Time expired — your team had more fighters standing.');
        else if (alive.red > alive.blue) endRound('red', 'Time expired — the enemy had more fighters standing.');
        else endRound(null, 'Time expired — even numbers, no winner.');
      }
      return;
    }
    if (state.phase === 'roundEnd') {
      if (state.phaseTime <= 0) {
        if (state.wins.blue >= WIN_ROUNDS) endMatch('blue');
        else if (state.wins.red >= WIN_ROUNDS) endMatch('red');
        else if (state.round >= MAX_ROUNDS) {
          if (state.wins.blue > state.wins.red) endMatch('blue');
          else if (state.wins.red > state.wins.blue) endMatch('red');
          else endMatch(null);
        } else {
          state.round += 1;
          hooks.onNextRound?.(state.round);
          startBuyPhase();
        }
      }
    }
  }

  return {
    state,
    step,
    startBuyPhase,
    startCombat,
    endRound,
    buyWeapon(type) {
      if (state.phase !== 'buy') return { ok: false, reason: 'Buy menu is only open between rounds.' };
      const w = WEAPONS[type];
      if (!w) return { ok: false, reason: 'Unknown weapon.' };
      if (state.weapon === type) return { ok: false, reason: `Already carrying the ${w.name}.` };
      if (state.money < w.price) return { ok: false, reason: `Need $${w.price} for the ${w.name}.` };
      state.money -= w.price;
      state.weapon = type;
      hooks.onBuy?.(type, state.money);
      return { ok: true, weapon: type, money: state.money };
    },
    buyArmor() {
      if (state.phase !== 'buy') return { ok: false, reason: 'Buy menu is only open between rounds.' };
      if (state.armor) return { ok: false, reason: 'Already wearing armor.' };
      if (state.money < ARMOR_PRICE) return { ok: false, reason: `Need $${ARMOR_PRICE} for armor.` };
      state.money -= ARMOR_PRICE;
      state.armor = true;
      hooks.onBuy?.('armor', state.money);
      return { ok: true, weapon: 'armor', money: state.money };
    },
    addKillReward() {
      state.money += KILL_REWARD;
      return state.money;
    },
    resetMatch() {
      state.phase = 'buy';
      state.phaseTime = BUY_SECONDS;
      state.round = 1;
      state.wins = { blue: 0, red: 0 };
      state.money = 800;
      state.weapon = 'pistol';
      state.armor = false;
      state.lastWinner = null;
      state.lastReason = '';
      state.matchWinner = null;
      hooks.onBuyPhase?.(state.round, state.money);
    },
  };
}
