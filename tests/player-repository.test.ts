import path from 'node:path';
import { describe, expect, it } from 'vitest';
import type { PlayerCard } from '../src/shared/contracts';
import { normalizeSeason, PlayerRepository, transferValue } from '../src/server/data/player-repository';

const fixturePath = path.resolve('tests/fixtures/player-database.json');

describe('PlayerRepository', () => {
  it('normalizuje publiczną nazwę sezonu transferowego do klucza istniejącego w bazie', () => {
    expect(normalizeSeason('2025/2026')).toBe('2025/26');
  });

  it('losuje zastępców z 2025/26, gdy gra posługuje się etykietą 2025/2026', async () => {
    const repository = await PlayerRepository.load(fixturePath);
    const result = repository.draw('2025/2026', ['Centre-Forward'], 5, new Set(), () => 0.5);
    expect(result.map((player) => player.id)).toEqual(['st-2']);
  });

  it('odczytuje wycenę transferową z faktycznego klucza 2025/26', () => {
    const card = { transferWindowValues: { '2025/26': 42 }, currentValue: 30, historicalValue: 20 } as PlayerCard;
    expect(transferValue(card)).toBe(42);
  });
});
