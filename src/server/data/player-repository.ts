import { readFile } from 'node:fs/promises';
import type { PlayerCard } from '../../shared/contracts.js';
import { TOP_LEAGUES, TRANSFER_SEASON_DISPLAY, TRANSFER_SEASON_KEY } from '../config/game.js';

type PlayerDatabase = Record<string, Record<string, PlayerCard[]>>;
type Random = () => number;

function seasonStart(season: string): number {
  return Number.parseInt(season.split('/')[0] ?? '', 10);
}

export function normalizeSeason(season: string): string {
  if (season === TRANSFER_SEASON_DISPLAY) return TRANSFER_SEASON_KEY;
  const [start, end] = season.split('/');
  return start && end && end.length === 4 ? `${start}/${end.slice(-2)}` : season;
}

export function transferValue(card: PlayerCard): number {
  return card.transferWindowValues[TRANSFER_SEASON_KEY]
    ?? card.transferWindowValues[TRANSFER_SEASON_DISPLAY]
    ?? (card.currentValue > 0 ? card.currentValue : card.historicalValue);
}

export class PlayerRepository {
  private constructor(
    private readonly database: PlayerDatabase,
    readonly draftSeasons: string[],
    readonly removedEntries: number,
  ) {}

  static async load(filePath: string): Promise<PlayerRepository> {
    const parsed: unknown = JSON.parse(await readFile(filePath, 'utf8'));
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      throw new Error('Baza zawodników ma nieprawidłowy format.');
    }

    const database = parsed as PlayerDatabase;
    const peakValues = new Map<string, number>();
    for (const positions of Object.values(database)) {
      for (const cards of Object.values(positions)) {
        for (const card of cards) {
          const values = [card.historicalValue, card.currentValue, ...Object.values(card.transferWindowValues)];
          peakValues.set(card.id, Math.max(peakValues.get(card.id) ?? 0, ...values));
        }
      }
    }

    let removedEntries = 0;
    for (const [season, positions] of Object.entries(database)) {
      for (const [position, cards] of Object.entries(positions)) {
        const filtered = cards.filter((card) => {
          if (card.stats.age === '?') return false;
          const ageIn2026 = card.stats.age + (2026 - seasonStart(season));
          return (peakValues.get(card.id) ?? 0) >= 5_000_000
            && TOP_LEAGUES.includes(card.stats.league as (typeof TOP_LEAGUES)[number])
            && card.currentValue > 0
            && ageIn2026 <= 32;
        });
        removedEntries += cards.length - filtered.length;
        positions[position] = filtered;
      }
    }

    const allSeasons = Object.keys(database);
    const draftSeasons = allSeasons.filter((season) => {
      const year = seasonStart(season);
      return year >= 2015 && year <= 2024;
    });
    return new PlayerRepository(database, draftSeasons, removedEntries);
  }

  get hasPlayers(): boolean {
    return Object.values(this.database).some((positions) =>
      Object.values(positions).some((cards) => cards.length > 0),
    );
  }

  randomSeason(random: Random = Math.random): string {
    const season = this.draftSeasons[Math.floor(random() * this.draftSeasons.length)];
    if (!season) throw new Error('Baza danych nie zawiera historycznych sezonów draftu.');
    return season;
  }

  draw(
    season: string,
    positions: string[],
    count: number,
    excludedIds: ReadonlySet<string>,
    random: Random = Math.random,
  ): PlayerCard[] {
    const seasonData = this.database[normalizeSeason(season)];
    if (!seasonData) return [];

    const possible = positions
      .flatMap((position) => seasonData[position] ?? [])
      .filter((card) => {
        if (card.stats.age === '?') return false;
        const ageIn2026 = card.stats.age + (2026 - seasonStart(season));
        return ageIn2026 <= 32 && !excludedIds.has(card.id);
      })
      .sort((left, right) => right.historicalValue - left.historicalValue);

    const weighted = possible.flatMap((card, index) =>
      Array.from({ length: index < possible.length / 3 ? 3 : 1 }, () => card),
    );
    for (let index = weighted.length - 1; index > 0; index -= 1) {
      const target = Math.floor(random() * (index + 1));
      [weighted[index], weighted[target]] = [weighted[target]!, weighted[index]!];
    }

    const unique = new Map<string, PlayerCard>();
    for (const card of weighted) {
      if (!unique.has(card.id)) unique.set(card.id, { ...card, sessionPickId: crypto.randomUUID() });
      if (unique.size >= count) break;
    }
    return [...unique.values()];
  }
}
