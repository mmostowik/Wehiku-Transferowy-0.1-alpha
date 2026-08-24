import type { DraftCard, GamePlayer, PlayerCard, RoomSummary, StatKey } from '../shared/contracts';
import { actionButtonClass, cardClass, create, detail, disabledCardClass, money, replaceChildren } from './dom';

const statLabels: Record<StatKey, string> = {
  goals: 'Gole w lidze',
  assists: 'Asysty w lidze',
  minutesPlayed: 'Minuty w lidze',
  yellowCards: 'Żółte kartki',
};

export function renderRooms(container: HTMLElement, rooms: RoomSummary[], join: (roomId: string) => void): void {
  if (!rooms.length) {
    replaceChildren(container, [create('li', 'text-gray-500', 'Brak otwartych pokoi. Stwórz własny!')]);
    return;
  }
  replaceChildren(container, rooms.map((room) => {
    const item = create('li', 'mb-2.5 flex items-center justify-between rounded-lg border border-brand bg-brand/10 p-[15px]');
    const label = create('span', 'text-white');
    label.append(document.createTextNode('Pokój Host: '), create('b', '', room.hostName), document.createTextNode(` (${room.playerCount} graczy)`));
    const button = create('button', `${actionButtonClass} px-[15px] py-[5px] text-sm`, 'Dołącz');
    button.addEventListener('click', () => join(room.id));
    item.append(label, button);
    return item;
  }));
}

export function renderLobbyPlayers(container: HTMLElement, players: GamePlayer[]): void {
  replaceChildren(container, players.map((player) =>
    create('li', 'my-[5px] rounded-lg border-l-3 border-brand bg-black/30 p-2.5 font-medium', player.username),
  ));
}

export function renderDraftPool(
  container: HTMLElement,
  pool: DraftCard[],
  budget: number,
  isMyTurn: boolean,
  pick: (sessionPickId: string, canAfford: boolean) => void,
): void {
  replaceChildren(container, pool.map((card) => {
    const canAfford = budget >= card.historicalValue;
    const node = create('article', `${cardClass} ${isMyTurn && canAfford ? '' : disabledCardClass}`);
    node.append(create('h3', 'mb-[15px] text-[1.2em] font-bold text-brand', 'Tajemnicza Karta'));
    node.append(detail('Wiek', String(card.displayStats.age)), detail('Liga', card.displayStats.league));
    for (const [key, value] of Object.entries(card.displayStats.activeStats)) {
      node.append(detail(statLabels[key as StatKey] ?? key, String(value)));
    }
    const price = create('p', 'mt-[15px] border-t border-[#444] pt-[15px] text-[1.1em] text-[#ccc]');
    price.append(document.createTextNode('Cena rynkowa:'), create('br'), create('b', 'text-[1.2em] text-accent', money(card.historicalValue)));
    node.append(price);
    node.addEventListener('click', () => pick(card.sessionPickId, canAfford));
    return node;
  }));
}

export function renderHiddenTeam(container: HTMLElement, team: PlayerCard[]): void {
  replaceChildren(container, team.map((card, index) => {
    const node = create('div', 'w-[150px] rounded-[10px] border border-dashed border-[#555] bg-black/50 p-[15px] text-center');
    node.append(create('span', 'text-[2em]', '❓'));
    const summary = create('p', 'mt-[5px] text-[#888]');
    summary.append(document.createTextNode(`Zakup #${index + 1}`), create('br'), document.createTextNode(money(card.historicalValue)));
    node.append(summary);
    return node;
  }));
}

export function renderTransferTeam(container: HTMLElement, team: PlayerCard[], sell: (playerId: string) => void): void {
  replaceChildren(container, team.map((card) => {
    const value = card.transferWindowValues['2025/26'] ?? card.transferWindowValues['2025/2026'] ?? (card.currentValue > 0 ? card.currentValue : card.historicalValue);
    const purchasePrice = card.purchasePrice ?? card.historicalValue;
    const profit = value - purchasePrice;
    const node = create('article', cardClass);
    node.append(create('h3', 'mb-[15px] text-[1.2em] font-bold text-accent', card.realName));
    node.append(detail('Liga', card.stats.league), detail('Kupiony w', card.boughtInSeason ?? '—'), detail('Kupiony za', money(purchasePrice)));
    const valuation = create('p', 'mt-[15px] border-t border-[#444] pt-[15px] text-[#ccc]');
    valuation.append(document.createTextNode('Wycena (2025/2026):'), create('br'), create('b', `text-[1.3em] ${profit >= 0 ? 'text-brand' : 'text-[#ff3333]'}`, money(value)));
    const button = create('button', 'mt-[15px] w-full cursor-pointer rounded-[25px] bg-[linear-gradient(90deg,#ff416c_0%,#ff4b2b_100%)] px-[30px] py-3 text-base font-bold text-white uppercase shadow-[0_4px_15px_rgba(255,65,108,0.3)] transition-all duration-300 hover:scale-105 hover:shadow-[0_6px_20px_rgba(255,65,108,0.5)]', 'Sprzedaj Kartę');
    button.addEventListener('click', (event) => { event.stopPropagation(); sell(card.id); });
    node.append(valuation, button);
    return node;
  }));
}

