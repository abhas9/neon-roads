import type { SaveData, Settings } from '../core/save';
import type { WorldDef } from '../levels/worldTypes';
import { formatTime, MEDAL_NAMES, medalTarget } from '../game/medals';
import { SPECIAL_TILE_COLORS, TILE_NAMES } from '../render/tileColors';
import { Tile } from '../sim/types';

export interface ScreenHost {
  root: HTMLElement;
  onNavigate: (focusFirst?: boolean) => void;
}

export const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);

export function medalIcon(m: number, size = 'md'): string {
  if (!m) return `<span class="medal none ${size}"></span>`;
  return `<span class="medal m${m} ${size}" title="${MEDAL_NAMES[m]}"></span>`;
}

export function titleScreen(save: SaveData, dailyLabel: string, phoneLabel: string): string {
  const total = Object.values(save.roads).filter((r) => r.completions > 0).length;
  const golds = Object.values(save.roads).filter((r) => r.medal >= 3).length;
  return `
  <div class="screen title-screen">
    <div class="logo">
      <div class="logo-main" data-text="NEON ROADS">NEON ROADS</div>
      <div class="logo-sub">ride the floating highways · survive the void</div>
    </div>
    <nav class="menu">
      <button class="nav btn primary" data-action="campaign">Campaign <small>${total}/30 roads · ${golds} gold+</small></button>
      <button class="nav btn" data-action="daily">Daily Run <small>${dailyLabel}</small></button>
      <button class="nav btn" data-action="endless">Endless <small>best ${save.endless.best} m</small></button>
      <button class="nav btn" data-action="phone">Phone Controller <small class="phone-status">${phoneLabel}</small></button>
      <button class="nav btn" data-action="help">How to Play</button>
      <button class="nav btn" data-action="settings">Settings</button>
    </nav>
    <div class="footer-hint">
      <span><kbd>←</kbd><kbd>→</kbd> steer</span><span><kbd>↑</kbd><kbd>↓</kbd> throttle</span><span><kbd>Space</kbd> jump</span><span><kbd>R</kbd> restart</span><span>🎮 gamepad &amp; touch supported</span>
    </div>
  </div>`;
}

export function isRoadUnlocked(worlds: WorldDef[], save: SaveData, wi: number, ri: number): boolean {
  const done = (w: number, r: number) => (save.roads[`w${w + 1}r${r + 1}`]?.completions ?? 0) > 0;
  if (ri > 0) return done(wi, ri - 1);
  if (wi === 0) return true;
  const prev = worlds[wi - 1].roads.filter((_, r) => done(wi - 1, r)).length;
  return prev >= 2 || done(wi, 0);
}

export function worldSelect(worlds: WorldDef[], save: SaveData, pars: Record<string, number>): string {
  const cards = worlds
    .map((w, wi) => {
      const unlockedAny = isRoadUnlocked(worlds, save, wi, 0);
      const roads = w.roads
        .map((r, ri) => {
          const id = `w${wi + 1}r${ri + 1}`;
          const rec = save.roads[id];
          const unlocked = isRoadUnlocked(worlds, save, wi, ri);
          const par = pars[id];
          return `<button class="nav road-btn ${unlocked ? '' : 'locked'}" data-action="road" data-world="${wi}" data-road="${ri}" ${unlocked ? '' : 'disabled'}
              data-tip="${esc(r.name)} · G ${r.gravity} · O₂ ${r.oxygen}s${par ? ` · Gold ${formatTime(medalTarget(3, par))}` : ''}">
            <span class="road-num">${ri + 1}</span>
            <span class="road-name">${unlocked ? esc(r.name) : 'LOCKED'}</span>
            <span class="road-best">${rec?.completions ? formatTime(rec.best) : ''}</span>
            ${medalIcon(rec?.medal ?? 0, 'sm')}
          </button>`;
        })
        .join('');
      return `<section class="world-card ${unlockedAny ? '' : 'locked'}" data-world="${wi}" style="--accent:${w.palette.edge};--sky:${w.sky.horizon};--sky2:${w.sky.nebulaA}">
        <header><span class="world-num">${String(wi + 1).padStart(2, '0')}</span><div><h3>${esc(w.name)}</h3><p>${esc(w.tagline)}</p></div></header>
        <div class="roads">${roads}</div>
        ${unlockedAny ? '' : '<div class="lock-note">Finish 2 roads in the previous world</div>'}
      </section>`;
    })
    .join('');
  return `
  <div class="screen worlds-screen">
    <div class="screen-head">
      <button class="nav btn ghost back" data-action="back">‹ Back</button>
      <h2>Campaign</h2>
      <div class="medal-legend">${[4, 3, 2, 1].map((m) => `${medalIcon(m, 'sm')}<span>${MEDAL_NAMES[m]}</span>`).join('')}</div>
    </div>
    <div class="world-grid">${cards}</div>
  </div>`;
}

export interface ResultsInfo {
  roadName: string;
  worldName: string;
  time: number;
  medal: number;
  prevBest: number | null;
  newRecord: boolean;
  par: number;
  hasNext: boolean;
  attempts: number;
  assist: boolean;
}

