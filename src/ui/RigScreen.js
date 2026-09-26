// ============================================================
// RigScreen — full-screen loadout + supply pods.
//
// Left: the "bay", a live pixel scene of your ball wearing its
// parts (guns on the flanks, armor ring, orbiting drone, frame as
// the pedestal) with the seven slot tiles around it. Right: the
// parts that fit the selected slot as icon tiles, plus a detail
// card for the focused part. The PODS tab opens supply pods.
// ============================================================

import { saveSystem } from '../meta/SaveSystem.js';
import { soundEngine } from '../utils/SoundEngine.js';
import { haptics } from '../platform/haptics.js';
import { BALLS, skinColors } from '../meta/Balls.js';
import { paintBall, CLASS_PATTERN } from '../rendering/ballSprite.js';
import { partIcon, partCanvas, ico, uiIcon } from '../rendering/pixelIcons.js';
import {
  SLOTS, PARTS, CRATES, getPart, partChips, partNote, TYPE_LABEL, rarityColor, rarityName,
  upgradeCost, salvageValue, loadoutTotals, MAX_LEVEL, INVENTORY_CAP,
} from '../meta/Mech.js';

const RANK = { common: 0, rare: 1, epic: 2, legendary: 3, mythic: 4 };
const RANGE_MAX = 1400;
// Where each slot tile sits around the bay
const LEFT = ['weapon1', 'armor', 'module1'];
const RIGHT = ['weapon2', 'drone', 'module2'];

export class RigScreen {
  constructor({ onBack }) {
    this.el = document.getElementById('screen-rig');
    this.body = document.getElementById('rig-body');
    this.wallet = document.getElementById('rig-wallet');
    this.tab = 'loadout';
    this.slot = 'weapon1';
    this.focus = null; // uid of the part shown in the detail card
    document.getElementById('btn-rig-back').addEventListener('click', () => {
      soundEngine.playUI();
      this.stop();
      onBack();
    });
    this.el.querySelectorAll('[data-rtab]').forEach((b) => b.addEventListener('click', () => {
      soundEngine.playUI();
      this.tab = b.dataset.rtab;
      this.render();
    }));
  }

  show(opts = {}) {
    if (opts.tab) this.tab = opts.tab;
    this.render();
  }

  stop() {
    cancelAnimationFrame(this._raf);
    this._raf = 0;
  }

  render() {
    this.stop();
    this._renderWallet();
    this.el.querySelectorAll('[data-rtab]').forEach((b) => b.classList.toggle('on', b.dataset.rtab === this.tab));
    if (this.tab === 'pods') this._renderPods();
    else this._renderLoadout();
  }

  _renderWallet() {
    const m = saveSystem.getMech();
    this.wallet.innerHTML = `<span title="Keys">${ico('key')}<b>${m.tokens}</b></span><span title="Scrap">${ico('scrap')}<b>${m.scrap}</b></span>`;
  }

  // ---------- Loadout ----------

