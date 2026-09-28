// ============================================================
// battleTips — hover a battle button (mouse) to see exactly what it
// will do right now: VENT's heat / energy numbers, END TURN's upkeep,
// STOMP, SWAP, and each gun / drone chip (damage vs the target,
// range, costs, ammo, why it can't fire). Numbers refresh while you
// hover, so they follow the fight.
// ============================================================

import { CONFIG } from '../config.js';
import { DTYPES, dtypeOf, partNote, reachLabel, droneUpkeep, dmgLabel, reactorHit } from '../meta/Mech.js';
import { ico, partIcon } from '../rendering/pixelIcons.js';

const G = CONFIG.gear;

const WHY = { ACTIVE: 'Your shield is already up', ANCHORED: 'Anchored legs can\'t charge', JAMMED: 'Guns jammed: you were drained to 0 energy (you can still move, stomp and vent)', USED: 'Already fired this turn: each gun fires once per turn', EMPTY: 'Out of ammo', HOT: 'Over your heat cap: VENT, or your next turn is lost', ENERGY: 'Not enough energy', RANGE: 'Out of reach: move closer', 'TOO CLOSE': 'Too close for this gun', 'NO TARGET': 'No target', 'NO ACTIONS': 'No actions left', WAIT: 'Wait for your turn' };

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
  const on = (game.playerDrones || []).filter((d) => !d.off);
  const drones = on.map((d) => row(d.name.replace(' DRONE', ''), `${droneUpkeep(d).en} EN`, d.color)).join('');
  const left = p.actionsLeft || 0;
  return `<h4>END TURN <em>[Space]</em></h4>
    ${left ? `<p>${left} action${left > 1 ? 's' : ''} left unused.</p>` : ''}
    ${drones ? `<p>Drones act now:</p>${drones}` : ''}
    <p>Your next turn starts with:</p>
    ${row('Energy', `+${p.regen} (max ${p.energyMax})`, '#73eff7')}
    ${row('Heat', `-${p.cool}`, '#ef7d57')}
    ${p.heat > p.heatCap ? `<p class="tip-bad">Over your heat cap: your next turn is lost (overheat)${p.heat - p.cool > p.heatCap ? ', and the one after (shutdown)' : ''}.</p>` : ''}`;
}

/** An icon row: symbol, value, what it means on hover. */
const irow = (icon, value, tip, color = '') => `<div class="tip-row" title="${tip}"><span>${ico(icon)}</span><b${color ? ` style="color:${color}"` : ''}>${value}</b><em>${tip}</em></div>`;

function stompTip(game) {
  const p = game.player;
  const st = game.stompStatus(p, game.activeEnemy);
  const legs = p.legs || {};
  const t = DTYPES[legs.stompType] || DTYPES.phys;
  const why = { 'NOT ADJACENT': 'Get right next to the enemy', USED: 'Once per turn', HOT: 'Too hot', ENERGY: 'Not enough energy' }[st.reason] || '';
  return `<h4>${ico('stomp')} STOMP <em>[F] · 1 action</em></h4>
    ${irow(t.icon, dmgLabel(p.stompDmg || 0), `${t.name} damage`, t.color)}
    ${irow('range', '1', 'Range: right next to you')}
    ${irow('push', '1', 'Knocks back')}
    ${legs.stompEn ? irow('energy', legs.stompEn, 'Energy', DTYPES.energy.color) : ''}
    ${irow('heat', `+${legs.stompHeat ?? G.stompHeat}`, 'Heat', DTYPES.heat.color)}
    ${why ? `<p class="tip-why">${why}</p>` : ''}`;
}

function gunTip(game, i) {
  const w = game.playerWeapons?.[i];
  if (!w) return '';
  const st = game.playerGunState(i);
  const t = DTYPES[dtypeOf(w)];
  const p = game.player;
  const hits = w.fx?.burst ? ` x${w.fx.burst}` : '';
  const rx = reactorHit(w, w.dmg || 0);
  const per = w.fx?.burst > 1 ? ' per hit' : '';
  return `<h4 style="color:${w.color || '#f4f4f4'}"><img class="pxi" src="${partIcon(w.id)}" alt=""> ${w.name} <em>[${i + 1}] · 1 action</em></h4>
    ${irow('dmg', w.fx?.mine ? `${dmgLabel(w.dmg)} mine` : `${dmgLabel(st.dmg || w.dmg)}${hits}`, `${t.name} damage${st.dmg ? ' vs this target' : ''}`, t.color)}
    ${irow('range', `${reachLabel(w.reach)}${w.arc ? ' ⌒' : ''}`, w.arc ? 'Range · lobbed over cover' : 'Range · needs a clear line')}
    ${irow('energy', `${w.en || 0} <small>/ ${Math.floor(p.energy)}</small>`, 'Energy (you have)', DTYPES.energy.color)}
    ${irow('heat', `+${w.heat || 0} <small>${Math.ceil(p.heat)}/${p.heatCap}</small>`, 'Heat (yours / cap)', DTYPES.heat.color)}
    ${w.ammo ? irow('ammo', `${w.ammoLeft}/${w.ammo}`, 'Shots left', '#ffcd75') : ''}
    ${w.backfire ? irow('backfire', `-${Math.round(w.backfire)}`, 'Backfire: costs you HP', '#ff5d73') : ''}
    ${Object.entries(w.fx?.resDrain || {}).map(([k, v]) => irow('resdrain', `-${v}`, `${DTYPES[k].name} resist, rest of fight`, DTYPES[k].color)).join('')}
    ${rx.heat ? irow('heatin', `+${rx.heat}`, `Heat into the target${per}`, DTYPES.heat.color) : ''}
    ${rx.drain ? irow('drain', rx.drain, `Drains their energy${per}`, DTYPES.energy.color) : ''}
    ${w.fx?.push ? irow('push', w.fx.push, 'Knocks back') : ''}
    ${w.fx?.pull ? irow('pull', w.fx.pull, 'Pulls in') : ''}
    ${w.desc ? `<p>${w.desc}</p>` : ''}
    ${st.ok && st.overheats ? `<p class="tip-bad">${ico('heat')} ${Math.ceil(p.heat + (w.heat || 0))}/${p.heatCap}: overheats you, next turn lost</p>` : ''}
    ${st.ok ? '' : `<p class="tip-bad">${WHY[st.reason] || st.reason}</p>`}`;
}

