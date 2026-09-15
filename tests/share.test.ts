import { describe, expect, it } from 'vitest';
import { asciiBar, CANONICAL_URL, gameUrl, postIntentUrl, postText, postWeightedLength, scorecard } from '../src/game/share';
import type { DistanceScore, RoadScore } from '../src/game/share';

const road: RoadScore = {
  kind: 'road',
  roadCode: '1-3',
  roadName: 'Blockade',
  worldName: 'Launch Ring',
  time: 19.91,
  par: 18.5,
  medal: 3,
  fuel: 0.61,
  oxygen: 0.823,
  topSpeed: 270,
  jumps: 12,
  attempts: 4,
  newRecord: true,
  assist: false,
};

const endless: DistanceScore = { kind: 'distance', daily: true, label: '2026-09-15', distance: 1234, best: 1500, time: 45.2, newRecord: false, endedBy: 'HULL BREACH' };

describe('share scorecard', () => {
  it('renders an aligned, pure-ASCII box with the run stats', () => {
    const card = scorecard(road, CANONICAL_URL);
    const lines = card.split('\n');
    const box = lines.filter((l) => l.startsWith('|') || l.startsWith('+'));
    expect(new Set(box.map((l) => l.length)).size).toBe(1);
    expect(/^[\x20-\x7e\n]*$/.test(card)).toBe(true);
    expect(card).toContain('00:19.91');
    expect(card).toContain('GOLD');
    expect(card).toContain('+1.41s');
    expect(card).toContain(`FUEL       ${asciiBar(0.61)}  61%`);
    expect(card).toContain('82%');
    expect(card).toContain('NEW PERSONAL BEST');
    expect(lines[lines.length - 1]).toContain(CANONICAL_URL);
  });

  it('stays ASCII for distance runs and odd names', () => {
    const card = scorecard({ ...road, roadName: 'Über Straße — Ω' }, CANONICAL_URL) + scorecard(endless, CANONICAL_URL);
    expect(/^[\x20-\x7e\n]*$/.test(card)).toBe(true);
    expect(card).toContain('DISTANCE   1234 m');
  });

  it('builds a post that fits in one X post with the link', () => {
    for (const score of [road, endless, { ...road, medal: 4, roadName: 'Singularity' }]) {
      const text = postText(score);
      expect(postWeightedLength(text, CANONICAL_URL)).toBeLessThanOrEqual(280);
    }
    const intent = new URL(postIntentUrl(postText(road), CANONICAL_URL));
    expect(intent.hostname).toBe('x.com');
    expect(intent.searchParams.get('url')).toBe(CANONICAL_URL);
    const text = intent.searchParams.get('text')!;
    expect(text).toContain('00:19.91');
    expect(text).toContain('Fuel');
    expect(text).toContain('61%');
    expect(text).toContain('Blockade');
  });

  it('shares the public URL from dev servers and the real URL from forks', () => {
    expect(gameUrl({ hostname: 'localhost', origin: 'http://localhost:5287', pathname: '/' })).toBe(CANONICAL_URL);
    expect(gameUrl({ hostname: '192.168.1.20', origin: 'http://192.168.1.20:5287', pathname: '/' })).toBe(CANONICAL_URL);
    expect(gameUrl({ hostname: 'someone.github.io', origin: 'https://someone.github.io', pathname: '/neon-roads/index.html' })).toBe('https://someone.github.io/neon-roads/');
  });
});