  _renderLoadout() {
    const m = saveSystem.getMech();
    const parts = saveSystem.getLoadoutParts();
    const t = loadoutTotals(parts);
    const bySlot = Object.fromEntries(SLOTS.map((s, i) => [s.id, parts[i]]));

    const tile = (slotId) => {
      const slot = SLOTS.find((s) => s.id === slotId);
      const owned = bySlot[slotId];
      const p = owned && getPart(owned.id);
      return `<button class="rig-slot ${slotId === this.slot ? 'sel' : ''} ${p ? '' : 'empty'}" data-slot="${slotId}" style="--rar:${p ? rarityColor(p.rarity) : 'var(--p-steel)'}">
        ${p ? `<img src="${partIcon(p.id)}" alt=""><i class="rig-lv">${owned.level}</i>` : '<span class="rig-plus">+</span>'}
        <span class="rig-slot-name">${slot.name}</span>
      </button>`;
    };

    // Load meter: one block per 4 capacity, red past the limit
    const blocks = Math.max(10, Math.ceil(t.capacity / 4));
    const used = Math.ceil(t.weight / 4);
    const meter = Array.from({ length: Math.max(blocks, used) }, (_, i) => `<i class="${i < used ? (i >= blocks ? 'over' : 'on') : ''}"></i>`).join('');

    this.body.innerHTML = `
      <div class="rig-bay">
        <div class="rig-col">${LEFT.map(tile).join('')}</div>
        <div class="rig-stage">
          <canvas id="rig-canvas" width="72" height="54"></canvas>
          ${tile('frame')}
        </div>
        <div class="rig-col">${RIGHT.map(tile).join('')}</div>
        <div class="rig-load ${t.overweight ? 'over' : ''}">
          ${ico('load')}<div class="rig-meter">${meter}</div><b>${t.weight}/${t.capacity}</b>
        </div>
        <div class="rig-totals">
          <span>${ico('hp')}+${Math.round(t.hp)}</span><span>${ico('def')}+${t.def.toFixed(1)}</span><span>${ico('gun')}${t.weapons.length}</span>${t.drones.length ? `<span>${ico('star')}${t.drones.length}</span>` : ''}
          ${t.overweight ? '<em class="rig-warn">OVERLOADED</em>' : ''}
        </div>
      </div>
      <div class="rig-side" id="rig-side"></div>`;

    this.body.querySelectorAll('[data-slot]').forEach((b) => b.addEventListener('click', () => {
      soundEngine.play('select');
      this.slot = b.dataset.slot;
      this.focus = null;
      this._renderLoadout();
    }));
    this._renderSide(m, bySlot, t);
    this._startBay(bySlot, t);
  }

  _renderSide(m, bySlot, t) {
    const side = document.getElementById('rig-side');
    const slot = SLOTS.find((s) => s.id === this.slot);
    const inSlot = bySlot[this.slot];
    const worn = new Set(Object.values(m.loadout));
    const fits = m.owned.filter((o) => getPart(o.id)?.type === slot.type)
      .sort((a, b) => (b.uid === inSlot?.uid) - (a.uid === inSlot?.uid) || RANK[getPart(b.id).rarity] - RANK[getPart(a.id).rarity] || b.level - a.level);
    if (!fits.some((o) => o.uid === this.focus)) this.focus = inSlot?.uid || fits[0]?.uid || null;

    const tiles = fits.map((o) => {
      const p = getPart(o.id);
      const mark = o.uid === inSlot?.uid ? '<i class="rig-mark here">&#10003;</i>' : worn.has(o.uid) ? '<i class="rig-mark">&#9679;</i>' : '';
      return `<button class="rig-item ${o.uid === this.focus ? 'sel' : ''}" data-uid="${o.uid}" style="--rar:${rarityColor(p.rarity)}">
        <img src="${partIcon(p.id)}" alt=""><i class="rig-lv">${o.level}</i>${mark}
      </button>`;
    }).join('');

    side.innerHTML = `
      <div class="rig-side-head"><b>${slot.name}</b><span>${fits.length}</span></div>
      <div class="rig-inv">${tiles || `<p class="rig-empty">${ico('pod', '#41a6f6')} Open pods to find ${TYPE_LABEL[slot.type].toLowerCase()}s</p>`}</div>
      <div class="rig-detail" id="rig-detail"></div>`;

    side.querySelectorAll('[data-uid]').forEach((b) => b.addEventListener('click', () => {
      soundEngine.play('select');
      this.focus = b.dataset.uid;
      this._renderSide(m, bySlot, t);
    }));
    this._renderDetail(m, bySlot, t, worn);
  }

