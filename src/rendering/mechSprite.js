// ============================================================
// mechSprite — the fighters on the field are drawn from their parts:
// the Frame sets the torso (bigger frames, bigger mechs), plating modules
// bolt armor onto it, and the Legs set what walks underneath. Guns and
// drones are mounted by Renderer._drawGear; the physics body stays the
// ball's circle hitbox.
//
// Grids use one character per pixel:
//   k ink outline   b paint   h paint highlight   d paint shadow
//   v visor         m metal   l light metal       . empty
// Sprites face right; the renderer mirrors them.
// ============================================================

import { getPart, rarityColor } from '../meta/Mech.js';

const INK = '#1a1c2c';
const METAL = '#566c86';
const METAL_LIGHT = '#94b0c2';
const VISOR = '#73eff7';

// ---------- Torsos (one per frame) ----------

const TORSOS = {
  fr_scout: [
    '.....kkkkkkkkk......',
    '....khhhhhhhhhk.....',
    '...khbbbbbbbbbdk....',
    '...khbbbkkkkkkbdk...',
    '...khbbkvvvvvvkdk...',
    '...khbbkvvvvvvkdk...',
    '...khbbbkkkkkkbdk...',
    '...khbbbbbbbbbbdk...',
    '....kbbbbbbbbbddk...',
    '.....kddddddddkk....',
    '......kkkkkkkk......',
  ],
  fr_brawler: [
    '....kkkkkkkkkkkk....',
    '..kkhhhhhhhhhhhhkk..',
    '.khhbbbbbbbbbbbbddk.',
    '.khbbbbbkkkkkkkbbdk.',
    '.khbbbbkvvvvvvvkbdk.',
    '.khbbbbkvvvvvvvkbdk.',
    '.khbbbbbkkkkkkkbbdk.',
    '.khbbbbbbbbbbbbbbdk.',
    '.kkbbbbbbbbbbbbbbkk.',
    '...kbbbbbbbbbbbbdk..',
    '...kddddddddddddkk..',
    '....kkkkkkkkkkkk....',
  ],
  fr_phantom: [
    '........kkkkk.......',
    '......kkhhhhhkk.....',
    '....kkhbbbbbbbbkk...',
    '..kkhbbbbkkkkkkkbkk.',
    '.khbbbbbkvvvvvvvvvk.',
    '..khbbbbbkkkkkkkkkk.',
    '...khbbbbbbbbbbbdk..',
    '....kbbbbbbbbbbddk..',
    '.....kbbbbbbbbddk...',
    '......kddddddddk....',
    '.......kkkkkkkk.....',
  ],
  fr_titan: [
    '...kkkkkkkkkkkkkkkk...',
    '..khhhhhhhhhhhhhhhhk..',
    '.khbbbbbbbbbbbbbbbbdk.',
    'khbbbbbbbbbbbbbbbbbbdk',
    'khbbbbbbkkkkkkkkbbbbdk',
    'khbbbbbkvvvvvvvvkbbbdk',
    'khbbbbbkvvvvvvvvkbbbdk',
    'khbbbbbbkkkkkkkkbbbbdk',
    'khbbbbbbbbbbbbbbbbbbdk',
    'khbbmmbbbbbbbbbbmmbbdk',
    '.kbbbbbbbbbbbbbbbbbddk',
    '..kddddddddddddddddkk.',
    '...kkkkkkkkkkkkkkkkk..',
  ],
  fr_colossus: [
    '.....kkkkkkkkkkkkkk.....',
    '...kkhhhhhhhhhhhhhhkk...',
    '..khhbbbbbbbbbbbbbbbdk..',
    '.khbbbbbbbbbbbbbbbbbbdk.',
    'khbbbbbbbkkkkkkkkbbbbbdk',
    'khbbbbbbkvvvvvvvvkbbbbdk',
    'khbbbbbbkvvvvvvvvkbbbbdk',
    'khbbbbbbbkkkkkkkkbbbbbdk',
    'khbbmmmbbbbbbbbbbbmmmbdk',
    'khbbbbbbbbbbbbbbbbbbbbdk',
    'khbbmmmbbbbbbbbbbbmmmbdk',
    '.kbbbbbbbbbbbbbbbbbbbddk',
    '..kdddddddddddddddddddk.',
    '...kkkkkkkkkkkkkkkkkkk..',
  ],
  fr_furnace: [
    '....kkkkkkkkkkkk....',
    '...khhhhhhhhhhhhk...',
    '..khbbbbbbbbbbbbdk..',
    '.khbbbkkkkkkkkbbbdk.',
    '.khbbkvvvvvvvvkbbdk.',
    '.khbbbkkkkkkkkbbbdk.',
    '.khbbbbbbbbbbbbbbdk.',
    '.khmkmkmkmkmkmkmbdk.',
    '.khmkmkmkmkmkmkmbdk.',
    '..kbbbbbbbbbbbbbdk..',
    '...kddddddddddddk...',
    '....kkkkkkkkkkkk....',
  ],
  fr_kiln: [
    '..kk...kkkkkk...kk..',
    '.kmlk.khhhhhhk.kmlk.',
    '.kmmkkhbbbbbbdkkmmk.',
    '..kkhbbkkkkkkbbdkk..',
    '...khbkvvvvvvkbdk...',
    '...khbkvvvvvvkbdk...',
    '...khbbkkkkkkbbdk...',
    '..khbmkmkmkmkmkbdk..',
    '..khbmkmkmkmkmkbdk..',
    '...kbbbbbbbbbbbddk..',
    '....kddddddddddddk..',
    '.....kkkkkkkkkkkk...',
  ],
  fr_capacitor: [
    '.......kkkkkkkk.......',
    '..kk..khhhhhhhhk..kk..',
    '.kllk.khbbbbbbdk.kllk.',
    '.kmlk.khbkkkkbdk.klmk.',
    '.kllk.khkvvvvkdk.kllk.',
    '.kmlk.khkvvvvkdk.klmk.',
    '.kllk.khbkkkkbdk.kllk.',
    '.kmlk.khbbbbbbdk.klmk.',
    '..kk..kbbbbbbbdk..kk..',
    '.......kddddddk.......',
    '........kkkkkk........',
  ],
  fr_rampart: [
    '..kkkkkkkkkkkkkkkkkkkk..',
    '.khhhhhhhhhhhhhhhhhhhhk.',
    'khhbbbbbbbbbbbbbbbbbbddk',
    'khbmmbbbbbbbbbbbbbbmmbdk',
    'khbmmbbbbkkkkkkbbbbmmbdk',
    'khbmmbbbkvvvvvvkbbbmmbdk',
    'khbmmbbbkvvvvvvkbbbmmbdk',
    'khbmmbbbbkkkkkkbbbbmmbdk',
    'khbbbbbbbbbbbbbbbbbbbbdk',
    'khbllbbbbbbbbbbbbbbllbdk',
    '.kbbbbbbbbbbbbbbbbbbbddk',
    '..kddddddddddddddddddk..',
    '...kkkkkkkkkkkkkkkkkk...',
  ],
  fr_revenant: [
    '.k....kkkkkkkkkkkk....k.',
    '.kk..kkhhhhhhhhhhkk..kk.',
    '.khkkhbbbbbbbbbbbbdkkhk.',
    '..khbbbbbbbbbbbbbbbbdk..',
    '.khbbbbbkkkkkkkkbbbbbdk.',
    '.khbbbbkvvvvvvvvkbbbbdk.',
    '.khbbbbkvvvvvvvvkbbbbdk.',
    '.khbbbbbkkkkkkkkbbbbbdk.',
    '.khbbmmbbbbbbbbbbmmbbdk.',
    '..kbbbbbbbbbbbbbbbbbdk..',
    '...kddddddddddddddddk...',
    '....kkkkkkkkkkkkkkkk....',
  ],
  fr_conduit: [
    '......kkkkkkkk......',
    '.....khhhhhhhhk.....',
    '.kkk.khbbbbbbdk.kkk.',
    '.klk.khbkkkkbdk.klk.',
    '.kmk.khkvvvvkdk.kmk.',
    '.klkkkhkvvvvkdkkklk.',
    '.kmk.khbkkkkbdk.kmk.',
    '.klk.khbbbbbbdk.klk.',
    '.kkk..kbbbbbdk..kkk.',
    '.......kddddk.......',
    '........kkkk........',
  ],
  fr_reclaimer: [
    '.kk..kkkkkkkkkkkk..kk.',
    'kmmk.khhhhhhhhhhk.kmmk',
    'kmlkkhbbbbbbbbbbdkklmk',
    '.kkkhbbbkkkkkkbbbdkkk.',
    '...khbbkvvvvvvkbbdk...',
    '...khbbkvvvvvvkbbdk...',
    '...khbbbkkkkkkbbbdk...',
    '...khbbbbbbbbbbbbdk...',
    '...khbmmbbbbbbmmbdk...',
    '...khbbbbbbbbbbbbdk...',
    '....kbbbbbbbbbbbddk...',
    '.....kddddddddddkk....',
    '......kkkkkkkkkk......',
  ],
  fr_leviathan: [
    '..k....kkkkkkkkkkk....k..',
    '.khk.kkhhhhhhhhhhhkk.khk.',
    '.khkkhbbbbbbbbbbbbbdkkdk.',
    '.khhbbbbbbbbbbbbbbbbbddk.',
    'khbbbbbbbkkkkkkkkkbbbbbdk',
    'khbbbbbbkvvvvvvvvvkbbbbdk',
    'khbbbbbbkvvvvvvvvvkbbbbdk',
    'khbbbbbbbkkkkkkkkkbbbbbdk',
    'khbbmmmmbbbbbbbbbbbmmmbdk',
    'khbbbbbbbbbbbbbbbbbbbbbdk',
    'khbbmmmmbbbbbbbbbbbmmmbdk',
    '.kbbbbbbbbbbbbbbbbbbbbddk',
    '..kddddddddddddddddddddk.',
    '...kkkkkkkkkkkkkkkkkkkk..',
  ],
  fr_hauler: [
    '..kkkkkkkkkkkkkkkk..',
    '.khhhhhhhhhhhhhhhhk.',
    '.khbbbbbbbbbbbbbbdk.',
    '.khbbbkkkkkkkkbbbdk.',
    '.khbbkvvvvvvvvkbbdk.',
    '.khbbbkkkkkkkkbbbdk.',
    '.khbbbbbbbbbbbbbbdk.',
    'kkmmmmmbbbbbbmmmmmkk',
    'kllllmkbbbbbbkmllllk',
    'kmmmmmkbbbbbbkmmmmmk',
    '.kkkkkkddddddkkkkkk.',
  ],
  fr_warden: [
    '....kkkkkkkkkkkk....',
    '..kkhhhhhhhhhhhhkk..',
    '.khhbbbbbbbbbbbbddk.',
    'khhbbbbkkkkkkbbbbddk',
    'khbbbbkvvvvvvkbbbbdk',
    'khbbbbbkkkkkkbbbbbdk',
    'khbbbbbbbbbbbbbbbbdk',
    'khbbbmbbbbbbbbmbbbdk',
    '.khbbbmbbbbbbmbbbdk.',
    '..kbbbbmbbbbmbbbddk.',
    '...kbbbbbmmbbbbbdk..',
    '....kddddddddddkk...',
    '.....kkkkkkkkkk.....',
  ],
  fr_gunner: [
    '..kk..kkkkkkkk..kk..',
    '.kllk.khhhhhhk.kllk.',
    '.kllkkhbbbbbbhkkllk.',
    '.kmmkhbbbbbbbbdkmmk.',
    '.kkkhbbbkkkkbbbdkkk.',
    '...khbbkvvvvkbbdk...',
    '...khbbkvvvvkbbdk...',
    '...khbbbkkkkbbbdk...',
    '..kkhbbbbbbbbbbdkk..',
    '.kllkbbmmmmmmbbdkllk',
    '.kmmkbbbbbbbbbbdkmmk',
    '.kkkk.kddddddk.kkkk.',
    '......kkkkkkkk......',
  ],
  fr_zenith: [
    '.........kk.........',
    '........kyyk........',
    '.k.....kkyykk.....k.',
    '.kk..kkhhhhhhkk..kk.',
    '.khkkhbbbbbbbbhkkhk.',
    '..khbbbbbkkbbbbbdk..',
    '.khbbbbbkvvkbbbbbdk.',
    '.khbbbbbkvvkbbbbbdk.',
    '.khbbbbbbkkbbbbbbdk.',
    '.khbbmmbbbbbbmmbbdk.',
    '..kbbbbbbbbbbbbbbdk.',
    '...kddddddddddddk...',
    '....kkkkkkkkkkkk....',
  ],
};

