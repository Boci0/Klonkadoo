// ============================================================
// UIManager — DOM-based interface layer.
// Owns the main menu, run map screen, node
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
import { OPERATOR, skinsFor, isSkinUnlocked, skinProgress, skinColors } from '../meta/Balls.js';
import { mechDataUrl } from '../rendering/mechSprite.js';
import { MEDALS, medalProgress, checkMedals } from '../meta/Medals.js';
import { masteryLevel, MILESTONES, MAX_MASTERY } from '../meta/Mastery.js';
import { getPart, loadoutTotals, SLOTS, PARTS, rarityColor, rarityName, describePart, CLEAN_WIN_KEYS, DTYPES, DTYPE_KEYS, tierOf, partChips, partNote } from '../meta/Mech.js';
import { partCardHtml, bindHoverTips, chipHtml, tierDots, hideTip, iconKeyHtml } from './partCard.js';
import { getSupply } from '../rogue/Supplies.js';
import { RigScreen } from './RigScreen.js';
import { ico, partIcon, uiIcon } from '../rendering/pixelIcons.js';

export class UIManager {
  /**
   * @param {Object} callbacks - action handlers owned by the App
   */
  constructor(callbacks) {
    this.cb = callbacks;
    this.screens = {
      menu: document.getElementById('screen-menu'),
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
    if (btnPlay) btnPlay.addEventListener('click', () => {
      soundEngine.playUI();
      // A suspended run resumes with the rig it started with
      if (this.cb.savedRun?.()) return this.cb.onPlay();
      // An overloaded mech (any mech on the team) can't deploy
      const heavy = this._overloadedMech();
      if (heavy) {
        const { i, t } = heavy;
        soundEngine.play('error');
        this.showConfirm({
          title: `MECH ${i + 1} OVERLOADED`,
          text: `${ico('load')} ${t.weight}/${t.capacity} kg: ${t.overKg - CONFIG.gear.overweightMax} kg past the limit. Lighten it to deploy.`,
          confirmLabel: 'OPEN RIG',
          onConfirm: () => {
            saveSystem.setEditing(i);
            this.showMech();
          },
        });
        return;
      }
      this.cb.onPlay();
    });
    document.getElementById('btn-almanac')?.addEventListener('click', () => {
      soundEngine.playUI();
      this.showAlmanac();
    });
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

    // Run map screen
    const btnRetreat = document.getElementById('btn-retreat');
    if (btnRetreat) {
      btnRetreat.addEventListener('click', () => {
        soundEngine.playUI();
        this.closeDrawers();
        this.showConfirm({
          title: 'ABANDON RUN?',
          text: 'The run ends now. Keys and scrap you earned are kept.',
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

  /** One supply card (Supplies.js) for the shop / treasure grids. */
  _supplyCard(s, button) {
    return `<div class="shop-item">
        <div class="shop-item-head">
          <span class="shop-item-icon">${ico(s.icon, s.color)}</span>
          <strong class="supply-name" style="color:${s.color}">${s.name}</strong>
        </div>
        <div class="shop-desc">${s.desc}</div>
        ${button}
      </div>`;
  }

  /** Treasure: pick one of the offered supplies for free. */
  showTreasure(supplies, onPick) {
    const cards = supplies.map((s) => this._supplyCard(s, `<button class="btn btn-accent" data-pick="${s.id}">TAKE</button>`)).join('');
    this.openModal('SUPPLY CACHE', `<p>Pick one.</p><div class="shop-grid">${cards}</div>`,
      `<div class="btn-row"><button class="btn btn-outline" data-act="skip">LEAVE IT</button></div>`);
    this.modalBody.querySelectorAll('[data-pick]').forEach((b) => b.addEventListener('click', () => {
      this.closeModal();
      onPick(b.dataset.pick);
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
      <div class="encounter-tags"><span class="tag-pill tag-loss">-${cost} G</span><span class="tag-pill tag-gold">50%: +45 GOLD OR 3 KEYS</span></div>`,
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

  /** Operation condition card shown when a run starts. */
  showCondition(cond) {
    this.openModal('OPERATION CONDITION', `<p class="condition-name">${cond.name}</p><p>${cond.desc}</p>`,
      `<div class="btn-row"><button class="btn btn-accent" data-act="ok">DEPLOY</button></div>`);
    this.modalActions.querySelector('[data-act="ok"]').addEventListener('click', () => this.closeModal());
  }

  // ---------- Deploy (run start) ----------

  /**
   * Before a run: your mech at a glance (what you'll fight with), its
   * paint, mastery and the Risk to play on (with its rules). There are no
   * classes: the rig is the character.
   */
  showBallSelect(onStart) {
    const b = OPERATOR;
    const owned = saveSystem.getLoadoutParts(0); // mech 1 leads
    const t = loadoutTotals(owned);
    // Garage mechs 2 and 3 come along (SWAP in battle, drop in after a knock-out)
    const team = saveSystem.getTeamLoadouts().slice(1);
    // One row of part icons (cards on hover / tap), in slot order
    const parts = owned.filter(Boolean);
    const partIds = parts.map((o) => o.id);
    const icons = parts.map((o) => `<span class="deploy-part" style="--c:${rarityColor(tierOf(o))}" data-tip-uid="${o.uid}" data-name="${getPart(o.id).name}"><img src="${partIcon(o.id)}" alt="${getPart(o.id).name}"></span>`).join('');

    this.openModal('DEPLOY', `
      <div class="deploy">
        <div class="deploy-ball">
          <img class="ball-sprite deploy-mech" id="deploy-sprite" src="${mechDataUrl(partIds, skinColors(b, 'default').color, skinColors(b, 'default').darkColor)}" alt="">
          <div class="deploy-paint">
            <button class="btn btn-outline paint-step" data-paint="-1" aria-label="Previous paint">&#9664;</button>
            <b id="paint-name">COBALT</b>
            <button class="btn btn-outline paint-step" data-paint="1" aria-label="Next paint">&#9654;</button>
          </div>
        </div>
        <div class="deploy-info">
          <div class="deploy-stats">
            <span title="HP">${ico('hp')}${CONFIG.run.maxHpBase + Math.round(t.hp)}</span>
            ${DTYPE_KEYS.map((k) => `<span title="${DTYPES[k].name} resist" style="color:${DTYPES[k].color}">${ico('def', DTYPES[k].color)}${Math.round((t.def + t.res[k]) * 10) / 10}</span>`).join('')}
            <span title="Energy pool, refill per turn">${ico('energy')}${t.energy}<em>${ico('regen')}${t.regen}</em></span>
            <span title="Heat cap, cooling per turn">${ico('heat')}${t.heatCap}<em>${ico('cool')}${t.cool}</em></span>
            <span title="Weight / load cap" class="${t.overKg > 0 ? 'bad' : ''}">${ico('load')}${t.weight}<em>/${t.capacity}</em></span>
          </div>
          <div class="deploy-parts">${icons}</div>
          ${team.length ? `<div class="deploy-team"><span>TEAM</span>${team.map((ps, i) => `<img src="${mechDataUrl(ps.filter(Boolean).map((o) => o.id), skinColors(b, 'default').color, skinColors(b, 'default').darkColor)}" alt="Mech ${i + 2}" title="Mech ${i + 2}">`).join('')}</div>` : ''}
          <p class="deploy-hint" id="deploy-hint">${t.overweight ? '<span class="bad">Over the load limit: fix it on the RIG screen.</span>' : ''}</p>
          <div class="deploy-mastery" id="ball-mastery"></div>
          <div class="deploy-risk"><p id="deploy-risk" class="risk-summary"></p><button class="btn btn-outline risk-rules-btn" data-act="rules">RULES</button></div>
        </div>
      </div>`, `<div class="btn-row">
        <button class="btn btn-outline" data-act="cancel">BACK</button>
        <div class="ball-risk-row" id="ball-risk-row"></div>
        <button class="btn btn-primary" data-act="start" ${t.overweight ? 'disabled' : ''}>&#9654; START</button>
      </div>`);

    const hint = document.getElementById('deploy-hint');
    // Hover (or press and hold) a part for its card
    bindHoverTips(this.modalBody, '[data-tip-uid]', (el) => {
      const o = saveSystem.getOwnedPart(el.dataset.tipUid);
      return o ? partCardHtml(o) : '';
    });

    // Risk + mastery
    const riskRow = this.modalActions.querySelector('#ball-risk-row');
    const levels = CONFIG.risk.levels.length;
    const renderRisk = () => {
      const max = saveSystem.getMaxRiskUnlocked(b.id);
      const val = saveSystem.getDifficultyLevel(b.id);
      const m = masteryLevel(saveSystem.getMasteryXp(b.id));
      const next = MILESTONES.find((x) => x.level > m.level);
      // At 10/10 the + stays live while the secret level is sealed: it glitches and hints
      const sealed = !saveSystem.hasSecretRisk(b.id) && max >= levels && val >= max;
      riskRow.innerHTML = `<button class="btn btn-outline risk-step" data-risk="-1" ${val <= 0 ? 'disabled' : ''}>&minus;</button>
        <b class="ball-risk-val ${val > levels ? 'secret' : ''}">${max === 0 ? 'RISK LOCKED' : `RISK <span id="risk-level-val">${val > levels ? 'XI' : val}</span>`}</b>
        <button class="btn btn-outline risk-step ${sealed ? 'risk-sealed' : ''}" data-risk="1" ${val >= max && !sealed ? 'disabled' : ''}>+</button>`;
      const summary = document.getElementById('deploy-risk');
      if (max === 0) summary.innerHTML = `<span class="dim-text">Win a run to unlock Risk</span>`;
      else if (val === 0) summary.innerHTML = '<span class="dim-text">No extra rules</span>';
      else {
        const rule = saveSystem.riskLevels(b.id)[val - 1];
        const more = val > 1 ? ` <span class="dim-text">+${val - 1}</span>` : '';
        summary.innerHTML = `<span class="risk-tp-inline">+${val * CONFIG.risk.scrapPerLevel}% SCRAP</span> <b class="${rule.allElite ? 'abyss-text' : ''}" title="${rule.desc}">${rule.name}</b>${more}`;
      }
      const bar = m.need ? `<i class="bm-bar" title="${m.into}/${m.need} XP"><i style="width:${Math.round((m.into / m.need) * 100)}%"></i></i>` : '<em>MAX</em>';
      document.getElementById('ball-mastery').innerHTML = `<b>${ico('star')}MASTERY ${m.level}</b>${bar}${next ? `<span title="Next at level ${next.level}">${next.label}</span>` : ''}`;
      riskRow.querySelectorAll('[data-risk]').forEach((btn) => btn.addEventListener('click', () => {
        const step = Number(btn.dataset.risk);
        if (step > 0 && sealed) {
          soundEngine.play('error');
          haptics.impact('heavy');
          this.glitchRiskHint(CONFIG.risk.secret.hint);
          return;
        }
        saveSystem.setDifficultyLevel(val + step, b.id);
        soundEngine.playUI(step > 0 ? 700 : 500);
        haptics.impact('light');
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
      const look = skinColors(b, s.id);
      document.getElementById('deploy-sprite').src = mechDataUrl(partIds, look.color, look.darkColor);
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

    this.modalBody.querySelector('[data-act="rules"]').addEventListener('click', () => {
      soundEngine.playUI();
      // The rules list replaces this window: come back to DEPLOY after
      this.showRiskRules(saveSystem.getDifficultyLevel(b.id), saveSystem.getMaxRiskUnlocked(b.id), () => this.showBallSelect(onStart));
    });
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
          ${row('motion', 'REDUCE MOTION', document.body.classList.contains('reduce-motion'))}
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
          if (key === 'motion') {
            const on = !document.body.classList.contains('reduce-motion');
            document.body.classList.toggle('reduce-motion', on);
            try {
              localStorage.setItem('slingshot-reduce-motion', on ? '1' : '0');
            } catch (_) {}
          }
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
      <p class="dim-text">KLONKADOO is made by one person, with no ads and no purchases.</p>
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
      mail: () => open(`mailto:${S.feedbackEmail}?subject=${encodeURIComponent(`KLONKADOO v${pkg.version} feedback`)}`),
      share: async () => {
        const link = onPlay && native ? S.playUrl : S.webUrl;
        try {
          await navigator.clipboard.writeText(`KLONKADOO, a pixel mech roguelike: ${link}`);
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
      <p><strong>KLONKADOO</strong> <span class="dim-text">v${pkg.version}</span><br>
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
          doc.innerHTML = `<iframe src="${import.meta.env.BASE_URL}privacy.html" title="Privacy policy"></iframe>`;
        } else {
          try {
            const text = await (await fetch(`${import.meta.env.BASE_URL}licenses.txt`)).text();
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

  /** Short-lived notification on the map screen (floor advanced, retreated, reward found...). */
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
        <div class="menu-stat"><span>Keys</span><strong class="accent">${saveSystem.getMech().tokens}</strong></div>
      `;
    }
    this._renderDaily();
    // One-time notice: the retired tech tree was paid out in Keys and scrap
    const conv = saveSystem.data.techConverted;
    if (conv) {
      this.toast(`<span class="feed-boon">TECH TREE RETIRED: ${conv.tp} TP → +${conv.keys} KEYS, +${conv.scrap} SCRAP</span>`);
      delete saveSystem.data.techConverted;
      saveSystem.save();
    }
    // One-time notice: the 1:1 build pass converted armor and shields
    const mc = saveSystem.data.mechConverted;
    if (mc) {
      const bits = [mc.armor ? `ARMOR → ${mc.armor} MOD${mc.armor > 1 ? 'S' : ''}` : '', mc.keys ? `+${mc.keys} ${ico('key')}` : '', mc.scrap ? `+${mc.scrap} ${ico('scrap')}` : ''].filter(Boolean);
      this.toast(`<span class="feed-boon">NEW RIG SLOTS: ${bits.join(' · ')}</span>`);
      delete saveSystem.data.mechConverted;
      saveSystem.save();
    }
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
    // Icon tiles: your first gun, medal star (with counts)
    const owned = MEDALS.filter((m) => saveSystem.hasMedal(m.id)).length;
    const gun = saveSystem.getLoadoutParts().find((o) => o && getPart(o.id).type === 'weapon');
    const heavy = !!this._overloadedMech(); // any team mech over the limit
    const tiles = {
      'btn-gear': { img: gun ? `<img class="pxi" src="${partIcon(gun.id)}" alt="">` : ico('gun'), label: 'RIG', count: heavy ? '!' : '', warn: heavy },
      'btn-almanac': { img: ico('book'), label: 'ALMANAC', count: `${new Set(saveSystem.getMech().owned.map((o) => o.id)).size}/${PARTS.length}` },
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
      ? `${ico('pod', d.crate === 'elite' ? '#c46fd6' : '#ffcd75')}<strong>FREE ${d.crate === 'elite' ? 'ELITE ' : ''}POD</strong><span>DAY ${d.streak}${d.crate === 'elite' ? '' : ` · ELITE ON DAY ${Math.ceil(d.streak / 7) * 7}`}</span>`
      : `${ico('pod', '#566c86')}<strong>OPENED</strong><span>DAY ${d.streak} · NEXT POD TOMORROW</span>`;
  }

  _claimDaily() {
    const got = saveSystem.claimDaily();
    if (!got) {
      soundEngine.play('error');
      return;
    }
    // Straight to the Rig screen's pods tab, opening today's free pod
    this.celebrateMedals(checkMedals(saveSystem));
    this.showMech({ tab: 'pods' });
    this.rig._openPod(got.crate, { free: true });
  }

  /** Toast for each newly earned medal. */
  celebrateMedals(list) {
    for (const m of list || []) {
      this.toast(`<span class="feed-boon">MEDAL: ${m.name}</span> <span class="feed-gold">+${m.keys} KEYS</span>`);
    }
    if (list?.length) soundEngine.play('confirm');
  }

  /** The first team mech (one that deploys) over the load limit: { i, t }, or null. */
  _overloadedMech() {
    const m = saveSystem.getMech();
    for (let i = 0; i < m.garageSlots; i++) {
      const parts = saveSystem.getLoadoutParts(i);
      if (i > 0 && !parts.some((o) => o && getPart(o.id)?.type === 'frame')) continue; // no frame: stays home
      const t = loadoutTotals(parts);
      if (t.overweight) return { i, t };
    }
    return null;
  }

  /** Rig screen (loadout + supply pods). */
  showMech(opts = {}) {
    this.closeModal();
    this._setVisible('rig');
    this.rig.show(opts);
  }

  /**
   * Almanac: every part in the game, by type, with its level-1 stats and
   * what it does (the same lines the Rig screen shows). Parts you own are ticked.
   */
  showAlmanac(type = 'weapon', page = 0) {
    const owned = new Set(saveSystem.getMech().owned.map((o) => o.id));
    const TABS = [['weapon', 'GUNS'], ['legs', 'LEGS'], ['frame', 'FRAMES'], ['drone', 'DRONES'], ['module', 'MODS'], ['special', 'SPECIALS'], ['icons', '? ICONS']];
    const RANK = { common: 0, rare: 1, epic: 2, legendary: 3, mythic: 4 };
    const list = PARTS.filter((p) => p.type === type).sort((a, b) => RANK[a.rarity] - RANK[b.rarity] || a.name.localeCompare(b.name));
    // No scrolling: as many cards as fit the screen, the rest on the next page
    const cols = window.innerWidth >= 1000 ? 3 : 2;
    const rows = Math.max(1, Math.floor((window.innerHeight - 230) / 96));
    const per = cols * rows;
    const pages = Math.max(1, Math.ceil(list.length / per));
    page = Math.max(0, Math.min(pages - 1, page));
    const cards = list.slice(page * per, page * per + per).map((p) => {
      const has = owned.has(p.id);
      const lo = { id: p.id, level: 1 };
      const note = partNote(p);
      return `<div class="alm-card ${has ? 'owned' : ''}" style="--rar:${rarityColor(p.rarity)}">
        <img class="alm-icon" src="${partIcon(p.id)}" alt="">
        <div class="alm-body">
          <div class="alm-head"><b>${p.name}</b>${tierDots(lo)}<em>${has ? '&#10003;' : ''}</em></div>
          <div class="rig-chips">${partChips(lo).slice(0, 7).map(chipHtml).join('')}</div>
          ${note ? `<p class="alm-desc" title="${note}">${note}</p>` : ''}
        </div>
      </div>`;
    }).join('');
    const tabs = TABS.map(([t, label]) => `<button class="btn ${t === type ? 'btn-accent' : 'btn-outline'} alm-tab" data-alm="${t}">${label}</button>`).join('');
    const found = PARTS.filter((p) => owned.has(p.id)).length;
    const pager = pages > 1
      ? `<button class="btn btn-outline" data-page="${page - 1}" ${page ? '' : 'disabled'}>&#9664;</button><b class="alm-page">${page + 1}/${pages}</b><button class="btn btn-outline" data-page="${page + 1}" ${page < pages - 1 ? '' : 'disabled'}>&#9654;</button>`
      : '';
    const body = type === 'icons' ? iconKeyHtml() : `<div class="alm-list" style="--cols:${cols}">${cards}</div>`;
    this.openModal(`ALMANAC ${found}/${PARTS.length}`, `<div class="alm-tabs">${tabs}</div>${body}`,
      `<div class="btn-row alm-actions">${pager}<button class="btn btn-accent" data-act="close">CLOSE</button></div>`, { wide: true });
    this.nodeModal.querySelector('.modal-content')?.classList.add('modal-almanac');
    this.modalBody.querySelectorAll('[data-alm]').forEach((b) => b.addEventListener('click', () => {
      soundEngine.playUI();
      this.showAlmanac(b.dataset.alm);
    }));
    this.modalActions.querySelectorAll('[data-page]').forEach((b) => b.addEventListener('click', () => {
      soundEngine.playUI();
      this.showAlmanac(type, Number(b.dataset.page));
    }));
    this.modalActions.querySelector('[data-act="close"]').addEventListener('click', () => {
      this.nodeModal.querySelector('.modal-content')?.classList.remove('modal-almanac');
      hideTip();
      this.closeModal();
    });
  }

  showMedals(page = 0) {
    const owned = MEDALS.filter((m) => saveSystem.hasMedal(m.id)).length;
    // No scrolling: a page of medals that fits, arrows for the rest
    const per = Math.max(3, Math.floor((window.innerHeight - 190) / 58));
    const pages = Math.max(1, Math.ceil(MEDALS.length / per));
    page = Math.max(0, Math.min(pages - 1, page));
    const rows = MEDALS.slice(page * per, page * per + per).map((m) => {
      const done = saveSystem.hasMedal(m.id);
      const [cur, max] = medalProgress(m, saveSystem);
      const pct = Math.round((Math.min(cur, max) / max) * 100);
      return `<div class="medal-row ${done ? 'done' : ''}">
        <i class="medal-icon">${done ? '&#9733;' : '&#9734;'}</i>
        <div class="medal-body">
          <strong>${m.name}</strong><span>${m.desc}</span>
          ${done ? '' : `<div class="medal-bar"><i style="width:${pct}%"></i></div>`}
        </div>
        <em class="medal-tp">${done ? 'EARNED' : `${Math.min(cur, max)}/${max}`}<br>+${m.keys} ${ico('key')}</em>
      </div>`;
    }).join('');
    const pager = pages > 1
      ? `<button class="btn btn-outline" data-page="${page - 1}" ${page ? '' : 'disabled'}>&#9664;</button><b class="alm-page">${page + 1}/${pages}</b><button class="btn btn-outline" data-page="${page + 1}" ${page < pages - 1 ? '' : 'disabled'}>&#9654;</button>`
      : '';
    this.openModal(`MEDALS ${owned}/${MEDALS.length}`, `<div class="medal-list">${rows}</div>`,
      `<div class="btn-row alm-actions">${pager}<button class="btn btn-accent" data-act="close">CLOSE</button></div>`);
    this.modalActions.querySelectorAll('[data-page]').forEach((b) => b.addEventListener('click', () => {
      soundEngine.playUI();
      this.showMedals(Number(b.dataset.page));
    }));
    this.modalActions.querySelector('[data-act="close"]').addEventListener('click', () => this.closeModal());
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
    this.renderQuests(run);
  }

  /**
   * Effective numbers for the Status drawer: everything folded together
   * (gear, mastery, boons, Risk, run condition), shown as what
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
    const def = run.totalDef;
    const res = run.res;
    const red = Math.max(-0.5, Math.min(0.85, run.damageReductionPct || 0));
    const taken = Math.round(((1 - red) * (1 + (risk.plusDmgTaken || 0) / 100) - 1) * 100);

    const rows = [
      { label: 'HP', value: `${Math.ceil(run.hp)}/${run.maxHp}${run.shieldHp > 0 ? ` +${Math.ceil(run.shieldHp)}` : ''}`, hint: run.shieldHp > 0 ? 'includes shield' : ball.name },
      { label: 'GUN DAMAGE', value: signed(dmg), tone: tone(dmg), hint: 'ATK from gear, boons, mastery' },
      { label: 'CRIT CHANCE', value: `${crit}%`, hint: 'crits hit 1.75x' },
      ...DTYPE_KEYS.map((t) => {
        const v = Math.round((def + (res[t] || 0)) * 10) / 10;
        return { label: `${DTYPES[t].name} RES`, value: `${v}`, tone: res[t] > 0 ? 'good' : '', hint: v > 0 ? `about -${Math.round(Math.min(12, v) * 0.75)} per ${DTYPES[t].short} hit` : 'no reduction' };
      }),
      { label: 'DAMAGE TAKEN', value: signed(taken), tone: tone(taken, false), hint: 'Risk' },
      { label: 'ENERGY', value: `${rig.energy} +${rig.regen}/T`, hint: 'per shot, refills each turn' },
      { label: 'HEAT', value: `${rig.heatCap} -${rig.cool}/T`, hint: 'cap, cools each turn' },
      ...(run.walkBonus ? [{ label: 'WALK', value: `+${run.walkBonus}`, tone: 'good', hint: 'Swift Loader' }] : []),
      ...(run.reachBonus ? [{ label: 'GUN RANGE', value: `+${run.reachBonus}`, tone: 'good', hint: 'Long Barrel' }] : []),
    ];
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
            +${q.reward} SCRAP
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

  openModal(title, bodyHTML, actionsHTML, { wide = false } = {}) {
    this.nodeModal.querySelector('.modal-content')?.classList.toggle('modal-wide', wide);
    this.nodeModal.querySelector('.modal-content')?.classList.remove('modal-almanac');
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
      treasure: 'SUPPLY CACHE',
      gamble: 'BACK-ALLEY GAMBLE',
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
      combat: ['Win clean for a bonus.', [chip('key', 'KEYS x3'), chip('gold', 'GOLD'), chip('scrap', 'SCRAP')]],
      elite: ['Tough. Worth it.', [chip('key', 'KEYS x5'), chip('gold', 'GOLD'), chip('scrap', 'SCRAP x10')]],
      miniboss: ['Sector guardian.', [chip('gold', '+50'), chip('key', 'KEYS x5'), chip('scrap', 'SCRAP x16')]],
      boss: ['Win the operation.', [chip('skull', 'BOSS', 'bad'), chip('key', 'KEYS')]],
      encounter: ['Unknown signal.', [chip('star', 'REWARD?'), chip('hp', 'RISK?', 'bad')]],
      shop: ['Repairs, Keys, scrap, boons.', [chip('gold', 'SPEND GOLD')]],
      rest: ['Catch your breath.', [chip('heal', 'HEAL')]],
      minigame: ['Timing test.', [chip('gold', 'GOLD'), chip('heal', 'HEAL')]],
      treasure: ['Unguarded.', [chip('star', '1 OF 2 FREE')]],
      gamble: ['Coin flip.', [chip('gold', '-15', 'bad'), chip('gold', '50%: +45')]],
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

    // Which part did the work (stomps and rams get a symbol: they aren't parts)
    const HIT_ICON = { STOMP: 'stomp', RAM: 'move' };
    const guns = Object.entries(r.byGun || {}).sort((a, b) => b[1] - a[1]);
    const top = guns[0]?.[1] || 1;
    const gunRows = guns.map(([name, dmg], i) => {
      const part = PARTS_BY_NAME[name];
      return `<div class="br-gun ${i === 0 ? 'mvp' : ''}" style="--c:${part?.color || '#94b0c2'}">
        <img src="${part ? partIcon(part.id) : uiIcon(HIT_ICON[name] || 'dmg')}" alt="">
        <span>${name}${i === 0 && guns.length > 1 ? ' <em>MVP</em>' : ''}</span>
        <i class="br-bar"><i style="--w:${Math.round((dmg / top) * 100)}%"></i></i><b>${Math.round(dmg)}</b></div>`;
    }).join('') || '<p class="dim-text">No gun hits this fight.</p>';

    // Rewards
    const tiles = [];
    const tile = (icon, value, label, color) => tiles.push(`<div class="reward-tile br-pop" style="--c:${color}">${icon}<strong data-count="${value}" data-prefix="+">+0</strong><span>${label}</span></div>`);
    if (rewards) {
      if (rewards.gold) tile(ico('gold'), rewards.gold, 'GOLD', '#ffcd75');
      if (rewards.scrap) tile(ico('scrap'), rewards.scrap, 'SCRAP', '#94b0c2');
      if (rewards.tokens) tile(ico('key'), rewards.tokens, 'KEYS', '#ffcd75');
      if (rewards.heal) tile(ico('hp'), rewards.heal, 'HP', '#ff5d73');
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
            <h3>DAMAGE BY PART</h3>
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
      if (c.gainScrap) parts.push(`<span class="tag-pill tag-tech">+${c.gainScrap} SCRAP</span>`);
      if (c.gainKeys) parts.push(`<span class="tag-pill tag-gold">+${c.gainKeys} KEYS</span>`);
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

    shopItems.forEach((item, i) => {
      const sup = getSupply(item.id);
      if (!sup) return;
      const cost = run.price(sup.cost);
      const affordable = run.gold >= cost;
      const label = item.sold ? 'SOLD' : `${cost} G`;
      body += this._supplyCard(sup, `<button class="btn ${!item.sold && affordable ? 'btn-accent' : 'btn-outline'}" data-buy="${i}" ${item.sold || !affordable ? 'disabled' : ''}>${label}</button>`);
    });

    body += '</div>';

    this.openModal('SUPPLY DEPOT', body, '');

    this.modalBody.querySelectorAll('button[data-buy]').forEach((btn) => {
      btn.addEventListener('click', () => {
        if (this.cb.onSupplyBuy(Number(btn.dataset.buy))) this.cb.onShopRefresh();
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

  showRest(run) {
    const healVal = CONFIG.run.hpRegenPerRest || 30;
    const notes = [];

    // Same multiplier the heal will use (Risk), capped at max HP
    const healMultiplier = run.healMult ?? saveSystem.getHealingMultiplier();
    const effectiveHealVal = Math.max(0, Math.min(Math.round(healVal * healMultiplier), run.maxHp - run.hp));
    const buttonText = `HEAL ${effectiveHealVal} HP`;

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
      if (rewards.keys) parts.push(`<span style="color:var(--accent)">+${rewards.keys} KEY${rewards.keys > 1 ? 'S' : ''}</span>`);
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
      tile('KEYS EARNED', run.tokensEarned || 0),
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
        <span class="quest-reward">${q.completed ? `+${q.reward} SCRAP` : '—'}</span>
      `;
      questList.appendChild(item);
    }
    if (!quests.length) questList.innerHTML = '<span class="dim-text">No quests this run.</span>';
    const m = saveSystem.getMech();
    document.getElementById('result-tp').textContent = `KEYS: ${m.tokens} · SCRAP: ${m.scrap}`;
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
        <div class="reward-tile" style="--c:#94b0c2">${ico('scrap')}<strong>+${rewards.scrap}</strong><span>SCRAP</span></div>
      </div>` : '';
    const final = rewards?.final;
    this.openModal(first ? 'SECTOR CLEAR' : final ? 'TRUE FINAL BOSS DOWN' : `ABYSS ${depth} CLEARED`, `
      ${first ? '<p class="node-line">The run counts as a win. Five Abyss floors wait below, and something at the bottom.</p>' : ''}
      ${final ? '<p class="node-line">KLONKADOO PRIME is scrap. From here the Abyss is endless: how deep can you go?</p>' : ''}
      ${first ? '' : reward}
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
  /** Every Risk rule; `onClose` (e.g. back to DEPLOY) runs when it's closed. */
  showRiskRules(level, maxUnlocked, onClose = null) {
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
    this.openModal('RISK RULES', `<p class="dim-text">Rules stack: Risk ${level || 'N'} applies rules 1 to ${level || 'N'}. Each level: +${CONFIG.risk.scrapPerLevel}% scrap from battles.</p><div class="risk-rule-list">${rows}</div>`,
      `<div class="btn-row"><button class="btn btn-accent" data-act="close">${onClose ? 'BACK' : 'CLOSE'}</button></div>`);
    this.modalActions.querySelector('[data-act="close"]').addEventListener('click', () => (onClose ? onClose() : this.closeModal()));
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

  /** Tapping + past Risk 10 while the secret is sealed: the value glitches and a clue flashes (DEPLOY window). */
  glitchRiskHint(hint) {
    const val = document.getElementById('risk-level-val');
    const summary = document.getElementById('deploy-risk');
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
    // Every fight can be left; leaving a boss or mini-boss counts as a loss
    document.getElementById('btn-retreat-battle')?.classList.remove('hidden');
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
}

// Battle report: gun names back to their parts (icons / colours)
const PARTS_BY_NAME = Object.fromEntries(PARTS.map((p) => [p.name, p]));