  _renderDetail(m, bySlot, t, worn) {
    const box = document.getElementById('rig-detail');
    const owned = this.focus && saveSystem.getOwnedPart(this.focus);
    if (!owned) {
      box.innerHTML = '';
      return;
    }
    const p = getPart(owned.id);
    const inThis = bySlot[this.slot]?.uid === owned.uid;
    const current = bySlot[this.slot];
    // Load after equipping this part here
    const after = t.weight - (current ? getPart(current.id).weight || 0 : 0) + (p.weight || 0)
      - (!inThis && worn.has(owned.uid) ? p.weight || 0 : 0);
    const capAfter = p.type === 'frame' ? p.capacity : t.capacity;
    const tooHeavy = !inThis && after > capAfter;
    const cost = upgradeCost(owned);
    const maxed = owned.level >= MAX_LEVEL;
    const range = p.range ? `<div class="rig-range" title="Range ${p.range[0]}-${p.range[1]}">
        ${ico('range')}<div class="rig-range-bar"><i style="left:${(p.range[0] / RANGE_MAX) * 100}%;width:${((Math.min(p.range[1], RANGE_MAX) - p.range[0]) / RANGE_MAX) * 100}%;--c:${p.color}"></i></div>
        <span>${p.range[1] >= RANGE_MAX ? 'ANY' : p.range[0] ? 'FAR' : 'NEAR'}</span>
      </div>` : '';
    const note = partNote(p);

    box.innerHTML = `
      <div class="rig-detail-head" style="--rar:${rarityColor(p.rarity)}">
        <img src="${partIcon(p.id)}" alt="">
        <div><strong>${p.name}</strong><span>${rarityName(p.rarity)} ${TYPE_LABEL[p.type]} · LV ${owned.level}${p.weight ? ` · ${ico('load')}${p.weight}` : ''}</span></div>
      </div>
      <div class="rig-chips">${partChips(owned).map((c) => `<span>${ico(c.icon)}${c.text}</span>`).join('')}</div>
      ${range}
      ${note ? `<p class="rig-note">${note}</p>` : ''}
      <div class="rig-actions">
        ${inThis
          ? (this.slot === 'frame' ? '<button class="btn btn-disabled" disabled>EQUIPPED</button>' : '<button class="btn btn-outline" data-act="unequip">REMOVE</button>')
          : `<button class="btn ${tooHeavy ? 'btn-outline' : 'btn-accent'}" data-act="equip">${tooHeavy ? 'TOO HEAVY' : 'EQUIP'}</button>`}
        <button class="btn ${!maxed && m.scrap >= cost ? 'btn-primary' : 'btn-disabled'}" data-act="upgrade" ${maxed || m.scrap < cost ? 'disabled' : ''}>${maxed ? 'MAX' : `LV+ ${ico('scrap')}${cost}`}</button>
        <button class="btn ${worn.has(owned.uid) ? 'btn-disabled' : 'btn-danger'}" data-act="salvage" ${worn.has(owned.uid) ? 'disabled' : ''}>${ico('scrap')}+${salvageValue(owned)}</button>
      </div>`;

    box.querySelectorAll('[data-act]').forEach((b) => b.addEventListener('click', () => {
      const act = b.dataset.act;
      // Equipping an overweight part is allowed (you just can't deploy), the label warns first
      const ok = act === 'equip' ? saveSystem.equipPart(this.slot, owned.uid)
        : act === 'unequip' ? saveSystem.unequipSlot(this.slot)
          : act === 'upgrade' ? saveSystem.upgradePart(owned.uid)
            : saveSystem.salvagePart(owned.uid) > 0;
      soundEngine.play(ok ? 'confirm' : 'error');
      if (ok && act !== 'salvage') haptics.impact('light');
      if (act === 'salvage') this.focus = null;
      const scroll = this.body.querySelector('.rig-inv')?.scrollTop || 0;
      this.render();
      const inv = this.body.querySelector('.rig-inv');
      if (inv) inv.scrollTop = scroll;
    }));
  }

  // ---------- Bay animation ----------