// ---------- Battle legs (one per legs part) ----------

const LEGS = {
  lg_strider: [
    '....kkkkkkkkkkkk....',
    '....kmmmmmmmmmmk....',
    '....kkkmk..kmkkk....',
    '.....kllk..kllk.....',
    '.....kmmk..kmmk.....',
    '....kbbbk..kbbbk....',
    '.....kmmk..kmmk.....',
    '.....kllk..kllk.....',
    '....kmmmmk.kmmmmk...',
    '...kkkkkkk.kkkkkkk..',
  ],
  lg_hopper: [
    '.....kkkkkkkkkk.....',
    '.....kmmmmmmmmk.....',
    '......kmk..kmk......',
    '.....kmk....kmk.....',
    '....kbk......kbk....',
    '.....kmk....kmk.....',
    '......kmk..kmk......',
    '.......kk..kk.......',
    '......kmk..kmk......',
    '.....kkkk..kkkk.....',
  ],
  lg_treads: [
    '...kkkkkkkkkkkkkk...',
    '...kmmmmmmmmmmmmk...',
    '..kkkkkkkkkkkkkkkk..',
    '.kbbbbbbbbbbbbbbbbk.',
    'kbkkkkkkkkkkkkkkkkbk',
    'kkllkkllkkllkkllkkkk',
    'kkllkkllkkllkkllkkkk',
    'kbkkkkkkkkkkkkkkkkbk',
    '.kddddddddddddddddk.',
    '..kkkkkkkkkkkkkkkk..',
  ],
  lg_catapult: [
    '...kkkkkkkkkkkkkk...',
    '...kmmmmmmmmmmmmk...',
    '...kkmmk....kmmkk...',
    '....kllk....kllk....',
    '....kmmk....kmmk....',
    '...kbbbbk..kbbbbk...',
    '...kbkkbk..kbkkbk...',
    '...kbbbbk..kbbbbk...',
    '...kmmmmk..kmmmmk...',
    '..kkkkkkkkkkkkkkkk..',
  ],
  lg_jumpjets: [
    '....kkkkkkkkkkkk....',
    '..kkkmmmmmmmmmmkkk..',
    '.kbk..kmk..kmk..kbk.',
    '.kbk.kllk..kllk.kbk.',
    '.kmk.kbbk..kbbk.kmk.',
    '.kkk..kmk..kmk..kkk.',
    '......kmk..kmk......',
    '......kllk.kllk.....',
    '.....kmmmk.kmmmk....',
    '.....kkkkk.kkkkk....',
  ],
  lg_coil: [
    '....kkkkkkkkkkkk....',
    '....kmmmmmmmmmmk....',
    '.....kmk....kmk.....',
    '....kbbbk..kbbbk....',
    '.....kmk....kmk.....',
    '....kbbbk..kbbbk....',
    '.....kmk....kmk.....',
    '....kbbbk..kbbbk....',
    '....kmmmk..kmmmk....',
    '...kkkkkkkkkkkkkk...',
  ],
  lg_anchor: [
    '...kkkkkkkkkkkkkk...',
    '...kmmmmmmmmmmmmk...',
    '..kkmmk......kmmkk..',
    '..kllk........kllk..',
    '.kmmk..........kmmk.',
    '.kbbk..........kbbk.',
    'kmmk............kmmk',
    'kllk............kllk',
    'kmmmk..........kmmmk',
    'kkkkkk........kkkkkk',
  ],
  lg_thrusters: [
    '...kkkkkkkkkkkkkk...',
    '..kmmmmmmmmmmmmmmk..',
    '.kbbbbbbbbbbbbbbbbk.',
    '.kddddddddddddddddk.',
    '..kkmmkkkmmkkkmmkk..',
    '...kllk.kllk.kllk...',
    '...kmmk.kmmk.kmmk...',
    '...kkkk.kkkk.kkkk...',
    '....................',
    '....................',
  ],
  lg_skids: [
    '....kkkkkkkkkkkk....',
    '....kmmmmmmmmmmk....',
    '.....kmk....kmk.....',
    '.....klk....klk.....',
    '.....kmk....kmk.....',
    '....kbbbk..kbbbk....',
    '.....kmk....kmk.....',
    '..kkkkkkkk.kkkkkkkk.',
    '.kllllllllkllllllllk',
    '..kkkkkkkkkkkkkkkkk.',
  ],
  lg_bulwark: [
    '...kkkkkkkkkkkkkk...',
    '...kmmmmmmmmmmmmk...',
    '..kbbbbk....kbbbbk..',
    '..khbbdk....khbbdk..',
    '..kbbbbk....kbbbbk..',
    '..kmllmk....kmllmk..',
    '..khbbdk....khbbdk..',
    '..kbbbbk....kbbbbk..',
    '.kmmmmmmk..kmmmmmmk.',
    '.kkkkkkkk..kkkkkkkk.',
  ],
  lg_phase: [
    '.....kkkkkkkkkk.....',
    '.....kmmmmmmmmk.....',
    '......kbk..kbk......',
    '......kbk..kbk......',
    '.....kvk....kvk.....',
    '.....kbk....kbk.....',
    '......kbk..kbk......',
    '......kvk..kvk......',
    '.....kbbk..kbbk.....',
    '....kkkkk..kkkkk....',
  ],
  lg_pogo: [
    '....kkkkkkkkkkkk....',
    '....kmmmmmmmmmmk....',
    '.....kkmk..kmkk.....',
    '......kmk..kmk......',
    '.....kbbk..kbbk.....',
    '......kmk..kmk......',
    '.....kbbk..kbbk.....',
    '......kmk..kmk......',
    '.....kmmmk.kmmmk....',
    '.....kkkkk.kkkkk....',
  ],
  lg_quad: [
    '..kkkkkkkkkkkkkkkk..',
    '..kmmmmmmmmmmmmmmk..',
    '.kmkk.kmk..kmk.kkmk.',
    '.klk.kllk..kllk.klk.',
    '.kmk.kmmk..kmmk.kmk.',
    '.kbk.kbbk..kbbk.kbk.',
    '.kmk.kmmk..kmmk.kmk.',
    '.kllk.kllkkllk.kllk.',
    'kmmmk.kmmkkmmk.kmmmk',
    'kkkkk.kkkkkkkk.kkkkk',
  ],
  lg_greaves: [
    '...kkkkkkkkkkkkkk...',
    '...kmmmmmmmmmmmmk...',
    '..kbbbbk....kbbbbk..',
    '..khbbdk....khbbdk..',
    '..kbbbbk....kbbbbk..',
    '..kmllmk....kmllmk..',
    '..kbbbbk....kbbbbk..',
    '..kvvvvk....kvvvvk..',
    '.kmmmmmmk..kmmmmmmk.',
    '.kkkkkkkk..kkkkkkkk.',
  ],
  lg_piston: [
    '...kkkkkkkkkkkkkk...',
    '..kmmmmmmmmmmmmmmk..',
    '..kkmllmk..kmllmkk..',
    '...kmllmk..kmllmk...',
    '...kkllkk..kkllkk...',
    '....kllk....kllk....',
    '...kkllkk..kkllkk...',
    '..kbbbbbbk.kbbbbbbk.',
    '.kkbbbbbbkkkkbbbbbbk',
    '.kkkkkkkkkkkkkkkkkkk',
  ],
  lg_stalker: [
    '....kkkkkkkkkkkk....',
    '....kmmmmmmmmmmk....',
    '...kmkkk....kkkmk...',
    '..kmk..kk..kk..kmk..',
    '..kbk...kk.kk..kbk..',
    '.kmk.....kkk....kmk.',
    '.kbk............kbk.',
    '.kmk............kmk.',
    'kmmmk..........kmmmk',
    'kkkkk..........kkkkk',
  ],
};

