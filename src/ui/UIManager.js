// ============================================================
// UIManager — DOM-based interface layer.
// Owns the main menu, tech tree view, run map screen, node
// modals (encounter/shop/rest/combat), battle HUD, and results.
// No game logic here — it renders state and forwards actions
// through callbacks.
// ============================================================

import { CONFIG } from '../config.js';
import { NODE_STYLE } from '../rendering/RogueMapRenderer.js';
import { icon } from './icons.js';

const C = CONFIG.colors;

// Tech upgrade id → icon glyph
const TECH_ICONS = {
  atk_sharpshooter: 'target', atk_base_power: 'sword', atk_armor_pen: 'swords', atk_risk_resonance: 'skull', atk_ballistic_apex: 'play',
  vit_health: 'heart', vit_overflow_shield: 'shield', vit_emergency_medkit: 'sparkle', vit_titan_core: 'tent', vit_vampiric_vitality: 'flame',
  def_aegis: 'shield', def_matrix_pct: 'shieldHalf', def_thorns_resist: 'wall', def_forcefield: 'target', def_fortified_matrix: 'layers', def_kinetic_dampener: 'bolt',
  tac_war_chest: 'coin', tac_merchant: 'bag', tac_logistics: 'map', tac_intellect: 'chip', tac_relic_synergy: 'gem',
};

const BRANCH_ICONS = { atk: 'sword', vit: 'heart', def: 'shield', tac: 'map' };

const RELIC_CATEGORY_COLORS = {
  Tactical: '#7aa2ff', Economy: '#e8a94c', Gladiator: '#e0655c', 'High-Tech': '#4fc3f7',
  Frontier: '#8fe3c1', Sanctuary: '#5fd3a8',
};

/** Colored gem glyph for a relic, tinted by its category. */
function relicIcon(relic, size = 18) {
  const color = RELIC_CATEGORY_COLORS[relic.category] || '#c792ea';
  return `<span class="relic-ico" style="color:${color}" title="${relic.category || ''}">${icon('gem', size)}</span>`;
}

/** Row of filled / empty segments, e.g. rank 3 of 10. */
function pips(filled, total, color) {
  let html = '<div class="pips">';
  for (let i = 0; i < total; i++) {
    html += `<span class="pip ${i < filled ? 'on' : ''}" ${i < filled ? `style="background:${color}"` : ''}></span>`;
  }
  return html + '</div>';
}

/** Replace every [data-icon] placeholder inside root with its SVG. */
function hydrateIcons(root = document) {
  root.querySelectorAll('[data-icon]').forEach((el) => {
    if (el.dataset.hydrated) return;
    el.innerHTML = icon(el.dataset.icon, Number(el.dataset.size) || (el.classList.contains('ability-icon') ? 22 : 15));
    el.dataset.hydrated = '1';
  });
}

import { saveSystem } from '../meta/SaveSystem.js';
import { soundEngine } from '../utils/SoundEngine.js';

export class UIManager {
  /**
   * @param {Object} callbacks - action handlers owned by the App
   */
  constructor(callbacks) {
    this.cb = callbacks;
    this.screens = {
      menu: document.getElementById('screen-menu'),
      tech: document.getElementById('screen-tech'),
      run: document.getElementById('screen-run'),
      battleHud: document.getElementById('battle-hud'),
      result: document.getElementById('screen-result'),
    };
    this.nodeModal = document.getElementById('node-modal');
    this.modalTitle = document.getElementById('node-modal-title');
    this.modalBody = document.getElementById('node-modal-body');
    this.modalActions = document.getElementById('node-modal-actions');

    hydrateIcons();
    this.bindGlobalEvents();
  }

