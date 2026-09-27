// ============================================================
// Terrain — the battle lane is flat ground (W.groundY). The old
// slingshot physics (hills, bounces, pads) is gone; the renderer
// still asks for the ground height and the (absent) height profile.
// ============================================================

import { CONFIG } from '../config.js';

/** No height profile: the lane is flat. */
export function getTerrain() {
  return null;
}

/** Ground surface height (y) at x. */
export function groundAt() {
  return CONFIG.world.groundY;
}