// Nozzle rows (0-based) that flame while airborne
const FLAMES = { lg_jumpjets: { row: 5, cols: [2, 17] }, lg_thrusters: { row: 7, cols: [4, 5, 9, 10, 14, 15] } };

// ---------- Painting ----------

function mix(hex, amt) {
  const n = parseInt(hex.slice(1), 16);
  const t = amt > 0 ? 255 : 0;
  const k = Math.abs(amt);
  const ch = (s) => Math.round(((n >> s) & 255) + (t - ((n >> s) & 255)) * k);
  return `#${[16, 8, 0].map((s) => ch(s).toString(16).padStart(2, '0')).join('')}`;
}

function paintGrid(g, grid, pal, ox = 0, oy = 0) {
  grid.forEach((row, y) => {
    for (let x = 0; x < row.length; x++) {
      const c = pal[row[x]];
      if (!c) continue;
      g.fillStyle = c;
      g.fillRect(ox + x, oy + y, 1, 1);
    }
  });
}

function palette(color, dark, flash, visor = VISOR) {
  if (flash) return { k: INK, b: '#f4f4f4', h: '#ffffff', d: '#c2c3c7', v: '#ffffff', m: '#e0e0e0', l: '#ffffff' };
  return { k: INK, b: color, h: mix(color, 0.3), d: dark || mix(color, -0.4), v: visor, m: METAL, l: METAL_LIGHT };
}