  bindGlobalEvents() {
    // Menu buttons
    const btnPlay = document.getElementById('btn-play');
    const btnTech = document.getElementById('btn-tech');
    if (btnPlay) btnPlay.addEventListener('click', () => this.cb.onPlay());
    if (btnTech) btnTech.addEventListener('click', () => this.cb.onOpenTech());

    // Save Export & Import buttons
    const btnExportSave = document.getElementById('btn-export-save');
    const btnImportSave = document.getElementById('btn-import-save');
    const btnResetData = document.getElementById('btn-reset-data');

    if (btnExportSave) {
      btnExportSave.addEventListener('click', () => {
        soundEngine.playUI();
        const json = saveSystem.exportSaveData();
        navigator.clipboard?.writeText(json).then(() => {
          alert('Save data copied to clipboard!');
        }).catch(() => {
          prompt('Copy save JSON manually:', json);
        });
      });
    }

    if (btnImportSave) {
      btnImportSave.addEventListener('click', () => {
        soundEngine.playUI();
        const input = prompt('Paste your save data JSON string:');
        if (input) {
          if (saveSystem.importSaveData(input)) {
            alert('Save data successfully imported!');
            location.reload();
          } else {
            alert('Invalid save data JSON!');
          }
        }
      });
    }

    if (btnResetData) {
      btnResetData.addEventListener('click', () => {
        soundEngine.playUI();
        if (confirm('Are you sure you want to reset ALL save data and tech tree progress?')) {
          saveSystem.reset();
          location.reload();
        }
      });
    }

    // Audio Mute Toggle buttons (Menu + HUD)
    const handleAudioToggle = () => {
      soundEngine.toggleMute();
      this.updateAudioButtons();
    };

    const btn1 = document.getElementById('btn-audio-toggle');
    const btn2 = document.getElementById('btn-audio-menu');
    if (btn1) btn1.addEventListener('click', handleAudioToggle);
    if (btn2) btn2.addEventListener('click', handleAudioToggle);
    this.updateAudioButtons();

    // Tech screen
    const btnTechBack = document.getElementById('btn-tech-back');
    if (btnTechBack) btnTechBack.addEventListener('click', () => this.cb.onBackToMenu());

    // Run map screen
    const btnRetreat = document.getElementById('btn-retreat');
    if (btnRetreat) {
      btnRetreat.addEventListener('click', () => {
        soundEngine.playUI();
        if (confirm('Abandon current operation? All run progress will be lost.')) {
          this.closeModal();
          this.cb.onRetreat();
        }
      });
    }

    // Result screen
    const btnRunEnd = document.getElementById('btn-run-end');
    if (btnRunEnd) btnRunEnd.addEventListener('click', () => this.cb.onRunEndConfirm());
  }

  updateAudioButtons() {
    const isMuted = soundEngine.muted;
    const glyph = icon(isMuted ? 'soundOff' : 'soundOn', 18);
    const btn1 = document.getElementById('btn-audio-toggle');
    const btn2 = document.getElementById('btn-audio-menu');
    if (btn1) btn1.innerHTML = glyph;
    if (btn2) btn2.innerHTML = `${glyph}<span>${isMuted ? 'SOUND OFF' : 'SOUND ON'}</span>`;
  }

  // ---------- Generic screen switching ----------

  showMenu(profile, meta) {
    this._setVisible('menu');
    const el = document.getElementById('menu-stats');
    if (el) {
      el.innerHTML = `
        <div class="menu-stat" title="Runs"><span class="menu-stat-ico" style="color:#7aa2ff">${icon('play', 22)}</span><strong>${meta.totalRuns}</strong><span>Runs</span></div>
        <div class="menu-stat" title="Wins"><span class="menu-stat-ico" style="color:#5fd3a8">${icon('trophy', 22)}</span><strong>${meta.totalWins}</strong><span>Wins</span></div>
        <div class="menu-stat" title="Tech Points"><span class="menu-stat-ico" style="color:#e8a94c">${icon('chip', 22)}</span><strong class="accent">${this._tp()}</strong><span>Tech</span></div>
      `;
    }
  }

