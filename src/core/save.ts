export interface Settings {
  music: number;
  sfx: number;
  jumpAssist: boolean;
  ghost: boolean;
  shake: boolean;
  bloom: boolean;
  quality: 'high' | 'low';
  touchControls: 'auto' | 'on' | 'off';
}

export interface RoadRecord {
  best: number;
  medal: number;
  ghost?: string;
  /** Jump assist state the ghost tape was recorded with. */
  ghostAssist?: boolean;
  completions: number;
  attempts: number;
}

export interface SaveData {
  v: 1;
  roads: Record<string, RoadRecord>;
  settings: Settings;
  endless: { best: number };
  daily: Record<string, { best: number; ghost?: string; ghostAssist?: boolean; attempts: number }>;
  seenHelp: boolean;
}

const KEY = 'neon-roads-save-v1';

export const DEFAULT_SETTINGS: Settings = {
  music: 0.55,
  sfx: 0.8,
  jumpAssist: false,
  ghost: true,
  shake: true,
  bloom: true,
  quality: 'high',
  touchControls: 'auto',
};

export function loadSave(): SaveData {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) {
      const d = JSON.parse(raw) as SaveData;
      if (d.v === 1) {
        d.settings = { ...DEFAULT_SETTINGS, ...d.settings };
        d.roads ??= {};
        d.daily ??= {};
        d.endless ??= { best: 0 };
        return d;
      }
    }
  } catch {
    // Storage unavailable or corrupt; start fresh.
  }
  return { v: 1, roads: {}, settings: { ...DEFAULT_SETTINGS }, endless: { best: 0 }, daily: {}, seenHelp: false };
}

export function writeSave(d: SaveData): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(d));
  } catch {
    // Quota exceeded: drop ghosts from other roads, keep progress.
    try {
      for (const r of Object.values(d.roads)) delete r.ghost;
      localStorage.setItem(KEY, JSON.stringify(d));
    } catch {
      // Give up silently; progress for this session stays in memory.
    }
  }
}
