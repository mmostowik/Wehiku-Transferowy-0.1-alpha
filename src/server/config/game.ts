import type { GameModeKey, PositionCode } from '../../shared/contracts.js';

export const TRANSFER_SEASON_DISPLAY = '2025/2026';
export const TRANSFER_SEASON_KEY = '2025/26';

export const TOP_LEAGUES = [
  'Premier League', 'LaLiga', 'Serie A', 'Bundesliga', 'Ligue 1', 'Liga Portugal',
  'Eredivisie', 'Süper Lig', 'Jupiler Pro League', 'Championship',
] as const;

export const POSITION_MAP: Record<PositionCode, string[]> = {
  GK: ['Goalkeeper'],
  CB: ['Centre-Back'],
  FB: ['Right-Back', 'Left-Back'],
  CM: ['Central Midfield', 'Defensive Midfield', 'Attacking Midfield'],
  W: ['Right Winger', 'Left Winger', 'Right Midfield', 'Left Midfield'],
  ST: ['Centre-Forward', 'Second Striker'],
};

export interface GameMode {
  name: string;
  budget: number;
  draftOrder: PositionCode[];
  transferWindowsAfterRound: number[];
}

export const GAME_MODES: Record<GameModeKey, GameMode> = {
  fast: { name: 'Szybki (5 graczy)', budget: 150_000_000, draftOrder: ['GK', 'CB', 'CM', 'W', 'ST'], transferWindowsAfterRound: [3, 5] },
  medium: { name: 'Średni (8 graczy)', budget: 250_000_000, draftOrder: ['GK', 'FB', 'CB', 'CM', 'W', 'CM', 'W', 'ST'], transferWindowsAfterRound: [3, 5, 7] },
  long: { name: 'Długi (11 graczy)', budget: 350_000_000, draftOrder: ['GK', 'FB', 'FB', 'CB', 'CB', 'CM', 'CM', 'CM', 'W', 'W', 'ST'], transferWindowsAfterRound: [3, 7, 9, 11] },
};