  _startBay(bySlot, t) {
    const canvas = document.getElementById('rig-canvas');
    if (!canvas) return;
    const g = canvas.getContext('2d');
    const W = canvas.width;
    const H = canvas.height;

    let ballId = 'vanguard';
    let skin = 'default';
    try {
      ballId = localStorage.getItem('slingshot-ball') || 'vanguard';
      skin = localStorage.getItem(`slingshot-skin-${ballId}`) || 'default';
    } catch (_) {}
    const ball = BALLS.find((b) => b.id === ballId) || BALLS[0];
    const look = skinColors(ball, skin);
    const sprite = document.createElement('canvas');
    sprite.width = sprite.height = 16;
    paintBall(sprite.getContext('2d'), { ...look, pattern: look.pattern || CLASS_PATTERN[ball.id] });

    const part = (id) => bySlot[id] && getPart(bySlot[id].id);
    const guns = [part('weapon1'), part('weapon2')];
    const armor = part('armor');
    const drone = part('drone');
    const mods = [part('module1'), part('module2')];
    const frame = part('frame');
    const frameCol = frame ? rarityColor(frame.rarity) : '#566c86';

    const cx = W / 2;
    const cy = 26;
    const start = performance.now();
    const px = (x, y, w, h, c) => {
      g.fillStyle = c;
      g.fillRect(Math.round(x), Math.round(y), w, h);
    };

    const draw = (now) => {
      const s = (now - start) / 1000;
      g.clearRect(0, 0, W, H);

      // Back wall panels and a sweeping scan beam
      px(0, 0, W, H, '#141627');
      for (let x = 2; x < W; x += 12) px(x, 2, 10, 34, '#191c30');
      const beam = ((s * 18) % (W + 16)) - 8;
      g.globalAlpha = 0.18;
      px(beam, 0, 4, 44, '#73eff7');
      g.globalAlpha = 1;

      // Floor grid
      px(0, 44, W, H - 44, '#1f2338');
      for (let x = -40; x < W + 40; x += 8) {
        g.fillStyle = '#2a3048';
        for (let y = 44; y < H; y++) g.fillRect(Math.round(cx + (x - cx) * (1 + (y - 44) / 10)), y, 1, 1);
      }
      px(0, 48, W, 1, '#2a3048');

      // Pedestal (frame): coloured by frame rarity, hazard stripe edge
      px(cx - 14, 40, 28, 5, frameCol);
      px(cx - 14, 40, 28, 1, '#f4f4f4');
      for (let i = 0; i < 26; i += 4) px(cx - 13 + i, 45, 2, 2, '#ffcd75');
      px(cx - 16, 47, 32, 2, '#1a1c2c');
      // Module lights on the pedestal
      mods.forEach((mp, i) => {
        if (!mp) return;
        const on = Math.sin(s * 4 + i * 2) > -0.2;
        px(cx + (i ? 8 : -10), 42, 2, 2, on ? rarityColor(mp.rarity) : '#1a1c2c');
      });

      const bob = Math.round(Math.sin(s * 2) * 1.2);
      // Armor: rotating dashed ring
      if (armor) {
        const col = rarityColor(armor.rarity);
        for (let a = 0; a < 24; a++) {
          if ((a + Math.floor(s * 6)) % 3 === 0) continue;
          const ang = (a / 24) * Math.PI * 2;
          px(cx + Math.cos(ang) * 11 - 0.5, cy + bob + Math.sin(ang) * 11 - 0.5, 1, 1, col);
        }
      }
      // Guns on the flanks (left one mirrored)
      guns.forEach((gp, i) => {
        if (!gp) return;
        const ic = partCanvas(gp.id);
        const y = cy + bob - ic.height / 2 + (i ? 1 : -1);
        g.save();
        if (i === 0) {
          g.translate(cx - 9, 0);
          g.scale(-1, 1);
          g.drawImage(ic, 0, Math.round(y));
        } else g.drawImage(ic, Math.round(cx + 9), Math.round(y));
        g.restore();
        // Muzzle blink every few seconds
        if (((s + i * 1.3) % 3) < 0.08) px(i ? cx + 9 + ic.width : cx - 10 - ic.width, cy + bob, 2, 2, '#ffcd75');
      });
      // Ball
      g.drawImage(sprite, Math.round(cx - 8), Math.round(cy - 8 + bob));
      // Drone orbiting above
      if (drone) {
        const ic = partCanvas(drone.id);
        const dx = Math.cos(s * 1.4) * 16;
        const dy = Math.sin(s * 2.8) * 2;
        g.drawImage(ic, Math.round(cx + dx - ic.width / 2), Math.round(3 + dy));
      }
      // Overloaded: red flicker
      if (t.overweight && Math.sin(s * 8) > 0) {
        g.globalAlpha = 0.2;
        px(0, 0, W, H, '#ff5d73');
        g.globalAlpha = 1;
      }
      this._raf = requestAnimationFrame(draw);
    };
    this._raf = requestAnimationFrame(draw);
  }

  // ---------- Pods ----------

