// ============================================================
// DevTools — Developer Debug & Balancing Panel
// Toggle with ~ (Backquote) or by clicking the [DEV] floating badge.
// Designed for easy removal by deleting this file & its 1-line import in main.js.
// ============================================================

export class DevTools {
  constructor(gameRefGetter, runRefGetter, saveSystem, techTree) {
    this.getGame = gameRefGetter;
    this.getRun = runRefGetter;
    this.saveSystem = saveSystem;
    this.techTree = techTree;

    // Balancing Overrides
    this.overrides = {
      enemyHpMult: 1.0,
      enemyAtkMult: 1.0,
      enemyDefOffset: 0,
    };

    this.visible = false;
    this._injectUI();
    this._bindHotkey();
  }

  _injectUI() {
    // Floating Dev Badge Button
    const badge = document.createElement('button');
    badge.id = 'dev-tools-badge';
    badge.innerHTML = '[DEV]';
    badge.style.cssText = `
      position: fixed;
      bottom: 10px;
      left: 10px;
      z-index: 99999;
      background: rgba(16, 22, 32, 0.85);
      border: 1px solid #e8a94c;
      color: #e8a94c;
      font-family: monospace;
      font-size: 11px;
      font-weight: bold;
      padding: 4px 10px;
      border-radius: 4px;
      cursor: pointer;
      box-shadow: 0 4px 12px rgba(0,0,0,0.5);
    `;
    badge.addEventListener('click', () => this.toggle());
    document.body.appendChild(badge);

    // Overlay Window
    const panel = document.createElement('div');
    panel.id = 'dev-tools-panel';
    panel.style.cssText = `
      position: fixed;
      top: 40px;
      left: 10px;
      width: 320px;
      max-height: 85vh;
      overflow-y: auto;
      z-index: 99999;
      background: rgba(12, 16, 24, 0.95);
      border: 1px solid #e8a94c;
      border-radius: 6px;
      padding: 14px;
      color: #d6dde8;
      font-family: "Segoe UI", sans-serif;
      font-size: 12px;
      box-shadow: 0 8px 24px rgba(0,0,0,0.8);
      display: none;
    `;

    panel.innerHTML = `
      <div style="display:flex;justify-content:space-between;align-items:center;border-bottom:1px solid rgba(232,169,76,0.3);padding-bottom:8px;margin-bottom:12px;">
        <span style="font-family:monospace;font-weight:700;color:#e8a94c;letter-spacing:1px;">[DEV] GAME BALANCER & DEBUG</span>
        <button id="dev-close" style="background:none;border:none;color:#8a94a8;cursor:pointer;font-weight:bold;">✕</button>
      </div>

      <!-- Section: TP & Tech Tree -->
      <div class="dev-section" style="margin-bottom:14px;background:rgba(255,255,255,0.03);padding:10px;border-radius:4px;">
        <div style="font-weight:700;color:#5fd3a8;margin-bottom:6px;">TECH POINTS & UPGRADES</div>
        <div style="display:flex;gap:6px;flex-wrap:wrap;margin-bottom:6px;">
          <button class="dev-btn" data-act="add-tp-1k">+1,000 TP</button>
          <button class="dev-btn" data-act="add-tp-50k">+50,000 TP</button>
          <button class="dev-btn" data-act="unlock-all-tech">Unlock All Techs</button>
        </div>
      </div>

      <!-- Section: Enemy Stat Tuning -->
      <div class="dev-section" style="margin-bottom:14px;background:rgba(255,255,255,0.03);padding:10px;border-radius:4px;">
        <div style="font-weight:700;color:#e0655c;margin-bottom:6px;">ENEMY STAT MODIFIERS</div>
        
        <label style="display:block;margin-bottom:6px;">
          Enemy HP Scale: <span id="dev-hp-val" style="color:#e8a94c;font-weight:bold;">1.0x</span>
          <input type="range" id="dev-hp-slider" min="0.1" max="5.0" step="0.1" value="1.0" style="width:100%;">
        </label>

        <label style="display:block;margin-bottom:6px;">
          Enemy ATK Scale: <span id="dev-atk-val" style="color:#e8a94c;font-weight:bold;">1.0x</span>
          <input type="range" id="dev-atk-slider" min="0.1" max="5.0" step="0.1" value="1.0" style="width:100%;">
        </label>

        <label style="display:block;margin-bottom:6px;">
          Enemy DEF Offset: <span id="dev-def-val" style="color:#e8a94c;font-weight:bold;">+0</span>
          <input type="range" id="dev-def-slider" min="-10" max="20" step="1" value="0" style="width:100%;">
        </label>
      </div>

      <!-- Section: Run Cheats & Combat Controls -->
      <div class="dev-section" style="margin-bottom:10px;background:rgba(255,255,255,0.03);padding:10px;border-radius:4px;">
        <div style="font-weight:700;color:#7aa2ff;margin-bottom:6px;">RUN CHEATS</div>
        <div style="display:flex;gap:6px;flex-wrap:wrap;">
          <button class="dev-btn" data-act="heal-full">Full Heal HP</button>
          <button class="dev-btn" data-act="add-gold">+500 Gold</button>
          <button class="dev-btn" data-act="insta-kill">Insta-Kill Enemies</button>
        </div>
      </div>

      <div style="font-size:10px;color:#8a94a8;text-align:center;margin-top:6px;">
        Press <code style="color:#e8a94c;">~</code> (Backquote) anytime to toggle
      </div>
    `;

    // Dev button styling
    const style = document.createElement('style');
    style.textContent = `
      .dev-btn {
        background: #1e2634;
        border: 1px solid #3d4a60;
        color: #d6dde8;
        font-size: 11px;
        padding: 4px 8px;
        border-radius: 3px;
        cursor: pointer;
      }
      .dev-btn:hover {
        background: #2b374d;
        border-color: #e8a94c;
        color: #fff;
      }
    `;
    document.head.appendChild(style);
    document.body.appendChild(panel);

    this.panel = panel;
    this._bindEvents();
  }