  showTech(techTree, saveSystem) {
    this._setVisible('tech');
    document.getElementById('tech-points').textContent = this._tp();
    const container = document.getElementById('tech-tree');
    container.innerHTML = '';

    const branches = [
      { key: 'atk', title: 'ATTACK', color: '#e0655c' },
      { key: 'vit', title: 'VITALITY', color: '#5fd3a8' },
      { key: 'def', title: 'DEFENSE', color: '#7aa2ff' },
      { key: 'tac', title: 'TACTICS', color: '#c792ea' },
    ];

    for (const branch of branches) {
      const col = document.createElement('div');
      col.className = 'tech-column';
      col.innerHTML = `<h3 style="color:${branch.color}">${icon(BRANCH_ICONS[branch.key], 18)}${branch.title}</h3>`;

      const nodes = techTree
        .getAllNodes()
        .filter((n) => n.branch === branch.key);

      for (const node of nodes) {
        const lvl = techTree.getNodeLevel(node.id);
        const maxLvl = node.maxLevel || 1;
        const isMaxed = techTree.isMaxed(node.id);
        const unlocked = techTree.isUnlocked(node.id);
        const affordable = techTree.canPurchase(node.id);
        const nextCost = techTree.getNodeNextCost(node.id);

        const rankDots = maxLvl > 1
          ? `<div class="tech-rank">${pips(lvl, maxLvl, branch.color)}<span>${lvl}/${maxLvl}</span></div>`
          : '';

        const row = document.createElement('div');
        row.className = `tech-node ${isMaxed ? 'owned' : lvl > 0 ? 'part-owned' : ''} ${!unlocked ? 'locked' : ''}`;
        row.innerHTML = `
          <div class="tech-node-head">
            <span class="tech-icon" style="color:${branch.color}">${icon(unlocked ? (TECH_ICONS[node.id] || 'sparkle') : 'lock', 20)}</span>
            <span class="tech-name">${node.label}</span>
            ${isMaxed ? `<span class="tech-owned">${icon('check', 14)}</span>` : ''}
          </div>
          ${rankDots}
          <div class="tech-desc">${node.desc}</div>
        `;

        if (!isMaxed && unlocked) {
          const btn = document.createElement('button');
          btn.className = `btn btn-tech-buy ${affordable ? 'btn-accent' : 'btn-disabled'}`;
          btn.title = affordable ? (lvl > 0 ? 'Upgrade' : 'Unlock') : 'Not enough Tech Points';
          btn.innerHTML = `${icon(affordable ? (lvl > 0 ? 'sparkle' : 'check') : 'lock', 14)}${icon('chip', 14)}<span>${nextCost}</span>`;
          btn.addEventListener('click', () => {
            if (affordable) {
              this.cb.onTechPurchase(node.id);
            }
          });
          row.appendChild(btn);
        }

        col.appendChild(row);
      }

      container.appendChild(col);
    }

    // Refresh stats line
    const stats = techTree.getPermanentStats();
    const parts = [
      `+${Math.round(stats.atkBonus * 100)}% ATK`,
      `+${stats.hpBonus} HP`,
      `+${stats.defBonus} DEF`,
    ];
    if (stats.startGoldBonus) parts.push(`+${stats.startGoldBonus} Start Gold`);
    if (stats.shopDiscountBonus) parts.push(`-${Math.round(stats.shopDiscountBonus * 100)}% Shop Cost`);
    if (stats.hasVampiricVitality) parts.push('25% Lifesteal');
    if (stats.hasRelicSynergy) parts.push('Relic Synergy');

    document.getElementById('tech-apply').innerHTML = `${icon('check', 14)} ${parts.join(' · ')}`;
  }

  // ---------- Run map screen ----------

  showRunScreen(run, mapInstance, floor) {
    const mapView = document.getElementById('map-view');
    const battleView = document.getElementById('battle-view');
    if (mapView) mapView.classList.remove('hidden');
    if (battleView) battleView.classList.add('hidden');

    this._setVisible('run');
    this.updateRunHud(run);
    this.renderMap(run, mapInstance, floor);
    this.renderQuests(run);
    this.renderRelics(run);
  }

  updateRunHud(run) {
    document.getElementById('run-hp').textContent = `${Math.ceil(run.hp)}/${run.maxHp}`;
    const hpFill = document.getElementById('run-hp-fill');
    if (hpFill) {
      const pct = Math.max(0, Math.min(1, run.hp / run.maxHp));
      hpFill.style.width = `${pct * 100}%`;
      hpFill.style.background = pct > 0.3 ? '#5fd3a8' : '#e0655c';
    }
    const actEl = document.getElementById('run-actions');
    if (actEl) actEl.textContent = `${run.floorActions ?? 5}`;
    document.getElementById('run-gold').textContent = `${run.gold}`;
    const atkBonusPct = Math.round((run.atkBonusPct || 0) * 100);
    const totalAtk = (run.atk * 10).toFixed(1).replace('.0', '');
    document.getElementById('run-atk').textContent = atkBonusPct > 0 ? `${totalAtk} (+${atkBonusPct}%)` : `${totalAtk}`;

    const defPct = Math.round((run.defPctBonus || 0) * 100);
    const totalDef = run.totalDef;
    document.getElementById('run-def').textContent = defPct > 0 ? `${totalDef} (+${defPct}%)` : `${totalDef}`;

    const dmgRed = Math.round((run.damageReductionPct || 0) * 100);
    const dmgRedEl = document.getElementById('run-dmg-red');
    if (dmgRedEl) dmgRedEl.textContent = dmgRed > 0 ? `-${dmgRed}%` : `0%`;
    document.getElementById('run-floor').textContent = run.floorProgress;

    // Boon chips
    const container = document.getElementById('run-boons');
    container.innerHTML = '';
    const counts = {};
    for (const id of run.boons) {
      counts[id] = (counts[id] || 0) + 1;
    }
    for (const id of Object.keys(counts)) {
      const def = CONFIG.boons.find((b) => b.id === id);
      if (!def) continue;
      const count = counts[id];
      const chip = document.createElement('span');
      chip.className = 'boon-chip';
      chip.style.borderColor = def.color;
      chip.style.color = def.color;
      chip.textContent = count > 1 ? `${def.name} x${count}` : def.name;
      chip.title = `${def.desc} (Stack ${count})`;
      container.appendChild(chip);
    }
    if (run.boons.length === 0) {
      container.innerHTML = '';
    }

    this.renderRelics(run);
    this.renderQuests(run);
  }