/** Plating modules show on the torso: which look each one bolts on. */
const ARMOR_LOOK = {
  md_plating: 'ar_scrap', md_physres: 'ar_kevlar', md_heatres: 'ar_kevlar', md_elecres: 'ar_kevlar',
  md_heavyplate: 'ar_reactive', md_composite: 'ar_reactive', md_insulated: 'ar_reactive', md_aegis: 'ar_aegis',
  md_titanplate: 'ar_titanium', md_voidcore: 'ar_void',
  md_reboundplate: 'ar_reactive', md_wardmesh: 'ar_titanium',
};
const LOOK_RANK = ['md_plating', 'md_physres', 'md_heatres', 'md_elecres', 'md_heavyplate', 'md_insulated', 'md_composite', 'md_reboundplate', 'md_aegis', 'md_titanplate', 'md_wardmesh', 'md_voidcore'];

/** Armor bolted onto the torso: pads, bands or rivets by plating module. */
function paintArmor(g, armorId, w, h, flash) {
  const part = armorId && getPart(armorId);
  if (!part) return;
  const c = flash ? '#f4f4f4' : part.color || rarityColor(part.rarity);
  const hi = flash ? '#ffffff' : mix(c, 0.35);
  const lo = flash ? '#c2c3c7' : mix(c, -0.35);
  const box = (x, y, bw, bh) => {
    g.fillStyle = INK;
    g.fillRect(x, y, bw, bh);
    g.fillStyle = c;
    g.fillRect(x + 1, y + 1, bw - 2, bh - 2);
    g.fillStyle = hi;
    g.fillRect(x + 1, y + 1, bw - 2, 1);
    g.fillStyle = lo;
    g.fillRect(x + 1, y + bh - 2, bw - 2, 1);
  };
  switch (ARMOR_LOOK[armorId]) {
    case 'ar_scrap':
      g.fillStyle = METAL_LIGHT;
      for (const [x, y] of [[4, 3], [w - 6, 4], [5, h - 4], [w - 7, h - 5]]) g.fillRect(x, y, 2, 2);
      break;
    case 'ar_kevlar':
      g.fillStyle = flash ? '#c2c3c7' : '#333c57';
      g.fillRect(3, h - 5, w - 6, 1);
      g.fillRect(3, h - 7, w - 6, 1);
      break;
    case 'ar_reactive':
      box(0, 2, 5, 5);
      box(w - 5, 2, 5, 5);
      break;
    case 'ar_aegis':
      box(0, 1, 5, 6);
      box(w - 5, 1, 5, 6);
      g.fillStyle = flash ? '#ffffff' : '#a7f070';
      g.fillRect(1, 0, 3, 1);
      g.fillRect(w - 4, 0, 3, 1);
      break;
    case 'ar_titanium':
      box(0, 1, 6, 7);
      box(w - 6, 1, 6, 7);
      box(Math.floor(w / 2) - 3, h - 5, 6, 4);
      break;
    case 'ar_void':
      box(0, 0, 6, 8);
      box(w - 6, 0, 6, 8);
      g.fillStyle = flash ? '#ffffff' : '#ff5d73';
      g.fillRect(2, 3, 2, 2);
      g.fillRect(w - 4, 3, 2, 2);
      break;
    default:
      break;
  }
}

