import type { GamePlayer, ScoreBreakdown } from '../../shared/contracts.js';

export function calculateScore(player: GamePlayer): ScoreBreakdown {
  const leagueCounts = new Map<string, number>();
  let teamValueBase = 0;
  let captainBonus = 0;

  for (const card of player.team) {
    const currentValue = card.currentValue || 0;
    teamValueBase += currentValue;
    if (card.id === player.captainId) captainBonus = currentValue;
    leagueCounts.set(card.stats.league, (leagueCounts.get(card.stats.league) ?? 0) + 1);
  }

  const hasLeagueSynergy = Math.max(0, ...leagueCounts.values()) >= 3;
  const valueWithCaptain = teamValueBase + captainBonus;
  const valueAfterSynergy = valueWithCaptain * (hasLeagueSynergy ? 1.15 : 1);

  return {
    teamValueBase,
    captainBonus,
    synergyBonus: valueAfterSynergy - valueWithCaptain,
    totalProfit: player.totalProfit,
    finalScore: valueAfterSynergy + player.totalProfit,
  };
}
