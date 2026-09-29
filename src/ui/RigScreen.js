// ============================================================
// RigScreen — full-screen loadout + supply pods.
//
// Left: the "bay", a live pixel scene of your mech as it will
// fight (frame torso with its plating, legs, side guns on the flanks,
// top guns on the shoulders, orbiting drone) with the slot tiles
// around it and the stat bar under it. Right: the
// parts that fit the selected slot as icon tiles, plus a detail
// card for the focused part. The PODS tab opens supply pods.
// ============================================================

import { saveSystem } from '../meta/SaveSystem.js';
import { soundEngine } from '../utils/SoundEngine.js';
import { haptics } from '../platform/haptics.js';
import { OPERATOR, skinColors } from '../meta/Balls.js';
import { torsoCanvas, legsCanvas } from '../rendering/mechSprite.js';
import { drawEffect } from '../rendering/fxDraw.js';
import { EFFECTS } from '../meta/Raid.js';
import { partIcon, partCanvas, ico, uiIcon, iconSize } from '../rendering/pixelIcons.js';
import { CONFIG } from '../config.js';
import {
  SLOTS, PARTS, CRATES, getPart, TYPE_LABEL, rarityColor, rarityName,
  upgradeCost, salvageValue, loadoutTotals, INVENTORY_CAP, slotAccepts, maxLevel, tierOf, transformInfo,
  PACK_SIZE, packCost,
} from '../meta/Mech.js';
import { partCardHtml, statBarHtml, bindHoverTips, hideTip, iconKeyHtml } from './partCard.js';

const RANK = { common: 0, rare: 1, epic: 2, legendary: 3, mythic: 4, ascended: 5 };
// Tile background by damage type (guns and drones that deal one), so a part reads at a glance
const DT_BG = { phys: '#94b0c2', heat: '#ef7d57', energy: '#41a6f6' };
const dtBg = (p) => (p && (p.type === 'weapon' || (p.type === 'drone' && p.dtype)) ? DT_BG[p.dtype || 'phys'] : 'transparent');
/** A tile's colours: rarity border + damage-type background. */
const tileStyle = (o, p) => `--rar:${rarityColor(tierOf(o))};--dt:${dtBg(p)}`;
/** The level badge: MAX once it can't level further. */
const lvText = (o) => ((o.level || 1) >= maxLevel(o) ? 'MAX' : o.level || 1);
// Where each slot tile sits around the bay
const LEFT = ['top1', 'side1', 'side2'];
const RIGHT = ['top2', 'side3', 'side4'];
const STRIP = ['drone', 'charge', 'teleport', 'hook'];
const MODS = SLOTS.filter((s) => s.type === 'module').map((s) => s.id);
// What an empty slot shows (a faint symbol instead of words)
const EMPTY_ICON = { top: 'top', side: 'side', drone: 'star', charge: 'move', teleport: 'range', hook: 'pull', module: 'def', frame: 'hp', legs: 'move' };

export class RigScreen {
  constructor({ onBack }) {
    this.el = document.getElementById('screen-rig');
    this.body = document.getElementById('rig-body');
    this.wallet = document.getElementById('rig-wallet');
    this.tab = 'loadout';
    this.slot = 'side1';
    this.focus = null; // uid of the part shown in the detail card
    this.hover = null; // uid of the inventory part under the mouse (stat bar preview)
    document.getElementById('btn-rig-back').addEventListener('click', () => {
      soundEngine.playUI();
      hideTip();
      this.stop();
      onBack();
    });
    this.el.querySelectorAll('[data-rtab]').forEach((b) => b.addEventListener('click', () => {
      soundEngine.playUI();
      this.tab = b.dataset.rtab;
      this.render();
    }));
    // Hover any part tile (slots, inventory, drops) for its icon card
    bindHoverTips(this.body, '[data-tip-uid],[data-tip-part]', (el) => {
      const uid = el.dataset.tipUid;
      const owned = uid ? saveSystem.getOwnedPart(uid) : { id: el.dataset.tipPart, level: 1 };
      return owned ? partCardHtml(owned) : '';
    });
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
    hideTip();
    this._renderWallet();
    this.el.querySelectorAll('[data-rtab]').forEach((b) => b.classList.toggle('on', b.dataset.rtab === this.tab));
    if (this.tab === 'pods') this._renderPods();
    else this._renderLoadout();
  }

  _renderWallet() {
    const m = saveSystem.getMech();
    this.wallet.innerHTML = `<span title="Keys">${ico('key')}<b>${m.tokens}</b></span><span title="Scrap">${ico('scrap')}<b>${m.scrap}</b></span>${m.shards || saveSystem.bestRiskAnyBall() >= CONFIG.abyss.shardMinRisk ? `<span title="Abyss Shards: ascend a Mythic max-level part. They can drop from Abyss wardens and Klonkadoo Prime on Risk 10 and XI">${ico('shard', '#c46fd6')}<b>${m.shards || 0}</b></span>` : ''}`;
  }

  // ---------- Loadout ----------

