// ============================================================
// UIManager — DOM-based interface layer.
// Owns the main menu, tech tree view, run map screen, node
// modals (encounter/shop/rest/combat), battle HUD, and results.
// No game logic here — it renders state and forwards actions
// through callbacks.
// ============================================================

import { CONFIG } from '../config.js';
import { NODE_STYLE } from '../rendering/RogueMapRenderer.js';

const C = CONFIG.colors;

import { saveSystem } from '../meta/SaveSystem.js';
import { soundEngine } from '../utils/SoundEngine.js';
import pkg from '../../package.json';
import { haptics } from '../platform/haptics.js';
import { RARITY } from '../meta/Relics.js';
import { BALLS, SKINS, isSkinUnlocked, skinColors } from '../meta/Balls.js';

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

    btnExportSave?.addEventListener('click', () => {
      soundEngine.playUI();
      this.showExportSave(saveSystem.exportSaveData());
    });

    btnImportSave?.addEventListener('click', () => {
      soundEngine.playUI();
      this.showImportSave();
    });

    btnResetData?.addEventListener('click', () => {
      soundEngine.playUI();
      this.showConfirm({
        title: 'RESET ALL DATA?',
        text: 'This permanently deletes your Tech Points, upgrades and stats. Export your save first if you want a backup.',
        confirmLabel: 'DELETE EVERYTHING',
        danger: true,
        onConfirm: () => {
          saveSystem.reset();
          location.reload();
        },
      });
    });

    document.getElementById('btn-credits')?.addEventListener('click', () => {
      soundEngine.playUI();
      this.showCredits();
    });

    // Audio Mute Toggle buttons (Menu + HUD)
    const handleAudioToggle = () => {
      soundEngine.toggleMute();
      this.updateAudioButtons();
    };

    document.getElementById('btn-audio-toggle')?.addEventListener('click', handleAudioToggle);
    document.getElementById('btn-settings')?.addEventListener('click', () => {
      soundEngine.playUI();
      this.showSettings();
    });
    this.updateAudioButtons();

    // Tech screen
    const btnTechBack = document.getElementById('btn-tech-back');
    if (btnTechBack) btnTechBack.addEventListener('click', () => this.cb.onBackToMenu());

    // Run map screen
    const btnRetreat = document.getElementById('btn-retreat');
    if (btnRetreat) {
      btnRetreat.addEventListener('click', () => {
        soundEngine.playUI();
        this.closeDrawers();
        this.showConfirm({
          title: 'ABANDON RUN?',
          text: 'The current operation ends immediately. Tech Points from completed quests are kept.',
          confirmLabel: 'ABANDON RUN',
          danger: true,
          onConfirm: () => this.cb.onRetreat(),
        });
      });
    }

    // Run screen drawer (Status)
    document.querySelectorAll('[data-drawer]').forEach((btn) => {
      btn.addEventListener('click', () => {
        soundEngine.playUI();
        this.toggleDrawer(btn.dataset.drawer);
      });
    });
    document.querySelectorAll('[data-drawer-close]').forEach((el) => {
      el.addEventListener('click', () => this.closeDrawers());
    });

    // Result screen
    const btnRunEnd = document.getElementById('btn-run-end');
    if (btnRunEnd) btnRunEnd.addEventListener('click', () => this.cb.onRunEndConfirm());
  }

  updateAudioButtons() {
    const isMuted = soundEngine.muted;
    const btn1 = document.getElementById('btn-audio-toggle');
    if (btn1) btn1.textContent = isMuted ? 'SND OFF' : 'SND ON';
  }

  // ---------- New node types ----------

  /** Treasure: pick one of the offered relics for free. */
  showTreasure(relics, onPick) {
    const cards = relics.map((r) => `
      <button class="shop-item treasure-pick" data-relic="${r.id}">
        <div class="shop-item-head">
          <span class="shop-item-icon">${r.icon}</span>
          <strong class="relic-name" style="color:${RARITY[r.rarity].color}">${r.name}</strong>
          <span class="shop-item-cat" style="color:${RARITY[r.rarity].color}">${RARITY[r.rarity].label}</span>
        </div>
        <div class="shop-desc">${r.desc}</div>
      </button>`).join('');
    this.openModal('TREASURE CACHE', `<p>Choose one relic to keep.</p><div class="shop-grid">${cards}</div>`,
      `<div class="btn-row"><button class="btn btn-outline" data-act="skip">LEAVE IT</button></div>`);
    this.modalBody.querySelectorAll('[data-relic]').forEach((b) => b.addEventListener('click', () => {
      this.closeModal();
      onPick(b.dataset.relic);
    }));
    this.modalActions.querySelector('[data-act="skip"]').addEventListener('click', () => {
      this.closeModal();
      onPick(null);
    });
  }

  /** Gamble: bet or walk away; `onBet` returns the outcome text to show. */
  showGamble(run, cost, onBet, onLeave) {
    const can = run.gold >= cost;
    this.openModal('BACK-ALLEY GAMBLE', `<p>"Double or nothing, friend. Well... triple."</p>
      <div class="encounter-tags"><span class="tag-pill tag-loss">-${cost} G</span><span class="tag-pill tag-gold">50%: +45 GOLD OR A RELIC</span></div>`,
      `<div class="btn-row">
        <button class="btn btn-outline" data-act="leave">WALK AWAY</button>
        <button class="btn btn-accent" data-act="bet" ${can ? '' : 'disabled'}>${can ? `BET ${cost}G` : 'NOT ENOUGH GOLD'}</button>
      </div>`);
    this.modalActions.querySelector('[data-act="leave"]').addEventListener('click', () => {
      this.closeModal();
      onLeave();
    });
    this.modalActions.querySelector('[data-act="bet"]').addEventListener('click', () => {
      const { won, text } = onBet();
      this.openModal(won ? 'YOU WIN!' : 'YOU LOSE', `<p class="${won ? 'accent-green' : ''}">${text}</p>`,
        `<div class="btn-row"><button class="btn btn-accent" data-act="ok">CONTINUE</button></div>`);
      this.modalActions.querySelector('[data-act="ok"]').addEventListener('click', () => {
        this.closeModal();
        onLeave();
      });
    });
  }

  /** Curse Shrine: show the curse + the epic relic on offer. */
  showShrine(curse, relic, onAccept, onLeave) {
    this.openModal('CURSE SHRINE', `<p>The shrine offers power, for a price.</p>
      <div class="shrine-deal">
        <div class="shrine-side curse"><span>CURSE</span><strong>${curse.name}</strong><em>${curse.desc}</em></div>
        <div class="shrine-side gift"><span>EPIC RELIC</span><strong>${relic.name}</strong><em>${relic.desc}</em></div>
      </div>`,
      `<div class="btn-row">
        <button class="btn btn-outline" data-act="leave">REFUSE</button>
        <button class="btn btn-danger" data-act="accept">ACCEPT THE DEAL</button>
      </div>`);
    this.modalActions.querySelector('[data-act="leave"]').addEventListener('click', () => {
      this.closeModal();
      onLeave();
    });
    this.modalActions.querySelector('[data-act="accept"]').addEventListener('click', () => {
      this.closeModal();
      onAccept();
    });
  }

  /** Operation condition card shown when a run starts. */
  showCondition(cond) {
    this.openModal('OPERATION CONDITION', `<p class="condition-name">${cond.name}</p><p>${cond.desc}</p>`,
      `<div class="btn-row"><button class="btn btn-accent" data-act="ok">DEPLOY</button></div>`);
    this.modalActions.querySelector('[data-act="ok"]').addEventListener('click', () => this.closeModal());
  }

  // ---------- Ball select ----------

  /** Pick a ball for the run. Remembers the last choice. */
  showBallSelect(onStart) {
    let selected = 'vanguard';
    try {
      selected = localStorage.getItem('slingshot-ball') || 'vanguard';
    } catch (_) {}
    if (!BALLS.some((b) => b.id === selected)) selected = 'vanguard';

    const bars = (n) => Array.from({ length: 5 }, (_, i) => `<i class="${i < n ? 'on' : ''}"></i>`).join('');
    const cards = BALLS.map((b) => `
      <button class="ball-card" data-ball="${b.id}" style="--ball:${b.color}">
        <img class="ball-sprite" src="${pixelBall(b.color, b.darkColor, b.radiusMult)}" alt="">
        <strong>${b.name}</strong>
        <span class="ball-role">${b.role}</span>
        <span class="ball-stat">HP<em>${bars(b.rating.hp)}</em></span>
        <span class="ball-stat">ATK<em>${bars(b.rating.atk)}</em></span>
        <span class="ball-stat">PWR<em>${bars(b.rating.power)}</em></span>
      </button>`).join('');

    this.openModal('CHOOSE YOUR BALL', `
      <div class="ball-grid">${cards}</div>
      <p class="ball-trait" id="ball-trait"></p>
      <div class="skin-row" id="skin-row"></div>`, `<div class="btn-row">
        <button class="btn btn-outline" data-act="cancel">BACK</button>
        <button class="btn btn-primary" data-act="start">&#9654; START</button>
      </div>`);

    const traitEl = document.getElementById('ball-trait');
    const select = (id) => {
      selected = id;
      this.modalBody.querySelectorAll('.ball-card').forEach((c) => c.classList.toggle('selected', c.dataset.ball === id));
      const b = BALLS.find((x) => x.id === id);
      const mods = [
        b.hpBonus ? `${b.hpBonus > 0 ? '+' : ''}${b.hpBonus} HP` : '',
        b.atkPct ? `+${Math.round(b.atkPct * 100)}% ATK` : '',
        b.powerPct ? `${b.powerPct > 0 ? '+' : ''}${Math.round(b.powerPct * 100)}% launch power` : '',
      ].filter(Boolean).join(' · ');
      traitEl.innerHTML = `<strong style="color:${b.color}">${b.name}:</strong> ${b.trait}${mods ? ` <span class="dim-text">(${mods})</span>` : ''}`;
      renderSkins(b);
    };

    // Skins for the selected ball (locked ones show how to unlock them)
    let skin = 'default';
    const skinRow = document.getElementById('skin-row');
    const renderSkins = (b) => {
      const stats = saveSystem.getBallStats(b.id);
      try {
        skin = localStorage.getItem(`slingshot-skin-${b.id}`) || 'default';
      } catch (_) {}
      if (!isSkinUnlocked(SKINS.find((s) => s.id === skin) || SKINS[0], stats)) skin = 'default';
      skinRow.innerHTML = '<span class="skin-label">SKIN</span>' + SKINS.map((s) => {
        const open = isSkinUnlocked(s, stats);
        const { color, darkColor } = skinColors(b, s.id);
        return `<button class="skin-btn ${s.id === skin ? 'selected' : ''} ${open ? '' : 'locked'}" data-skin="${s.id}" ${open ? '' : 'disabled'} title="${open ? s.name : s.hint}">
          <img src="${pixelBall(color, darkColor, b.radiusMult)}" alt=""><span>${open ? s.name : `LOCKED: ${s.hint}`}</span>
        </button>`;
      }).join('');
      skinRow.querySelectorAll('[data-skin]:not([disabled])').forEach((btn) => btn.addEventListener('click', () => {
        skin = btn.dataset.skin;
        try {
          localStorage.setItem(`slingshot-skin-${b.id}`, skin);
        } catch (_) {}
        soundEngine.play('select');
        renderSkins(b);
      }));
    };
    this.modalBody.querySelectorAll('.ball-card').forEach((c) => {
      c.addEventListener('click', () => {
        soundEngine.play('select');
        haptics.impact('light');
        select(c.dataset.ball);
      });
    });
    select(selected);

    this.modalActions.querySelector('[data-act="cancel"]').addEventListener('click', () => this.closeModal());
    this.modalActions.querySelector('[data-act="start"]').addEventListener('click', () => {
      try {
        localStorage.setItem('slingshot-ball', selected);
      } catch (_) {}
      soundEngine.play('confirm');
      this.closeModal();
      onStart(selected, skin);
    });
  }

  // ---------- Settings ----------

  showSettings() {
    const row = (key, label, on) => `
      <button class="setting-row ${on ? 'on' : ''}" data-setting="${key}">
        <span>${label}</span><strong>${on ? 'ON' : 'OFF'}</strong>
      </button>`;
    const render = () => {
      this.openModal('SETTINGS', `
        <div class="settings-list">
          ${row('sfx', 'SOUND EFFECTS', soundEngine.sfxOn)}
          ${row('music', 'MUSIC', soundEngine.musicOn)}
          ${row('haptics', 'VIBRATION', haptics.enabled)}
        </div>`, `<div class="btn-row">
          <button class="btn btn-outline" data-act="credits">CREDITS</button>
          <button class="btn btn-accent" data-act="close">DONE</button>
        </div>`);
      this.modalBody.querySelectorAll('[data-setting]').forEach((btn) => {
        btn.addEventListener('click', () => {
          const key = btn.dataset.setting;
          if (key === 'sfx') soundEngine.setSfx(!soundEngine.sfxOn);
          if (key === 'music') soundEngine.setMusic(!soundEngine.musicOn);
          if (key === 'haptics') {
            haptics.setEnabled(!haptics.enabled);
            haptics.impact('medium');
          }
          soundEngine.playUI();
          this.updateAudioButtons();
          render();
        });
      });
      this.modalActions.querySelector('[data-act="credits"]').addEventListener('click', () => this.showCredits());
      this.modalActions.querySelector('[data-act="close"]').addEventListener('click', () => this.closeModal());
    };
    render();
  }

  // ---------- Generic dialogs ----------

  /** In-game replacement for window.confirm (styled, works the same on Android). */
  showConfirm({ title, text, confirmLabel = 'CONFIRM', cancelLabel = 'CANCEL', danger = false, onConfirm, onCancel }) {
    this.openModal(title, `<p>${text}</p>`, `<div class="btn-row">
        <button class="btn btn-outline" data-act="cancel">${cancelLabel}</button>
        <button class="btn ${danger ? 'btn-danger' : 'btn-accent'}" data-act="confirm">${confirmLabel}</button>
      </div>`);
    this.modalActions.querySelector('[data-act="cancel"]').addEventListener('click', () => {
      soundEngine.playUI();
      this.closeModal();
      onCancel?.();
    });
    this.modalActions.querySelector('[data-act="confirm"]').addEventListener('click', () => {
      this.closeModal();
      onConfirm?.();
    });
  }

  showRetreatConfirm(cost, { onConfirm, onCancel }) {
    this.showConfirm({
      title: 'RETREAT?',
      text: `Fall back to your previous tile. You lose <strong class="accent">${cost} HP</strong> and 1 move, and get no rewards. The hostile stays on the map, so you can come back for it later.`,
      confirmLabel: `RETREAT (-${cost} HP)`,
      cancelLabel: 'KEEP FIGHTING',
      danger: true,
      onConfirm,
      onCancel,
    });
  }

  // ---------- Save transfer ----------

  showExportSave(code) {
    this.openModal('EXPORT SAVE', `
      <p>Your save code is below. Keep it somewhere safe (notes app, a message to yourself) and use <strong>IMPORT SAVE</strong> on any device to restore it.</p>
      <textarea class="save-code" readonly>${code}</textarea>
      <p class="save-status" id="save-status"></p>
    `, `<div class="btn-row">
        <button class="btn btn-accent" data-act="copy">COPY CODE</button>
        <button class="btn btn-outline" data-act="close">DONE</button>
      </div>`);
    const status = document.getElementById('save-status');
    const box = this.modalBody.querySelector('.save-code');
    const copy = async () => {
      try {
        await navigator.clipboard.writeText(code);
        status.textContent = 'COPIED TO CLIPBOARD';
        status.className = 'save-status ok';
        soundEngine.play('confirm');
      } catch {
        box.focus();
        box.select();
        status.textContent = 'Could not copy automatically: long-press the code and choose Copy.';
        status.className = 'save-status err';
      }
    };
    this.modalActions.querySelector('[data-act="copy"]').addEventListener('click', copy);
    this.modalActions.querySelector('[data-act="close"]').addEventListener('click', () => this.closeModal());
    copy();
  }

  showImportSave() {
    this.openModal('IMPORT SAVE', `
      <p>Paste a save code (starts with <strong>SLING1-</strong>): long-press the box and choose Paste. <span class="accent">This replaces your current progress.</span></p>
      <textarea class="save-code" placeholder="SLING1-..." spellcheck="false" autocapitalize="off" autocomplete="off"></textarea>
      <p class="save-status" id="save-status"></p>
    `, `<div class="btn-row">
        <button class="btn btn-outline" data-act="cancel">CANCEL</button>
        <button class="btn btn-accent" data-act="import">IMPORT</button>
      </div>`);
    const status = document.getElementById('save-status');
    const box = this.modalBody.querySelector('.save-code');
    this.modalActions.querySelector('[data-act="cancel"]').addEventListener('click', () => this.closeModal());
    this.modalActions.querySelector('[data-act="import"]').addEventListener('click', () => {
      if (!box.value.trim()) {
        status.textContent = 'Paste a save code first.';
        status.className = 'save-status err';
        return;
      }
      if (saveSystem.importSaveData(box.value)) {
        status.textContent = 'SAVE RESTORED, RELOADING...';
        status.className = 'save-status ok';
        soundEngine.play('confirm');
        setTimeout(() => location.reload(), 700);
      } else {
        status.textContent = 'That code is incomplete or damaged. Copy the whole code and try again.';
        status.className = 'save-status err';
        soundEngine.play('error');
      }
    });
  }

  // ---------- Credits / legal ----------

  showCredits() {
    this.openModal('CREDITS', `
      <p><strong>SLINGSHOT OPS</strong> <span class="dim-text">v${pkg.version}</span><br>
      Design &amp; code by Boci.</p>
      <p class="dim-text">Fonts: Pixelify Sans &amp; Press Start 2P (SIL Open Font License 1.1).<br>
      Built with Capacitor (MIT License). Sound effects are synthesized in-game.</p>
      <p class="dim-text">This game collects no personal data and works fully offline.</p>
      <div id="credits-doc" class="credits-doc hidden"></div>
    `, `<div class="btn-row">
        <button class="btn btn-outline" data-doc="privacy">PRIVACY POLICY</button>
        <button class="btn btn-outline" data-doc="licenses">LICENSES</button>
      </div>
      <div class="btn-row"><button class="btn btn-accent" data-act="close">CLOSE</button></div>`);

    const doc = document.getElementById('credits-doc');
    this.modalActions.querySelectorAll('button[data-doc]').forEach((btn) => {
      btn.addEventListener('click', async () => {
        soundEngine.playUI();
        doc.classList.remove('hidden');
        // Bundled with the app (Vite public/), so this works offline
        if (btn.dataset.doc === 'privacy') {
          doc.innerHTML = '<iframe src="./privacy.html" title="Privacy policy"></iframe>';
        } else {
          try {
            const text = await (await fetch('./licenses.txt')).text();
            doc.innerHTML = '';
            const pre = document.createElement('pre');
            pre.textContent = text;
            doc.appendChild(pre);
          } catch {
            doc.textContent = 'Licenses unavailable.';
          }
        }
      });
    });
    this.modalActions.querySelector('button[data-act="close"]').addEventListener('click', () => this.closeModal());
  }

  // ---------- Run screen drawers ----------

  toggleDrawer(name) {
    const drawer = document.getElementById(`drawer-${name}`);
    if (!drawer) return;
    const opening = !drawer.classList.contains('open');
    this.closeDrawers();
    if (!opening) return;
    drawer.classList.add('open');
    this.screens.run.classList.add('drawer-open');
  }

  closeDrawers() {
    document.querySelectorAll('.run-drawer.open').forEach((d) => d.classList.remove('open'));
    this.screens.run.classList.remove('drawer-open');
  }

  /** Short-lived notification on the map screen (floor advanced, retreated, relic found...). */
  toast(html) {
    const stack = document.getElementById('toast-stack');
    if (!stack) return;
    const el = document.createElement('div');
    el.className = 'toast';
    el.innerHTML = html;
    stack.appendChild(el);
    while (stack.children.length > 3) stack.firstChild.remove();
    setTimeout(() => el.classList.add('out'), 2600);
    setTimeout(() => el.remove(), 3000);
  }

  _setBattleMode(on) {
    this.screens.run.classList.toggle('in-battle', on);
    if (on) this.closeDrawers();
  }

  // ---------- Generic screen switching ----------

  showMenu(profile, meta) {
    this._setVisible('menu');
    const el = document.getElementById('menu-stats');
    if (el) {
      el.innerHTML = `
        <div class="menu-stat"><span>Runs</span><strong>${meta.totalRuns}</strong></div>
        <div class="menu-stat"><span>Wins</span><strong>${meta.totalWins}</strong></div>
        <div class="menu-stat"><span>Tech Pts</span><strong class="accent">${this._tp()}</strong></div>
      `;
    }
  }

  showTech(techTree, saveSystem) {
    this._setVisible('tech');
    document.getElementById('tech-points').textContent = this._tp();
    const container = document.getElementById('tech-tree');
    const tabs = document.getElementById('tech-tabs');
    container.innerHTML = '';
    tabs.innerHTML = '';

    const branches = [
      { key: 'atk', title: 'ATTACK', color: 'var(--accent-red)' },
      { key: 'vit', title: 'VITALITY', color: 'var(--accent-green)' },
      { key: 'def', title: 'DEFENSE', color: 'var(--accent-blue)' },
      { key: 'tac', title: 'TACTICS', color: 'var(--accent-purple)' },
    ];
    // One branch at a time — remembered across re-renders (e.g. after a purchase)
    if (!branches.some((b) => b.key === this._techBranch)) this._techBranch = 'atk';

    for (const branch of branches) {
      const nodes = techTree.getAllNodes().filter((n) => n.branch === branch.key);
      const ranks = nodes.reduce((sum, n) => sum + techTree.getNodeLevel(n.id), 0);
      const maxRanks = nodes.reduce((sum, n) => sum + (n.maxLevel || 1), 0);
      const canBuy = nodes.some((n) => techTree.isUnlocked(n.id) && techTree.canPurchase(n.id));

      const tab = document.createElement('button');
      const active = branch.key === this._techBranch;
      tab.className = `tech-tab ${active ? 'active' : ''}`;
      tab.setAttribute('role', 'tab');
      tab.setAttribute('aria-selected', String(active));
      tab.style.setProperty('--branch', branch.color);
      tab.innerHTML = `
        <span class="tech-tab-title">${branch.title}${canBuy ? '<i class="tech-tab-dot"></i>' : ''}</span>
        <span class="tech-tab-count">${ranks}/${maxRanks}</span>
      `;
      tab.addEventListener('click', () => {
        if (this._techBranch === branch.key) return;
        soundEngine.playUI();
        this._techBranch = branch.key;
        this.showTech(techTree, saveSystem);
      });
      tabs.appendChild(tab);

      if (!active) continue;
      container.style.setProperty('--branch', branch.color);

      for (const node of nodes) {
        const lvl = techTree.getNodeLevel(node.id);
        const maxLvl = node.maxLevel || 1;
        const isMaxed = techTree.isMaxed(node.id);
        const unlocked = techTree.isUnlocked(node.id);
        const affordable = techTree.canPurchase(node.id);
        const nextCost = techTree.getNodeNextCost(node.id);
        const requires = node.requires ? techTree.getAllNodes().find((n) => n.id === node.requires) : null;

        const pips = Array.from({ length: maxLvl }, (_, i) => `<i class="${i < lvl ? 'on' : ''}"></i>`).join('');

        const card = document.createElement('div');
        card.className = `tech-node ${isMaxed ? 'owned' : lvl > 0 ? 'part-owned' : ''} ${!unlocked ? 'locked' : ''}`;
        card.innerHTML = `
          <div class="tech-node-head">
            <span class="tech-icon">${node.icon || '[*]'}</span>
            <span class="tech-name">${node.label}</span>
          </div>
          <div class="tech-rank"><div class="tech-pips">${pips}</div><span>${lvl}/${maxLvl}</span></div>
          <div class="tech-desc">${node.desc}</div>
        `;

        const btn = document.createElement('button');
        if (isMaxed) {
          btn.className = 'btn btn-outline tech-buy';
          btn.disabled = true;
          btn.textContent = 'MAXED';
        } else if (!unlocked) {
          btn.className = 'btn btn-outline tech-buy';
          btn.disabled = true;
          btn.textContent = requires ? `NEEDS ${requires.label.toUpperCase()}` : 'LOCKED';
        } else {
          btn.className = `btn tech-buy ${affordable ? 'btn-accent' : 'btn-outline'}`;
          btn.disabled = !affordable;
          btn.innerHTML = `${lvl > 0 ? 'UPGRADE' : 'UNLOCK'} <span class="tech-price">${nextCost} TP</span>`;
          btn.addEventListener('click', () => this.cb.onTechPurchase(node.id));
        }
        card.appendChild(btn);
        container.appendChild(card);
      }
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

    document.getElementById('tech-apply').textContent = `ACTIVE BONUSES: ${parts.join('  ·  ')}`;
  }

  // ---------- Run map screen ----------

  showRunScreen(run, mapInstance, floor) {
    const mapView = document.getElementById('map-view');
    const battleView = document.getElementById('battle-view');
    if (mapView) mapView.classList.remove('hidden');
    if (battleView) battleView.classList.add('hidden');

    this._setVisible('run');
    this._setBattleMode(false);
    this.updateRunHud(run);
    this.renderMap(run, mapInstance, floor);
    this.renderQuests(run);
    this.renderRelics(run);
  }

  updateRunHud(run) {
    document.getElementById('run-hp').textContent = `${Math.ceil(run.hp)}/${run.maxHp}`;
    const hpBar = document.getElementById('run-hp-bar');
    if (hpBar) {
      const pct = Math.max(0, Math.min(1, run.hp / run.maxHp));
      hpBar.style.width = `${Math.round(pct * 100)}%`;
      hpBar.className = pct <= 0.3 ? 'low' : pct <= 0.6 ? 'mid' : '';
    }
    const actEl = document.getElementById('run-actions');
    if (actEl) actEl.textContent = `${run.floorActions ?? 5}`;
    document.getElementById('run-gold').textContent = `${run.gold}G`;
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
      chip.innerHTML = `<b style="color:${def.color}">${def.name}${count > 1 ? ` x${count}` : ''}</b> ${def.desc}`;
      container.appendChild(chip);
    }
    if (run.boons.length === 0) {
      container.innerHTML = '<span class="dim-text">No buffs yet: encounters and battles can grant them.</span>';
    }
    const cond = CONFIG.runConditions.find((c) => c.id === run.condition);
    if (cond) {
      const chip = document.createElement('span');
      chip.className = 'boon-chip';
      chip.style.borderColor = '#73eff7';
      chip.innerHTML = `<b style="color:#73eff7">${cond.name}</b> ${cond.desc}`;
      container.prepend(chip);
    }
    for (const id of run.curses || []) {
      const curse = CONFIG.curses.find((c) => c.id === id);
      if (!curse) continue;
      const chip = document.createElement('span');
      chip.className = 'boon-chip';
      chip.style.borderColor = '#ff5d73';
      chip.innerHTML = `<b style="color:#ff5d73">CURSE: ${curse.name}</b> ${curse.desc}`;
      container.appendChild(chip);
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
      container.innerHTML = '<span class="dim-text">No active quests</span>';
      return;
    }
    for (const q of quests) {
      const item = document.createElement('div');
      item.className = `quest-item ${q.completed ? 'done' : ''}`;

      let counterText = '';
      if (q.id === 'quest_shopping') {
        const spent = Math.min(40, run.totalGoldSpent || 0);
        counterText = `${spent}/40 Gold`;
      } else if (q.id === 'quest_perfect') {
        const fl = Math.min(5, (run.floor || 0) + 1);
        counterText = `${fl}/5 Floors`;
      } else if (q.id === 'quest_rest') {
        const h = Math.min(40, run.maxRestHealed || 0);
        counterText = `${h}/40 HP`;
      } else {
        counterText = q.completed ? '1/1' : '0/1';
      }

      item.innerHTML = `
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:2px;">
          <span class="quest-name" style="font-weight:600;font-size:12px;color:${q.completed ? 'var(--green)' : 'var(--text)'}">
            ${q.completed ? '[x]' : '[-]'} ${q.name}
          </span>
          <span style="font-family:var(--mono);font-size:11px;color:${q.completed ? 'var(--green)' : 'var(--accent)'};font-weight:700;">
            +${q.reward} TP
          </span>
        </div>
        <div style="display:flex;justify-content:space-between;align-items:center;font-size:11px;color:var(--text-dim);">
          <span>${q.desc}</span>
          <span style="font-family:var(--mono);font-weight:600;margin-left:6px;color:${q.completed ? 'var(--green)' : 'var(--accent)'}">[${counterText}]</span>
        </div>
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
      treasure: 'TREASURE CACHE',
      gamble: 'BACK-ALLEY GAMBLE',
      shrine: 'CURSE SHRINE',
      entry: 'START',
    };
    const title = labels[node.type] || node.type.toUpperCase();

    const body = `
      <div class="modal-node-icon" style="color:${style.color}">${style.icon}</div>
      <p>${this._nodeDescription(node)}</p>
    `;

    let actions = '';
    if (node.type === 'combat' || node.type === 'elite' || node.type === 'miniboss' || node.type === 'boss') {
      actions += `<div class="btn-row">
        <button class="btn btn-danger" data-act="fight">ENGAGE</button>
      </div>
      <div class="btn-row">
        <button class="btn btn-outline" data-act="back">&#9664; BACK</button>
        <button class="btn btn-outline" data-act="retreat" title="Slip past without fighting: no rewards, 1 move">SNEAK PAST · -10 HP</button>
      </div>`;
    } else {
      actions = `<div class="btn-row">
        <button class="btn btn-outline" data-act="back">&#9664; BACK</button>
        <button class="btn btn-accent" data-act="proceed">PROCEED</button>
      </div>`;
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
        else if (act === 'back') this.cb.onNodeBack();
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
        return 'A sector mini-boss. Defeat it for 2 relics and +50 gold.';
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
      case 'treasure':
        return 'An unguarded cache. Take one of two relics for free.';
      case 'gamble':
        return 'A shady dealer runs a coin game. Bet 15 gold: 50% to win 45 gold or a relic.';
      case 'shrine':
        return 'A shrine hums with bad energy. Accept a curse to claim an epic relic.';
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
          parts.push(`<span style="color:var(--accent)">+ RELIC: ${r.name}</span>`);
        }
      } else if (rewards.relic) {
        parts.push(`<span style="color:var(--accent)">+ RELIC: ${rewards.relic.name}</span>`);
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
      if (c.gainActions) parts.push(`<span class="tag-pill tag-action">+${c.gainActions} MOVE${c.gainActions > 1 ? 'S' : ''}</span>`);
      if (c.loseHp) parts.push(`<span class="tag-pill tag-loss">-${c.loseHp} HP</span>`);
      if (c.loseGold) parts.push(`<span class="tag-pill tag-loss">-${c.loseGold} G</span>`);
      if (c.loseMaxHp) parts.push(`<span class="tag-pill tag-loss">-${c.loseMaxHp} MAX HP</span>`);
      if (c.gambleGold) parts.push(`<span class="tag-pill tag-gold">50%: +${c.gambleGold} GOLD</span>`);
      if (c.heal) parts.push(`<span class="tag-pill tag-gain">+${c.heal} HP</span>`);
      if (c.gainMaxHp) parts.push(`<span class="tag-pill tag-gain">+${c.gainMaxHp} MAX HP</span>`);
      if (c.gainGold) parts.push(`<span class="tag-pill tag-gold">+${c.gainGold} GOLD</span>`);
      if (c.gainTech) parts.push(`<span class="tag-pill tag-tech">+${c.gainTech} TECH PTS</span>`);
      if (c.gainRelic) parts.push(`<span class="tag-pill tag-gold">+ RANDOM RELIC</span>`);
      if (c.gainBoon) {
        const boon = CONFIG.boons.find((b) => b.id === c.gainBoon);
        if (boon) parts.push(`<span class="tag-pill tag-boon">+ ${boon.name.toUpperCase()}: ${boon.desc}</span>`);
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
    let body = `<div class="shop-header-info"><span class="accent">YOUR GOLD: ${run.gold}G</span> · Refresh stock up to 3 times per visit</div>`;
    body += '<div class="shop-grid">';

    for (const relic of shopItems) {
      const cost = run.relicPrice(relic);
      const alreadyOwned = run.relics.includes(relic.id);
      const affordable = run.gold >= cost;

      body += `
        <div class="shop-item">
          <div class="shop-item-head">
            <span class="shop-item-icon">${relic.icon || '[*]'}</span>
            <strong class="relic-name">${relic.name}</strong>
            <span class="shop-item-cat" style="color:${RARITY[relic.rarity]?.color || 'inherit'}">${relic.category || ''}</span>
          </div>
          <div class="shop-desc">${relic.desc}</div>
          <button class="btn ${alreadyOwned ? 'btn-outline' : affordable ? 'btn-accent' : 'btn-outline'}"
            data-relic="${relic.id}" ${alreadyOwned || !affordable ? 'disabled' : ''}>${alreadyOwned ? 'OWNED' : cost + ' G'}</button>
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
      <div class="btn-row">
        <button class="btn btn-outline" data-act="refresh" ${canRefresh ? '' : 'disabled'}>
          ${refreshesLeft > 0 ? `REFRESH (${refreshesLeft}/3 • ${refreshCost}G)` : 'NO REFRESHES LEFT'}
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
      container.innerHTML = '<span class="dim-text">No relics</span>';
      return;
    }
    for (const id of run.relics) {
      const relic = CONFIG.relics.find((r) => r.id === id);
      if (!relic) continue;
      const item = document.createElement('div');
      item.className = 'relic-item';
      item.innerHTML = `
        <div class="relic-name" style="color:${RARITY[relic.rarity]?.color || 'inherit'}">${relic.name} <span class="relic-rarity">${RARITY[relic.rarity]?.label || ''}</span></div>
        <div class="relic-desc">${relic.desc}</div>
      `;
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
      maxHpVal += 10;
      notes.push('Family Feast');
    }
    if (run.hasRelic?.('rel_golden_apple')) {
      healVal = run.maxHp + maxHpVal;
      notes.push('Golden Apple');
    }

    const healMultiplier = saveSystem.getHealingMultiplier();
    const effectiveHealVal = Math.round(healVal * healMultiplier);

    let buttonText = run.hasRelic?.('rel_golden_apple') ? 'HEAL TO FULL' : `HEAL ${effectiveHealVal} HP`;
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
          parts.push(`<span style="color:var(--accent)">+ RELIC: ${r.name}</span>`);
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
    document.getElementById('result-risk')?.classList.add('hidden');
    document.getElementById('result-title').textContent =
      run.runResult === 'victory' ? 'OPERATION COMPLETE' : 'OPERATION FAILED';
    document.getElementById('result-title').style.color =
      run.runResult === 'victory' ? '#5fd3a8' : '#e0655c';
    const cond = CONFIG.runConditions.find((c) => c.id === run.condition);
    document.getElementById('result-sub').textContent = run.runResult === 'victory' ? 'The sector is clear.' : run.hp > 0 ? 'Operation abandoned.' : 'Your ball was destroyed.';
    const tile = (label, value) => `<div class="result-stat"><span>${label}</span><strong>${value}</strong></div>`;
    document.getElementById('result-stats').innerHTML = [
      tile('FLOOR', `${run.floor + 1}/${CONFIG.map.floors}`),
      tile('BATTLES WON', run.combatsWon),
      tile('BALL', run.ball?.name || 'VANGUARD'),
      tile('RELICS', run.relics.length),
      tile('RISK', saveSystem.getDifficultyLevel()),
      tile('CONDITION', cond ? cond.name : '-'),
    ].join('');

    const questList = document.getElementById('result-quests');
    questList.innerHTML = '';
    for (const q of quests) {
      const item = document.createElement('div');
      item.className = `quest-item ${q.completed ? 'done' : ''}`;
      item.innerHTML = `
        <span>${q.completed ? '✓' : '•'} ${q.name}</span>
        <span class="quest-reward">${q.completed ? `+${q.reward} TP` : '—'}</span>
      `;
      questList.appendChild(item);
    }
    if (!quests.length) questList.innerHTML = '<span class="dim-text">No quests this run.</span>';
    const tp = meta?.techPoints ?? (this.cb.getTechPoints ? this.cb.getTechPoints() : 0);
    document.getElementById('result-tp').textContent = `TECH POINTS: ${tp}`;
  }

  /** Full-screen warning card before mini-boss / boss fights. Tap (or wait) to begin. */
  showBossIntro({ title, name, desc, color }, onDone) {
    const el = document.getElementById('boss-intro');
    if (!el) return onDone();
    document.getElementById('boss-intro-sub').textContent = title;
    const nameEl = document.getElementById('boss-intro-name');
    nameEl.textContent = name;
    nameEl.style.color = color || '';
    document.getElementById('boss-intro-desc').textContent = desc;
    el.classList.remove('hidden', 'out');
    soundEngine.play('alarm');
    haptics.impact('heavy');

    let done = false;
    const finish = () => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      el.classList.add('out');
      setTimeout(() => el.classList.add('hidden'), 250);
      onDone();
    };
    const timer = setTimeout(finish, 4000);
    // Ignore taps for a moment so the tap that started the fight doesn't skip it
    setTimeout(() => el.addEventListener('pointerdown', finish, { once: true }), 500);
  }

  showRiskUnlocked(level, rule) {
    const el = document.getElementById('result-risk');
    if (!el) return;
    el.innerHTML = `RISK ${level} UNLOCKED<br><span>${rule.name}: ${rule.desc}</span>`;
    el.classList.remove('hidden');
    soundEngine.play('confirm');
  }

  showBattleHud(run, nodeType) {
    // Bosses can't be fled; everything else can
    document.getElementById('btn-retreat-battle')?.classList.toggle('hidden', nodeType === 'miniboss' || nodeType === 'boss');
    document.getElementById('battle-floor').textContent = `FLOOR ${run.floor + 1}`;
    document.getElementById('battle-node').textContent =
      nodeType === 'boss' ? 'BOSS' : nodeType === 'miniboss' ? 'MINI-BOSS' : nodeType === 'elite' ? 'ELITE' : 'COMBAT';
    document.getElementById('battle-gold').textContent = `${run.gold}G`;

    const mapView = document.getElementById('map-view');
    const battleView = document.getElementById('battle-view');
    if (mapView) mapView.classList.add('hidden');
    if (battleView) battleView.classList.remove('hidden');

    this._setVisible('battleHud', 'run');
    this._setBattleMode(true);
  }

  showMinigameView() {
    const mapView = document.getElementById('map-view');
    const battleView = document.getElementById('battle-view');
    if (mapView) mapView.classList.add('hidden');
    if (battleView) battleView.classList.remove('hidden');

    this._setVisible('run');
    this._setBattleMode(true);
  }

  clearBattleHud() {
    const mapView = document.getElementById('map-view');
    const battleView = document.getElementById('battle-view');
    if (mapView) mapView.classList.remove('hidden');
    if (battleView) battleView.classList.add('hidden');

    this._setVisible('run');
    this._setBattleMode(false);
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
/** Tiny pixel-art ball (same shading as the battle sprites) as a data URL. */
function pixelBall(color, dark, radiusMult = 1) {
  const N = 16;
  const c = document.createElement('canvas');
  c.width = N;
  c.height = N;
  const g = c.getContext('2d');
  const r = 7.6 * Math.min(1, 0.72 + radiusMult * 0.28);
  const mid = (N - 1) / 2;
  for (let y = 0; y < N; y++) {
    for (let x = 0; x < N; x++) {
      const dx = x - mid;
      const dy = y - mid;
      const d = Math.hypot(dx, dy);
      if (d > r) continue;
      const shade = (dx + dy) / r;
      g.fillStyle = d > r - 1 ? '#1a1c2c' : shade < -0.55 ? '#f4f4f4' : shade > 0.45 ? dark : color;
      g.fillRect(x, y, 1, 1);
    }
  }
  return c.toDataURL();
}