export function renderReplacementPool(container: HTMLElement, pool: PlayerCard[], budget: number, pick: (id: string) => void): void {
  replaceChildren(container, pool.map((card) => {
    const price = card.transferWindowValues['2025/26'] ?? card.transferWindowValues['2025/2026'] ?? card.historicalValue;
    const canAfford = budget >= price;
    const node = create('article', `${cardClass} ${canAfford ? '' : disabledCardClass}`);
    node.append(create('h3', 'mb-[15px] text-[1.1em] font-bold text-accent', card.realName));
    node.append(detail('Liga', card.stats.league), detail('Wiek', String(card.stats.age)), detail('Cena', money(price)));
    node.addEventListener('click', () => canAfford ? pick(card.sessionPickId!) : window.alert('Nie stać Cię!'));
    return node;
  }));
}

export function renderCaptainTeam(container: HTMLElement, team: PlayerCard[], select: (id: string) => void): void {
  replaceChildren(container, team.map((card) => {
    const node = create('article', `${cardClass} text-center before:bg-accent hover:-translate-y-2.5 hover:scale-100 hover:border-accent hover:shadow-[0_12px_20px_rgba(255,215,0,0.3)]`);
    node.append(create('h3', 'mb-[15px] text-[1.4em] font-bold text-white', card.realName));
    node.append(detail('Liga dzisiaj', card.stats.league));
    const valuation = create('p', 'my-[5px] text-[0.9em] text-[#ccc]');
    valuation.append(document.createTextNode('Dzisiejsza (ostateczna) wycena:'), create('br'), create('b', 'text-[1.2em] text-brand', money(card.currentValue)));
    node.append(valuation);
    node.addEventListener('click', () => select(card.id));
    return node;
  }));
}

export function renderResults(container: HTMLElement, players: GamePlayer[]): void {
  const winner = players[0];
  if (!winner) return;
  const heading = create('h1', 'text-[3em] font-black text-accent');
  heading.append(document.createTextNode('🏆 Zwycięzca: '), create('span', 'text-brand', winner.username), document.createTextNode(' 🏆'));
  const wrapper = create('div', 'overflow-x-auto');
  const table = create('table', 'mx-auto my-[30px] w-full max-w-[900px] overflow-hidden rounded-[15px] border-separate border-spacing-0 shadow-[0_8px_30px_rgba(0,0,0,0.5)]');
  const header = create('tr');
  ['Miejsce', 'Menedżer', 'Wartość Składu', 'Kapitan (Bonus)', 'Synergia Ligi', 'Profit z Okienek', 'Wynik Końcowy'].forEach((label) => header.append(create('th', 'border-b-2 border-brand bg-brand/20 p-[15px] text-center font-bold tracking-[1px] text-brand uppercase', label)));
  table.append(header);
  players.forEach((player, index) => {
    const result = player.breakdown!;
    const row = create('tr', index === 0 ? 'border-l-4 border-accent bg-accent/10' : '');
    const values = [`#${index + 1}`, player.username, money(result.teamValueBase), `+ ${money(result.captainBonus)}`, `+ ${money(result.synergyBonus)}`, `+ ${money(result.totalProfit)}`, money(result.finalScore)];
    values.forEach((value, column) => row.append(create('td', `border-b border-[#333] bg-[#1e1e1ecc] p-[15px] text-center ${column === 6 ? `text-[1.2em] font-black ${index === 0 ? 'text-accent' : 'text-brand'}` : 'text-white'}`, value)));
    table.append(row);
  });
  wrapper.append(table);
  const replay = create('button', `${actionButtonClass} mt-5`, 'Zagraj ponownie');
  replay.addEventListener('click', () => window.location.reload());
  container.replaceChildren(heading, wrapper, replay);
}
