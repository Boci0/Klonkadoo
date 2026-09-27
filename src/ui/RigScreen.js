// ============================================================
// RigScreen — full-screen loadout + supply pods.
//
// Left: the "bay", a live pixel scene of your mech as it will
// fight (frame torso with its armor, legs, guns on the flanks,
// orbiting drone) with the eight slot tiles around it. Right: the
// parts that fit the selected slot as icon tiles, plus a detail
// card for the focused part. The PODS tab opens supply pods.
// ============================================================

import { saveSystem } from '../meta/SaveSystem.js';
import { soundEngine } from '../utils/SoundEngine.js';
import { haptics } from '../platform/haptics.js';
import { OPERATOR, skinColors } from '../meta/Balls.js';
import { torsoCanvas, legsCanvas } from '../rendering/mechSprite.js';
import { partIcon, partCanvas, ico, uiIcon } from '../rendering/pixelIcons.js';
import {
  SLOTS, PARTS, CRATES, getPart, partChips, partNote, describePart, TYPE_LABEL, rarityColor, rarityName,
  upgradeCost, salvageValue, loadoutTotals, MAX_LEVEL, INVENTORY_CAP, DTYPES, DTYPE_KEYS, LANE_SIZE, reachLabel,
} from '../meta/Mech.js';

const RANK = { common: 0, rare: 1, epic: 2, legendary: 3, mythic: 4 };
const REACH_MAX = LANE_SIZE - 1; // farthest distance on the lane
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

    // Garage: up to 3 mechs; locked slots say how to earn them
    const garage = [0, 1, 2].map((i) => {
      const open = i < m.garageSlots;
      const lock = i === 1 ? 'Beat a floor 5 boss' : 'Beat an Abyss boss';
      const framed = open && m.loadouts[i]?.frame;
      return `<button class="rig-gtab ${i === m.editing ? 'on' : ''} ${open ? '' : 'locked'}" data-garage="${i}" ${open ? '' : `disabled title="${lock}"`}>
        MECH ${i + 1}${open ? (framed || i === 0 ? '' : ' <em>NO FRAME</em>') : ` <em>${ico('lock')} ${lock.toUpperCase()}</em>`}
      </button>`;
    }).join('');

    this.body.innerHTML = `
      <div class="rig-garage">${garage}</div>
      <div class="rig-bay">
        <div class="rig-col">${LEFT.map(tile).join('')}</div>
        <div class="rig-stage">
          <canvas id="rig-canvas" width="72" height="54"></canvas>
          <div class="rig-core-slots">${tile('frame')}${tile('legs')}</div>
        </div>
        <div class="rig-col">${RIGHT.map(tile).join('')}</div>
        <div class="rig-load ${t.overweight ? 'over' : ''}">
          ${ico('load')}<div class="rig-meter">${meter}</div><b>${t.weight}/${t.capacity}</b>
        </div>
        <div class="rig-totals">
          <span>${ico('hp')}+${Math.round(t.hp)}</span>${DTYPE_KEYS.map((k) => `<span title="${DTYPES[k].name} resist" style="color:${DTYPES[k].color}">${ico('def', DTYPES[k].color)}${Math.round((t.def + t.res[k]) * 10) / 10}</span>`).join('')}<span>${ico('gun')}${t.weapons.length}</span>${t.drones.length ? `<span>${ico('star')}${t.drones.length}</span>` : ''}
          ${t.overweight ? '<em class="rig-warn">OVERLOADED</em>' : ''}
        </div>
      </div>
      <div class="rig-side" id="rig-side"></div>`;

    this.body.querySelectorAll('[data-garage]').forEach((b) => b.addEventListener('click', () => {
      if (!saveSystem.setEditing(Number(b.dataset.garage))) return;
      soundEngine.play('select');
      this.focus = null;
      this._renderLoadout();
    }));
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
    const worn = saveSystem.getWornUids(); // on any garage mech
    const fits = m.owned.filter((o) => getPart(o.id)?.type === slot.type)
      .sort((a, b) => (b.uid === inSlot?.uid) - (a.uid === inSlot?.uid) || RANK[getPart(b.id).rarity] - RANK[getPart(a.id).rarity] || b.level - a.level);
    if (!fits.some((o) => o.uid === this.focus)) this.focus = inSlot?.uid || fits[0]?.uid || null;

    const tiles = fits.map((o) => {
      const p = getPart(o.id);
      const on = saveSystem.wornBy(o.uid);
      const mark = o.uid === inSlot?.uid ? '<i class="rig-mark here">&#10003;</i>' : on === m.editing ? '<i class="rig-mark">&#9679;</i>' : on >= 0 ? `<i class="rig-mark other" title="On mech ${on + 1}">${on + 1}</i>` : '';
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
      - (!inThis && saveSystem.wornBy(owned.uid) === m.editing ? p.weight || 0 : 0);
    const capAfter = p.type === 'frame' ? p.capacity : t.capacity;
    const tooHeavy = !inThis && after > capAfter;
    const cost = upgradeCost(owned);
    const maxed = owned.level >= MAX_LEVEL;
    const range = p.reach ? `<div class="rig-range" title="Hits at ${reachLabel(p.reach)} positions away">
        ${ico('range')}<div class="rig-range-bar"><i style="left:${((p.reach[0] - 1) / REACH_MAX) * 100}%;width:${((p.reach[1] - p.reach[0] + 1) / REACH_MAX) * 100}%;--c:${p.color}"></i></div>
        <span>${reachLabel(p.reach)}</span>
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

    const ball = OPERATOR;
    let skin = 'default';
    try {
      skin = localStorage.getItem(`slingshot-skin-${ball.id}`) || 'default';
    } catch (_) {}
    const look = skinColors(ball, skin);

    const part = (id) => bySlot[id] && getPart(bySlot[id].id);
    const guns = [part('weapon1'), part('weapon2')];
    const armor = part('armor');
    const drone = part('drone');
    const mods = [part('module1'), part('module2')];
    const frame = part('frame');
    const frameCol = frame ? rarityColor(frame.rarity) : '#566c86';
    const legs = part('legs');
    // The mech itself: legs on the pedestal, torso (frame + armor) on the legs
    const legsSprite = legsCanvas(legs?.id || 'lg_strider', look.color, look.darkColor);
    const torso = torsoCanvas(frame?.id || 'fr_scout', armor?.id || null, look.color, look.darkColor);
    const legsTop = 40 - (legsSprite.height - 2);
    const torsoTop = legsTop + 2 - torso.height;
    const gunX = Math.ceil(torso.width / 2) + 1;

    const cx = W / 2;
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

      const bob = Math.round(Math.sin(s * 2) * 0.6);
      g.drawImage(legsSprite, Math.round(cx - legsSprite.width / 2), legsTop);
      g.drawImage(torso, Math.round(cx - torso.width / 2), torsoTop + bob);
      const gy = torsoTop + Math.round(torso.height * 0.45) + bob;
      // Guns on the flanks (left one mirrored)
      guns.forEach((gp, i) => {
        if (!gp) return;
        const ic = partCanvas(gp.id);
        const y = gy - ic.height / 2 + (i ? 1 : -1);
        g.save();
        if (i === 0) {
          g.translate(cx - gunX, 0);
          g.scale(-1, 1);
          g.drawImage(ic, 0, Math.round(y));
        } else g.drawImage(ic, Math.round(cx + gunX), Math.round(y));
        g.restore();
        // Muzzle blink every few seconds
        if (((s + i * 1.3) % 3) < 0.08) px(i ? cx + gunX + ic.width : cx - gunX - 1 - ic.width, gy, 2, 2, '#ffcd75');
      });
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
      info.innerHTML = `<b>${p.name}</b> · ${rarityName(p.rarity)} ${TYPE_LABEL[p.type]}${owned.has(p.id) ? ' · owned' : ''}${describePart({ id: p.id, level: 1 }).map((l) => ` · ${l}`).join('')}`;
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