  renderMap(run, mapInstance, floor) {
    const canvas = document.getElementById('map-canvas');
    // RogueMapRenderer instance is managed by the App; we render via callback.
    this.cb.onRenderMap(canvas, floor);
  }

  renderQuests(run) {
    const container = document.getElementById('run-quests');
    container.innerHTML = '';
    const quests = run.questSystem?.getActiveQuests?.() ?? [];
    if (quests.length === 0) {
      container.innerHTML = `<span class="empty-ico">${icon('clipboard', 22)}</span>`;
      return;
    }
    for (const q of quests) {
      const item = document.createElement('div');
      item.className = `quest-item ${q.completed ? 'done' : ''}`;

      // Progress as a fraction so it can be drawn as a bar
      let cur = q.completed ? 1 : 0;
      let max = 1;
      if (q.id === 'quest_shopping') {
        cur = Math.min(40, run.totalGoldSpent || 0); max = 40;
      } else if (q.id === 'quest_perfect') {
        cur = Math.min(5, (run.floor || 0) + 1); max = 5;
      } else if (q.id === 'quest_rest') {
        cur = Math.min(40, run.maxRestHealed || 0); max = 40;
      }
      const color = q.completed ? 'var(--green)' : 'var(--accent)';

      item.title = `${q.desc} (${cur}/${max})`;
      item.innerHTML = `
        <div class="quest-head">
          <span class="quest-ico" style="color:${color}">${icon(q.completed ? 'check' : 'clipboard', 14)}</span>
          <span class="quest-name">${q.name}</span>
          <span class="quest-tp" style="color:${color}">+${q.reward}${icon('chip', 12)}</span>
        </div>
        <div class="quest-bar"><div style="width:${(cur / max) * 100}%;background:${color}"></div></div>
      `;
      container.appendChild(item);
    }
  }

  // ---------- Node modal ----------

  openModal(title, bodyHTML, actionsHTML) {
    this.modalTitle.textContent = title;
    this.modalBody.innerHTML = bodyHTML;
    this.modalActions.innerHTML = actionsHTML;
    this.nodeModal.classList.add('open');
  }

  closeModal() {
    this.nodeModal.classList.remove('open');
  }

  /** Craft standard action buttons bound to callbacks. */
  _actionButton(text, cls, onClick) {
    const b = document.createElement('button');
    b.className = `btn ${cls}`;
    b.textContent = text;
    b.addEventListener('click', onClick);
    return b;
  }

  showNodeIntro(node, run) {
    const style = NODE_STYLE[node.type] || NODE_STYLE.combat;
    const labels = {
      combat: 'HOSTILE CONTACT',
      elite: 'ELITE HOSTILE DETECTED',
      miniboss: 'MINI-BOSS COMMANDER',
      boss: 'HIGH-VALUE TARGET',
      encounter: 'SIGNAL DETECTED',
      shop: 'SUPPLY DEPOT',
      rest: 'SAFE ZONE',
      minigame: 'PRECISION DRILL',
      entry: 'START',
    };
    const title = labels[node.type] || node.type.toUpperCase();

    const body = `
      <div class="modal-node-icon" style="color:${style.color}">${icon(style.icon, 56)}</div>
      <p>${this._nodeDescription(node)}</p>
    `;

    let actions = '';
    if (node.type === 'combat' || node.type === 'elite' || node.type === 'miniboss' || node.type === 'boss') {
      actions += `<div class="btn-row">
        <button class="btn btn-danger" data-act="fight">ENGAGE</button>
        <button class="btn" data-act="retreat">RETREAT</button>
      </div>`;
    } else {
      actions = `<div class="btn-row"><button class="btn btn-accent" data-act="proceed">PROCEED</button></div>`;
    }

    this.openModal(title, body, actions);
    this._bindModalActions(node);
  }