  _bindHotkey() {
    window.addEventListener('keydown', (e) => {
      if (e.key === '`' || e.key === '~') {
        this.toggle();
      }
    });
  }

  toggle() {
    this.visible = !this.visible;
    this.panel.style.display = this.visible ? 'block' : 'none';
  }

  _bindEvents() {
    this.panel.querySelector('#dev-close').addEventListener('click', () => this.toggle());

    // TP Buttons
    this.panel.querySelectorAll('.dev-btn[data-act]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const act = btn.dataset.act;
        if (act === 'add-tp-1k') {
          this.saveSystem.addTechPoints(1000);
          this._notify('Added +1,000 TP!');
        } else if (act === 'add-tp-50k') {
          this.saveSystem.addTechPoints(50000);
          this._notify('Added +50,000 TP!');
        } else if (act === 'unlock-all-tech') {
          for (const node of this.techTree.getAllNodes()) {
            const maxLvl = node.maxLevel || 1;
            this.saveSystem.data.techTreePurchases[node.id] = maxLvl;
          }
          this.saveSystem.save();
          this._notify('All Tech Tree Nodes Unlocked!');
        } else if (act === 'heal-full') {
          const run = this.getRun();
          if (run) {
            run.hp = run.maxHp;
            this._notify('Player Fully Healed!');
          }
        } else if (act === 'add-gold') {
          const run = this.getRun();
          if (run) {
            run.gold += 500;
            this._notify('Added +500 Gold!');
          }
        } else if (act === 'insta-kill') {
          const game = this.getGame();
          if (game && game.enemies) {
            for (const enemy of game.enemies) {
              enemy.hp = 0;
            }
            this._notify('Enemies Eliminated!');
          }
        }
      });
    });

    // Sliders
    const hpSlider = this.panel.querySelector('#dev-hp-slider');
    const atkSlider = this.panel.querySelector('#dev-atk-slider');
    const defSlider = this.panel.querySelector('#dev-def-slider');

    hpSlider.addEventListener('input', (e) => {
      this.overrides.enemyHpMult = parseFloat(e.target.value);
      this.panel.querySelector('#dev-hp-val').textContent = `${this.overrides.enemyHpMult.toFixed(1)}x`;
    });

    atkSlider.addEventListener('input', (e) => {
      this.overrides.enemyAtkMult = parseFloat(e.target.value);
      this.panel.querySelector('#dev-atk-val').textContent = `${this.overrides.enemyAtkMult.toFixed(1)}x`;
    });

    defSlider.addEventListener('input', (e) => {
      this.overrides.enemyDefOffset = parseInt(e.target.value, 10);
      const val = this.overrides.enemyDefOffset;
      this.panel.querySelector('#dev-def-val').textContent = val >= 0 ? `+${val}` : `${val}`;
    });
  }

  _notify(msg) {
    const toast = document.createElement('div');
    toast.textContent = msg;
    toast.style.cssText = `
      position: fixed;
      bottom: 20px;
      right: 20px;
      background: #5fd3a8;
      color: #080c14;
      font-weight: bold;
      padding: 8px 14px;
      border-radius: 4px;
      z-index: 100000;
      box-shadow: 0 4px 12px rgba(0,0,0,0.5);
    `;
    document.body.appendChild(toast);
    setTimeout(() => toast.remove(), 1800);
  }
}