  _renderLoadout() {
    const m = saveSystem.getMech();
    const parts = saveSystem.getLoadoutParts();
    const t = loadoutTotals(parts);
    const bySlot = Object.fromEntries(SLOTS.map((s, i) => [s.id, parts[i]]));

    const tile = (slotId, cls = '') => {
      const slot = SLOTS.find((s) => s.id === slotId);
      const owned = bySlot[slotId];
      const p = owned && getPart(owned.id);
      const empty = EMPTY_ICON[slot.mount || slot.kind || slot.id] || EMPTY_ICON[slot.type] || 'star';
      return `<button class="rig-slot ${cls} ${slotId === this.slot ? 'sel' : ''} ${p ? '' : 'empty'}" data-slot="${slotId}" ${p ? `data-tip-uid="${owned.uid}"` : `title="${slot.name}"`} style="${p ? tileStyle(owned, p) : '--rar:var(--p-steel)'}">
        ${p ? `<img src="${partIcon(p.id)}" alt=""><i class="rig-lv">${lvText(owned)}</i>` : `<span class="rig-plus">${ico(empty)}</span>`}
        <span class="rig-slot-name">${slot.name}</span>
      </button>`;
    };

    // Special effect (cosmetic) between the top guns
    const fx = EFFECTS[m.fx[m.editing]];
    const fxTile = `<button class="rig-slot sm ${this.slot === 'fx' ? 'sel' : ''} ${fx ? '' : 'empty'}" data-slot="fx" title="${fx ? `${fx.name}: ${fx.desc}` : 'SPECIAL EFFECT (cosmetic)'}" style="--rar:${fx ? fx.color : 'var(--p-steel)'}">
        ${fx ? ico('star', fx.color) : `<span class="rig-plus">${ico('star')}</span>`}
        <span class="rig-slot-name">FX</span>
      </button>`;

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
        <div class="rig-col">${LEFT.map((id) => tile(id)).join('')}</div>
        <div class="rig-stage">
          <div class="rig-fx-slot">${fxTile}</div>
          <canvas id="rig-canvas" width="160" height="112"></canvas>
          <div class="rig-core-slots">${tile('frame')}${tile('legs')}</div>
        </div>
        <div class="rig-col">${RIGHT.map((id) => tile(id)).join('')}</div>
        <div class="rig-strip">${STRIP.map((id) => tile(id, 'sm')).join('')}</div>
        <div class="rig-strip mods">${MODS.map((id) => tile(id, 'xs')).join('')}</div>
        <div class="rig-stats-wrap" id="rig-stats">${statBarHtml(t)}</div>
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
      this.invSlot = null;
      this.focus = null;
      this._renderLoadout();
    }));
    this._renderSide(m, bySlot, t);
    this._startBay(bySlot, t);
  }

  /** Loadout totals if `uid` went into the selected slot (null if it's already there). */
  _preview(bySlot, uid) {
    if (!uid || bySlot[this.slot]?.uid === uid) return null;
    const next = { ...bySlot };
    for (const k of Object.keys(next)) if (next[k]?.uid === uid) next[k] = null;
    next[this.slot] = saveSystem.getOwnedPart(uid);
    return loadoutTotals(SLOTS.map((s) => next[s.id]));
  }

  _renderStats(bySlot, t) {
    const box = document.getElementById('rig-stats');
    if (box) box.innerHTML = statBarHtml(t, this._preview(bySlot, this.hover || this.focus));
  }

  /** FX slot: pick one of the special effects you own (raid rewards) for this mech. */
  _renderFxSide(m) {
    const side = document.getElementById('rig-side');
    const cur = m.fx[m.editing];
    const owned = Object.values(EFFECTS).filter((e) => m.effects[e.id] > 0);
    const row = (e) => {
      const free = saveSystem.effectFree(e.id, m.editing);
      const on = cur === e.id;
      return `<button class="rig-fx-item ${on ? 'sel' : ''}" data-fx="${e.id}" ${on || free > 0 ? '' : 'disabled'} style="--rar:${e.color}">
        ${ico('star', e.color)}<span><strong>${e.name}</strong><em>${e.desc}</em></span>
        <i title="Copies you own / not on another mech">x${m.effects[e.id]}${on ? ' · ON' : ` · ${free} FREE`}</i>
      </button>`;
    };
    side.innerHTML = `
      <div class="rig-side-head"><b>SPECIAL EFFECT</b><span></span></div>
      <p class="rig-note">Cosmetic only: no weight, no stats. Each copy fits one mech.</p>
      <div class="rig-fx-list">
        ${owned.map(row).join('') || `<p class="rig-empty">${ico('star', '#566c86')} Earn special effects in the weekly RAID</p>`}
        ${cur ? '<button class="btn btn-outline" data-fx="">REMOVE</button>' : ''}
      </div>`;
    side.querySelectorAll('[data-fx]').forEach((b) => b.addEventListener('click', () => {
      const ok = saveSystem.equipFx(m.editing, b.dataset.fx || null);
      soundEngine.play(ok ? 'select' : 'error');
      if (ok) this._renderLoadout();
    }));
  }

  _renderSide(m, bySlot, t) {
    if (this.slot === 'fx') return this._renderFxSide(m);
    const side = document.getElementById('rig-side');
    const slot = SLOTS.find((s) => s.id === this.slot);
    const inSlot = bySlot[this.slot];
    const worn = saveSystem.getWornUids(); // on any garage mech
    const fits = m.owned.filter((o) => slotAccepts(slot, getPart(o.id)))
      .sort((a, b) => (b.uid === inSlot?.uid) - (a.uid === inSlot?.uid) || RANK[tierOf(b)] - RANK[tierOf(a)] || b.level - a.level);
    if (!fits.some((o) => o.uid === this.focus)) this.focus = inSlot?.uid || fits[0]?.uid || null;

    const tile = (o) => {
      const p = getPart(o.id);
      const on = saveSystem.wornBy(o.uid);
      // Equipped: in this slot (bright), elsewhere on this mech, or on another garage mech
      const where = o.uid === inSlot?.uid ? 'here' : on === m.editing ? 'mine' : on >= 0 ? 'other' : '';
      const mark = where === 'here' ? '<i class="rig-badge here" title="Equipped here">&#10003; ON</i>'
        : where === 'mine' ? '<i class="rig-badge mine" title="Equipped in another slot">&#10003;</i>'
          : where === 'other' ? `<i class="rig-badge other" title="On mech ${on + 1}">M${on + 1}</i>` : '';
      const ready = o.level >= maxLevel(o) && transformInfo(o) ? '<i class="rig-mark up" title="Ready to transform">&#9650;</i>' : '';
      return `<button class="rig-item ${o.uid === this.focus ? 'sel' : ''} ${where ? `worn ${where}` : ''}" data-uid="${o.uid}" data-tip-uid="${o.uid}" style="${tileStyle(o, p)}">
        <img src="${partIcon(p.id)}" alt=""><i class="rig-lv">${lvText(o)}</i>${mark}${ready}
      </button>`;
    };
    const what = slot.kind ? slot.name.toLowerCase() : TYPE_LABEL[slot.type].toLowerCase();

    side.innerHTML = `
      <div class="rig-side-head"><b>${slot.name}</b><span id="rig-pager"></span><em title="What the icons mean"><button class="rig-key-btn" data-act="key">?</button></em></div>
      <div class="rig-inv" id="rig-inv"></div>
      <div class="rig-detail" id="rig-detail"></div>`;
    this._renderDetail(m, bySlot, t, worn);

    // No scrolling: as many tiles as fit the space left, arrows for the rest
    const inv = document.getElementById('rig-inv');
    const cols = Math.max(1, Math.floor((inv.clientWidth + 5) / 65)); // 60px tiles + 5px gap (styles .rig-inv)
    const rows = Math.max(1, Math.floor((inv.clientHeight + 5) / 65));
    const per = cols * rows;
    const pages = Math.max(1, Math.ceil(fits.length / per));
    if (this.invSlot !== this.slot) {
      // A new slot opens on the page with the focused part
      this.invSlot = this.slot;
      this.invPage = Math.max(0, Math.floor(fits.findIndex((o) => o.uid === this.focus) / per));
    }
    this.invPage = Math.max(0, Math.min(pages - 1, this.invPage || 0));
    inv.innerHTML = fits.slice(this.invPage * per, this.invPage * per + per).map(tile).join('')
      || `<p class="rig-empty">${ico('pod', '#41a6f6')} Open pods to find ${what}s</p>`;
    const pager = document.getElementById('rig-pager');
    pager.innerHTML = pages > 1
      ? `<button data-inv="-1" ${this.invPage ? '' : 'disabled'}>&#9664;</button>${this.invPage + 1}/${pages} · ${fits.length}<button data-inv="1" ${this.invPage < pages - 1 ? '' : 'disabled'}>&#9654;</button>`
      : `${fits.length}`;
    pager.querySelectorAll('[data-inv]').forEach((b) => b.addEventListener('click', () => {
      soundEngine.playUI();
      this.invPage += Number(b.dataset.inv);
      this._renderSide(m, bySlot, t);
    }));
    side.querySelector('[data-act="key"]').addEventListener('click', () => {
      soundEngine.playUI();
      this._showIconKey();
    });

    side.querySelectorAll('[data-uid]').forEach((b) => {
      b.addEventListener('click', () => {
        soundEngine.play('select');
        this.focus = b.dataset.uid;
        this._renderSide(m, bySlot, t);
      });
      b.addEventListener('mouseenter', () => {
        this.hover = b.dataset.uid;
        this._renderStats(bySlot, t);
      });
      b.addEventListener('mouseleave', () => {
        this.hover = null;
        this._renderStats(bySlot, t);
      });
    });
    this._renderStats(bySlot, t);
  }

  /** What every stat icon means, over the Rig. */
  _showIconKey() {
    let box = document.getElementById('rig-key');
    if (!box) {
      box = document.createElement('div');
      box.id = 'rig-key';
      box.className = 'rig-key';
      this.body.appendChild(box);
    }
    box.innerHTML = `<div class="rig-key-panel"><div class="drops-title"><strong>ICONS</strong><span></span><button class="btn btn-outline" data-act="close">&#10005;</button></div>${iconKeyHtml()}</div>`;
    box.querySelector('[data-act="close"]').addEventListener('click', () => {
      soundEngine.playUI();
      box.remove();
    });
  }

  _renderDetail(m, bySlot, t, worn) {
    const box = document.getElementById('rig-detail');
    const owned = this.focus && saveSystem.getOwnedPart(this.focus);
    if (!owned) {
      box.innerHTML = '';
      return;
    }
    const p = getPart(owned.id);
    const G = CONFIG.gear;
    const inThis = bySlot[this.slot]?.uid === owned.uid;
    const after = this._preview(bySlot, owned.uid);
    const tooHeavy = !inThis && after && after.overKg > G.overweightMax;
    const dupe = !inThis && p.unique && Object.entries(bySlot).some(([k, o]) => k !== this.slot && o && o.id === p.id && o.uid !== owned.uid);
    const cost = upgradeCost(owned);
    const maxed = owned.level >= maxLevel(owned);
    const tf = transformInfo(owned);
    const fodder = maxed && tf ? saveSystem.transformFodder(owned.uid) : [];
    const canTf = maxed && tf && fodder.length >= tf.parts && m.scrap >= tf.scrap;

    // A Mythic part at max level ASCENDS with Abyss Shards (CONFIG.abyss.ascend)
    const asc = saveSystem.ascendInfo(owned);
    // At max level the level button becomes TRANSFORM (it needs spare parts of the same tier)
    const lvBtn = asc.ok
      ? `<button class="btn ${asc.afford ? 'btn-accent' : 'btn-disabled'}" data-act="ascend" ${asc.afford ? '' : 'disabled'}>&#9650;<i class="tdot" style="--c:${rarityColor('ascended')}"></i> ${ico('shard', '#c46fd6')}${asc.shards} ${ico('scrap')}${asc.scrap}</button>`
      : !maxed
      ? `<button class="btn ${m.scrap >= cost ? 'btn-primary' : 'btn-disabled'}" data-act="upgrade" ${m.scrap < cost ? 'disabled' : ''} title="Level up">LV+ ${ico('scrap')}${cost}</button>`
      : tf
        ? `<button class="btn ${canTf ? 'btn-accent' : 'btn-disabled'}" data-act="transform" ${canTf ? '' : 'disabled'} title="Transform to ${rarityName(tf.to)}: melts ${tf.parts} spare ${rarityName(tierOf(owned))} parts + ${tf.scrap} scrap">&#9650;<i class="tdot" style="--c:${rarityColor(tf.to)}"></i> ${tf.parts}x<i class="tdot" style="--c:${rarityColor(tierOf(owned))}"></i> ${ico('scrap')}${tf.scrap}</button>`
        : '<button class="btn btn-disabled" disabled>MAX</button>';
    const heavyTip = 'Too heavy: you will not be able to deploy';
    const equipBtn = inThis
      ? (this.slot === 'frame' ? '<button class="btn btn-disabled" disabled>&#10003;</button>' : '<button class="btn btn-outline" data-act="unequip" title="Remove">&#10005;</button>')
      : dupe ? `<button class="btn btn-disabled" disabled title="One per mech">${ico('lock')}1x</button>`
        : `<button class="btn ${tooHeavy ? 'btn-outline' : 'btn-accent'}" data-act="equip" title="${tooHeavy ? heavyTip : 'Equip'}">${tooHeavy ? `${ico('load')}!` : 'EQUIP'}</button>`;
    const sell = `<button class="btn ${worn.has(owned.uid) ? 'btn-disabled' : 'btn-danger'}" data-act="salvage" ${worn.has(owned.uid) ? 'disabled' : ''} title="Salvage">${ico('scrap')}+${salvageValue(owned)}</button>`;
    const tfInfo = asc.ok
      ? `<p class="rig-note">&#9650; ASCEND to ${rarityName('ascended')}: ${asc.shards} Abyss Shards (you have ${saveSystem.getShards()}) + ${asc.scrap} scrap. Shards can drop from Abyss wardens and Klonkadoo Prime on Risk 10 and XI.</p>`
      : maxed && tf && !canTf
        ? `<p class="rig-note">&#9650; ${fodder.length < tf.parts ? `needs ${tf.parts} spare ${rarityName(tierOf(owned))} parts` : `needs ${tf.scrap} scrap`}</p>` : '';

    box.innerHTML = partCardHtml(owned, { extra: `${tfInfo}<div class="rig-actions">${equipBtn}${lvBtn}${sell}</div>` });

    box.querySelectorAll('[data-act]').forEach((b) => b.addEventListener('click', () => {
      const act = b.dataset.act;
      // TRANSFORM melts parts: show exactly which ones first
      if (act === 'transform') return this._confirmTransform(owned, tf);
      if (act === 'ascend') {
        const done = saveSystem.ascendPart(owned.uid);
        soundEngine.play(done ? 'coin' : 'error');
        if (!done) return;
        haptics.impact('heavy');
        this.render();
        return this._flashTransform(owned);
      }
      // Equipping an overweight part is allowed (you just can't deploy), the button warns first
      const ok = act === 'equip' ? saveSystem.equipPart(this.slot, owned.uid)
        : act === 'unequip' ? saveSystem.unequipSlot(this.slot)
          : act === 'upgrade' ? saveSystem.upgradePart(owned.uid)
            : act === 'transform' ? saveSystem.transformPart(owned.uid)
              : saveSystem.salvagePart(owned.uid) > 0;
      soundEngine.play(ok ? (act === 'transform' ? 'coin' : 'confirm') : 'error');
      if (ok && act !== 'salvage') haptics.impact(act === 'transform' ? 'heavy' : 'light');
      if (act === 'salvage') this.focus = null;
      const scroll = this.body.querySelector('.rig-inv')?.scrollTop || 0;
      this.render();
      const inv = this.body.querySelector('.rig-inv');
      if (inv) inv.scrollTop = scroll;
      if (ok && act === 'transform') this._flashTransform(owned);
    }));
  }

  /** TRANSFORM: pick which spare parts of the same tier to melt (the cheapest are picked to start). */
  _confirmTransform(owned, tf) {
    soundEngine.playUI();
    const p = getPart(owned.id);
    const pool = saveSystem.transformPool(owned.uid);
    const picked = new Set(pool.slice(0, tf.parts).map((o) => o.uid));
    const box = document.createElement('div');
    box.className = 'rig-key';
    this.body.appendChild(box);
    const draw = () => {
      const ok = picked.size === tf.parts;
      box.innerHTML = `<div class="rig-key-panel tf-panel" style="--rar:${rarityColor(tf.to)}">
          <div class="drops-title"><strong>TRANSFORM ${p.name}</strong><span></span></div>
          <div class="tf-row">
            <span class="tf-part"><img src="${partIcon(p.id)}" alt=""><i class="tdot" style="--c:${rarityColor(tierOf(owned))}"></i></span>
            <b>&#9654;</b>
            <span class="tf-part"><img src="${partIcon(p.id)}" alt=""><i class="tdot" style="--c:${rarityColor(tf.to)}"></i> ${rarityName(tf.to)} LV 1</span>
          </div>
          <p class="rig-note">Pick ${tf.parts} spare ${rarityName(tierOf(owned))} parts to melt <b class="tf-count ${ok ? 'ok' : ''}">${picked.size}/${tf.parts}</b> · ${ico('scrap')}${tf.scrap}</p>
          <div class="tf-fodder">${pool.map((o) => `<button class="rig-item ${picked.has(o.uid) ? 'picked' : ''}" data-pick="${o.uid}" data-tip-uid="${o.uid}" style="--rar:${rarityColor(tierOf(o))}"><img src="${partIcon(o.id)}" alt=""><i class="rig-lv">${o.level}</i>${picked.has(o.uid) ? '<i class="rig-badge here">&#10003;</i>' : ''}</button>`).join('')}</div>
          <div class="rig-actions"><button class="btn btn-outline" data-act="no">CANCEL</button><button class="btn ${ok ? 'btn-accent' : 'btn-disabled'}" data-act="yes" ${ok ? '' : 'disabled'}>&#9650; TRANSFORM</button></div>
        </div>`;
      box.querySelectorAll('[data-pick]').forEach((el) => el.addEventListener('click', () => {
        const uid = el.dataset.pick;
        if (picked.has(uid)) picked.delete(uid);
        else if (picked.size < tf.parts) picked.add(uid);
        else return soundEngine.play('error');
        soundEngine.play('select');
        hideTip();
        draw();
      }));
      box.querySelector('[data-act="no"]').addEventListener('click', () => {
        soundEngine.playUI();
        hideTip();
        box.remove();
      });
      box.querySelector('[data-act="yes"]').addEventListener('click', () => {
        hideTip();
        box.remove();
        const done = saveSystem.transformPart(owned.uid, [...picked]);
        soundEngine.play(done ? 'coin' : 'error');
        if (!done) return;
        haptics.impact('heavy');
        this.render();
        this._flashTransform(owned);
      });
    };
    draw();
  }

  /** A short burst over the detail card after a transform. */
  _flashTransform(owned) {
    const box = document.getElementById('rig-detail');
    if (!box) return;
    box.style.setProperty('--glow', rarityColor(tierOf(owned)));
    box.classList.remove('transformed');
    void box.offsetWidth;
    box.classList.add('transformed');
  }

  // ---------- Bay animation ----------

  _startBay(bySlot, t) {
    const canvas = document.getElementById('rig-canvas');
    if (!canvas) return;
    const g = canvas.getContext('2d');
    // Drawn at 2x so hi-res part icons keep their detail; the layout stays in 80x56 units
    const W = canvas.width / 2;
    const H = canvas.height / 2;
    g.setTransform(2, 0, 0, 2, 0, 0);
    g.imageSmoothingEnabled = false;

    const ball = OPERATOR;
    let skin = 'default';
    try {
      skin = localStorage.getItem(`slingshot-skin-${ball.id}`) || 'default';
    } catch (_) {}
    const look = skinColors(ball, skin);

    const part = (id) => bySlot[id] && getPart(bySlot[id].id);
    const fxId = saveSystem.getMech().fx[saveSystem.getMech().editing]; // special effect (cosmetic)
    // Side guns on the flanks (1-2 left, 3-4 right), top guns on the shoulders
    const guns = [part('side1'), part('side3'), part('side2'), part('side4')];
    const tops = [part('top1'), part('top2')];
    const drone = part('drone');
    const mods = MODS.map(part);
    const plating = mods.filter(Boolean).find((mp) => ['md_voidcore', 'md_titanplate', 'md_aegis', 'md_composite', 'md_insulated', 'md_heavyplate', 'md_plating'].includes(mp.id));
    const armor = plating?.id || null;
    const frame = part('frame');
    const frameCol = frame ? rarityColor(tierOf(bySlot.frame)) : '#566c86';
    const legs = part('legs');
    // The mech itself: legs on the pedestal, torso (frame + armor) on the legs
    const legsSprite = legsCanvas(legs?.id || 'lg_strider', look.color, look.darkColor);
    const torso = torsoCanvas(frame?.id || 'fr_scout', armor, look.color, look.darkColor);
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
        px(cx - 12 + i * 3, 42, 2, 2, on ? rarityColor(mp.rarity) : '#1a1c2c');
      });

      const bob = Math.round(Math.sin(s * 2) * 0.6);
      g.drawImage(legsSprite, Math.round(cx - legsSprite.width / 2), legsTop);
      g.drawImage(torso, Math.round(cx - torso.width / 2), torsoTop + bob);
      if (fxId) drawEffect(g, fxId, cx, torsoTop + bob, torso.width, torso.height, 1, now);
      const gy = torsoTop + Math.round(torso.height * 0.45) + bob;
      // Guns on the flanks (left one mirrored)
      guns.forEach((gp, i) => {
        if (!gp) return;
        const ic = partCanvas(gp.id);
        const { w: iw, h: ih } = iconSize(ic);
        const right = i % 2 === 1;
        const low = i >= 2; // the second gun on a flank hangs lower
        const y = gy - ih / 2 + (low ? 6 : -1);
        const x = gunX + (low ? 2 : 0);
        g.save();
        if (!right) {
          g.translate(cx - x, 0);
          g.scale(-1, 1);
          g.drawImage(ic, 0, Math.round(y), iw, ih);
        } else g.drawImage(ic, Math.round(cx + x), Math.round(y), iw, ih);
        g.restore();
        // Muzzle blink every few seconds
        if (((s + i * 1.3) % 3) < 0.08) px(right ? cx + x + iw : cx - x - 1 - iw, y + ih / 2, 2, 2, '#ffcd75');
      });
      // Top guns sit on the shoulders, pointing outward
      tops.forEach((gp, i) => {
        if (!gp) return;
        const ic = partCanvas(gp.id);
        const { w: iw, h: ih } = iconSize(ic);
        const y = torsoTop + bob - ih + 3;
        g.save();
        if (i === 0) {
          g.translate(cx - 2, 0);
          g.scale(-1, 1);
          g.drawImage(ic, 0, Math.round(y), iw, ih);
        } else g.drawImage(ic, Math.round(cx + 2), Math.round(y), iw, ih);
        g.restore();
      });
      // Drone orbiting above
      if (drone) {
        const ic = partCanvas(drone.id);
        const { w: iw, h: ih } = iconSize(ic);
        const dx = Math.cos(s * 1.4) * 16;
        const dy = Math.sin(s * 2.8) * 2;
        g.drawImage(ic, Math.round(cx + dx - iw / 2), Math.round(3 + dy), iw, ih);
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
    const credits = saveSystem.getPodCredits(); // free pods won in the Abyss
    const pods = CRATES.map((c) => {
      const locked = c.minRisk && maxRisk < c.minRisk;
      const can = !locked && m.tokens >= c.cost;
      const canPack = !locked && m.tokens >= packCost(c);
      const odds = Object.entries(c.odds);
      const pct = (v) => (v < 1 ? v.toFixed(2).replace(/0+$/, '') : v);
      const free = credits[c.id] || 0; // won in the Abyss: claimed instead of bought
      return `<div class="rig-pod ${locked && !free ? 'locked' : ''} ${free ? 'has-free' : ''}" style="--pod:${c.color}">
        <div class="rig-pod-art-wrap"><img class="rig-pod-art" src="${uiIcon('pod', locked && !free ? '#566c86' : c.color)}" alt="">${locked && !free ? ico('lock') : ''}${free ? `<b class="rig-pod-count" title="Free pods won in the Abyss">x${free}</b>` : ''}</div>
        <strong>${c.name}</strong>
        <div class="rig-odds">${odds.map(([r, v]) => `<i style="flex:${Math.max(v, 1.5)};background:${rarityColor(r)}"></i>`).join('')}</div>
        <div class="rig-odds-legend">${odds.map(([r, v]) => `<span style="color:${rarityColor(r)}" title="${rarityName(r)}">${pct(v)}%</span>`).join('')}</div>
        <button class="rig-drops-btn" data-drops="${c.id}">POSSIBLE DROPS</button>
        ${free >= PACK_SIZE
          ? `<div class="rig-pod-buy">
              <button class="btn btn-accent" data-credit="${c.id}" title="Won in the Abyss: open one for free">CLAIM x1</button>
              <button class="btn btn-accent" data-credit-pack="${c.id}" title="Won in the Abyss: open ${PACK_SIZE} for free">CLAIM x${PACK_SIZE}</button>
            </div>`
          : free
          ? `<button class="btn btn-accent rig-pod-claim" data-credit="${c.id}" title="Won in the Abyss: open one for free">CLAIM${free > 1 ? ` (${free})` : ''}</button>`
          : locked
          ? `<button class="btn btn-disabled" disabled>${ico('lock')}RISK ${c.minRisk}</button>`
          : `<div class="rig-pod-buy">
              <button class="btn ${can ? 'btn-primary' : 'btn-disabled'}" data-pod="${c.id}" ${can ? '' : 'disabled'}>x1 ${ico('key')}${c.cost}</button>
              <button class="btn ${canPack ? 'btn-accent' : 'btn-disabled'}" data-pack="${c.id}" ${canPack ? '' : 'disabled'}>x${PACK_SIZE} ${ico('key')}${packCost(c)}</button>
            </div>`}
      </div>`;
    }).join('');
    this.body.innerHTML = `
      <div class="rig-pods">${pods}</div>
      <div class="rig-foot-row">
        <p class="rig-foot">${ico('key')} Win fights to earn keys · ${saveSystem.getMech().owned.length > INVENTORY_CAP ? `<b class="warn" title="Over the limit: your salvage settings found nothing to take. Salvage spares or pick more tiers.">${saveSystem.getMech().owned.length}/${INVENTORY_CAP} PARTS: FULL</b>` : `${saveSystem.getMech().owned.length}/${INVENTORY_CAP} parts`} · ${PARTS.length} to find</p>
        <button class="btn btn-outline rig-salvage-btn" data-act="bulk-salvage" title="Turn spare parts into scrap, by tier">${ico('scrap')}SALVAGE SPARES${saveSystem.getSalvagePrefs().smart ? ' <em>SMART</em>' : saveSystem.getSalvagePrefs().auto ? ' <em>AUTO</em>' : ''}</button>
      </div>
      <div class="rig-reveal hidden" id="rig-reveal"></div>`;
    this.body.querySelector('[data-act="bulk-salvage"]')?.addEventListener('click', () => {
      soundEngine.playUI();
      this._showSalvage();
    });
    this.body.querySelectorAll('[data-pod]').forEach((b) => b.addEventListener('click', () => this._openPod(b.dataset.pod)));
    this.body.querySelectorAll('[data-pack]').forEach((b) => b.addEventListener('click', () => this._openPod(b.dataset.pack, { pack: true })));
    this.body.querySelectorAll('[data-credit]').forEach((b) => b.addEventListener('click', () => this._openPod(b.dataset.credit, { credit: true })));
    this.body.querySelectorAll('[data-credit-pack]').forEach((b) => b.addEventListener('click', () => this._openPod(b.dataset.creditPack, { credit: true, pack: true })));
    this.body.querySelectorAll('[data-drops]').forEach((b) => b.addEventListener('click', () => {
      soundEngine.playUI();
      this._showDrops(b.dataset.drops);
    }));
  }

  /** Every part a pod can give, by rarity, with the chance per rarity and per item. */
  /**
   * SALVAGE SPARES: pick the tiers, see exactly what goes and the scrap it
   * pays, then confirm. Equipped parts are never touched; by default your
   * best copy of every part and anything upgraded are kept too. AUTO applies
   * the same tiers to new pod drops you already own as good or better.
   */
  _showSalvage() {
    const box = document.getElementById('rig-reveal');
    if (!box) return;
    const draw = () => {
      const prefs = saveSystem.getSalvagePrefs();
      const list = saveSystem.salvageCandidates(prefs);
      const total = list.reduce((s, o) => s + salvageValue(o), 0);
      const tierBtns = Object.keys(RANK).map((r) => {
        const on = prefs.tiers.includes(r);
        const n = saveSystem.salvageCandidates({ ...prefs, tiers: [r] }).length;
        return `<button class="salv-tier ${on ? 'on' : ''}" data-tier="${r}" style="--rar:${rarityColor(r)}" title="${on ? 'Salvaging' : 'Keeping'} ${rarityName(r).toLowerCase()} spares">${rarityName(r)}<i>${n}</i></button>`;
      }).join('');
      // Every tick here means "salvage more": the keep settings show flipped (ticked = salvage them too)
      // Each toggle says what it does right now on a second line (no hover needed)
      const opt = (key, label, onText, offText, flip = false) => {
        const on = flip ? !prefs[key] : !!prefs[key];
        return `<button class="salv-opt ${on ? 'on' : ''}" data-opt="${key}"><b>${on ? '&#10003;' : ''}</b><span>${label}<em>${on ? onText : offText}</em></span></button>`;
      };
      // No scrolling: as many icons as fit, then a count
      const SHOW = 28;
      const icons = list.slice(0, SHOW).map((o) => `<span class="salv-item" data-tip-uid="${o.uid}" style="--rar:${rarityColor(tierOf(o))}"><img src="${partIcon(o.id)}" alt=""><i>${o.level}</i></span>`).join('');
      box.style.removeProperty('--rar');
      box.classList.remove('mythic');
      box.innerHTML = `<div class="drops-panel salv-panel" style="--pod:#94b0c2">
          <div class="drops-title"><strong>${ico('scrap')}SALVAGE SPARES</strong><span>Equipped parts are never salvaged</span><button class="btn btn-outline" data-act="close">&#10005;</button></div>
          <p class="salv-hint">Lit tiers get salvaged (the number is how many spares). Past ${INVENTORY_CAP} parts, new pods salvage spares by these same settings.</p>
          <div class="salv-tiers">${tierBtns}</div>
          <div class="salv-opts">
            ${opt('keepBest', 'ALSO SALVAGE MY BEST COPY', 'Your best copy of each part can go too', 'Your best copy of each part is always kept', true)}
            ${opt('keepLeveled', 'ALSO SALVAGE UPGRADED PARTS', 'Parts above LV 1 can go too', 'Parts above LV 1 are always kept', true)}
            ${opt('smart', 'SMART: KEEP WHAT 3 MECHS CAN USE', 'Copies past what 3 mechs could fit become scrap, after every pod too (6 of a top gun, 12 of a side gun, 3 frames). Your best copies stay', 'No limit per part')}
            ${opt('auto', 'AUTO-SALVAGE POD DUPLICATES', 'New drops in the lit tiers you already own as good or better become scrap', 'New drops always stay in your inventory')}
          </div>
          <div class="salv-list">${icons || '<p class="dim-text">Nothing to salvage with these settings.</p>'}${list.length > SHOW ? `<span class="salv-more">+${list.length - SHOW}</span>` : ''}</div>
          <div class="rig-actions">
            <button class="btn ${list.length ? 'btn-danger' : 'btn-disabled'}" data-act="go" ${list.length ? '' : 'disabled'}>SALVAGE ${list.length} ${ico('scrap')}+${total}</button>
          </div>
        </div>`;
      box.querySelector('[data-act="close"]').addEventListener('click', () => {
        soundEngine.playUI();
        box.classList.add('hidden');
        this.render();
      });
      box.querySelectorAll('[data-tier]').forEach((b) => b.addEventListener('click', () => {
        const t = b.dataset.tier;
        const tiers = prefs.tiers.includes(t) ? prefs.tiers.filter((x) => x !== t) : [...prefs.tiers, t];
        saveSystem.setSalvagePrefs({ tiers });
        soundEngine.playUI();
        draw();
      }));
      box.querySelectorAll('[data-opt]').forEach((b) => b.addEventListener('click', () => {
        saveSystem.setSalvagePrefs({ [b.dataset.opt]: !prefs[b.dataset.opt] });
        soundEngine.playUI();
        draw();
      }));
      box.querySelector('[data-act="go"]')?.addEventListener('click', () => {
        const got = saveSystem.salvageMany(list.map((o) => o.uid));
        hideTip();
        soundEngine.play('confirm');
        haptics.impact('medium');
        this._renderWallet();
        draw();
        const btn = box.querySelector('[data-act="go"]');
        if (btn) btn.innerHTML = `${ico('scrap')}+${got} SCRAP`;
      });
    };
    draw();
    box.classList.remove('hidden');
  }

  _showDrops(podId) {
    const crate = CRATES.find((c) => c.id === podId);
    const box = document.getElementById('rig-reveal');
    const owned = new Set(saveSystem.getMech().owned.map((o) => o.id));
    const fmt = (v) => (v >= 1 ? `${Math.round(v * 10) / 10}` : v >= 0.1 ? v.toFixed(2).replace(/0$/, '') : v.toFixed(3).replace(/0+$/, ''));
    const rows = Object.entries(crate.odds).filter(([, v]) => v > 0).map(([r, v]) => {
      const pool = PARTS.filter((p) => p.rarity === r);
      return `<div class="drops-row" style="--rar:${rarityColor(r)}">
        <div class="drops-head"><b>${rarityName(r)}</b><span>${fmt(v)}%</span><em>${fmt(v / pool.length)}% each</em></div>
        <div class="drops-items">${pool.map((p) => `<span class="drops-item ${owned.has(p.id) ? 'owned' : ''}" data-part="${p.id}" data-tip-part="${p.id}"><img src="${partIcon(p.id)}" alt="">${owned.has(p.id) ? '<i>&#10003;</i>' : ''}</span>`).join('')}</div>
      </div>`;
    }).join('');
    box.style.removeProperty('--rar');
    box.classList.remove('mythic');
    box.innerHTML = `<div class="drops-panel" style="--pod:${crate.color}">
        <div class="drops-title"><strong>${crate.name}</strong><span>&#10003; = owned</span><button class="btn btn-outline" data-act="close">&#10005;</button></div>
        <div class="drops-list">${rows}</div>
        <div class="drops-info" id="drops-info">Tap a part to see it</div>
      </div>`;
    box.classList.remove('hidden');
    box.querySelector('[data-act="close"]').addEventListener('click', () => {
      soundEngine.playUI();
      box.classList.add('hidden');
    });
    // No hover on phones: tapping an icon shows its card
    box.querySelectorAll('[data-part]').forEach((el) => el.addEventListener('click', () => {
      box.querySelectorAll('.drops-item.sel').forEach((x) => x.classList.remove('sel'));
      el.classList.add('sel');
      document.getElementById('drops-info').innerHTML = partCardHtml({ id: el.dataset.part, level: 1 });
      soundEngine.play('select');
    }));
  }

  /**
   * Pod opening: the parts are dealt face down as cards. Tap a card (or
   * FLIP ALL) and it charges up, shaking harder while it glows; rare and
   * better cards shift the glow to their colour halfway (a tease), then it
   * flips over to show the part. Single pods are one card, packs five.
   */
  _openPod(podId, { free = false, pack = false, credit = false } = {}) {
    // Your best copy of each part before the pod: NEW (first one ever) / UPGRADE (better than it)
    const rankOf = (o) => RANK[tierOf(o)] * 100 + (o.level || 1);
    const best = new Map();
    for (const o of saveSystem.getMech().owned) best.set(o.id, Math.max(best.get(o.id) ?? -1, rankOf(o)));
    const got = saveSystem.buyCrate(podId, { free, pack, credit });
    if (!got) return soundEngine.play('error');
    const tags = got.map((o) => {
      const had = best.get(o.id);
      best.set(o.id, Math.max(had ?? -1, rankOf(o)));
      return o.autoSalvaged ? 'scrap' : had === undefined ? 'new' : rankOf(o) > had ? 'up' : '';
    });
    this._renderWallet();
    const crate = CRATES.find((c) => c.id === podId);
    const box = document.getElementById('rig-reveal');
    if (!box) return;
    const back = uiIcon('pod', '#f4f4f4');
    box.style.setProperty('--rar', crate.color);
    box.classList.remove('mythic');
    box.innerHTML = `
      <div class="rig-rays"></div>
      <div class="pcards ${got.length > 1 ? 'pack' : 'single'}">
        ${got.map((o, i) => {
          const tier = tierOf(o);
          const p = getPart(o.id);
          // The back already shows the rarity (colour + a light beam, like Super Mechs); the flip tells you which part
          const tag = { new: '<i class="pcard-tag new">NEW</i>', up: '<i class="pcard-tag up">&#9650; UPGRADE</i>' }[tags[i]] || '';
          return `<button class="pcard3d r${RANK[tier]} ${tags[i] === 'scrap' ? 'scrapped' : ''}" data-i="${i}" style="--pod:${rarityColor(tier)};--rar:${rarityColor(tier)};--dt:${dtBg(p)};--deal:${i * 0.12}s">
            <span class="pcard-beam"></span>
            <span class="pcard-face back"><img src="${back}" alt=""><em>${rarityName(tier)}</em></span>
            <span class="pcard-face front">
              ${tag}
              <img src="${partIcon(p.id)}" alt="">
              <b>${rarityName(tier)}</b>
              <strong>${p.name}</strong>
              <i class="pcard-type">${TYPE_LABEL[p.type]}</i>
              ${o.autoSalvaged ? `<i class="pcard-scrap" title="Salvaged by your salvage settings">&#8594; ${ico('scrap')}+${o.autoSalvaged} SCRAP</i>` : ''}
            </span>
          </button>`;
        }).join('')}
      </div>
      <p class="pcards-hint">TAP A CARD</p>
      <div class="rig-actions pcards-actions">
        ${got.length > 1 ? '<button class="btn btn-accent" data-act="all">FLIP ALL</button>' : ''}
        <button class="btn btn-outline hidden" data-act="ok">OK</button>
        <button class="btn btn-accent hidden" data-act="fit">VIEW IN RIG</button>
      </div>`;
    box.classList.remove('hidden');
    haptics.impact('medium');
    soundEngine.play('select');

    const cards = [...box.querySelectorAll('.pcard3d')];
    let flipped = 0;
    let queue = Promise.resolve();
    const done = () => {
      box.querySelector('.pcards-hint')?.classList.add('hidden');
      box.querySelector('[data-act="all"]')?.classList.add('hidden');
      box.querySelector('[data-act="ok"]').classList.remove('hidden');
      box.querySelector('[data-act="fit"]').classList.remove('hidden');
      const best = Math.max(...got.map((o) => RANK[tierOf(o)]));
      box.style.setProperty('--rar', rarityColor(Object.keys(RANK)[best]));
      box.classList.toggle('mythic', best >= 4);
    };
    const flip = (i) => {
      const el = cards[i];
      if (!el || el.dataset.state) return queue;
      el.dataset.state = 'charging';
      queue = queue.then(() => this._flipCard(el, got[i])).then(() => {
        flipped += 1;
        if (flipped === got.length) done();
      });
      return queue;
    };
    cards.forEach((el, i) => el.addEventListener('click', () => flip(i)));
    box.querySelector('[data-act="all"]')?.addEventListener('click', () => {
      soundEngine.playUI();
      // Worst first, the best card last (the drama)
      [...cards.keys()].sort((a, b) => RANK[tierOf(got[a])] - RANK[tierOf(got[b])]).forEach((i) => flip(i));
    });
    box.querySelector('[data-act="ok"]').addEventListener('click', () => {
      soundEngine.playUI();
      this.render();
    });
    box.querySelector('[data-act="fit"]').addEventListener('click', () => {
      soundEngine.playUI();
      // The best card: prefer an empty slot it fits
      const owned = [...got].filter((o) => !o.autoSalvaged).sort((a, b) => RANK[tierOf(b)] - RANK[tierOf(a)])[0];
      if (!owned) return this.render(); // everything turned into scrap
      const p = getPart(owned.id);
      const m = saveSystem.getMech();
      const slots = SLOTS.filter((s) => slotAccepts(s, p));
      this.slot = (slots.find((s) => !m.loadout[s.id]) || slots[0]).id;
      this.focus = owned.uid;
      this.tab = 'loadout';
      this.render();
    });
  }

  /** One card: charge (shake + glow, rare+ shift colour halfway), then flip. Resolves when it's face up. */
  _flipCard(el, owned) {
    const rank = RANK[tierOf(owned)];
    const charge = 450 + rank * 180;
    return new Promise((resolve) => {
      el.classList.add('charge');
      el.style.setProperty('--glow', 'var(--rar)');
      el.style.setProperty('--charge', `${charge}ms`);
      const ticks = 3 + rank * 2;
      for (let i = 0; i < ticks; i++) setTimeout(() => soundEngine.playUI(300 + i * 60, 0.03), (charge / ticks) * i);
      setTimeout(() => {
        el.classList.remove('charge');
        el.classList.add('flipped', `r${rank}`);
        el.dataset.tipUid = owned.uid; // its hover card only once it's face up (no peeking)
        soundEngine.play(rank >= 3 ? 'alarm' : rank >= 1 ? 'coin' : 'confirm');
        haptics.impact(rank >= 2 ? 'heavy' : 'light');
        if (rank >= 3) {
          this.body.classList.add('pod-quake');
          setTimeout(() => this.body.classList.remove('pod-quake'), 420);
        }
        setTimeout(resolve, 260);
      }, charge);
    });
  }
}
