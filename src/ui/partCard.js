// ============================================================
// partCard — one way to show a part everywhere: the Rig, pods and the
// battle. Icons first, few words: an icon card for a part (name, tier
// dots, level, kg, stat chips, range bar, one note line), and a hover
// tooltip that follows the mouse (tap-and-hold on phones).
// ============================================================

import { CONFIG } from '../config.js';
import {
  getPart, partChips, partNote, rarityColor, rarityName, TYPE_LABEL, reachLabel,
  tierRange, tierOf, maxLevel, RARITY_ORDER, LANE_SIZE, DTYPES, DTYPE_KEYS, dtypeOf, dmgLabel,
} from '../meta/Mech.js';
import { ico, partIcon } from '../rendering/pixelIcons.js';

const REACH_MAX = LANE_SIZE - 1;

/** One stat chip: icon + value, its meaning in the tooltip. */
export const chipHtml = (c) => `<span class="pchip"${c.tip ? ` title="${c.tip}"` : ''}${c.color ? ` style="--c:${c.color}"` : ''}>${ico(c.icon)}${c.text}</span>`;

/** Tier dots: filled up to the tier the part is at, hollow up to its highest. */
export function tierDots(owned) {
  const p = getPart(owned.id);
  const [lo, hi] = tierRange(p).map((r) => RARITY_ORDER.indexOf(r));
  const now = RARITY_ORDER.indexOf(tierOf(owned));
  let out = '';
  for (let i = lo; i <= hi; i++) out += `<i class="${i <= now ? 'on' : ''}" style="--c:${rarityColor(RARITY_ORDER[i])}" title="${rarityName(RARITY_ORDER[i])}"></i>`;
  return `<span class="tdots">${out}</span>`;
}

/** The range band of a gun on the lane. */
export function rangeBar(p) {
  if (!p.reach) return '';
  return `<div class="rig-range" title="Hits ${reachLabel(p.reach)} positions away">
      ${ico('range')}<div class="rig-range-bar"><i style="left:${((p.reach[0] - 1) / REACH_MAX) * 100}%;width:${((p.reach[1] - p.reach[0] + 1) / REACH_MAX) * 100}%;--c:${p.color || '#f4f4f4'}"></i></div>
      <span>${reachLabel(p.reach)}</span>
    </div>`;
}

/**
 * The icon card for an owned part ({ id, level, tier }).
 * `extra` html goes under the chips (buttons, compare rows).
 */
export function partCardHtml(owned, { extra = '', note = true } = {}) {
  const p = getPart(owned.id);
  if (!p) return '';
  const tier = tierOf(owned);
  const col = rarityColor(tier);
  const text = note ? partNote(p) : '';
  return `<div class="pcard" style="--rar:${col}">
      <div class="pcard-head">
        <img src="${partIcon(p.id)}" alt="">
        <div>
          <strong>${p.name}</strong>
          <span>${tierDots(owned)}<em>${TYPE_LABEL[p.type]}</em><em title="Level">LV ${owned.level || 1}/${maxLevel(owned)}</em>${p.weight ? `<em title="Weight">${ico('load')}${p.weight}</em>` : ''}</span>
        </div>
      </div>
      <div class="rig-chips">${partChips(owned).map(chipHtml).join('')}</div>
      ${rangeBar(p)}
      ${text ? `<p class="rig-note">${text}</p>` : ''}
      ${extra}
    </div>`;
}

/**
 * The mech stat bar: load meter plus HP / energy / regen / heat / cooling /
 * resists as icons. `next` (another loadoutTotals) shows green / red changes.
 */