function droneTip(game, i) {
  const d = game.playerDrones?.[i];
  if (!d) return '';
  const { en, heat } = droneUpkeep(d);
  const t = DTYPES[dtypeOf(d)];
  return `<h4 style="color:${d.color || '#f4f4f4'}"><img class="pxi" src="${partIcon(d.id)}" alt=""> ${d.name} <em>${d.off ? 'DOCKED' : 'DEPLOYED'}</em></h4>
    ${d.heal ? irow('heal', `+${Math.round(d.heal)}`, 'Repair every turn', '#a7f070') : d.forcefieldEvery ? irow('def', `1/${d.forcefieldEvery}`, 'Forcefield every few turns', '#a7f070') : irow('dmg', dmgLabel(d.dmg), `${t.name} damage every turn, any range`, t.color)}
    ${irow('energy', `${en}/T`, 'Energy per turn', DTYPES.energy.color)}
    ${heat ? irow('heat', `+${heat}/T`, 'Heat per turn', DTYPES.heat.color) : ''}
    <p>${d.off ? 'Tap: DEPLOY (1 action)' : 'Tap: recall (free)'}</p>`;
}

/** A special chip: what it does and what it costs. */
function specialTip(game, i) {
  const sp = game.playerSpecials?.[i];
  if (!sp) return '';
  const st = game.specialStatus(game.player, sp, game.activeEnemy);
  return `<h4 style="color:${sp.color || '#f4f4f4'}"><img class="pxi" src="${partIcon(sp.id)}" alt=""> ${sp.name} <em>1 action</em></h4>
    ${sp.ram ? irow('dmg', Math.round(sp.ram), 'Ram: Physical damage + knockback') : ''}
    ${sp.dist ? irow('move', sp.dist, 'Dash distance') : ''}
    ${sp.range ? irow('range', `2-${sp.range}`, 'Hook range') : ''}
    ${sp.absorb ? irow('def', Math.round(sp.absorb), 'Soaks damage') : ''}
    ${irow('energy', sp.en || 0, 'Energy', DTYPES.energy.color)}
    ${irow('heat', `+${sp.heat || 0}`, 'Heat', DTYPES.heat.color)}
    ${irow('ammo', `${sp.usesLeft}/${sp.uses}`, 'Uses left', '#ffcd75')}
    <p>${partNote(sp)}</p>
    ${st.ok ? '' : `<p class="tip-bad">${WHY[st.reason] || st.reason}</p>`}`;
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
      const el = e.target.closest('#btn-vent, #btn-end-turn, #btn-stomp, [data-gun], [data-drone], [data-swap], [data-special]');
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
      const special = el.dataset?.special;
      if (special !== undefined) {
        const again = this.hud.querySelector(`[data-special="${special}"]`);
        if (!again) return this.hide();
        this.target = again;
      }
      const again = gun !== undefined ? this.hud.querySelector(`[data-gun="${gun}"]`) : drone !== undefined ? this.hud.querySelector(`[data-drone="${drone}"]`) : swap !== undefined ? this.hud.querySelector(`[data-swap="${swap}"]`) : null;
      if (!again) return this.hide();
      this.target = again;
    }
    const t = this.target;
    const g = this.game;
    const html = t.id === 'btn-vent' ? ventTip(g) : t.id === 'btn-end-turn' ? endTip(g) : t.id === 'btn-stomp' ? stompTip(g) : t.dataset.swap !== undefined ? swapTip(g, Number(t.dataset.swap)) : t.dataset.special !== undefined ? specialTip(g, Number(t.dataset.special)) : t.dataset.gun !== undefined ? gunTip(g, Number(t.dataset.gun)) : droneTip(g, Number(t.dataset.drone));
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
