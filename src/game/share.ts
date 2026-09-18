import { formatTime, MEDAL_NAMES } from './medals';

/** Canonical public URL, used when playing from a local or LAN dev server. */
export const CANONICAL_URL = 'https://abhas9.github.io/neon-roads/';

export function gameUrl(loc: { hostname: string; origin: string; pathname: string } = location): string {
  const local = /^(localhost|127\.0\.0\.1|\[::1\]|0\.0\.0\.0)$/.test(loc.hostname) || /^(10|192\.168|172\.(1[6-9]|2\d|3[01]))\./.test(loc.hostname);
  if (local) return CANONICAL_URL;
  return `${loc.origin}${loc.pathname.replace(/[^/]*$/, '')}`;
}

/** Camera-based controllers, tagged on a shared scorecard. */
export type CameraControl = 'wand' | 'hands';

const CONTROL_ROW: Record<CameraControl, string> = { wand: 'CAMERA WAND', hands: 'HAND TRACKING' };
const CONTROL_POST: Record<CameraControl, string> = {
  wand: '🪄 Flown with a paper wand and a webcam',
  hands: '🖐 Flown with bare hands and a webcam',
};

export interface RoadScore {
  kind: 'road';
  roadCode: string;
  roadName: string;
  worldName: string;
  time: number;
  par: number;
  medal: number;
  /** Remaining fuel / oxygen, 0..1. */
  fuel: number;
  oxygen: number;
  /** HUD speed units (sim speed x 10). */
  topSpeed: number;
  jumps: number;
  attempts: number;
  newRecord: boolean;
  assist: boolean;
  /** Camera controller the run was driven by, at least partly. */
  control?: CameraControl;
}

export interface DistanceScore {
  kind: 'distance';
  daily: boolean;
  label: string;
  distance: number;
  best: number;
  time: number;
  newRecord: boolean;
  endedBy: string;
  /** Camera controller the run was driven by, at least partly. */
  control?: CameraControl;
}

export type Score = RoadScore | DistanceScore;

const WIDTH = 40;
const clamp01 = (v: number) => Math.max(0, Math.min(1, v));

/** ASCII meter, e.g. `[##########------]`. */
export function asciiBar(fraction: number, cells = 16): string {
  const filled = Math.round(clamp01(fraction) * cells);
  return `[${'#'.repeat(filled)}${'-'.repeat(cells - filled)}]`;
}

/** Compact meter for posts, e.g. `▰▰▰▰▰▰▱▱▱▱`. */
export function postBar(fraction: number, cells = 10): string {
  const filled = Math.round(clamp01(fraction) * cells);
  return '▰'.repeat(filled) + '▱'.repeat(cells - filled);
}

const pct = (v: number) => `${Math.round(clamp01(v) * 100)}%`;

function ascii(text: string): string {
  // Keep the card strictly printable ASCII so it lines up in any monospace font.
  return text.normalize('NFKD').replace(/[^\x20-\x7e]/g, '');
}

function row(content: string): string {
  const c = ascii(content);
  return `|  ${(c.length > WIDTH - 4 ? c.slice(0, WIDTH - 4) : c).padEnd(WIDTH - 4)}|`;
}

const rule = () => `+${'-'.repeat(WIDTH - 2)}+`;