export function statBarHtml(t, next = null) {
  const G = CONFIG.gear;
  const hpBase = CONFIG.run.maxHpBase;
  const rows = [
    ['hp', 'HP', (x) => Math.round(hpBase + x.hp), '#ff5d73'],
    ['energy', 'Energy pool', (x) => x.energy, DTYPES.energy.color],
    ['regen', 'Energy regen per turn', (x) => x.regen, DTYPES.energy.color],
    ['heat', 'Heat cap', (x) => x.heatCap, DTYPES.heat.color],
    ['cool', 'Cooling per turn', (x) => x.cool, '#73eff7'],
    ...DTYPE_KEYS.map((k) => ['def', `${DTYPES[k].name} resist`, (x) => Math.round((x.def + x.res[k]) * 10) / 10, DTYPES[k].color]),
  ];
  const delta = (a, b) => {
    const d = Math.round((b - a) * 10) / 10;
    return d ? `<em class="${d > 0 ? 'up' : 'down'}">${d > 0 ? '+' : ''}${d}</em>` : '';
  };
  const stats = rows.map(([icon, tip, f, c]) => `<span class="rstat" title="${tip}" style="--c:${c}">${ico(icon)}<b>${f(t)}</b>${next ? delta(f(t), f(next)) : ''}</span>`).join('');
  // Load: one meter to the cap, the overweight margin in red after it
  const w = next ? next.weight : t.weight;
  const pct = Math.min(100, (w / t.capacity) * 100);
  const over = Math.max(0, w - t.capacity);
  const state = over > G.overweightMax ? 'over' : over > 0 ? 'heavy' : '';
  const loadTip = over > G.overweightMax ? `Over the limit by ${over - G.overweightMax} kg: you can't deploy` : over > 0 ? `${over} kg over: -${over * G.overweightHp} HP` : `${t.capacity - w} kg free`;
  return `<div class="rig-statbar">
      <div class="rig-load ${state}" title="${loadTip}">
        ${ico('load')}<div class="rig-meter"><i style="width:${pct}%"></i></div>
        <b>${w}<small>/${t.capacity}</small></b>${next && next.weight !== t.weight ? delta(t.weight, next.weight).replace('up', 'kg-up').replace('down', 'kg-down') : ''}
        ${over > 0 ? `<em class="rig-warn">${over > G.overweightMax ? `${ico('lock')}+${over}` : `${ico('hp')}-${over * G.overweightHp}`}</em>` : ''}
      </div>
      <div class="rig-stats">${stats}</div>
    </div>`;
}

/**
 * A part as it is in this fight (live object from the battle: enemy guns
 * carry their own damage, ammo and uses left). Same look as partCardHtml.
 */
