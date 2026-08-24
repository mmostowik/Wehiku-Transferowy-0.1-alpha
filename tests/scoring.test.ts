import { describe, expect, it } from 'vitest';
import type { GamePlayer, PlayerCard } from '../src/shared/contracts';
import { calculateScore } from '../src/server/domain/scoring';

function card(id: string, league: string, currentValue: number): PlayerCard {
  return { id, realName: id, stats: { age: 25, league }, historicalValue: currentValue, transferWindowValues: {}, currentValue };
}

describe('calculateScore', () => {
  it('zachowuje kapitana x2, premię 15% za ligę i profit transferowy', () => {
    const player: GamePlayer = {
      id: '1', username: 'Gracz', budget: 0, totalProfit: 5_000_000, captainId: 'a',
      team: [card('a', 'Serie A', 10_000_000), card('b', 'Serie A', 20_000_000), card('c', 'Serie A', 30_000_000)],
    };
    expect(calculateScore(player)).toEqual({
      teamValueBase: 60_000_000,
      captainBonus: 10_000_000,
      synergyBonus: 10_500_000,
      totalProfit: 5_000_000,
      finalScore: 85_500_000,
    });
  });
});