  _renderPods() {
    const m = saveSystem.getMech();
    const maxRisk = saveSystem.bestRiskAnyBall(); // pods unlock account-wide
    const pods = CRATES.map((c) => {
      const locked = c.minRisk && maxRisk < c.minRisk;
      const can = !locked && m.tokens >= c.cost;
      const odds = Object.entries(c.odds);
      const pct = (v) => (v < 1 ? v.toFixed(2).replace(/0+$/, '') : v);
      return `<div class="rig-pod ${locked ? 'locked' : ''}" style="--pod:${c.color}">
        <div class="rig-pod-art-wrap"><img class="rig-pod-art" src="${uiIcon('pod', locked ? '#566c86' : c.color)}" alt="">${locked ? ico('lock') : ''}</div>
        <strong>${c.name}</strong>
        <div class="rig-odds">${odds.map(([r, v]) => `<i style="flex:${Math.max(v, 1.5)};background:${rarityColor(r)}"></i>`).join('')}</div>
        <div class="rig-odds-legend">${odds.map(([r, v]) => `<span style="color:${rarityColor(r)}" title="${rarityName(r)}">${pct(v)}%</span>`).join('')}</div>
        <button class="rig-drops-btn" data-drops="${c.id}">POSSIBLE DROPS</button>
        <button class="btn ${can ? 'btn-primary' : 'btn-disabled'}" data-pod="${c.id}" ${can ? '' : 'disabled'}>${locked ? `${ico('lock')}RISK ${c.minRisk}` : `OPEN ${ico('key')}${c.cost}`}</button>
      </div>`;
    }).join('');
    this.body.innerHTML = `
      <div class="rig-pods">${pods}</div>
      <p class="rig-foot">${ico('key')} Win fights to earn keys · ${m.owned.length}/${INVENTORY_CAP} parts · ${PARTS.length} to find</p>
      <div class="rig-reveal hidden" id="rig-reveal"></div>`;
    this.body.querySelectorAll('[data-pod]').forEach((b) => b.addEventListener('click', () => this._openPod(b.dataset.pod)));
    this.body.querySelectorAll('[data-drops]').forEach((b) => b.addEventListener('click', () => {
      soundEngine.playUI();
      this._showDrops(b.dataset.drops);
    }));
  }

  /** Every part a pod can give, by rarity, with the chance per rarity and per item. */
  _showDrops(podId) {
    const crate = CRATES.find((c) => c.id === podId);
    const box = document.getElementById('rig-reveal');
    const owned = new Set(saveSystem.getMech().owned.map((o) => o.id));
    const fmt = (v) => (v >= 1 ? `${Math.round(v * 10) / 10}` : v >= 0.1 ? v.toFixed(2).replace(/0$/, '') : v.toFixed(3).replace(/0+$/, ''));
    const rows = Object.entries(crate.odds).filter(([, v]) => v > 0).map(([r, v]) => {
      const pool = PARTS.filter((p) => p.rarity === r);
      return `<div class="drops-row" style="--rar:${rarityColor(r)}">
        <div class="drops-head"><b>${rarityName(r)}</b><span>${fmt(v)}%</span><em>${fmt(v / pool.length)}% each</em></div>
        <div class="drops-items">${pool.map((p) => `<span class="drops-item ${owned.has(p.id) ? 'owned' : ''}" data-part="${p.id}" title="${p.name}"><img src="${partIcon(p.id)}" alt="">${owned.has(p.id) ? '<i>&#10003;</i>' : ''}</span>`).join('')}</div>
      </div>`;
    }).join('');
    box.style.removeProperty('--rar');
    box.classList.remove('mythic');
    box.innerHTML = `<div class="drops-panel" style="--pod:${crate.color}">
        <div class="drops-title"><strong>${crate.name}</strong><span>&#10003; = owned</span><button class="btn btn-outline" data-act="close">&#10005;</button></div>
        <div class="drops-list">${rows}</div>
        <p class="drops-info" id="drops-info">Tap a part to see what it is</p>
      </div>`;
    box.classList.remove('hidden');
    box.querySelector('[data-act="close"]').addEventListener('click', () => {
      soundEngine.playUI();
      box.classList.add('hidden');
    });
    // No hover on phones: tapping an icon names the part
    box.querySelectorAll('[data-part]').forEach((el) => el.addEventListener('click', () => {
      const p = getPart(el.dataset.part);
      box.querySelectorAll('.drops-item.sel').forEach((x) => x.classList.remove('sel'));
      el.classList.add('sel');
      const info = document.getElementById('drops-info');
      info.style.setProperty('--rar', rarityColor(p.rarity));
      info.innerHTML = `<b>${p.name}</b> · ${rarityName(p.rarity)} ${TYPE_LABEL[p.type]}${owned.has(p.id) ? ' · owned' : ''}${partNote(p) ? ` · ${partNote(p)}` : ''}`;
      soundEngine.play('select');
    }));
  }

