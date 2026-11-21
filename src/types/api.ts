export type GameMode = "regular" | "pve";
export type TabId = "quests" | "quest-tree" | "maps" | "cultist" | "items";

export interface BootstrapConfig {
  host: string;
  port: number;
  default_game_mode: GameMode;
  language: "ru" | "en";
  watch_logs: boolean;
  watch_screenshots: boolean;
  eft_logs_dir: string;
  eft_screenshots_dir: string;
  auto_open_browser?: boolean;
  cache_ttl_minutes?: number;
}

export interface WatcherStatus {
  watchLogs: boolean;
  watchScreenshots: boolean;
  logsDir: string;
  logsDirFound?: boolean;
  screenshotsDir: string;
  activeMode?: GameMode;
}

export interface MapSummary {
  id: string;
  name: string;
  normalizedName: string;
  hasSvg: boolean;
  raidDuration: number;
  players: string;
  bossCount: number;
  extractCount: number;
  lockCount: number;
}

export interface BootstrapResponse {
  mode: GameMode;
  lang: "ru" | "en";
  config: BootstrapConfig;
  watcher: WatcherStatus;
  maps: MapSummary[];
  traders: { id: string; name: string }[];
  rates: { RUB: number; USD: number; EUR: number };
}

export interface QuestItem {
  id: string;
  name: string;
  trader: string;
  mapName: string;
  minPlayerLevel: number;
  experience: number;
  kappaRequired: boolean;
  lightkeeperRequired: boolean;
  status: string;
  prereqIds: string[];
  prereqNames: string[];
  prereqCompletedCount?: number;
  prereqTotalCount?: number;
  objectivesText?: string[];
  neededItems?: { itemId: string; name: string; count: number; foundInRaid?: boolean }[];
  neededKeys?: { itemId?: string; name: string; fleaPrice?: number }[];
  wikiLink?: string;
}

export interface QuestsResponse {
  mode: GameMode;
  counts: {
    active: number;
    available: number;
    completed: number;
    failed?: number;
    locked: number;
  };
  kappa: { done: number; total: number };
  recordedXp: number;
  velocity: { date: string; count: number; xp: number }[];
  needs?: {
    firItems?: { itemId: string; name: string; count: number; quests?: string[] }[];
    questItems?: { itemId: string; name: string; count: number; quests?: string[] }[];
    keys?: { itemId?: string; name: string; fleaPrice?: number; quests?: string[] }[];
  };
  quests: QuestItem[];
}