const cache = new Map();

/** Drop the cached canvases (the browser may blank them after a long time in the background). */
export function clearMechSpriteCache() {
  cache.clear();
}

/** The frame / armor a ball carries (parts list from Mech.withMech / enemyMech). */
export function mechLook(ball) {
  const parts = ball.parts || [];
  const frame = parts.find((id) => getPart(id)?.type === 'frame') || 'fr_scout';
  // The best plating module shows (older snapshots may still list armor ids)
  const armor = [...parts].filter((id) => ARMOR_LOOK[id]).sort((a, b) => LOOK_RANK.indexOf(b) - LOOK_RANK.indexOf(a))[0] || null;
  return { frame: TORSOS[frame] ? frame : 'fr_scout', armor };
}

/** Torso canvas for a frame + armor in a paint job (cached). Enemies get a red visor. */
export function torsoCanvas(frame, armor, color, dark, flash = false, visor = null) {
  const key = `t|${frame}|${armor}|${color}|${dark}|${flash ? 1 : 0}|${visor}`;
  let c = cache.get(key);
  if (c) return c;
  const grid = TORSOS[frame] || TORSOS.fr_scout;
  c = document.createElement('canvas');
  c.width = grid[0].length;
  c.height = grid.length;
  const g = c.getContext('2d');
  paintGrid(g, grid, palette(color, dark, flash, visor || VISOR));
  paintArmor(g, armor, c.width, c.height, flash);
  cache.set(key, c);
  return c;
}