  /**
   * Pod opening: the pod drops into a light beam, shakes harder and harder
   * while it glows (epic+ drops shift the glow to their colour halfway: a
   * tease), then bursts into two halves with sparks, a ring and a flash.
   */
  _openPod(podId) {
    const got = saveSystem.buyCrate(podId);
    if (!got) return soundEngine.play('error');
    this._renderWallet();
    const crate = CRATES.find((c) => c.id === podId);
    const p = getPart(got.id);
    const rank = RANK[p.rarity];
    const box = document.getElementById('rig-reveal');
    const art = uiIcon('pod', crate.color);
    const sparks = Array.from({ length: 18 }, (_, i) => `<i style="--a:${i * 20 + Math.random() * 10}deg;--d:${120 + Math.random() * 90}px"></i>`).join('');
    box.style.setProperty('--rar', rarityColor(p.rarity));
    box.innerHTML = `
      <div class="pod-stage" style="--pod:${crate.color};--glow:${crate.color}">
        <div class="pod-beam"></div>
        <div class="pod-shell"><img class="pod-half top" src="${art}" alt=""><img class="pod-half bot" src="${art}" alt=""></div>
        <div class="pod-sparks">${sparks}</div>
        <div class="pod-ring"></div>
        <div class="pod-flash"></div>
      </div>`;
    box.classList.remove('hidden');
    const stage = box.querySelector('.pod-stage');
    haptics.impact('medium');
    soundEngine.play('select');

    const charge = 1200;
    requestAnimationFrame(() => stage.classList.add('charge'));
    // Rising ticks while it charges
    for (let i = 0; i < 9; i++) setTimeout(() => soundEngine.playUI(260 + i * 70, 0.035), 150 + i * 115);
    if (rank >= 2) setTimeout(() => stage.style.setProperty('--glow', rarityColor(p.rarity)), charge * 0.55);
    setTimeout(() => {
      stage.classList.add('burst');
      soundEngine.play(rank >= 3 ? 'alarm' : 'coin');
      haptics.impact(rank >= 2 ? 'heavy' : 'medium');
      if (rank >= 3) this.body.classList.add('pod-quake');
    }, charge);
    setTimeout(() => {
      this.body.classList.remove('pod-quake');
      this._reveal(got);
    }, charge + 420);
  }

  _reveal(owned) {
    const p = getPart(owned.id);
    const col = rarityColor(p.rarity);
    const box = document.getElementById('rig-reveal');
    if (!box) return;
    soundEngine.play('confirm');
    box.style.setProperty('--rar', col);
    box.classList.toggle('mythic', p.rarity === 'mythic');
    box.innerHTML = `
      <div class="rig-rays"></div>
      <div class="pod-flash out"></div>
      <img class="rig-reveal-icon" src="${partIcon(p.id)}" alt="">
      <span class="rig-reveal-rar">${rarityName(p.rarity)} ${TYPE_LABEL[p.type]}</span>
      <strong>${p.name}</strong>
      <div class="rig-chips">${partChips(owned).map((c) => `<span>${ico(c.icon)}${c.text}</span>`).join('')}${p.weight ? `<span>${ico('load')}${p.weight}</span>` : ''}</div>
      <div class="rig-actions">
        <button class="btn btn-outline" data-act="ok">OK</button>
        <button class="btn btn-accent" data-act="fit">VIEW IN RIG</button>
      </div>`;
    box.classList.remove('hidden');
    box.querySelector('[data-act="ok"]').addEventListener('click', () => {
      soundEngine.playUI();
      this.render();
    });
    box.querySelector('[data-act="fit"]').addEventListener('click', () => {
      soundEngine.playUI();
      // Prefer an empty slot of the right type
      const m = saveSystem.getMech();
      const slots = SLOTS.filter((s) => s.type === p.type);
      this.slot = (slots.find((s) => !m.loadout[s.id]) || slots[0]).id;
      this.focus = owned.uid;
      this.tab = 'loadout';
      this.render();
    });
  }
}