export function battlePartHtml(w) {
  const p = getPart(w.id) || w;
  const t = DTYPES[dtypeOf(w)];
  const C = [];
  const add = (cond, icon, text, tip, color) => { if (cond) C.push({ icon, text, tip, color }); };
  add(w.type === 'weapon', w.mount === 'top' ? 'top' : 'side', w.mount === 'top' ? 'TOP' : 'SIDE', 'Mount');
  add(w.dmg && !w.drone, t.icon, dmgLabel(w.dmg), `${t.name} damage per hit`, t.color);
  add(w.fx?.burst, 'ammo', `x${w.fx?.burst}`, 'Hits per shot');
  add(w.reach, 'range', w.reach ? reachLabel(w.reach) : '', 'Range (positions)');
  add(w.en, 'energy', `${w.en}`, 'Energy per use', DTYPES.energy.color);
  add(w.heat, 'heat', `${w.heat}`, 'Heat per use', DTYPES.heat.color);
  add(w.ammo, 'ammo', `${w.ammoLeft ?? w.ammo}/${w.ammo}`, 'Shots left', '#ffcd75');
  add(w.uses, 'ammo', `${w.usesLeft ?? w.uses}/${w.uses}`, 'Uses left', '#ffcd75');
  add(w.backfire, 'backfire', `-${Math.round(w.backfire || 0)}`, 'Backfire: HP it costs its user', '#ff5d73');
  for (const [k, v] of Object.entries(w.fx?.resDrain || {})) add(true, 'resdrain', `-${v}`, `Strips ${DTYPES[k].name} resist`, DTYPES[k].color);
  add(w.fx?.corrode, 'resdrain', `-${w.fx?.corrode}`, 'Strips PHYSICAL resist', DTYPES.phys.color);
  add(w.fx?.drain, 'drain', `${w.fx?.drain}`, 'Drains energy', DTYPES.energy.color);
  add(w.fx?.heat, 'heat', `+${w.fx?.heat}`, 'Heat into the target', DTYPES.heat.color);
  add(w.fx?.push, 'push', `${w.fx?.push}`, 'Knocks back');
  add(w.fx?.pull, 'pull', `${w.fx?.pull}`, 'Pulls in');
  add(w.fx?.pierce, 'pierce', '', 'Ignores resists');
  add(w.arc, 'arc', '', 'Lobbed: flies over cover');
  // Drones and specials
  add(p.type === 'drone' && w.dmg, t.icon, dmgLabel(w.dmg || 0), `${t.name} damage every turn, any range`, t.color);
  add(w.heal, 'heal', `+${Math.round(w.heal || 0)}`, 'Repair every turn', '#a7f070');
  add(w.forcefieldEvery, 'def', `1/${w.forcefieldEvery}`, 'Forcefield every few turns', '#a7f070');
  add(w.ram, 'dmg', `${Math.round(w.ram || 0)}`, 'Ram damage');
  add(w.range && w.special === 'hook', 'range', `2-${w.range}`, 'Hook range');
  add(w.dist, 'move', `${w.dist}`, 'Dash distance');
  const note = partNote(p);
  const state = p.type === 'drone' ? (w.off ? 'DOCKED' : 'DEPLOYED') : TYPE_LABEL[p.type] || '';
  return `<div class="pcard" style="--rar:${rarityColor(p.rarity)}">
      <div class="pcard-head">
        <img src="${partIcon(w.id)}" alt="">
        <div><strong>${w.name}</strong><span><em>${state}</em></span></div>
      </div>
      <div class="rig-chips">${C.map(chipHtml).join('')}</div>
      ${w.reach ? rangeBar(w) : ''}
      ${note ? `<p class="rig-note">${note}</p>` : ''}
    </div>`;
}

// ---------- Icon key ----------

/** Every stat symbol and what it means (the Almanac ICONS tab, the Rig's ? button). */
export const ICON_KEY = [
  ['range', 'RANGE', 'How far a gun reaches, in lane positions (1 = right next to you)'],
  ['dmg', 'PHYSICAL', 'Physical damage per hit (the hit rolls between the two numbers)'],
  ['heat', 'HEAT', 'Explosive damage, the heat a shot adds to you, or your heat cap'],
  ['energy', 'ENERGY', 'Electric damage, the energy a shot costs, or your energy pool'],
  ['regen', 'REGEN', 'Energy you get back each turn'],
  ['cool', 'COOLING', 'Heat you lose each turn (VENT cools twice as much)'],
  ['hp', 'HP', 'Health. Going over the weight cap costs some'],
  ['def', 'RESIST', 'Cuts damage of its colour\'s type (white = all types)'],
  ['load', 'WEIGHT', 'Kilograms. Every mech carries up to 1000'],
  ['side', 'SIDE GUN', 'Fits the 4 side slots'],
  ['top', 'TOP GUN', 'Heavy or lobbed: fits the 2 top slots'],
  ['ammo', 'AMMO / USES', 'Shots or uses per battle; on guns "x3" = hits per shot'],
  ['arc', 'LOBBED', 'Flies over cover'],
  ['pierce', 'PIERCE', 'Ignores resists'],
  ['backfire', 'BACKFIRE', 'HP each shot costs you'],
  ['resdrain', 'STRIP', 'Takes away the target\'s resist for the rest of the fight'],
  ['drain', 'DRAIN', 'Burns the target\'s energy; past zero it hits HP'],
  ['push', 'KNOCKBACK', 'Pushes the target away (into the edge: it slams)'],
  ['pull', 'PULL', 'Drags the target toward you'],
  ['stomp', 'STOMP', 'Legs kick a mech right next to you and knock it back'],
  ['move', 'MOVE', 'How far the legs walk / jump, or how far a charge dashes'],
  ['heal', 'REPAIR', 'HP restored'],
  ['star', 'CRIT', 'Chance for a 1.75x hit'],
  ['gun', 'GUN BONUS', 'Extra damage on all your guns'],
  ['gold', 'GOLD', 'More gold from fights'],
  ['lock', 'LOCKED', 'Anchored (can\'t move), or one per mech'],
];

