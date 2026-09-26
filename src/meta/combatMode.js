// ============================================================
// Combat mode (prototype switch, Settings -> COMBAT).
//   'gear'    – your body does no damage: ramming only EXPOSES a target.
//               Guns fire on your command and cost energy + heat; strong
//               guns carry limited ammo. Enemies follow the same rules.
//   'classic' – the original rules: collisions deal damage, guns auto-fire.
// ============================================================

const KEY = 'slingshot-combat-mode';

let mode = 'gear';
try {
  const saved = localStorage.getItem(KEY);
  if (saved === 'classic' || saved === 'gear') mode = saved;
} catch (_) {}

export const getCombatMode = () => mode;
export const isGearMode = () => mode === 'gear';

export function setCombatMode(next) {
  mode = next === 'classic' ? 'classic' : 'gear';
  try {
    localStorage.setItem(KEY, mode);
  } catch (_) {}
}