/** Monospace scorecard copied to the clipboard. Every line is plain ASCII. */
export function scorecard(score: Score, url: string): string {
  const lines = [rule(), row('N E O N   R O A D S')];
  if (score.kind === 'road') {
    const delta = score.time - score.par;
    lines.push(
      row(`ROAD  ${score.roadCode}  ${score.roadName.toUpperCase()}`),
      row(`WORLD ${score.worldName.toUpperCase()}`),
      rule(),
      row(`TIME       ${formatTime(score.time)}   ${MEDAL_NAMES[score.medal].toUpperCase()}`),
      row(`PAR        ${formatTime(score.par)}   ${delta >= 0 ? '+' : '-'}${Math.abs(delta).toFixed(2)}s`),
      row(`FUEL       ${asciiBar(score.fuel)} ${pct(score.fuel).padStart(4)}`),
      row(`OXYGEN     ${asciiBar(score.oxygen)} ${pct(score.oxygen).padStart(4)}`),
      row(`TOP SPEED  ${Math.round(score.topSpeed)}`),
      row(`JUMPS      ${score.jumps}`),
      row(`ATTEMPTS   ${score.attempts}${score.assist ? '  (jump assist)' : ''}`),
    );
  } else {
    lines.push(
      row(score.daily ? `DAILY RUN  ${score.label}` : 'ENDLESS'),
      rule(),
      row(`DISTANCE   ${score.distance} m`),
      row(`BEST       ${score.best} m`),
      row(`SURVIVED   ${formatTime(score.time)}`),
      row(`ENDED BY   ${score.endedBy}`),
    );
  }
  if (score.control) lines.push(row(`CONTROL    ${CONTROL_ROW[score.control]}`));
  if (score.newRecord) lines.push(rule(), row('*** NEW PERSONAL BEST ***'));
  lines.push(rule(), `  Race me: ${url}`);
  return lines.join('\n');
}

const MEDAL_EMOJI = ['', '🥉', '🥈', '🥇', '💎'];

/** Post text for X. The game URL is passed separately so X can attach a link card. */
export function postText(score: Score): string {
  if (score.kind === 'road') {
    return [
      `🏁 Cleared ${score.roadCode} "${score.roadName}" in NEON ROADS`,
      '',
      `⏱ ${formatTime(score.time)} · ${MEDAL_EMOJI[score.medal]} ${MEDAL_NAMES[score.medal].toUpperCase()}`,
      `⛽ Fuel ${postBar(score.fuel)} ${pct(score.fuel)}`,
      `💨 O₂   ${postBar(score.oxygen)} ${pct(score.oxygen)}`,
      `🚀 Top speed ${Math.round(score.topSpeed)} · ${score.jumps} jumps`,
      ...(score.newRecord ? ['🏆 New personal best!'] : []),
      ...(score.control ? [CONTROL_POST[score.control]] : []),
      '',
      'Can you beat my time?',
    ].join('\n');
  }
  return [
    score.daily ? `🌌 NEON ROADS Daily Run ${score.label}` : '🌌 NEON ROADS Endless',
    '',
    `📏 ${score.distance.toLocaleString('en-US')} m${score.newRecord ? ' · 🏆 new best' : ` · best ${score.best.toLocaleString('en-US')} m`}`,
    `⏱ Survived ${formatTime(score.time)}`,
    `💥 ${score.endedBy}`,
    ...(score.control ? [CONTROL_POST[score.control]] : []),
    '',
    'How far can you go?',
  ].join('\n');
}

export function postIntentUrl(text: string, url: string): string {
  return `https://x.com/intent/tweet?text=${encodeURIComponent(text)}&url=${encodeURIComponent(url)}`;
}

/** Approximates X's weighted length: links count 23, wide characters (emoji, CJK) count 2. */
export function postWeightedLength(text: string, url: string): number {
  let n = 0;
  for (const ch of text) n += (ch.codePointAt(0) ?? 0) > 0x10ff ? 2 : 1;
  return n + 1 + 23 + (url ? 0 : -24);
}

/** Copies synchronously inside the click handler (before a new tab steals focus), with the async API as backup. */
export function copyToClipboard(text: string): boolean {
  let ok = false;
  const ta = document.createElement('textarea');
  ta.value = text;
  ta.setAttribute('readonly', '');
  ta.style.cssText = 'position:fixed;top:-1000px;left:-1000px;opacity:0';
  document.body.appendChild(ta);
  ta.select();
  try {
    ok = document.execCommand('copy');
  } catch {
    ok = false;
  }
  ta.remove();
  if (navigator.clipboard?.writeText) navigator.clipboard.writeText(text).catch(() => undefined);
  return ok || !!navigator.clipboard?.writeText;
}