export function iconKeyHtml() {
  return `<div class="icon-key">${ICON_KEY.map(([icon, name, text]) => `<div class="icon-key-row">${ico(icon)}<b>${name}</b><span>${text}</span></div>`).join('')}</div>`;
}

// ---------- Hover tooltip ----------

let tipEl = null;
let tipOwner = null; // the element the tooltip is showing
let tipW = 0;
let tipH = 0;
let holdTimer = 0;

function tip() {
  if (!tipEl) {
    tipEl = document.createElement('div');
    tipEl.className = 'part-tip hidden';
    document.body.appendChild(tipEl);
  }
  return tipEl;
}

/** Put the tooltip next to (x, y), kept on screen. Cheap: no re-render, no layout read. */
function moveTip(x, y) {
  if (!tipEl) return;
  let left = x + 16;
  let top = y + 12;
  if (left + tipW > window.innerWidth - 8) left = Math.max(8, x - tipW - 16);
  if (top + tipH > window.innerHeight - 8) top = Math.max(8, window.innerHeight - tipH - 8);
  tipEl.style.transform = `translate(${Math.round(left)}px, ${Math.round(top)}px)`;
}

/** Show `html` in the floating tooltip near (x, y). */
export function showTip(html, x, y) {
  const el = tip();
  if (html == null) return moveTip(x, y); // same card: just follow the mouse
  el.innerHTML = html;
  el.classList.remove('hidden');
  tipW = el.offsetWidth; // measured once per card, not per mouse move
  tipH = el.offsetHeight;
  moveTip(x, y);
}

export function hideTip() {
  clearTimeout(holdTimer);
  tipOwner = null;
  tipEl?.classList.add('hidden');
}

/**
 * Hover (mouse) or press-and-hold (touch) any element under `root` that
 * matches `selector` to see `htmlFor(el)` in the tooltip. The card is built
 * once per element you hover; moving the mouse only moves it.
 */
export function bindHoverTips(root, selector, htmlFor) {
  root.addEventListener('mouseover', (e) => {
    const el = e.target.closest?.(selector);
    if (!el || !root.contains(el) || el === tipOwner) return;
    const html = htmlFor(el);
    if (!html) return;
    tipOwner = el;
    showTip(html, e.clientX, e.clientY);
  });
  root.addEventListener('mousemove', (e) => {
    if (tipOwner && tipOwner.contains(e.target)) moveTip(e.clientX, e.clientY);
  });
  root.addEventListener('mouseout', (e) => {
    const el = e.target.closest?.(selector);
    if (el && el === tipOwner && !el.contains(e.relatedTarget)) hideTip();
  });
  root.addEventListener('touchstart', (e) => {
    const el = e.target.closest?.(selector);
    if (!el) return;
    const t = e.touches[0];
    clearTimeout(holdTimer);
    holdTimer = setTimeout(() => {
      const html = htmlFor(el);
      if (html) showTip(html, t.clientX, t.clientY - 80);
    }, 380);
  }, { passive: true });
  root.addEventListener('touchend', () => setTimeout(hideTip, 1400), { passive: true });
  root.addEventListener('touchmove', () => clearTimeout(holdTimer), { passive: true });
}
