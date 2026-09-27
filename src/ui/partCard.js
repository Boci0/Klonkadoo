// ============================================================
// partCard — one way to show a part everywhere: the Rig, pods and the
// battle. Icons first, few words: an icon card for a part (name, tier
// dots, level, kg, stat chips, range bar, one note line), and a hover
// tooltip that follows the mouse (tap-and-hold on phones).
// ============================================================

import { CONFIG } from '../config.js';
import {
  getPart, partChips, partNote, rarityColor, rarityName, TYPE_LABEL, reachLabel,
  tierRange, tierOf, maxLevel, RARITY_ORDER, LANE_SIZE, DTYPES, DTYPE_KEYS,
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

// ---------- Hover tooltip ----------

let tipEl = null;
let holdTimer = 0;

function tip() {
  if (!tipEl) {
    tipEl = document.createElement('div');
    tipEl.className = 'part-tip hidden';
    document.body.appendChild(tipEl);
  }
  return tipEl;
}

/** Show `html` in the floating tooltip near (x, y). */
export function showTip(html, x, y) {
  const el = tip();
  el.innerHTML = html;
  el.classList.remove('hidden');
  const r = el.getBoundingClientRect();
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  let left = x + 16;
  let top = y + 12;
  if (left + r.width > vw - 8) left = Math.max(8, x - r.width - 16);
  if (top + r.height > vh - 8) top = Math.max(8, vh - r.height - 8);
  el.style.left = `${left}px`;
  el.style.top = `${top}px`;
}

export function hideTip() {
  clearTimeout(holdTimer);
  tipEl?.classList.add('hidden');
}

/**
 * Hover (mouse) or press-and-hold (touch) any element under `root` that
 * matches `selector` to see `htmlFor(el)` in the tooltip.
 */
export function bindHoverTips(root, selector, htmlFor) {
  root.addEventListener('mouseover', (e) => {
    const el = e.target.closest?.(selector);
    if (!el || !root.contains(el)) return;
    const html = htmlFor(el);
    if (html) showTip(html, e.clientX, e.clientY);
  });
  root.addEventListener('mousemove', (e) => {
    const el = e.target.closest?.(selector);
    if (!el || tipEl?.classList.contains('hidden')) return;
    showTip(tipEl.innerHTML, e.clientX, e.clientY);
  });
  root.addEventListener('mouseout', (e) => {
    const el = e.target.closest?.(selector);
    if (el && !el.contains(e.relatedTarget)) hideTip();
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