/** Legs canvas for a legs part in a paint job (cached). `flame` lights the jets. */
export function legsCanvas(legsId, color, dark, flame = false) {
  const id = LEGS[legsId] ? legsId : 'lg_strider';
  const key = `l|${id}|${color}|${dark}|${flame ? 1 : 0}`;
  let c = cache.get(key);
  if (c) return c;
  const grid = LEGS[id];
  c = document.createElement('canvas');
  c.width = grid[0].length;
  c.height = grid.length + 2;
  const g = c.getContext('2d');
  paintGrid(g, grid, palette(color, dark, false));
  const f = FLAMES[id];
  if (flame && f) {
    for (const x of f.cols) {
      g.fillStyle = '#ffcd75';
      g.fillRect(x, f.row + 1, 1, 2);
      g.fillStyle = '#ef7d57';
      g.fillRect(x, f.row + 3, 1, 1);
    }
  }
  cache.set(key, c);
  return c;
}

/** Whole mech (legs + torso) as a data URL, for the Rig screen. */
export function mechDataUrl(partIds, color, dark) {
  const { frame, armor } = mechLook({ parts: partIds });
  const legsId = partIds.find((id) => getPart(id)?.type === 'legs') || 'lg_strider';
  const t = torsoCanvas(frame, armor, color, dark);
  const l = legsCanvas(legsId, color, dark);
  const c = document.createElement('canvas');
  c.width = Math.max(t.width, l.width);
  c.height = t.height + l.height - 3;
  const g = c.getContext('2d');
  g.drawImage(l, Math.round((c.width - l.width) / 2), t.height - 3);
  g.drawImage(t, Math.round((c.width - t.width) / 2), 0);
  return c.toDataURL();
}
