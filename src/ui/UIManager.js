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
import { BALLS, skinsFor, isSkinUnlocked, skinProgress, skinColors, getSkill } from '../meta/Balls.js';
import { ballDataUrl, CLASS_PATTERN } from '../rendering/ballSprite.js';
import { MEDALS, medalProgress, checkMedals } from '../meta/Medals.js';
import { SLOTS, describeItem, itemName, rarityColor, rarityName, upgradeCost, salvageValue, MAX_LEVEL as GEAR_MAX_LEVEL, INVENTORY_CAP as GEAR_CAP } from '../meta/Gear.js';

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
    document.getElementById('btn-medals')?.addEventListener('click', () => {
      soundEngine.playUI();
      this.showMedals();
    });
    document.getElementById('menu-daily')?.addEventListener('click', () => this._claimDaily());
    document.getElementById('btn-gear')?.addEventListener('click', () => {
      soundEngine.playUI();
      this.showGear();
    });

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
        <img class="ball-sprite" data-sprite="${b.id}" src="${ballDataUrl({ color: b.color, darkColor: b.darkColor, pattern: CLASS_PATTERN[b.id] }, b.radiusMult)}" alt="">
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
      const pct = (v) => `${v > 0 ? '+' : ''}${Math.round(v * 100)}%`;
      const mods = [
        b.hpBonus ? `<span class="${b.hpBonus > 0 ? 'mod-up' : 'mod-down'}">${b.hpBonus > 0 ? '+' : ''}${b.hpBonus} HP</span>` : '',
        b.defBonus ? `<span class="mod-up">+${b.defBonus} DEF</span>` : '',
        b.atkPct ? `<span class="${b.atkPct > 0 ? 'mod-up' : 'mod-down'}">${pct(b.atkPct)} ATK</span>` : '',
        b.powerPct ? `<span class="${b.powerPct > 0 ? 'mod-up' : 'mod-down'}">${pct(b.powerPct)} launch power</span>` : '',
        b.dmgTakenPct ? `<span class="mod-down">+${Math.round(b.dmgTakenPct * 100)}% damage taken</span>` : '',
      ].filter(Boolean).join(' · ');
      const skill = getSkill(b.id);
      traitEl.innerHTML = `<strong style="color:${b.color}">${b.name}:</strong> ${b.trait} <span class="dim-text">${b.feel}</span>${mods ? `<span class="ball-mods">${mods}</span>` : ''}
        <span class="ball-skill"><b style="color:${skill.color}">SKILL · ${skill.name}</b> <span class="dim-text">(${skill.cooldown - (b.id === 'vanguard' ? 1 : 0)} turn cooldown)</span> ${skill.desc}</span>`;
      renderSkins(b);
    };

    // Skins for the selected ball: each class has its own set (locked ones show progress)
    let skin = 'default';
    const skinRow = document.getElementById('skin-row');
    const renderSkins = (b) => {
      const stats = saveSystem.getBallStats(b.id);
      const list = skinsFor(b.id);
      try {
        skin = localStorage.getItem(`slingshot-skin-${b.id}`) || 'default';
      } catch (_) {}
      if (!isSkinUnlocked(list.find((s) => s.id === skin), stats)) skin = 'default';
      skinRow.innerHTML = '<span class="skin-label">SKIN</span>' + list.map((s) => {
        const open = isSkinUnlocked(s, stats);
        const look = skinColors(b, s.id);
        return `<button class="skin-btn ${s.id === skin ? 'selected' : ''} ${open ? '' : 'locked'}" data-skin="${s.id}" ${open ? '' : 'disabled'} title="${open ? s.name : s.hint}">
          <img src="${ballDataUrl(look, b.radiusMult)}" alt=""><span>${open ? s.name : `<b>${s.name}</b> ${s.hint} <em>${skinProgress(s, stats)}</em>`}</span>
        </button>`;
      }).join('');
      // The class card previews the chosen skin
      const card = this.modalBody.querySelector(`[data-sprite="${b.id}"]`);
      if (card) card.src = ballDataUrl(skinColors(b, skin), b.radiusMult);
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
    this._renderDaily();
    const medals = document.getElementById('btn-medals');
    if (medals) {
      const owned = MEDALS.filter((m) => saveSystem.hasMedal(m.id)).length;
      medals.innerHTML = `MEDALS <span class="btn-count">${owned}/${MEDALS.length}</span>`;
    }
  }

  _renderDaily() {
    const el = document.getElementById('menu-daily');
    if (!el) return;
    const d = saveSystem.getDailyStatus();
    el.classList.toggle('ready', d.canClaim);
    el.innerHTML = d.canClaim
      ? `<strong>DAILY SUPPLY READY</strong><span>TAP TO CLAIM +${d.reward} TP · DAY ${d.streak} STREAK</span>`
      : `<strong>SUPPLY CLAIMED</strong><span>DAY ${d.streak} STREAK · COME BACK TOMORROW</span>`;
  }

  _claimDaily() {
    const got = saveSystem.claimDaily();
    if (!got) {
      soundEngine.play('error');
      return;
    }
    soundEngine.play('confirm');
    haptics.impact('medium');
    this.toast(`<span class="feed-boon">DAILY SUPPLY: +${got.reward} TP (DAY ${got.streak})</span>`);
    this.celebrateMedals(checkMedals(saveSystem));
    this.showMenu(saveSystem.getProfile(), saveSystem.getMeta());
  }

  /** Toast for each newly earned medal. */
  celebrateMedals(list) {
    for (const m of list || []) {
      this.toast(`<span class="feed-relic">MEDAL: ${m.name}</span> <span class="feed-boon">+${m.tp} TP</span>`);
    }
    if (list?.length) soundEngine.play('confirm');
  }

  /** Gear screen: worn slots, scrap, and the inventory with equip / upgrade / salvage. */
  showGear(focusUid = null) {
    const g = saveSystem.getGear();
    const worn = new Set(Object.values(g.equipped));
    const card = (item, extraHtml = '') => {
      const color = rarityColor(item.rarity);
      return `<div class="gear-item ${worn.has(item.uid) ? 'worn' : ''} ${item.uid === focusUid ? 'flash' : ''}" style="--rarity:${color}">
        <div class="gear-item-head">
          <span class="gear-slot-tag">${item.slot.toUpperCase()}</span>
          <strong style="color:${color}">${itemName(item)}</strong>
          <em>+${item.level}</em>
        </div>
        <div class="gear-lines">${describeItem(item).map((l) => `<span>${l}</span>`).join('')}</div>
        ${extraHtml}
      </div>`;
    };

    const slots = SLOTS.map((slot) => {
      const item = g.items.find((i) => i.uid === g.equipped[slot.id]);
      return `<div class="gear-slot">
        <div class="gear-slot-name">${slot.name}<span>${slot.hint}</span></div>
        ${item ? card(item) : '<div class="gear-empty">EMPTY</div>'}
      </div>`;
    }).join('');

    const order = { legendary: 0, epic: 1, rare: 2, common: 3 };
    const items = [...g.items].sort((a, b) =>
      (worn.has(b.uid) - worn.has(a.uid)) || a.slot.localeCompare(b.slot) || order[a.rarity] - order[b.rarity] || b.level - a.level);
    const list = items.length
      ? items.map((item) => {
        const isWorn = worn.has(item.uid);
        const cost = upgradeCost(item);
        const maxed = item.level >= GEAR_MAX_LEVEL;
        return card(item, `<div class="gear-actions">
          <button class="btn ${isWorn ? 'btn-outline' : 'btn-accent'}" data-gear="equip" data-uid="${item.uid}">${isWorn ? 'UNEQUIP' : 'EQUIP'}</button>
          <button class="btn ${!maxed && g.scrap >= cost ? 'btn-primary' : 'btn-disabled'}" data-gear="upgrade" data-uid="${item.uid}" ${maxed || g.scrap < cost ? 'disabled' : ''}>${maxed ? 'MAX' : `UPGRADE ${cost}`}</button>
          <button class="btn ${isWorn ? 'btn-disabled' : 'btn-danger'}" data-gear="salvage" data-uid="${item.uid}" ${isWorn ? 'disabled' : ''}>SALVAGE +${salvageValue(item)}</button>
        </div>`);
      }).join('')
      : '<p class="gear-hint">No gear yet. Elites sometimes drop gear; mini-bosses and bosses always do. Higher Risk drops higher levels.</p>';

    this.openModal(`GEAR`,
      `<div class="gear-slots">${slots}</div>
       <div class="gear-bar"><span>SCRAP <strong>${g.scrap}</strong></span><span>${g.items.length}/${GEAR_CAP}</span></div>
       <div class="gear-list">${list}</div>`,
      `<div class="btn-row"><button class="btn btn-accent" data-act="close">CLOSE</button></div>`);
    this.modalActions.querySelector('[data-act="close"]').addEventListener('click', () => this.closeModal());
    this.modalBody.querySelectorAll('button[data-gear]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const uid = btn.dataset.uid;
        const act = btn.dataset.gear;
        const ok = act === 'equip' ? saveSystem.equipGear(uid)
          : act === 'upgrade' ? saveSystem.upgradeGear(uid)
            : saveSystem.salvageGear(uid) > 0;
        soundEngine.play(ok ? 'confirm' : 'error');
        const scroll = this.modalBody.querySelector('.gear-list')?.scrollTop || 0;
        this.showGear(act === 'salvage' ? null : uid);
        const listEl = this.modalBody.querySelector('.gear-list');
        if (listEl) listEl.scrollTop = scroll;
      });
    });
  }

  showMedals() {
    const owned = MEDALS.filter((m) => saveSystem.hasMedal(m.id)).length;
    const rows = MEDALS.map((m) => {
      const done = saveSystem.hasMedal(m.id);
      const [cur, max] = medalProgress(m, saveSystem);
      const pct = Math.round((Math.min(cur, max) / max) * 100);
      return `<div class="medal-row ${done ? 'done' : ''}">
        <i class="medal-icon">${done ? '&#9733;' : '&#9734;'}</i>
        <div class="medal-body">
          <strong>${m.name}</strong><span>${m.desc}</span>
          ${done ? '' : `<div class="medal-bar"><i style="width:${pct}%"></i></div>`}
        </div>
        <em class="medal-tp">${done ? 'EARNED' : `${Math.min(cur, max)}/${max}`}<br>+${m.tp} TP</em>
      </div>`;
    }).join('');
    this.openModal(`MEDALS ${owned}/${MEDALS.length}`, `<div class="medal-list">${rows}</div>`,
      `<div class="btn-row"><button class="btn btn-accent" data-act="close">CLOSE</button></div>`);
    this.modalActions.querySelector('[data-act="close"]').addEventListener('click', () => this.closeModal());
  }

  showTech(techTree) {
    this._setVisible('tech');
    document.getElementById('tech-points').textContent = this._tp();
    this._renderTechTree(document.getElementById('tech-tree'), techTree);

    // Bonus line (tap for the full list)
    const bonuses = techBonusList(techTree.getPermanentStats());
    const apply = document.getElementById('tech-apply');
    apply.innerHTML = bonuses.length
      ? `<b>ACTIVE BONUSES</b> ${bonuses.map((b) => `${b.value} ${b.label}`).join('  ·  ')}`
      : '<b>ACTIVE BONUSES</b> none yet: unlock a node to start';
    apply.onclick = () => {
      soundEngine.playUI();
      const rows = bonuses.map((b) => `<div class="bonus-row"><span>${b.label}</span><strong>${b.value}</strong></div>`).join('');
      this.openModal('ACTIVE BONUSES', rows ? `<div class="bonus-list">${rows}</div>` : '<p>No perks unlocked yet.</p>',
        '<div class="btn-row"><button class="btn btn-accent" data-act="close">CLOSE</button></div>');
      this.modalActions.querySelector('[data-act="close"]').addEventListener('click', () => this.closeModal());
    };
  }

  /**
   * The whole tree on one pannable, zoomable canvas: a CORE in the middle and
   * four branches growing out of it, each forking and ending in a capstone.
   * Drag to pan, pinch / wheel / buttons to zoom, tap a node to inspect it.
   */
  _renderTechTree(container, techTree) {
    const nodes = techTree.getAllNodes();
    const byId = Object.fromEntries(nodes.map((n) => [n.id, n]));
    const pos = (n) => techNodePos(n);
    const branchOf = (key) => TECH_BRANCHES.find((b) => b.key === key);

    const stateOf = (n) => {
      const lvl = techTree.getNodeLevel(n.id);
      if (techTree.isMaxed(n.id)) return 'maxed';
      if (!techTree.isUnlocked(n.id)) return 'locked';
      if (techTree.canPurchase(n.id)) return lvl > 0 ? 'owned affordable' : 'affordable';
      return lvl > 0 ? 'owned' : 'open';
    };

    if (!byId[this._techSelected]) {
      this._techSelected = (nodes.find((n) => techTree.canPurchase(n.id)) || nodes[0]).id;
    }

    // Branch-like connectors: S-curves that follow each branch's direction
    const curve = (a, b, dir, cls, color) => {
      const len = Math.hypot(b.x - a.x, b.y - a.y) * 0.45;
      return `<path class="tlink ${cls}" style="--branch:${color}" d="M${a.x} ${a.y} C${a.x + dir.x * len} ${a.y + dir.y * len} ${b.x - dir.x * len} ${b.y - dir.y * len} ${b.x} ${b.y}" />`;
    };
    const links = [];
    for (const branch of TECH_BRANCHES) {
      const dir = { x: Math.cos(branch.angle), y: Math.sin(branch.angle) };
      const root = nodes.find((n) => n.branch === branch.key && !techTree.getRequirements(n.id).length);
      if (root) links.push(curve(TECH_CORE, pos(root), dir, `trunk ${techTree.isPurchased(root.id) ? 'lit' : 'open'}`, branch.color));
      for (const n of nodes.filter((x) => x.branch === branch.key)) {
        for (const reqId of techTree.getRequirements(n.id)) {
          const r = byId[reqId];
          if (!r) continue;
          const lit = techTree.isPurchased(reqId) ? (techTree.isPurchased(n.id) ? 'lit' : 'open') : '';
          links.push(curve(pos(r), pos(n), dir, lit, branch.color));
        }
      }
    }

    // Branch name + ranks beside the core, clear of the branch's first node
    const labels = TECH_BRANCHES.map((b) => {
      const own = nodes.filter((n) => n.branch === b.key);
      const ranks = own.reduce((sum, n) => sum + techTree.getNodeLevel(n.id), 0);
      const max = own.reduce((sum, n) => sum + (n.maxLevel || 1), 0);
      const x = TECH_CORE.x + Math.sign(Math.cos(b.angle)) * 112;
      const y = TECH_CORE.y + Math.sign(Math.sin(b.angle)) * 16;
      return `<span class="tbranch-label" style="left:${x}px;top:${y}px;--branch:${b.color}">${b.title} <em>${ranks}/${max}</em></span>`;
    }).join('');

    const totalRanks = nodes.reduce((sum, n) => sum + techTree.getNodeLevel(n.id), 0);
    const nodeHtml = nodes.map((n) => {
      const p = pos(n);
      const lvl = techTree.getNodeLevel(n.id);
      return `<button class="tnode ${stateOf(n)} ${n.capstone ? 'cap' : ''} ${n.id === this._techSelected ? 'sel' : ''}" data-node="${n.id}" style="left:${p.x}px;top:${p.y}px;--branch:${branchOf(n.branch).color}" aria-label="${n.label}">
        <span class="tnode-icon">${n.icon || '*'}</span>
        <span class="tnode-rank">${lvl}/${n.maxLevel || 1}</span>
        <span class="tnode-label">${n.label}</span>
      </button>`;
    }).join('');

    const sel = byId[this._techSelected];
    const selColor = branchOf(sel.branch).color;
    const lvl = techTree.getNodeLevel(sel.id);
    const max = sel.maxLevel || 1;
    const reqs = techTree.getRequirements(sel.id).map((id) => {
      const ok = techTree.isPurchased(id);
      return `<li class="${ok ? 'ok' : ''}">${ok ? '&#10003;' : '&#10007;'} ${techTree.nodes[id]?.label || id}</li>`;
    }).join('');
    const pips = Array.from({ length: max }, (_, i) => `<i class="${i < lvl ? 'on' : ''}"></i>`).join('');
    const cost = techTree.getNodeNextCost(sel.id);
    let buy;
    if (techTree.isMaxed(sel.id)) buy = '<button class="btn btn-outline tech-buy" disabled>MAXED</button>';
    else if (!techTree.isUnlocked(sel.id)) buy = '<button class="btn btn-outline tech-buy" disabled>LOCKED</button>';
    else {
      const ok = techTree.canPurchase(sel.id);
      buy = `<button class="btn tech-buy ${ok ? 'btn-accent' : 'btn-outline'}" data-buy="${sel.id}" ${ok ? '' : 'disabled'}>${lvl > 0 ? 'UPGRADE' : 'UNLOCK'} <span class="tech-price">${cost} TP</span></button>`;
    }

    container.innerHTML = `
      <div class="tech-view" id="tech-view">
        <div class="tech-world" id="tech-world" style="width:${TECH_WORLD.w}px;height:${TECH_WORLD.h}px">
          <svg class="tech-links" width="${TECH_WORLD.w}" height="${TECH_WORLD.h}" viewBox="0 0 ${TECH_WORLD.w} ${TECH_WORLD.h}" aria-hidden="true">${links.join('')}</svg>
          ${labels}
          <div class="tcore" style="left:${TECH_CORE.x}px;top:${TECH_CORE.y}px"><span>RANKS</span><b>${totalRanks}</b></div>
          ${nodeHtml}
        </div>
        <div class="tech-zoom">
          <button class="btn btn-outline" data-zoom="out" aria-label="Zoom out">&minus;</button>
          <button class="btn btn-outline" data-zoom="in" aria-label="Zoom in">+</button>
          <button class="btn btn-outline" data-zoom="fit">FIT</button>
        </div>
      </div>
      <aside class="tech-detail ${sel.capstone ? 'cap' : ''}" style="--branch:${selColor}">
        <div class="tech-detail-head">
          <span class="tech-icon">${sel.icon || '*'}</span>
          <div><strong class="tech-name">${sel.label}</strong><span class="tech-rank-text">RANK ${lvl}/${max}${sel.capstone ? ' · CAPSTONE' : ''}</span></div>
        </div>
        <div class="tech-pips">${pips}</div>
        <p class="tech-desc">${sel.desc.replace(/^CAPSTONE: /, '')}</p>
        ${reqs ? `<ul class="tech-reqs"><li class="tech-reqs-title">REQUIRES</li>${reqs}</ul>` : ''}
        ${buy}
      </aside>`;

    this._bindTechCamera(container);

    container.querySelectorAll('[data-node]').forEach((el) => el.addEventListener('click', () => {
      if (this._techDragged || this._techSelected === el.dataset.node) return;
      soundEngine.playUI();
      this._techSelected = el.dataset.node;
      this.showTech(techTree);
    }));
    container.querySelector('[data-buy]')?.addEventListener('click', (e) => {
      soundEngine.play('confirm');
      haptics.impact('medium');
      this.cb.onTechPurchase(e.currentTarget.dataset.buy);
    });
  }

  // ---------- Tech tree camera (pan / zoom) ----------

  _techApplyCam() {
    const world = document.getElementById('tech-world');
    const cam = this._techCam;
    if (world && cam) world.style.transform = `translate(${cam.x}px, ${cam.y}px) scale(${cam.k})`;
  }

  _techZoomLimits() {
    const view = document.getElementById('tech-view');
    const w = view?.clientWidth || 600;
    const h = view?.clientHeight || 300;
    const fit = Math.min(w / (TECH_BOUNDS.w + 60), h / (TECH_BOUNDS.h + 60));
    return { fit, min: Math.min(fit, 1) * 0.9, max: 1.6, w, h };
  }

  /** Centre the camera on a world point at zoom k. */
  _techLookAt(x, y, k) {
    const { min, max, w, h } = this._techZoomLimits();
    const kk = Math.max(min, Math.min(max, k));
    this._techCam = { x: w / 2 - x * kk, y: h / 2 - y * kk, k: kk };
    this._techApplyCam();
  }

  _techFit() {
    const { fit } = this._techZoomLimits();
    this._techLookAt(TECH_BOUNDS.cx, TECH_BOUNDS.cy, fit);
  }

  _techZoomAt(factor, sx, sy) {
    const cam = this._techCam;
    const { min, max } = this._techZoomLimits();
    const k = Math.max(min, Math.min(max, cam.k * factor));
    // Keep the world point under (sx, sy) fixed
    cam.x = sx - ((sx - cam.x) / cam.k) * k;
    cam.y = sy - ((sy - cam.y) / cam.k) * k;
    cam.k = k;
    this._techApplyCam();
  }

  _bindTechCamera(container) {
    const view = container.querySelector('#tech-view');
    if (!this._techCam) {
      // First visit: whole tree on big screens, the core and inner branches on phones
      const { fit } = this._techZoomLimits();
      if (fit >= 0.75) this._techFit();
      else this._techLookAt(TECH_CORE.x, TECH_CORE.y, 0.8);
    } else {
      this._techApplyCam();
    }

    container.querySelectorAll('[data-zoom]').forEach((btn) => btn.addEventListener('click', () => {
      soundEngine.playUI();
      const { w, h } = this._techZoomLimits();
      if (btn.dataset.zoom === 'fit') this._techFit();
      else this._techZoomAt(btn.dataset.zoom === 'in' ? 1.25 : 0.8, w / 2, h / 2);
    }));

    const pointers = new Map();
    let last = null; // { x, y, dist }
    const local = (e) => {
      const r = view.getBoundingClientRect();
      return { x: e.clientX - r.left, y: e.clientY - r.top };
    };
    const snapshot = () => {
      const pts = [...pointers.values()];
      if (pts.length >= 2) {
        return { x: (pts[0].x + pts[1].x) / 2, y: (pts[0].y + pts[1].y) / 2, dist: Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y) };
      }
      return pts[0] ? { ...pts[0], dist: 0 } : null;
    };

    view.addEventListener('pointerdown', (e) => {
      if (e.target.closest('.tech-zoom')) return;
      pointers.set(e.pointerId, local(e));
      last = snapshot();
      this._techDragged = false;
      this._techDragStart = local(e);
    });
    view.addEventListener('pointermove', (e) => {
      if (!pointers.has(e.pointerId)) return;
      pointers.set(e.pointerId, local(e));
      const now = snapshot();
      if (!now || !last) return;
      const start = this._techDragStart;
      if (start && Math.hypot(now.x - start.x, now.y - start.y) > 8) this._techDragged = true;
      if (!this._techDragged) return;
      this._techCam.x += now.x - last.x;
      this._techCam.y += now.y - last.y;
      if (now.dist && last.dist) this._techZoomAt(now.dist / last.dist, now.x, now.y);
      else this._techApplyCam();
      last = now;
    });
    const end = (e) => {
      pointers.delete(e.pointerId);
      last = snapshot();
      // A drag must not also count as a tap on the node under the finger
      if (this._techDragged) setTimeout(() => { this._techDragged = false; }, 0);
    };
    view.addEventListener('pointerup', end);
    view.addEventListener('pointercancel', end);
    view.addEventListener('pointerleave', end);
    view.addEventListener('wheel', (e) => {
      e.preventDefault();
      const p = local(e);
      this._techZoomAt(e.deltaY < 0 ? 1.12 : 0.9, p.x, p.y);
    }, { passive: false });
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
    const statsEl = document.getElementById('run-stats');
    if (statsEl) {
      statsEl.innerHTML = this._runStatRows(run).map((r) => `
        <div class="run-stat">
          <div><span>${r.label}</span>${r.hint ? `<small>${r.hint}</small>` : ''}</div>
          <strong class="${r.tone || ''}">${r.value}</strong>
        </div>`).join('');
    }

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

  /**
   * Effective numbers for the Status drawer: everything folded together
   * (class, relics, boons, tech perks, Risk, run condition), shown as what
   * it means in a fight rather than raw multipliers.
   */
  _runStatRows(run) {
    const perm = run.permanent || {};
    const ball = run.ball || {};
    const risk = saveSystem.getRiskData();
    const signed = (v) => `${v > 0 ? '+' : ''}${v}%`;
    const tone = (v, goodWhenUp = true) => (v === 0 ? '' : (v > 0) === goodWhenUp ? 'good' : 'bad');

    const dmg = Math.round((run.atk * (run.condition === 'glass_war' ? 1.3 : 1) - 1) * 100);
    const classDmg = {
      juggernaut: '+40% more on impact (class)',
      cluster: 'fragments always deal 12',
      graviton: '+30% more when falling (class)',
    }[ball.id] || 'vs. a basic ball';
    const crit = Math.round((0.05 + (ball.id === 'striker' ? 0.1 : 0) + (perm.critChance || 0)) * 100);
    const def = run.totalDef;
    const red = Math.max(-0.5, Math.min(0.85, (run.damageReductionPct || 0) + (perm.kineticDampenerPct || 0)));
    const taken = Math.round(((1 - red) * (1 + (risk.plusDmgTaken || 0) / 100) - 1) * 100);
    const power = Math.round((run.launchPowerMult - 1) * 100);
    const skill = getSkill(run.ballType);
    const cd = Math.max(1, skill.cooldown - (ball.id === 'vanguard' ? 1 : 0) - (run.hasRelic('rel_overcharge') ? 1 : 0) - Math.floor(perm.cdReductionTurns || 0));

    const rows = [
      { label: 'HP', value: `${Math.ceil(run.hp)}/${run.maxHp}${run.shieldHp > 0 ? ` +${Math.ceil(run.shieldHp)}` : ''}`, hint: run.shieldHp > 0 ? 'includes shield' : ball.name },
      { label: 'DAMAGE', value: signed(dmg), tone: tone(dmg), hint: classDmg },
      { label: 'CRIT CHANCE', value: `${crit}%`, hint: 'crits hit 1.75x' },
      { label: 'DEF', value: `${def}`, hint: def > 0 ? `about -${Math.round(def * 0.75)} per enemy hit` : 'no flat reduction' },
      { label: 'DAMAGE TAKEN', value: signed(taken), tone: tone(taken, false), hint: 'class, relics, perks, Risk' },
      { label: 'LAUNCH POWER', value: signed(power), tone: tone(power), hint: 'max shot speed / range' },
      { label: 'SKILL', value: `${cd} TURN CD`, hint: skill.name },
    ];
    if (perm.vampiricVitalityPct) rows.push({ label: 'LIFESTEAL', value: `${Math.round(perm.vampiricVitalityPct * 1000) / 10}%`, tone: 'good', hint: 'of damage dealt' });
    if (perm.forcefieldTurnInterval) rows.push({ label: 'FORCEFIELD', value: `EVERY ${perm.forcefieldTurnInterval}T`, tone: 'good', hint: 'blocks one hit' });
    if (perm.counterPct) rows.push({ label: 'COUNTER', value: `${Math.round(perm.counterPct * 100)}%`, tone: 'good', hint: 'damage sent back' });
    if (perm.secondWindPct) rows.push({ label: 'SECOND WIND', value: run.secondWindUsed ? 'USED' : 'READY', tone: run.secondWindUsed ? 'bad' : 'good', hint: `revive at ${Math.round(perm.secondWindPct * 100)}% HP` });
    rows.push({ label: 'FLOOR', value: run.floorProgress });
    return rows;
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
      if (rewards.gear) {
        const it = rewards.gear;
        body += `<div class="gear-drop" style="--rarity:${rarityColor(it.rarity)}">
          <span>GEAR FOUND · ${rarityName(it.rarity)}</span>
          <strong>${itemName(it)} +${it.level}</strong>
          <em>${describeItem(it).join(' · ')}</em>
        </div>`;
      }
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

  /** Every Risk rule: active ones highlighted, locked ones dimmed. */
  showRiskRules(level, maxUnlocked) {
    const rows = CONFIG.risk.levels.map((rule, i) => {
      const n = i + 1;
      const state = n <= level ? 'on' : n <= maxUnlocked ? '' : 'locked';
      return `<div class="risk-rule-row ${state}"><b>${n}</b><span><strong>${rule.name}</strong> ${rule.desc}</span></div>`;
    }).join('');
    this.openModal('RISK RULES', `<p class="dim-text">Rules stack: Risk ${level || 'N'} applies rules 1 to ${level || 'N'}. Each level: +${CONFIG.risk.tpPerLevel}% Tech Points.</p><div class="risk-rule-list">${rows}</div>`,
      `<div class="btn-row"><button class="btn btn-accent" data-act="close">CLOSE</button></div>`);
    this.modalActions.querySelector('[data-act="close"]').addEventListener('click', () => this.closeModal());
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
    const skill = getSkill(run.ballType);
    const skillBtn = document.getElementById('btn-overdrive');
    if (skillBtn) {
      skillBtn.querySelector('.ability-name').textContent = skill.short;
      skillBtn.title = `[1] ${skill.name}: ${skill.desc}`;
      skillBtn.style.setProperty('--skill', skill.color);
    }

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

// ---------- Tech tree layout ----------
// Four branches grow out of the CORE like an X; `col` is how far along the
// branch a node sits, `row` (0-2) which side of the branch it forks to.
const TECH_BRANCHES = [
  { key: 'atk', title: 'ATTACK', color: '#e0556d', angle: (-150 * Math.PI) / 180 },
  { key: 'vit', title: 'VITALITY', color: '#a7f070', angle: (-30 * Math.PI) / 180 },
  { key: 'def', title: 'DEFENSE', color: '#41a6f6', angle: (30 * Math.PI) / 180 },
  { key: 'tac', title: 'TACTICS', color: '#c46fd6', angle: (150 * Math.PI) / 180 },
];
const TECH_WORLD = { w: 1500, h: 1000 };
const TECH_CORE = { x: TECH_WORLD.w / 2, y: TECH_WORLD.h / 2 };

function techNodePos(n) {
  const branch = TECH_BRANCHES.find((b) => b.key === n.branch) || TECH_BRANCHES[0];
  const col = n.col || 0;
  const along = 160 + col * 145;
  // Forks spread wider the further out they grow; the ATK/TAC side mirrors
  // so "row 0" always points away from the horizontal centre line
  const flip = Math.sin(branch.angle) < 0 ? -1 : 1;
  const side = ((n.row ?? 1) - 1) * (84 + col * 10) * flip;
  const dx = Math.cos(branch.angle);
  const dy = Math.sin(branch.angle);
  return { x: Math.round(TECH_CORE.x + dx * along - dy * side), y: Math.round(TECH_CORE.y + dy * along + dx * side) };
}

// Bounding box of every node, for "FIT"
const TECH_BOUNDS = (() => {
  const pts = Object.values(CONFIG.techTree).map(techNodePos);
  pts.push(TECH_CORE);
  const xs = pts.map((p) => p.x);
  const ys = pts.map((p) => p.y);
  const pad = 70;
  const minX = Math.min(...xs) - pad;
  const maxX = Math.max(...xs) + pad;
  const minY = Math.min(...ys) - pad;
  const maxY = Math.max(...ys) + pad;
  return { w: maxX - minX, h: maxY - minY, cx: (minX + maxX) / 2, cy: (minY + maxY) / 2 };
})();

/**
 * Every active tech perk as { label, value }, with values combined the way
 * battles apply them (e.g. Sharpshooter and Base ATK Core multiply).
 */
function techBonusList(st) {
  const out = [];
  const add = (cond, label, value) => { if (cond) out.push({ label, value }); };
  const pct = (v) => Math.round(v * 1000) / 10;
  const dmg = ((10 + (st.baseAtkBonus || 0)) / 10) * (1 + (st.atkBonus || 0)) - 1;
  add(dmg > 0, 'Damage', `+${pct(dmg)}%`);
  add(st.critChance, 'Crit chance', `+${pct(st.critChance)}%`);
  add(st.armorPenPct, 'Armor pierce', `${pct(Math.min(0.9, st.armorPenPct))}%`);
  add(st.ballisticApexMaxPct, 'Fast-hit damage', `up to +${pct(st.ballisticApexMaxPct)}%`);
  add(st.riskResonanceBonusPerLevel, 'Damage per Risk level', `+${pct(st.riskResonanceBonusPerLevel)}%`);
  add(st.hpBonus, 'Max HP', `+${st.hpBonus}`);
  add(st.overflowShieldCapPct, 'Overflow shield cap', `${pct(st.overflowShieldCapPct)}% HP`);
  add(st.emergencyMedkitHeal, 'Emergency heal', `${st.emergencyMedkitHeal} HP`);
  add(st.titanCoreHealBonusPct, 'Safe Zone healing', `+${pct(st.titanCoreHealBonusPct)}%, +${st.titanCoreMaxHpBonus} max HP`);
  add(st.vampiricVitalityPct, 'Lifesteal', `${pct(st.vampiricVitalityPct)}%`);
  add(st.secondWindPct, 'Second Wind', `revive at ${pct(st.secondWindPct)}%`);
  add(st.defBonus, 'DEF', `+${st.defBonus}`);
  add(st.defPctBonus, 'Total DEF', `+${pct(st.defPctBonus)}%`);
  add(st.kineticDampenerPct, 'Damage taken', `-${pct(st.kineticDampenerPct)}%`);
  add(st.thornsResistPct, 'Thorns taken', `-${pct(Math.min(1, st.thornsResistPct))}%`);
  add(st.forcefieldTurnInterval, 'Forcefield', `every ${st.forcefieldTurnInterval} turns`);
  add(st.fortifiedMatrixBonusDef, 'DEF per heavy hit', `+${st.fortifiedMatrixBonusDef} (x3 max)`);
  add(st.counterPct, 'Counter damage', `${pct(st.counterPct)}%`);
  add(st.startGoldBonus, 'Start gold', `+${st.startGoldBonus}`);
  add(st.shopDiscountBonus, 'Shop prices', `-${pct(st.shopDiscountBonus)}%`);
  add(st.rerollDiscountBonus, 'Reroll price', `-${pct(st.rerollDiscountBonus)}%`);
  add(Math.floor(st.cdReductionTurns || 0), 'Cooldowns', `-${Math.floor(st.cdReductionTurns)} turn${Math.floor(st.cdReductionTurns) > 1 ? 's' : ''}`);
  add(st.tpBonusPct, 'Battle TP', `+${pct(st.tpBonusPct)}%`);
  add(st.relicAtkPctPerItem, 'Per relic', `+${pct(st.relicAtkPctPerItem)}% ATK/HP, +${Math.round(st.relicDefPerItem * 100) / 100} DEF`);
  add(st.supplyDropRelics, 'Starting relics', `${st.supplyDropRelics}`);
  return out;
}