export function resultsScreen(r: ResultsInfo): string {
  const rows = [4, 3, 2]
    .map((m) => `<li class="${r.medal >= m ? 'got' : ''}">${medalIcon(m, 'sm')}<span>${MEDAL_NAMES[m]}</span><b>${formatTime(medalTarget(m, r.par))}</b></li>`)
    .join('');
  return `
  <div class="screen results-screen">
    <div class="panel">
      <div class="panel-kicker">${esc(r.worldName)}</div>
      <h2 class="glow">ROAD COMPLETE</h2>
      <div class="panel-sub">${esc(r.roadName)}</div>
      <div class="result-medal">${medalIcon(r.medal, 'xl')}<div class="result-medal-name">${MEDAL_NAMES[r.medal]}</div></div>
      <div class="result-time">${formatTime(r.time)}${r.newRecord ? '<span class="badge">NEW RECORD</span>' : ''}</div>
      <div class="result-meta">${r.prevBest ? `Previous best ${formatTime(r.prevBest)} · ` : ''}${r.attempts} attempt${r.attempts === 1 ? '' : 's'}${r.assist ? ' · jump assist on' : ''}</div>
      <ul class="targets">${rows}<li class="got">${medalIcon(1, 'sm')}<span>Bronze</span><b>finish</b></li></ul>
      <div class="actions">
        ${r.hasNext ? '<button class="nav btn primary" data-action="next">Next Road</button>' : ''}
        <button class="nav btn ${r.hasNext ? '' : 'primary'}" data-action="retry">Retry <kbd>R</kbd></button>
        <button class="nav btn ghost" data-action="worlds">Worlds</button>
      </div>
    </div>
  </div>`;
}

export function endlessResults(opts: { daily: boolean; label: string; distance: number; best: number; newRecord: boolean; cause: string; sub: string; time: number }): string {
  return `
  <div class="screen results-screen">
    <div class="panel">
      <div class="panel-kicker">${opts.daily ? `Daily Run · ${esc(opts.label)}` : 'Endless'}</div>
      <h2 class="glow bad">${esc(opts.cause)}</h2>
      <div class="panel-sub">${esc(opts.sub)}</div>
      <div class="result-time">${opts.distance} m${opts.newRecord ? '<span class="badge">NEW RECORD</span>' : ''}</div>
      <div class="result-meta">Best ${opts.best} m · survived ${formatTime(opts.time)}</div>
      <div class="actions">
        <button class="nav btn primary" data-action="retry">Retry <kbd>R</kbd></button>
        <button class="nav btn ghost" data-action="menu">Menu</button>
      </div>
    </div>
  </div>`;
}

export function pauseScreen(title: string): string {
  return `
  <div class="screen pause-screen">
    <div class="panel small">
      <div class="panel-kicker">Paused</div>
      <h2>${esc(title)}</h2>
      <div class="actions column">
        <button class="nav btn primary" data-action="resume">Resume</button>
        <button class="nav btn" data-action="restart">Restart <kbd>R</kbd></button>
        <button class="nav btn" data-action="settings">Settings</button>
        <button class="nav btn ghost" data-action="quit">Quit</button>
      </div>
    </div>
  </div>`;
}

export function settingsScreen(s: Settings): string {
  const toggle = (key: keyof Settings, label: string, hint: string) =>
    `<label class="nav setting toggle" tabindex="0" data-toggle="${key}"><span><b>${label}</b><small>${hint}</small></span><i class="switch ${s[key] ? 'on' : ''}"></i></label>`;
  const slider = (key: 'music' | 'sfx', label: string) =>
    `<label class="setting"><span><b>${label}</b></span><input class="nav" type="range" min="0" max="1" step="0.05" value="${s[key]}" data-slider="${key}"></label>`;
  const select = (key: 'quality' | 'touchControls', label: string, opts: [string, string][]) =>
    `<div class="setting"><span><b>${label}</b></span><div class="seg">${opts
      .map(([v, l]) => `<button class="nav ${s[key] === v ? 'on' : ''}" data-select="${key}" data-value="${v}">${l}</button>`)
      .join('')}</div></div>`;
  return `
  <div class="screen settings-screen">
    <div class="panel">
      <div class="screen-head inline"><button class="nav btn ghost back" data-action="back">‹ Back</button><h2>Settings</h2><span></span></div>
      <div class="settings-list">
        ${slider('music', 'Music')}
        ${slider('sfx', 'Sound effects')}
        ${toggle('jumpAssist', 'Jump assist', 'Auto-jumps at edges. Great for learning a road.')}
        ${toggle('ghost', 'Ghost replays', 'Race your best run (toggle in-game with G).')}
        ${toggle('shake', 'Camera effects', 'Screen shake and speed FOV. Turn off for reduced motion.')}
        ${toggle('bloom', 'Bloom glow', 'Neon glow post-processing.')}
        ${select('quality', 'Resolution', [['high', 'Sharp'], ['low', 'Fast']])}
        ${select('touchControls', 'Touch controls', [['auto', 'Auto'], ['on', 'On'], ['off', 'Off']])}
      </div>
    </div>
  </div>`;
}