  _bindModalActions(node) {
    const buttons = this.modalActions.querySelectorAll('button[data-act]');
    buttons.forEach((btn) => {
      btn.addEventListener('click', () => {
        this.closeModal();
        const act = btn.dataset.act;
        if (act === 'fight') this.cb.onNodeFight(node);
        else if (act === 'retreat') this.cb.onNodeRetreat(node);
        else if (act === 'proceed') this.cb.onNodeProceed(node);
      });
    });
  }

  _nodeDescription(node) {
    switch (node.type) {
      case 'combat':
        return 'A hostile unit blocks the path. Eliminate it to earn gold and tech data.';
      case 'elite':
        return 'A heavily armed elite unit. High risk, high reward.';
      case 'miniboss':
        return 'A sector mini-boss! Defeat it for 2 Relic Collectibles and +50 Extra Gold.';
      case 'boss':
        return 'The sector commander. Eliminate it to complete the operation.';
      case 'encounter':
        return 'An anomalous signal. Approaching may yield rewards — or damage.';
      case 'shop':
        return 'A supply depot. Spend gold on run-scoped enhancements.';
      case 'rest':
        return 'A safe zone. Restore HP before continuing.';
      case 'minigame':
        return 'A calibration drill. Precision yields bonus supplies.';
      default:
        return 'Proceed.';
    }
  }

  showCombatResult(win, rewards, run) {
    const title = win ? 'CONTACT ELIMINATED' : 'CONTACT LOST';
    const color = win ? '#5fd3a8' : '#e0655c';
    let body = `<p style="color:${color};font-weight:700">${win ? 'Objective complete.' : 'Retreat successful.'}</p>`;
    if (rewards) {
      const parts = [];
      if (rewards.gold) parts.push(`+${rewards.gold} Gold`);
      if (rewards.tech) parts.push(`+${rewards.tech} TP`);
      if (rewards.heal) parts.push(`+${rewards.heal} HP`);
      if (rewards.relics && rewards.relics.length) {
        for (const r of rewards.relics) {
          parts.push(`<span style="color:var(--accent)">+ Collectible: ${r.name}</span>`);
        }
      } else if (rewards.relic) {
        parts.push(`<span style="color:var(--accent)">+ Collectible: ${rewards.relic.name}</span>`);
      }
      if (parts.length) body += `<p class="reward-line">${parts.join(' • ')}</p>`;
    }
    this.openModal('BATTLE REPORT', body,
      `<div class="btn-row"><button class="btn btn-accent" data-act="continue">CONTINUE</button></div>`
    );
    const btn = this.modalActions.querySelector('button[data-act="continue"]');
    btn.addEventListener('click', () => {
      this.closeModal();
      this.cb.onBattleReportContinue();
    });
  }

  showEncounterOptions(encounter) {
    const getPreview = (c) => {
      const parts = [];
      if (c.gainActions) parts.push(`<span class="tag-pill tag-action">+${c.gainActions} ACTION${c.gainActions > 1 ? 'S' : ''}</span>`);
      if (c.loseHp) parts.push(`<span class="tag-pill tag-loss">-${c.loseHp} HP</span>`);
      if (c.loseGold) parts.push(`<span class="tag-pill tag-loss">-${c.loseGold} G</span>`);
      if (c.heal) parts.push(`<span class="tag-pill tag-gain">+${c.heal} HP</span>`);
      if (c.gainMaxHp) parts.push(`<span class="tag-pill tag-gain">+${c.gainMaxHp} MAX HP</span>`);
      if (c.gainGold) parts.push(`<span class="tag-pill tag-gold">+${c.gainGold} GOLD</span>`);
      if (c.gainTech) parts.push(`<span class="tag-pill tag-tech">+${c.gainTech} TP</span>`);
      if (c.gainRelic) parts.push(`<span class="tag-pill tag-gold">+ COLLECTIBLE</span>`);
      if (c.gainBoon) {
        const boon = CONFIG.boons.find((b) => b.id === c.gainBoon);
        if (boon) parts.push(`<span class="tag-pill tag-boon">+ BOON: ${boon.name}</span>`);
      }
      return parts.length ? `<div class="encounter-tags">${parts.join('')}</div>` : '';
    };

    const actionHtml = encounter.choices.map((choice, i) => {
      const preview = getPreview(choice);
      return `<div class="btn-row">
        <button class="btn btn-enc-option" data-enc="${i}">
          <span class="enc-label">${choice.label.toUpperCase()}</span>
          ${preview}
        </button>
      </div>`;
    }).join('');

    this.openModal(
      encounter.title,
      `<p class="enc-desc">${encounter.desc}</p>`,
      actionHtml
    );
    this.modalActions.querySelectorAll('button[data-enc]').forEach((btn) => {
      btn.addEventListener('click', () => {
        this.closeModal();
        this.cb.onEncounterChoice(Number(btn.dataset.enc));
      });
    });
  }

