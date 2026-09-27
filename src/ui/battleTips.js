// ============================================================
// battleTips — hover a battle button (mouse) to see exactly what it
// will do right now: VENT's heat / energy numbers, END TURN's upkeep,
// STOMP, SWAP, and each gun / drone chip (damage vs the target,
// range, costs, ammo, why it can't fire). Numbers refresh while you
// hover, so they follow the fight.
// ============================================================

import { CONFIG } from '../config.js';
import { DTYPES, dtypeOf, partNote, reachLabel } from '../meta/Mech.js';

const G = CONFIG.gear;

const WHY = { USED: 'Already fired this turn: each gun fires once per turn', EMPTY: 'Out of ammo', HOT: 'Over your heat cap: VENT, or your next turn is lost', ENERGY: 'Not enough energy', RANGE: 'Out of reach: move closer', 'TOO CLOSE': 'Too close for this gun', BLOCKED: 'No clear line to the target', 'NO TARGET': 'No target', 'NO ACTIONS': 'No actions left', WAIT: 'Wait for your turn' };

const row = (label, value, color = '') => `<div class="tip-row"><span>${label}</span><b${color ? ` style="color:${color}"` : ''}>${value}</b></div>`;

function ventTip(game) {
  const p = game.player;
  const cooled = Math.round(Math.min(p.heat, p.cool * G.vent.coolMult));
  return `<h4>VENT <em>[V] · ends your turn</em></h4>
    ${row('Heat', `${Math.ceil(p.heat)} → ${Math.ceil(p.heat - cooled)} (-${cooled})`, '#ef7d57')}
    <p>The cooldown: cools ${p.cool * G.vent.coolMult} heat (2× your cooling). Energy only comes back from regeneration.</p>`;
}

function endTip(game) {
  const p = game.player;
  const D = G.drone;
  const on = (game.playerDrones || []).filter((d) => !d.off);
  const drones = on.map((d) => row(d.name.replace(' DRONE', ''), `${d.heal ? D.healEn : d.forcefieldEvery ? D.shieldEn : D.dmgEn} EN`, d.color)).join('');
  const left = p.actionsLeft || 0;
  return `<h4>END TURN <em>[Space]</em></h4>
    ${left ? `<p>${left} action${left > 1 ? 's' : ''} left unused.</p>` : ''}
    ${drones ? `<p>Drones act now:</p>${drones}` : ''}
    <p>Your next turn starts with:</p>
    ${row('Energy', `+${p.regen} (max ${p.energyMax})`, '#73eff7')}
    ${row('Heat', `-${p.cool}`, '#ef7d57')}
    ${p.heat > p.heatCap ? `<p class="tip-bad">Over your heat cap: your next turn is lost (overheat)${p.heat - p.cool > p.heatCap ? ', and the one after (shutdown)' : ''}.</p>` : ''}`;
}

function stompTip(game) {
  const p = game.player;
  const st = game.stompStatus(p, game.activeEnemy);
  const why = { 'NOT ADJACENT': 'Get right next to the enemy.', COVER: 'A wall is in the way.', USED: 'Once per turn.', HOT: 'Too hot to move.' }[st.reason] || '';
  return `<h4>STOMP <em>[F] · 1 action</em></h4>
    ${row('Damage', `${Math.round(p.stompDmg || 0)} Physical`)}
    ${row('Heat', `+${G.stompHeat}`, '#ef7d57')}
    <p>Kick the enemy right next to you and knock it back 1. Damage comes from your legs. Once per turn, no energy.</p>
    ${why ? `<p class="tip-why">${why}</p>` : ''}`;
}