export function helpScreen(): string {
  const tiles = [Tile.Supply, Tile.Boost, Tile.Sticky, Tile.Slippery, Tile.Burning]
    .map((t) => `<li><span class="tile-swatch t${t}" style="--c:${SPECIAL_TILE_COLORS[t]}"></span>${TILE_NAMES[t]}</li>`)
    .join('');
  return `
  <div class="screen help-screen">
    <div class="panel wide">
      <div class="screen-head inline"><button class="nav btn ghost back" data-action="back">‹ Back</button><h2>How to Play</h2><span></span></div>
      <div class="help-grid">
        <div>
          <h4>Goal</h4>
          <p>Reach the gate at the end of each road. Every road is a puzzle of gaps, walls, tunnels and tiles — and your air and fuel are always running out.</p>
          <h4>Controls</h4>
          <table class="controls">
            <tr><td>Steer</td><td><kbd>←</kbd><kbd>→</kbd> / <kbd>A</kbd><kbd>D</kbd></td><td>Left stick</td></tr>
            <tr><td>Accelerate / brake</td><td><kbd>↑</kbd><kbd>↓</kbd> / <kbd>W</kbd><kbd>S</kbd></td><td>RT / LT</td></tr>
            <tr><td>Jump</td><td><kbd>Space</kbd></td><td>A</td></tr>
            <tr><td>Restart</td><td><kbd>R</kbd></td><td>Y / Back</td></tr>
            <tr><td>Pause</td><td><kbd>Esc</kbd></td><td>Start</td></tr>
            <tr><td>Toggle ghost</td><td><kbd>G</kbd></td><td>X</td></tr>
          </table>
          <p class="dim">Touch: drag the left pad to steer (up/down for throttle), tap JUMP on the right.</p>
        </div>
        <div>
          <h4>Tiles</h4>
          <ul class="tile-list">${tiles}</ul>
          <h4>Survival</h4>
          <ul class="rules">
            <li><b>O₂</b> drains every second — it's the clock.</li>
            <li><b>Fuel</b> burns with distance travelled.</li>
            <li><b>Gravity</b> (G) changes per road: low G floats, high G barely hops.</li>
            <li>Hitting a wall head-on at speed destroys the ship. Brush it slowly and you'll just bump.</li>
            <li>Finish fast for <b>Silver</b>, <b>Gold</b> and the elusive <b>Neon</b> medal. Your best run becomes a ghost.</li>
          </ul>
        </div>
      </div>
    </div>
  </div>`;
}

export interface PhoneInfo {
  status: 'idle' | 'connecting' | 'ready' | 'error';
  error: string;
  code: string;
  url: string;
  qrSvg: string;
  names: string[];
  lanHint: boolean;
}

export function phoneScreen(p: PhoneInfo): string {
  const statusText =
    p.status === 'ready' ? (p.names.length ? `Connected: ${p.names.map(esc).join(', ')}` : 'Waiting for a phone…') : p.status === 'connecting' ? 'Opening pairing channel…' : p.status === 'error' ? esc(p.error) : '';
  return `
  <div class="screen phone-screen">
    <div class="panel wide phone-panel">
      <div class="screen-head inline"><button class="nav btn ghost back" data-action="back">‹ Back</button><h2>Phone Controller</h2><span></span></div>
      <div class="phone-grid">
        <div class="qr-wrap ${p.status === 'ready' ? '' : 'pending'}">
          ${p.qrSvg || '<div class="qr-placeholder">…</div>'}
        </div>
        <div class="phone-info">
          <div class="pair-code-label">Pairing code</div>
          <div class="pair-code">${esc(p.code || '-----')}</div>
          <div class="pair-status ${p.status} ${p.names.length ? 'connected' : ''}"><i></i>${statusText}</div>
          <ol class="pair-steps">
            <li>Scan the QR code with your phone camera, or open <code>${esc(p.url.replace(/#.*$/, ''))}</code> and type the code.</li>
            <li>Hold the phone sideways: <b>left thumb</b> drags to steer (up/down = throttle), <b>right thumb</b> jumps. Tilt steering and cruise are in the pad's ⚙ menu.</li>
            <li>In menus the phone becomes a D-pad with A/B buttons.</li>
          </ol>
          <p class="dim small">Inputs travel peer-to-peer over WebRTC — directly between your phone and this browser, no game server. A free public broker is only used for the initial handshake.${
            p.lanHint
              ? ' You are running a local server, so your phone must be on the same Wi-Fi as this computer.'
              : ' Any network works; being on the same Wi-Fi gives the lowest latency.'
          }</p>
          <div class="actions left">
            <button class="nav btn" data-action="phone-new-code">New code</button>
            <button class="nav btn ghost" data-action="phone-disconnect">Turn off</button>
          </div>
        </div>
      </div>
    </div>
  </div>`;
}