  showShop(run, shopItems = [], refreshesLeft = 3, refreshCost = 8) {
    let body = `<div class="shop-header-info"><span style="color:#e8a94c">${icon('coin', 16)} ${run.gold}</span></div>`;
    body += '<div class="shop-grid" style="margin-top: 14px;">';

    for (const relic of shopItems) {
      const cost = Math.round(relic.cost * (run.shopDiscount || 1) * saveSystem.getShopPriceMultiplier());
      const alreadyOwned = run.relics.includes(relic.id);
      const affordable = run.gold >= cost;

      body += `
        <div class="shop-item" style="padding: 12px; margin-bottom: 10px; border: 1px solid var(--border); background: var(--bg-panel-2);">
          <div style="display: flex; gap: 10px; align-items: flex-start; flex: 1;">
            ${relicIcon(relic, 26)}
            <div style="flex: 1;">
              <div style="display: flex; justify-content: space-between; align-items: center;">
                <strong class="relic-name">${relic.name}</strong>

              </div>
              <div class="shop-desc" style="margin-top: 4px; font-size: 12px; color: var(--text-dim);">${relic.desc}</div>
            </div>
          </div>
          <div style="margin-top: 10px; display: flex; justify-content: flex-end;">
            <button class="btn ${alreadyOwned ? 'btn-disabled' : affordable ? 'btn-accent' : 'btn-disabled'}"
              data-relic="${relic.id}" ${alreadyOwned ? 'disabled' : ''}>${alreadyOwned ? icon('check', 14) : `${icon('coin', 14)} ${cost}`}</button>
          </div>
        </div>
      `;
    }

    body += '</div>';

    this.openModal('SUPPLY DEPOT', body, '');

    // Bind relic purchase buttons
    this.modalBody.querySelectorAll('button[data-relic]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const id = btn.dataset.relic;
        const relic = CONFIG.relics.find((r) => r.id === id);
        if (relic && this.cb.onRelicBuy(relic)) {
          this.cb.onShopRefresh();
        }
      });
    });

    // Action buttons: Refresh & Leave
    const canRefresh = refreshesLeft > 0 && run.gold >= refreshCost;
    this.modalActions.innerHTML = `
      <div class="btn-row" style="display: flex; gap: 12px; justify-content: flex-end; width: 100%;">
        <button class="btn ${canRefresh ? 'btn-outline' : 'btn-disabled'}" data-act="refresh" ${canRefresh ? '' : 'disabled'}>
          ${icon('retreat', 14)} ${refreshesLeft > 0 ? `${refreshesLeft}/3 · ${icon('coin', 14)} ${refreshCost}` : '0/3'}
        </button>
        <button class="btn btn-primary" data-act="leave">LEAVE</button>
      </div>
    `;

    const btnRefresh = this.modalActions.querySelector('button[data-act="refresh"]');
    if (btnRefresh && canRefresh) {
      btnRefresh.addEventListener('click', () => {
        if (this.cb.onShopDoRefresh) {
          this.cb.onShopDoRefresh();
        }
      });
    }

    const btnLeave = this.modalActions.querySelector('button[data-act="leave"]');
    if (btnLeave) {
      btnLeave.addEventListener('click', () => {
        this.closeModal();
        this.cb.onNodeProceed(undefined, true);
      });
    }
  }

  /** Render the relic detail panel on the run sidebar. */
  renderRelics(run) {
    const container = document.getElementById('run-relics');
    if (!container) return;
    container.innerHTML = '';
    if (run.relics.length === 0) {
      container.innerHTML = `<span class="empty-ico">${icon('gem', 22)}</span>`;
      return;
    }
    for (const id of run.relics) {
      const relic = CONFIG.relics.find((r) => r.id === id);
      if (!relic) continue;
      const item = document.createElement('div');
      item.className = 'relic-item';
      // Icon grid; the full description lives in the tooltip
      item.title = `${relic.name}\n${relic.desc}`;
      item.innerHTML = relicIcon(relic, 20);
      container.appendChild(item);
    }
  }

  showRest(run) {
    let healVal = CONFIG.run.hpRegenPerRest || 30;
    let maxHpVal = 0;
    const notes = [];

    if (run.permanent?.titanCoreHealBonusPct > 0) {
      healVal = Math.round(healVal * (1 + run.permanent.titanCoreHealBonusPct));
      maxHpVal += (run.permanent.titanCoreMaxHpBonus || 0);
      notes.push('Titan Core');
    }

    if (run.hasRelic?.('rel_family_feast')) {
      maxHpVal += 15;
      notes.push('Family Feast');
    }

    const healMultiplier = saveSystem.getHealingMultiplier();
    const effectiveHealVal = Math.round(healVal * healMultiplier);

    let buttonText = `HEAL ${effectiveHealVal} HP`;
    if (maxHpVal > 0) {
      buttonText += ` & +${maxHpVal} MAX HP`;
    }

    if (healMultiplier < 1) {
      notes.push(`Risk Penalty (-${Math.round((1 - healMultiplier) * 100)}% Heal)`);
    }

    const noteHtml = notes.length
      ? `<br><span style="font-size:12px;color:var(--accent);font-weight:600;">Active Bonuses: ${notes.join(' • ')}</span>`
      : '';

    this.openModal('SAFE ZONE',
      `<p style="margin-bottom:12px;">Take a moment to recover. Choose an option:${noteHtml}</p>`,
      `<div class="btn-row"><button class="btn btn-accent" data-rest="heal">${buttonText}</button></div>
       <div class="btn-row"><button class="btn" data-rest="leave">CONTINUE</button></div>`
    );
    this.modalActions.querySelectorAll('button[data-rest]').forEach((btn) => {
      btn.addEventListener('click', () => {
        this.closeModal();
        this.cb.onRestOption(btn.dataset.rest === 'heal' ? 'heal' : 'leave');
      });
    });
  }

  showBoon(boon) {
    this.openModal(
      boon.name,
      `<p style="color:${boon.color}">${boon.desc}</p>`,
      `<div class="btn-row"><button class="btn btn-accent" data-act="ok">ACCEPT</button></div>`
    );
    this.modalActions.querySelector('button[data-act="ok"]').addEventListener('click', () => {
      this.closeModal();
      this.cb.onBoonAccepted(boon.id);
    });
  }

  showMinigameIntro() {
    this.openModal(
      'PRECISION DRILL',
      `<p>Calibrate your timing. Land 3 of 5 in the green band. Rewards scale with accuracy.</p>`,
      `<div class="btn-row"><button class="btn btn-accent" data-act="start">START</button></div>`
    );
    this.modalActions.querySelector('button[data-act="start"]').addEventListener('click', () => {
      this.closeModal();
      this.cb.onMinigameStart();
    });
  }

  showMinigameResult(result, rewards = {}) {
    const hits = result.hits || 0;
    const perfects = result.perfects || 0;
    const totalAttempts = result.totalAttempts || 5;
    const isAllPerfect = hits === totalAttempts && perfects === totalAttempts;

    const title = isAllPerfect
      ? 'FLAWLESS DRILL'
      : perfects >= 3
      ? 'PRECISION DRILL'
      : hits >= 3
      ? 'DRILL PASSED'
      : 'DRILL FAILED';

    const color = (isAllPerfect || perfects >= 3 || hits >= 3) ? '#5fd3a8' : '#e0655c';

    let body = `<p style="color:${color};font-weight:700;font-size:16px;margin-bottom:6px;">${title}</p>`;
    body += `<p style="margin-bottom:12px;">Accuracy: <strong>${hits}/${totalAttempts} Hits</strong> • <strong>${perfects} Perfects</strong></p>`;

    if (rewards) {
      const parts = [];
      if (rewards.gold) parts.push(`+${rewards.gold} Gold`);
      if (rewards.healText || rewards.heal) parts.push(`<span style="color:#5fd3a8">${rewards.healText || ('+' + rewards.heal + ' HP Healed')}</span>`);
      if (rewards.relics && rewards.relics.length) {
        for (const r of rewards.relics) {
          parts.push(`<span style="color:var(--accent)">+ Collectible: ${r.name}</span>`);
        }
      }
      if (parts.length) {
        body += `<div style="padding:10px 14px;background:var(--bg-panel-2);border:1px solid var(--border);border-radius:4px;text-align:left;">
          <div style="font-size:10px;color:var(--text-dim);letter-spacing:1.5px;text-transform:uppercase;margin-bottom:4px;">REWARDS EARNED</div>
          <p class="reward-line" style="margin:0;font-weight:600;font-size:13px;line-height:1.6;">${parts.join('<br>')}</p>
        </div>`;
      }
    }

    this.openModal('DRILL REPORT', body,
      `<div class="btn-row"><button class="btn btn-accent" data-act="ok">CLAIM REWARDS</button></div>`
    );
    this.modalActions.querySelector('button[data-act="ok"]').addEventListener('click', () => {
      this.closeModal();
      this.cb.onMinigameDone();
    });
  }

  showRunResult(run, quests, meta) {
    this._setVisible('result');
    document.getElementById('result-title').textContent =
      run.runResult === 'victory' ? 'OPERATION COMPLETE' : 'OPERATION FAILED';
    document.getElementById('result-title').style.color =
      run.runResult === 'victory' ? '#5fd3a8' : '#e0655c';
    document.getElementById('result-sub').textContent =
      `Floors reached: ${run.floor + 1}/${CONFIG.map.floors} • Combats won: ${run.combatsWon}`;

    const questList = document.getElementById('result-quests');
    questList.innerHTML = '';
    for (const q of quests) {
      const item = document.createElement('div');
      item.className = `quest-item ${q.completed ? 'done' : ''}`;
      item.innerHTML = `
        <span><span style="color:${q.completed ? 'var(--green)' : 'var(--text-dim)'}">${icon(q.completed ? 'check' : 'clipboard', 14)}</span> ${q.name}</span>
        <span class="quest-reward">${q.completed ? `+${q.reward} ${icon('chip', 12)}` : '—'}</span>
      `;
      questList.appendChild(item);
    }
    const tp = meta?.techPoints ?? (this.cb.getTechPoints ? this.cb.getTechPoints() : 0);
    document.getElementById('result-tp').innerHTML = `${icon('chip', 18)} ${tp}`;
  }

  showBattleHud(run, nodeType) {
    document.getElementById('battle-floor').textContent = `${run.floor + 1}`;
    document.getElementById('battle-node').textContent =
      nodeType === 'boss' ? 'BOSS' : nodeType === 'miniboss' ? 'MINI-BOSS' : nodeType === 'elite' ? 'ELITE' : 'COMBAT';
    document.getElementById('battle-gold').textContent = `${run.gold}`;

    const mapView = document.getElementById('map-view');
    const battleView = document.getElementById('battle-view');
    if (mapView) mapView.classList.add('hidden');
    if (battleView) battleView.classList.remove('hidden');

    this._setVisible('battleHud', 'run');
  }

  showMinigameView() {
    const mapView = document.getElementById('map-view');
    const battleView = document.getElementById('battle-view');
    if (mapView) mapView.classList.add('hidden');
    if (battleView) battleView.classList.remove('hidden');

    this._setVisible('run');
  }

  clearBattleHud() {
    const mapView = document.getElementById('map-view');
    const battleView = document.getElementById('battle-view');
    if (mapView) mapView.classList.remove('hidden');
    if (battleView) battleView.classList.add('hidden');

    this._setVisible('run');
  }

  // ---------- helpers ----------

  _setVisible(...names) {
    for (const key of Object.keys(this.screens)) {
      const el = this.screens[key];
      if (el) {
        el.classList.toggle('hidden', !names.includes(key));
        if (names.includes(key)) el.classList.add('active');
        else el.classList.remove('active');
      }
    }
  }

  _tp() {
    // Tech points are read from the save via a callback.
    return this.cb.getTechPoints ? this.cb.getTechPoints() : 0;
  }
}