function gunTip(game, i) {
  const w = game.playerWeapons?.[i];
  if (!w) return '';
  const st = game.playerGunState(i);
  const t = DTYPES[dtypeOf(w)];
  const p = game.player;
  const hits = w.fx?.burst ? ` (${w.fx.burst} hits)` : '';
  return `<h4 style="color:${w.color || '#f4f4f4'}">${w.name} <em>[${i ? 'E' : 'Q'}] · 1 action</em></h4>
    ${row('Damage', w.fx?.mine ? `${Math.round(w.dmg)} mine` : `~${st.dmg || Math.round(w.dmg)}${hits} ${t.name}`, t.color)}
    ${row('Range', `${reachLabel(w.reach)} position${w.reach[1] > 1 ? 's' : ''}${w.arc ? ' · lobbed' : ''}`)}
    ${row('Energy', `${w.en || 0} (have ${Math.floor(p.energy)})`, '#73eff7')}
    ${row('Heat', `+${w.heat || 0} (${Math.ceil(p.heat)}/${p.heatCap})`, '#ef7d57')}
    ${w.ammo ? row('Ammo', `${w.ammoLeft}/${w.ammo}`, '#ffcd75') : ''}
    <p>${partNote(w)}</p>
    ${st.ok && st.overheats ? `<p class="tip-bad">Overheats you (${Math.ceil(p.heat + (w.heat || 0))}/${p.heatCap}): your next turn is lost, more if cooling can't bring you back under.</p>` : ''}
    ${st.ok ? '' : `<p class="tip-bad">${WHY[st.reason] || st.reason}</p>`}`;
}

function droneTip(game, i) {
  const d = game.playerDrones?.[i];
  if (!d) return '';
  const D = G.drone;
  const en = d.heal ? D.healEn : d.forcefieldEvery ? D.shieldEn : D.dmgEn;
  const does = d.heal ? `Repairs ${Math.round(d.heal)} HP` : d.forcefieldEvery ? `Forcefield every ${d.forcefieldEvery} turns` : `Shoots for ~${Math.round(d.dmg)} ${DTYPES[dtypeOf(d)].name}`;
  return `<h4 style="color:${d.color || '#f4f4f4'}">${d.name} <em>${d.off ? 'DOCKED' : 'DEPLOYED'}</em></h4>
    <p>${does} at the end of each of your turns, any range.</p>
    ${row('Upkeep', `${en} EN per turn${d.dmg ? ` · +${D.dmgHeat} heat` : ''}`, '#73eff7')}
    <p>${d.off ? 'Tap to DEPLOY: uses 1 action, then it works every turn.' : 'Tap to recall it (free).'}</p>`;
}

/** A team mech in the team bar. */
function swapTip(game, i) {
  const m = game.team?.[i];
  if (!m) return '';
  const active = i === game.teamIndex;
  const guns = (m.weapons || []).map((w) => w.name).join(' + ') || 'No guns';
  const hp = Math.round(active ? game.player.hp : m.hp);
  const state = active ? 'FIGHTING' : hp <= 0 ? 'KNOCKED OUT' : 'SWAP · whole turn';
  return `<h4>${m.name} <em>${state}</em></h4>
    ${row('HP', `${hp}/${Math.round(m.maxHp)}`, '#a7f070')}
    <p>${guns}</p>
    <p>${active ? 'The mech on the lane.' : 'SWAP brings it in on the same position. It takes your whole turn, so do it at the start. If the fighting mech is knocked out, the next one drops in by itself.'}</p>`;
}

export class BattleTips {
  constructor(game, hud) {
    this.game = game;
    this.hud = hud;
    this.el = document.createElement('div');
    this.el.className = 'hud-tip hidden';
    document.body.appendChild(this.el);
    this.target = null;
    // Mouse only: on touch the chips act on press, so there's nothing to hover
    hud.addEventListener('pointerover', (e) => {
      if (e.pointerType !== 'mouse') return;
      const el = e.target.closest('#btn-vent, #btn-end-turn, #btn-stomp, [data-gun], [data-drone], [data-swap]');
      if (el) this.show(el);
    });
    hud.addEventListener('pointerout', (e) => {
      if (this.target && !this.target.contains(e.relatedTarget)) this.hide();
    });
    hud.addEventListener('pointerdown', () => this.hide());
  }

  show(el) {
    this.target = el;
    // A hovered gun lights up the plates it can hit
    this.game.previewGun = el.dataset?.gun !== undefined ? Number(el.dataset.gun) : null;
    this.refresh();
  }

  hide() {
    this.target = null;
    this.game.previewGun = null;
    this.el.classList.add('hidden');
  }

  /** Called every frame while in battle: live numbers, and gone if its button is. */
  refresh() {
    const el = this.target;
    if (!el) return;
    if (this.hud.classList.contains('hidden')) return this.hide(); // battle over
    if (!el.isConnected || el.classList.contains('hidden') || !this.game.player) {
      // The gun chips are rebuilt when their state changes: follow the same chip
      const gun = el.dataset?.gun;
      const drone = el.dataset?.drone;
      const swap = el.dataset?.swap;
      const again = gun !== undefined ? this.hud.querySelector(`[data-gun="${gun}"]`) : drone !== undefined ? this.hud.querySelector(`[data-drone="${drone}"]`) : swap !== undefined ? this.hud.querySelector(`[data-swap="${swap}"]`) : null;
      if (!again) return this.hide();
      this.target = again;
    }
    const t = this.target;
    const g = this.game;
    const html = t.id === 'btn-vent' ? ventTip(g) : t.id === 'btn-end-turn' ? endTip(g) : t.id === 'btn-stomp' ? stompTip(g) : t.dataset.swap !== undefined ? swapTip(g, Number(t.dataset.swap)) : t.dataset.gun !== undefined ? gunTip(g, Number(t.dataset.gun)) : droneTip(g, Number(t.dataset.drone));
    if (html !== this._html) {
      this.el.innerHTML = html;
      this._html = html;
    }
    this.el.classList.remove('hidden');
    // Above the button, kept on screen
    const r = t.getBoundingClientRect();
    const w = this.el.offsetWidth;
    const h = this.el.offsetHeight;
    const x = Math.max(8, Math.min(window.innerWidth - w - 8, r.left + r.width / 2 - w / 2));
    const y = r.top - h - 8 >= 8 ? r.top - h - 8 : r.bottom + 8;
    this.el.style.transform = `translate(${Math.round(x)}px, ${Math.round(y)}px)`;
  }
}
