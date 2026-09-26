// ============================================================
// UIManager — DOM-based interface layer.
// Owns the main menu, tech tree view, run map screen, node
// modals (encounter/shop/rest/combat), battle HUD, and results.
// No game logic here — it renders state and forwards actions
// through callbacks.
// ============================================================

import { CONFIG } from '../config.js';
import { Capacitor } from '@capacitor/core';
import { NODE_STYLE } from '../rendering/RogueMapRenderer.js';

const C = CONFIG.colors;

import { saveSystem } from '../meta/SaveSystem.js';
import { soundEngine } from '../utils/SoundEngine.js';
import pkg from '../../package.json';
import { haptics } from '../platform/haptics.js';
import { isDesktop, openExternal } from '../platform/desktop.js';
import { canSelfUpdate, checkForUpdate, isSkipped, skipVersion } from '../platform/updater.js';
import { RARITY } from '../meta/Relics.js';
import { OPERATOR, skinsFor, isSkinUnlocked, skinProgress, skinColors } from '../meta/Balls.js';
import { ballDataUrl, CLASS_PATTERN } from '../rendering/ballSprite.js';
import { MEDALS, medalProgress, checkMedals } from '../meta/Medals.js';
import { masteryLevel, MILESTONES, MAX_MASTERY } from '../meta/Mastery.js';
import { getPart, loadoutTotals, SLOTS, PARTS, rarityColor, CLEAN_WIN_KEYS } from '../meta/Mech.js';
import { RigScreen } from './RigScreen.js';
import { ico, partIcon } from '../rendering/pixelIcons.js';

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
      rig: document.getElementById('screen-rig'),
    };
    this.rig = new RigScreen({ onBack: () => this.cb.onBackToMenu() });
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
    if (btnPlay) btnPlay.addEventListener('click', () => {
      soundEngine.playUI();
      // A suspended run resumes with the rig it started with
      if (this.cb.savedRun?.()) return this.cb.onPlay();
      // An overloaded rig can't deploy
      const t = loadoutTotals(saveSystem.getLoadoutParts());
      if (t.overweight) {
        soundEngine.play('error');
        this.showConfirm({
          title: 'RIG OVERLOADED',
          text: `${ico('load')} ${t.weight}/${t.capacity}. Lighten your rig to deploy.`,
          confirmLabel: 'OPEN RIG',
          onConfirm: () => this.showMech(),
        });
        return;
      }
      this.cb.onPlay();
    });
    if (btnTech) btnTech.addEventListener('click', () => this.cb.onOpenTech());
    document.getElementById('btn-medals')?.addEventListener('click', () => {
      soundEngine.playUI();
      this.showMedals();
    });
    document.getElementById('menu-daily')?.addEventListener('click', () => this._claimDaily());
    document.getElementById('btn-gear')?.addEventListener('click', () => {
      soundEngine.playUI();
      this.showMech();
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
    document.getElementById('btn-support')?.addEventListener('click', () => {
      soundEngine.playUI();
      this.showSupport();
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
          text: 'The run ends now. Quest TP is kept.',
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
    this.openModal('TREASURE CACHE', `<p>Pick one.</p><div class="shop-grid">${cards}</div>`,
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

  // ---------- Deploy (run start) ----------

  /**
   * Before a run: your rig at a glance (what you'll fight with), the
   * ball's paint, mastery and the Risk to play on. There are no classes:
   * the rig is the character.
   */
  showBallSelect(onStart) {
    const b = OPERATOR;
    const owned = saveSystem.getLoadoutParts();
    const t = loadoutTotals(owned);
    // One row of part icons (names on hover / tap), in the order you'd read a rig
    const order = ['frame', 'legs', 'weapon1', 'weapon2', 'drone', 'armor', 'module1', 'module2'];
    const parts = order.map((slotId) => {
      const o = owned[SLOTS.findIndex((s) => s.id === slotId)];
      return o ? getPart(o.id) : null;
    }).filter(Boolean);
    const icons = parts.map((p) => `<span class="deploy-part" style="--c:${rarityColor(p.rarity)}" title="${p.name}" data-name="${p.name}"><img src="${partIcon(p.id)}" alt="${p.name}"></span>`).join('');

    this.openModal('DEPLOY', `
      <div class="deploy">
        <div class="deploy-ball">
          <img class="ball-sprite" id="deploy-sprite" src="${ballDataUrl(skinColors(b, 'default'), 1)}" alt="">
          <div class="deploy-paint">
            <button class="btn btn-outline paint-step" data-paint="-1" aria-label="Previous paint">&#9664;</button>
            <b id="paint-name">COBALT</b>
            <button class="btn btn-outline paint-step" data-paint="1" aria-label="Next paint">&#9654;</button>
          </div>
        </div>
        <div class="deploy-info">
          <div class="deploy-stats">
            <span title="HP">${ico('hp')}${CONFIG.run.maxHpBase + Math.round(t.hp)}</span>
            <span title="DEF">${ico('def')}${t.def.toFixed(1)}</span>
            <span title="Energy pool, refill per turn">${ico('energy')}${t.energy}<em>+${t.regen}</em></span>
            <span title="Heat cap, cooling per turn">${ico('heat')}${t.heatCap}<em>-${t.cool}</em></span>
          </div>
          <div class="deploy-parts">${icons}</div>
          <p class="deploy-hint" id="deploy-hint">${t.overweight ? '<span class="bad">Over the load limit: fix it on the RIG screen.</span>' : ''}</p>
          <div class="deploy-mastery" id="ball-mastery"></div>
        </div>
      </div>`, `<div class="btn-row">
        <button class="btn btn-outline" data-act="cancel">BACK</button>
        <div class="ball-risk-row" id="ball-risk-row"></div>
        <button class="btn btn-primary" data-act="start" ${t.overweight ? 'disabled' : ''}>&#9654; START</button>
      </div>`);

    // Tapping a part names it (phones have no hover)
    const hint = document.getElementById('deploy-hint');
    if (!t.overweight) {
      this.modalBody.querySelectorAll('[data-name]').forEach((el) => el.addEventListener('click', () => {
        hint.textContent = el.dataset.name;
      }));
    }

    // Risk + mastery
    const riskRow = this.modalActions.querySelector('#ball-risk-row');
    const renderRisk = () => {
      const max = saveSystem.getMaxRiskUnlocked(b.id);
      const val = saveSystem.getDifficultyLevel(b.id);
      const m = masteryLevel(saveSystem.getMasteryXp(b.id));
      const next = MILESTONES.find((x) => x.level > m.level);
      riskRow.innerHTML = `<button class="btn btn-outline risk-step" data-risk="-1" ${val <= 0 ? 'disabled' : ''}>&minus;</button>
        <b class="ball-risk-val ${val > 10 ? 'secret' : ''}">${max === 0 ? 'RISK LOCKED' : `RISK <span>${val > 10 ? 'XI' : val}</span>`}</b>
        <button class="btn btn-outline risk-step" data-risk="1" ${val >= max ? 'disabled' : ''}>+</button>`;
      const bar = m.need ? `<i class="bm-bar" title="${m.into}/${m.need} XP"><i style="width:${Math.round((m.into / m.need) * 100)}%"></i></i>` : '<em>MAX</em>';
      document.getElementById('ball-mastery').innerHTML = `<b>${ico('star')}MASTERY ${m.level}</b>${bar}${next ? `<span title="Next at level ${next.level}">${next.label}</span>` : ''}`;
      riskRow.querySelectorAll('[data-risk]').forEach((btn) => btn.addEventListener('click', () => {
        saveSystem.setDifficultyLevel(val + Number(btn.dataset.risk), b.id);
        soundEngine.playUI();
        this.cb.onBallChanged?.();
        renderRisk();
      }));
    };

    // Paint: step through all paints; locked ones show what unlocks them
    const list = skinsFor();
    const stats = saveSystem.getBallStats(b.id);
    let skin = 'default';
    try {
      skin = localStorage.getItem(`slingshot-skin-${b.id}`) || 'default';
    } catch (_) {}
    if (!isSkinUnlocked(list.find((s) => s.id === skin), stats)) skin = 'default';
    let shown = Math.max(0, list.findIndex((s) => s.id === skin));
    const renderPaint = () => {
      const s = list[shown];
      const open = isSkinUnlocked(s, stats);
      document.getElementById('deploy-sprite').src = ballDataUrl(skinColors(b, s.id), 1);
      document.getElementById('deploy-sprite').classList.toggle('locked', !open);
      document.getElementById('paint-name').innerHTML = open ? s.name : `${ico('lock')}${s.name}`;
      if (!t.overweight) hint.textContent = open ? `${list.filter((x) => isSkinUnlocked(x, stats)).length}/${list.length} paints` : `${s.hint} (${skinProgress(s, stats)})`;
      if (open) {
        skin = s.id;
        try {
          localStorage.setItem(`slingshot-skin-${b.id}`, skin);
        } catch (_) {}
      }
    };
    this.modalBody.querySelectorAll('[data-paint]').forEach((btn) => btn.addEventListener('click', () => {
      shown = (shown + Number(btn.dataset.paint) + list.length) % list.length;
      soundEngine.playUI();
      renderPaint();
    }));

    saveSystem.setSelectedBall(b.id);
    renderRisk();
    renderPaint();

    this.modalActions.querySelector('[data-act="cancel"]').addEventListener('click', () => this.closeModal());
    this.modalActions.querySelector('[data-act="start"]').addEventListener('click', () => {
      soundEngine.play('confirm');
      this.closeModal();
      onStart(b.id, skin); // a locked paint on screen isn't used: the last unlocked one is
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
        </div>
        <div class="settings-data">
          <span>SAVE</span>
          <button class="btn btn-outline" data-act="export">EXPORT</button>
          <button class="btn btn-outline" data-act="import">IMPORT</button>
          <button class="btn btn-danger" data-act="reset">RESET</button>
        </div>`, `<div class="btn-row">
          <button class="btn btn-outline" data-act="credits">CREDITS</button>
          ${canSelfUpdate ? '<button class="btn btn-outline" data-act="updates">UPDATES</button>' : ''}
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
      const on = (act, fn) => this.modalBody.querySelector(`[data-act="${act}"]`)?.addEventListener('click', () => {
        soundEngine.playUI();
        fn();
      });
      on('export', () => this.showExportSave(saveSystem.exportSaveData()));
      on('import', () => this.showImportSave());
      on('reset', () => this.showConfirm({
        title: 'RESET ALL DATA?',
        text: 'Deletes all progress for good. Export first for a backup.',
        confirmLabel: 'DELETE EVERYTHING',
        danger: true,
        onConfirm: () => {
          saveSystem.reset();
          this.cb.onDataReset?.();
          location.reload();
        },
      }));
      this.modalActions.querySelector('[data-act="credits"]').addEventListener('click', () => this.showCredits());
      this.modalActions.querySelector('[data-act="updates"]')?.addEventListener('click', () => {
        soundEngine.playUI();
        this.checkUpdates({ manual: true });
      });
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
      text: `Back to your last tile: <strong class="accent">-${cost} HP</strong>, -1 move, no rewards. The enemy stays.`,
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
      <p>Keep this code safe. <strong>IMPORT</strong> it on any device.</p>
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
        status.textContent = 'Long-press the code to copy it.';
        status.className = 'save-status err';
      }
    };
    this.modalActions.querySelector('[data-act="copy"]').addEventListener('click', copy);
    this.modalActions.querySelector('[data-act="close"]').addEventListener('click', () => this.closeModal());
    copy();
  }

  showImportSave() {
    this.openModal('IMPORT SAVE', `
      <p>Paste a <strong>SLING1-</strong> code. <span class="accent">Replaces current progress.</span></p>
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
        this.cb.onDataReset?.(); // a run from the old save doesn't carry over
        status.textContent = 'SAVE RESTORED, RELOADING...';
        status.className = 'save-status ok';
        soundEngine.play('confirm');
        setTimeout(() => location.reload(), 700);
      } else {
        status.textContent = 'Code is incomplete or damaged.';
        status.className = 'save-status err';
        soundEngine.play('error');
      }
    });
  }

  // ---------- Support ----------

  /**
   * Ways to help the game. With CONFIG.store === 'play' the Android build
   * links to the Play listing and has no tip / donate link (Play only allows
   * those through Play Billing). GitHub builds link to the releases page.
   */
  showSupport() {
    const S = CONFIG.support;
    const native = Capacitor.isNativePlatform();
    const onPlay = CONFIG.store === 'play';
    const rows = [
      onPlay
        ? { act: 'rate', ico: '&#9733;', title: native ? 'RATE ON GOOGLE PLAY' : 'GET IT ON GOOGLE PLAY', text: native ? 'A quick review helps more than anything.' : 'Play on your phone, and leave a review.' }
        : { act: 'github', ico: '&#9733;', title: 'GET THE APPS', text: 'Android & Windows builds on GitHub.' },
      { act: 'share', ico: '&#10150;', title: 'SHARE THE GAME', text: 'Copy the link for a friend.' },
      { act: 'mail', ico: '&#9993;', title: 'SEND FEEDBACK', text: 'Bugs, ideas, balance: I read it all.' },
    ];
    if (S.donateUrl && !(onPlay && native)) rows.push({ act: 'donate', ico: '&#9829;', title: 'BUY ME A COFFEE', text: 'Optional. Keeps updates coming.' });

    this.openModal('SUPPORT THE GAME', `
      <p class="dim-text">Slingshot Ops is made by one person, with no ads and no purchases.</p>
      <div class="support-list">${rows.map((r) => `
        <button class="btn btn-outline support-row" data-support="${r.act}">
          <i class="support-ico">${r.ico}</i><div><strong>${r.title}</strong><span>${r.text}</span></div>
        </button>`).join('')}
      </div>
      <p class="save-status" id="support-status"></p>`,
    '<div class="btn-row"><button class="btn btn-accent" data-act="close">CLOSE</button></div>');

    const status = document.getElementById('support-status');
    const open = (url) => {
      // In the app, Capacitor hands any non-app URL to Android (Play Store, mail app, browser)
      if (isDesktop) openExternal(url);
      else if (native || url.startsWith('mailto:')) window.location.href = url;
      else window.open(url, '_blank', 'noopener');
    };
    const actions = {
      rate: () => open(S.playUrl),
      github: () => open(S.releasesUrl),
      donate: () => open(S.donateUrl),
      mail: () => open(`mailto:${S.feedbackEmail}?subject=${encodeURIComponent(`Slingshot Ops v${pkg.version} feedback`)}`),
      share: async () => {
        const link = onPlay && native ? S.playUrl : S.webUrl;
        try {
          await navigator.clipboard.writeText(`Slingshot Ops, a pixel slingshot roguelike: ${link}`);
          status.textContent = 'LINK COPIED';
          status.className = 'save-status ok';
        } catch {
          status.textContent = link;
          status.className = 'save-status';
        }
      },
    };
    this.modalBody.querySelectorAll('[data-support]').forEach((b) => b.addEventListener('click', () => {
      soundEngine.playUI();
      actions[b.dataset.support]?.();
    }));
    this.modalActions.querySelector('[data-act="close"]').addEventListener('click', () => this.closeModal());
  }

  // ---------- Updates (GitHub builds) ----------

  /**
   * Launch check (quiet: only speaks up when a new, un-skipped version exists
   * and the menu is showing with nothing on top) or manual check from Settings.
   */
  async checkUpdates({ manual = false } = {}) {
    if (manual) {
      this.openModal('UPDATES', '<p class="dim-text">Checking GitHub...</p>',
        '<div class="btn-row"><button class="btn btn-accent" data-act="close">CLOSE</button></div>');
      this.modalActions.querySelector('[data-act="close"]').addEventListener('click', () => this.closeModal());
    }
    const update = await checkForUpdate();
    if (!update) {
      if (manual && this.modalTitle.textContent === 'UPDATES') {
        this.modalBody.innerHTML = `<p>You're on the latest version.</p><p class="dim-text">v${pkg.version}</p>`;
      }
      return;
    }
    if (!manual) {
      const onMenu = !document.getElementById('screen-menu')?.classList.contains('hidden');
      if (!onMenu || this.nodeModal.classList.contains('open') || isSkipped(update.version)) return;
    }
    this.showUpdate(update);
  }

  showUpdate(update) {
    // First real line of the release notes (skipping headings), without markdown noise
    // (GitHub's auto notes end with a bare "Full Changelog" link: not worth showing)
    const note = update.notes.split('\n').filter((l) => !l.trim().startsWith('#') && !/full changelog|https?:\/\//i.test(l))
      .map((l) => l.replace(/^[*\-\s]+/, '').replace(/[<>&*`]/g, '').trim()).find(Boolean) || '';
    this.openModal('UPDATE READY', `
      <p><strong class="accent-green">v${update.version}</strong> <span class="dim-text">(you have v${pkg.version})</span></p>
      ${note ? `<p class="dim-text">${note}</p>` : ''}
      <div class="update-bar hidden"><i></i></div>
      <p class="save-status" id="update-status"></p>`,
    `<div class="btn-row">
      <button class="btn btn-outline" data-act="later">LATER</button>
      <button class="btn btn-accent" data-act="update">UPDATE</button>
    </div>`);

    const bar = this.modalBody.querySelector('.update-bar');
    const status = document.getElementById('update-status');
    const btn = this.modalActions.querySelector('[data-act="update"]');
    this.modalActions.querySelector('[data-act="later"]').addEventListener('click', () => {
      soundEngine.playUI();
      skipVersion(update.version);
      this.closeModal();
    });
    btn.addEventListener('click', async () => {
      soundEngine.playUI();
      btn.disabled = true;
      bar.classList.remove('hidden');
      status.textContent = 'DOWNLOADING...';
      status.className = 'save-status';
      try {
        await update.install((p) => { bar.firstElementChild.style.width = `${Math.round(p * 100)}%`; });
        // Android: the system installer is now on top. Desktop relaunches itself.
        status.textContent = 'INSTALLING...';
        status.className = 'save-status ok';
      } catch (e) {
        status.textContent = e.needsPermission ? e.message : 'Update failed. Try again later.';
        status.className = 'save-status err';
        bar.classList.add('hidden');
        btn.disabled = false;
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
      <p class="dim-text">This game collects no personal data and works offline.${canSelfUpdate ? ' It only goes online to check GitHub for updates.' : ''}</p>
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
    // A run left open (app closed mid-run) resumes from the big button
    const saved = this.cb.savedRun?.();
    const play = document.getElementById('btn-play');
    if (play) {
      if (saved) {
        const where = saved.floor >= CONFIG.map.floors ? `ABYSS ${saved.floor - CONFIG.map.floors + 1}` : `F${saved.floor + 1}`;
        play.innerHTML = `&#9654; CONTINUE RUN <small>${where}</small>`;
      } else {
        play.innerHTML = '&#9654; START OPERATION';
      }
      play.classList.toggle('resume', !!saved);
    }
    // Icon tiles: tech chip, your first gun, medal star (with counts)
    const owned = MEDALS.filter((m) => saveSystem.hasMedal(m.id)).length;
    const gun = saveSystem.getLoadoutParts().find((o) => o && getPart(o.id).type === 'weapon');
    const rig = loadoutTotals(saveSystem.getLoadoutParts());
    const tiles = {
      'btn-tech': { img: ico('tp'), label: 'TECH', count: '' },
      'btn-gear': { img: gun ? `<img class="pxi" src="${partIcon(gun.id)}" alt="">` : ico('gun'), label: 'RIG', count: rig.overweight ? '!' : '', warn: rig.overweight },
      'btn-medals': { img: ico('star'), label: 'MEDALS', count: `${owned}/${MEDALS.length}` },
    };
    for (const [id, t] of Object.entries(tiles)) {
      const el = document.getElementById(id);
      if (el) el.innerHTML = `${t.img}<span>${t.label}</span>${t.count !== '' ? `<em class="${t.warn ? 'warn' : ''}">${t.count}</em>` : ''}`;
    }
  }

  _renderDaily() {
    const el = document.getElementById('menu-daily');
    if (!el) return;
    const d = saveSystem.getDailyStatus();
    el.classList.toggle('ready', d.canClaim);
    el.innerHTML = d.canClaim
      ? `${ico('pod', '#ffcd75')}<strong>DAILY SUPPLY</strong><span>${ico('tp')}+${d.reward} · DAY ${d.streak}</span>`
      : `${ico('pod', '#566c86')}<strong>CLAIMED</strong><span>DAY ${d.streak} · BACK TOMORROW</span>`;
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

  /** Rig screen (loadout + supply pods). */
  showMech(opts = {}) {
    this.closeModal();
    this._setVisible('rig');
    this.rig.show(opts);
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
    // One-time notice after the skill-tree rebuild refunded the old tree
    if (saveSystem.data.techRefund) {
      this.toast(`<span class="feed-boon">TECH TREE REBUILT: +${saveSystem.data.techRefund} TP REFUNDED</span>`);
      saveSystem.data.techRefund = 0;
      saveSystem.save();
    }
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
    const crit = Math.round((0.05 + (perm.critChance || 0)) * 100);
    const rig = perm.mech?.rig || CONFIG.gear.baseRig;
    const energy = rig.energy + (perm.rigEnergy || 0) + (run.hasRelic('rel_energy_well') ? 12 : 0);
    const regen = rig.regen + (perm.rigRegen || 0) + (run.hasRelic('rel_energy_well') ? 3 : 0) + (run.hasRelic('rel_overcharge') ? 4 : 0);
    const def = run.totalDef;
    const red = Math.max(-0.5, Math.min(0.85, (run.damageReductionPct || 0) + (perm.kineticDampenerPct || 0)));
    const taken = Math.round(((1 - red) * (1 + (risk.plusDmgTaken || 0) / 100) - 1) * 100);
    const power = Math.round((run.launchPowerMult - 1) * 100);

    const rows = [
      { label: 'HP', value: `${Math.ceil(run.hp)}/${run.maxHp}${run.shieldHp > 0 ? ` +${Math.ceil(run.shieldHp)}` : ''}`, hint: run.shieldHp > 0 ? 'includes shield' : ball.name },
      { label: 'GUN DAMAGE', value: signed(dmg), tone: tone(dmg), hint: 'ATK from gear, relics, mastery' },
      { label: 'CRIT CHANCE', value: `${crit}%`, hint: 'crits hit 1.75x' },
      { label: 'DEF', value: `${def}`, hint: def > 0 ? `about -${Math.round(def * 0.75)} per enemy hit` : 'no flat reduction' },
      { label: 'DAMAGE TAKEN', value: signed(taken), tone: tone(taken, false), hint: 'relics, perks, Risk' },
      { label: 'ENERGY', value: `${energy} +${regen}/T`, hint: 'per shot, refills each turn' },
      { label: 'HEAT', value: `${rig.heatCap + 0} -${rig.cool + (perm.rigCool || 0)}/T`, hint: 'cap, cools each turn' },
      { label: 'MOVE POWER', value: signed(power), tone: tone(power), hint: 'max launch speed / range' },
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
      ${this._nodeDescription(node)}
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

  /** One short line plus reward chips for a map tile. */
  _nodeDescription(node) {
    const chip = (icon, text, cls = '') => `<span class="node-chip ${cls}">${ico(icon)}${text}</span>`;
    const R = {
      combat: ['Win clean for a bonus.', [chip('key', 'KEYS x3'), chip('gold', 'GOLD'), chip('tp', 'TP')]],
      elite: ['Tough. Worth it.', [chip('relic', 'RELIC'), chip('gold', 'GOLD'), chip('tp', 'TP x2'), chip('key', 'KEYS')]],
      miniboss: ['Sector guardian.', [chip('gold', '+50'), chip('relic', 'RELIC x2'), chip('key', 'KEYS')]],
      boss: ['Win the operation.', [chip('skull', 'BOSS', 'bad'), chip('key', 'KEYS')]],
      encounter: ['Unknown signal.', [chip('star', 'REWARD?'), chip('hp', 'RISK?', 'bad')]],
      shop: ['Spend gold on relics.', [chip('relic', 'RELICS')]],
      rest: ['Catch your breath.', [chip('heal', 'HEAL')]],
      minigame: ['Timing test.', [chip('gold', 'GOLD'), chip('heal', 'HEAL')]],
      treasure: ['Unguarded.', [chip('relic', '1 OF 2 FREE')]],
      gamble: ['Coin flip.', [chip('gold', '-15', 'bad'), chip('gold', '50%: +45')]],
      shrine: ['Power, for a price.', [chip('skull', 'CURSE', 'bad'), chip('relic', 'EPIC RELIC')]],
    }[node.type];
    if (!R) return '';
    return `<p class="node-line">${R[0]}</p><div class="node-chips">${R[1].join('')}</div>`;
  }

  /**
   * End-of-battle report: a full-screen card over the arena.
   *   left  – how the fight went (damage, shots, best hit, rams, turns)
   *           and which gun did the work
   *   right – rewards, popping in one by one with counting numbers,
   *           and your HP going into the next node
   * `report` comes from Game.battleStats (report + track).
   */
  showCombatResult(win, rewards, run, report = null) {
    document.getElementById('battle-report')?.remove();
    const r = report || {};
    const el = document.createElement('div');
    el.id = 'battle-report';
    el.className = `battle-report ${win ? 'win' : 'lose'}`;

    const row = (icon, label, value) => `<div class="br-row">${icon}<span>${label}</span><b data-count="${value}">0</b></div>`;
    const stats = [
      row(ico('dmg'), 'DAMAGE DEALT', Math.round(r.dealt || 0)),
      row(ico('hp'), 'DAMAGE TAKEN', Math.round(r.taken || 0)),
      row(ico('gun'), 'SHOTS FIRED', r.shots || 0),
      row(ico('star'), 'BEST HIT', Math.round(r.bestHit || 0)),
      row(ico('skull'), 'ENEMIES DOWN', r.kills || 0),
      row(ico('move'), 'RAMS', r.rams || 0),
      row(ico('cd'), 'TURNS', r.turns || 0),
    ].join('');

    // Which gun did the work
    const guns = Object.entries(r.byGun || {}).sort((a, b) => b[1] - a[1]);
    const top = guns[0]?.[1] || 1;
    const gunRows = guns.map(([name, dmg], i) => {
      const part = PARTS_BY_NAME[name];
      return `<div class="br-gun ${i === 0 ? 'mvp' : ''}" style="--c:${part?.color || '#94b0c2'}">
        ${part ? `<img src="${partIcon(part.id)}" alt="">` : ''}
        <span>${name}${i === 0 && guns.length > 1 ? ' <em>MVP</em>' : ''}</span>
        <i class="br-bar"><i style="--w:${Math.round((dmg / top) * 100)}%"></i></i><b>${Math.round(dmg)}</b></div>`;
    }).join('') || '<p class="dim-text">No gun hits this fight.</p>';

    // Rewards
    const tiles = [];
    const tile = (icon, value, label, color) => tiles.push(`<div class="reward-tile br-pop" style="--c:${color}">${icon}<strong data-count="${value}" data-prefix="+">+0</strong><span>${label}</span></div>`);
    if (rewards) {
      if (rewards.gold) tile(ico('gold'), rewards.gold, 'GOLD', '#ffcd75');
      if (rewards.tech) tile(ico('tp'), rewards.tech, 'TP', '#73eff7');
      if (rewards.tokens) tile(ico('key'), rewards.tokens, 'KEYS', '#ffcd75');
      if (rewards.heal) tile(ico('hp'), rewards.heal, 'HP', '#ff5d73');
      const relics = rewards.relics?.length ? rewards.relics : rewards.relic ? [rewards.relic] : [];
      for (const rel of relics) tiles.push(`<div class="reward-tile br-pop" style="--c:${RARITY[rel.rarity]?.color || '#c46fd6'}">${ico('relic')}<strong>+1</strong><span>${rel.name}</span></div>`);
    }
    const hpPct = run ? Math.max(0, Math.min(100, Math.round((run.hp / run.maxHp) * 100))) : 0;
    const right = win
      ? `<h3>REWARDS</h3>
        ${rewards?.clean ? `<p class="br-clean">CLEAN WIN · +${CLEAN_WIN_KEYS} KEYS</p>` : ''}
        <div class="reward-tiles">${tiles.join('') || '<p class="dim-text">Nothing this time.</p>'}</div>`
      : `<h3>DOWN</h3><p class="node-line bad">Your rig was destroyed.</p>`;

    el.innerHTML = `
      <div class="br-card">
        <header class="br-head">
          <h2>${win ? 'VICTORY' : 'DEFEATED'}</h2>
          <span>${r.nodeLabel || ''}</span>
        </header>
        <div class="br-body">
          <section class="br-col">
            <h3>BATTLE</h3>
            <div class="br-stats">${stats}</div>
            <h3>GUNS</h3>
            <div class="br-guns">${gunRows}</div>
          </section>
          <section class="br-col br-right">
            ${right}
            ${run ? `<div class="br-hp"><span>${ico('hp')}HP</span><i class="br-bar hp"><i style="--w:${hpPct}%"></i></i><b>${Math.ceil(run.hp)}/${run.maxHp}</b></div>` : ''}
            <button class="btn btn-primary br-continue" data-act="continue">CONTINUE &#9654;</button>
          </section>
        </div>
      </div>`;
    document.body.appendChild(el);

    // Count the numbers up and pop the reward tiles in, one after another
    const counters = [...el.querySelectorAll('[data-count]')];
    const start = performance.now();
    const dur = 700;
    const tick = (now) => {
      const k = Math.min(1, (now - start) / dur);
      const e = 1 - Math.pow(1 - k, 3);
      for (const c of counters) c.textContent = `${c.dataset.prefix || ''}${Math.round(Number(c.dataset.count) * e)}`;
      if (k < 1 && el.isConnected) requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
    el.querySelectorAll('.br-pop').forEach((t, i) => {
      t.style.animationDelay = `${0.35 + i * 0.12}s`;
    });
    requestAnimationFrame(() => el.classList.add('in'));
    soundEngine.play(win ? 'confirm' : 'error');

    el.querySelector('[data-act="continue"]').addEventListener('click', () => {
      soundEngine.playUI();
      el.classList.remove('in');
      setTimeout(() => el.remove(), 180);
      this.cb.onBattleReportContinue();
    });
  }

  showEncounterOptions(encounter, run) {
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
      // Paid options need the gold up front
      const broke = choice.loseGold && (run?.gold ?? Infinity) < choice.loseGold;
      return `<div class="btn-row">
        <button class="btn btn-enc-option" data-enc="${i}" ${broke ? 'disabled title="Not enough gold"' : ''}>
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
    let body = `<div class="shop-header-info">${ico('gold')}<span class="accent">${run.gold}G</span></div>`;
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

    // Same multiplier the heal will use (Risk + Festering Wounds curse), capped at max HP
    const healMultiplier = run.healMult ?? saveSystem.getHealingMultiplier();
    const rawHeal = Math.round(healVal * healMultiplier);
    const effectiveHealVal = run.permanent?.overflowShieldCapPct > 0 ? rawHeal : Math.max(0, Math.min(rawHeal, run.maxHp + maxHpVal - run.hp));

    let buttonText = run.hasRelic?.('rel_golden_apple') ? 'HEAL TO FULL' : `HEAL ${effectiveHealVal} HP`;
    if (maxHpVal > 0) {
      buttonText += ` & +${maxHpVal} MAX HP`;
    }

    if (healMultiplier < 1) {
      notes.push(`Heal penalty (-${Math.round((1 - healMultiplier) * 100)}%)`);
    }

    const noteHtml = notes.length
      ? `<span style="font-size:12px;color:var(--accent);font-weight:600;">${notes.join(' • ')}</span>`
      : '';

    this.openModal('SAFE ZONE',
      `<div class="modal-node-icon">${ico('heal')}</div>${noteHtml ? `<p>${noteHtml}</p>` : ''}`,
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
      `<p>Land <strong class="accent">3 of 5</strong> in the green. PERFECTs speed it up.</p>`,
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
    const depth = run.abyssDepth || 0;
    document.getElementById('result-sub').textContent = depth ? `Sector clear, then ${depth} floor${depth > 1 ? 's' : ''} into the Abyss.` : run.runResult === 'victory' ? 'The sector is clear.' : run.hp > 0 ? 'Operation abandoned.' : 'Your ball was destroyed.';
    const tile = (label, value) => `<div class="result-stat"><span>${label}</span><strong>${value}</strong></div>`;
    document.getElementById('result-stats').innerHTML = [
      depth ? tile('ABYSS', depth) : tile('FLOOR', `${Math.min(run.floor + 1, CONFIG.map.floors)}/${CONFIG.map.floors}`),
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

  /** Mastery XP line on the result screen: +XP, level bar, level-ups and milestones reached. */
  showMasteryResult(ball, xp, { before, after }, totalXp) {
    const main = document.querySelector('.result-main');
    if (!main || !ball) return;
    let el = document.getElementById('result-mastery');
    if (!el) {
      el = document.createElement('div');
      el.id = 'result-mastery';
      el.className = 'result-mastery';
      document.getElementById('result-tp')?.after(el);
    }
    const m = masteryLevel(totalXp);
    const hit = MILESTONES.filter((x) => x.level > before && x.level <= after);
    el.innerHTML = `
      <div class="rm-head">${ico('star')}<b style="color:${ball.color}">${ball.name}</b> LV ${after}${after > before ? ' <em class="rm-up">LEVEL UP!</em>' : ''}<span class="rm-xp">+${xp} XP</span></div>
      <i class="rm-bar"><i style="width:${m.need ? Math.round((m.into / m.need) * 100) : 100}%"></i></i>
      ${hit.map((x) => `<span class="rm-milestone">LV ${x.level}: ${x.label}</span>`).join('')}`;
    if (after > before) soundEngine.play('confirm');
  }

  /** After a boss: extract with the win, or descend deeper into the Abyss. */
  showDescend({ depth, next, rewards, hp, maxHp }, onDescend, onExtract) {
    const first = depth === 0;
    const reward = rewards ? `<div class="reward-tiles">
        <div class="reward-tile" style="--c:#ffcd75">${ico('key')}<strong>+${rewards.keys}</strong><span>KEYS</span></div>
        <div class="reward-tile" style="--c:#73eff7">${ico('tp')}<strong>+${rewards.tp}</strong><span>TP</span></div>
      </div>` : '';
    this.openModal(first ? 'SECTOR CLEAR' : `ABYSS ${depth} CLEARED`, `
      ${first ? '<p class="node-line">The run counts as a win. Something waits below.</p>' : reward}
      <div class="node-chips">
        <span class="node-chip">${ico('hp')}${Math.ceil(hp)}/${maxHp}</span>
        <span class="node-chip bad">${ico('skull')}ABYSS ${next}: +${next * 8}% HP</span>
        <span class="node-chip">${ico('key')}${3 + next * 2} per floor</span>
      </div>`,
    `<div class="btn-row">
      <button class="btn btn-accent" data-act="extract">EXTRACT</button>
      <button class="btn btn-danger" data-act="descend">DESCEND</button>
    </div>`);
    this.modalActions.querySelector('[data-act="extract"]').addEventListener('click', () => {
      soundEngine.play('confirm');
      this.closeModal();
      onExtract();
    });
    this.modalActions.querySelector('[data-act="descend"]').addEventListener('click', () => {
      soundEngine.play('alarm');
      haptics.impact('heavy');
      onDescend();
    });
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

  /** Every Risk rule: active ones highlighted, locked ones dimmed, plus the sealed 11th. */
  showRiskRules(level, maxUnlocked) {
    let rows = CONFIG.risk.levels.map((rule, i) => {
      const n = i + 1;
      const state = n <= level ? 'on' : n <= maxUnlocked ? '' : 'locked';
      return `<div class="risk-rule-row ${state}"><b>${n}</b><span><strong>${rule.name}</strong> ${rule.desc}</span></div>`;
    }).join('');
    const secret = CONFIG.risk.secret;
    const n = CONFIG.risk.levels.length + 1;
    if (saveSystem.hasSecretRisk()) {
      rows += `<div class="risk-rule-row abyss ${level >= n ? 'on' : ''}"><b>XI</b><span><strong>${secret.name}</strong> ${secret.desc}</span></div>`;
    } else {
      // Scrambled until you reach Risk 10; then the clue becomes readable
      const clue = maxUnlocked >= n - 1 ? secret.hint : '&#9618;&#9618;&#9618; &#9618;&#9618; &#9618;&#9618;&#9618;&#9618; &#9618;&#9618; &#9618;&#9618;&#9618;&#9618;&#9618;';
      rows += `<div class="risk-rule-row sealed"><b>??</b><span><strong class="glitch-text" data-text="&#9618;&#9618;&#9618;&#9618;&#9618;">&#9618;&#9618;&#9618;&#9618;&#9618;</strong> ${clue}</span></div>`;
    }
    this.openModal('RISK RULES', `<p class="dim-text">Rules stack: Risk ${level || 'N'} applies rules 1 to ${level || 'N'}. Each level: +${CONFIG.risk.tpPerLevel}% Tech Points.</p><div class="risk-rule-list">${rows}</div>`,
      `<div class="btn-row"><button class="btn btn-accent" data-act="close">CLOSE</button></div>`);
    this.modalActions.querySelector('[data-act="close"]').addEventListener('click', () => this.closeModal());
  }

  /** Result-screen line for the secret Risk: unlocked, or a hint of how close you were. */
  showSecretRisk(unlocked, normalFights = 0) {
    const el = document.getElementById('result-risk');
    if (!el) return;
    const secret = CONFIG.risk.secret;
    el.innerHTML = unlocked
      ? `<b class="abyss-text">RISK XI: ${secret.name}</b><br><span>${secret.desc}</span>`
      : `<b class="glitch-text" data-text="&#9618; SIGNAL &#9618;">&#9618; SIGNAL &#9618;</b><br><span>Something watched you fight ${normalFights} common hostile${normalFights === 1 ? '' : 's'}.</span>`;
    el.classList.remove('hidden');
    el.classList.toggle('abyss', unlocked);
    if (unlocked) {
      soundEngine.play('alarm');
      haptics.impact('heavy');
    }
  }

  /** Tapping + past Risk 10 while the secret is sealed: the value glitches and a clue flashes. */
  glitchRiskHint(hint) {
    const val = document.getElementById('risk-level-val');
    const summary = document.getElementById('risk-level-bonus');
    if (!val || !summary) return;
    const before = { v: val.textContent, s: summary.innerHTML };
    val.textContent = '??';
    val.classList.add('glitch');
    summary.innerHTML = `<span class="abyss-text">${hint}</span>`;
    clearTimeout(this._glitchT);
    this._glitchT = setTimeout(() => {
      val.textContent = before.v;
      val.classList.remove('glitch');
      summary.innerHTML = before.s;
    }, 2600);
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
    document.getElementById('battle-floor').textContent = run.floor >= CONFIG.map.floors ? `ABYSS ${run.floor - CONFIG.map.floors + 1}` : `FLOOR ${run.floor + 1}`;
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

// Battle report: gun names back to their parts (icons / colours)
const PARTS_BY_NAME = Object.fromEntries(PARTS.map((p) => [p.name, p]));

// ---------- Tech tree layout ----------
// Four branches grow out of the CORE like an X; `col` is how far along the
// branch a node sits, `row` (0-2) which side of the branch it forks to.
const TECH_BRANCHES = [
  { key: 'rct', title: 'REACTOR', color: '#73eff7', angle: (-150 * Math.PI) / 180 },
  { key: 'sur', title: 'SURVIVAL', color: '#a7f070', angle: (-30 * Math.PI) / 180 },
  { key: 'bar', title: 'BARRIER', color: '#41a6f6', angle: (30 * Math.PI) / 180 },
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
  add(st.rigEnergy, 'Energy pool', `+${st.rigEnergy}`);
  add(st.rigRegen, 'Energy per turn', `+${st.rigRegen}`);
  add(st.rigCool, 'Cooling per turn', `+${st.rigCool}`);
  add(st.freeFirstShot, 'First shot', 'free');
  add(st.killEnergy, 'Kills refund', `${st.killEnergy} energy`);
  add(st.overclock, 'Every 3rd turn', '+1 action');
  add(st.barrierHpPct, 'Barrier HP', `+${pct(st.barrierHpPct)}%`);
  add(st.barrierCdCut, 'Barrier cooldown', `-${st.barrierCdCut}T`);
  add(st.barrierSpikeDmg, 'Barrier spikes', `${st.barrierSpikeDmg} dmg`);
  add(st.barrierExtra, 'Barriers on field', `+${st.barrierExtra}`);
  add(st.bulwarkPct, 'Behind a barrier', `-${pct(st.bulwarkPct)}% dmg`);
  add(st.barrierForcefield, 'Barrier', 'grants Forcefield');
  add(st.emergencyMedkitHeal, 'Emergency heal', `${st.emergencyMedkitHeal} HP`);
  add(st.overflowShieldCapPct, 'Overflow shield cap', `${pct(st.overflowShieldCapPct)}% HP`);
  add(st.forcefieldTurnInterval, 'Forcefield', `every ${st.forcefieldTurnInterval} turns`);
  add(st.vampiricVitalityPct, 'Lifesteal', `${pct(st.vampiricVitalityPct)}%`);
  add(st.counterPct, 'Counter damage', `${pct(st.counterPct)}%`);
  add(st.secondWindPct, 'Second Wind', `revive at ${pct(st.secondWindPct)}%`);
  add(st.startGoldBonus, 'Start gold', `+${st.startGoldBonus}`);
  add(st.shopDiscountBonus, 'Shop prices', `-${pct(st.shopDiscountBonus)}%`);
  add(st.extraMoves, 'Moves per floor', `+${st.extraMoves}`);
  add(st.tpBonusPct, 'Battle TP', `+${pct(st.tpBonusPct)}%`);
  add(st.keyBonus, 'Keys per win', `+${st.keyBonus}`);
  add(st.supplyDropRelics, 'Starting relics', `${st.supplyDropRelics}`);
  return out;
}
