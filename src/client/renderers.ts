import type { LobbyPlayer, MysteryCard, OwnedCardView, PlayerView, RoomSummary, StatKey } from '../shared/contracts';
import { actionButtonClass, cardClass, create, detail, disabledCardClass, money, replaceChildren } from './dom';

const statLabels: Record<StatKey, string> = {
  goals: 'Gole w lidze', assists: 'Asysty w lidze', minutesPlayed: 'Minuty w lidze', yellowCards: 'Żółte kartki',
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

export function renderLobbyPlayers(container: HTMLElement, players: LobbyPlayer[]): void {
  replaceChildren(container, players.map((player) =>
    create('li', `my-[5px] rounded-lg border-l-3 border-brand bg-black/30 p-2.5 font-medium ${player.connected ? '' : 'opacity-50'}`, `${player.username}${player.connected ? '' : ' — rozłączony'}`),
  ));
}

export function renderDraftPool(container: HTMLElement, pool: MysteryCard[], budget: number, isMyTurn: boolean, pick: (sessionPickId: string, canAfford: boolean) => void): void {
  replaceChildren(container, pool.map((card) => {
    const canAfford = budget >= card.price;
    const node = create('article', `${cardClass} ${isMyTurn && canAfford ? '' : disabledCardClass}`);
    node.append(create('h3', 'mb-[15px] text-[1.2em] font-bold text-brand', 'Tajemnicza karta'));
    appendMysteryDetails(node, card);
    const price = create('p', 'mt-[15px] border-t border-[#444] pt-[15px] text-[1.1em] text-[#ccc]');
    price.append(document.createTextNode('Cena rynkowa:'), create('br'), create('b', 'text-[1.2em] text-accent', money(card.price)));
    node.append(price);
    node.addEventListener('click', () => pick(card.sessionPickId, canAfford));
    return node;
  }));
}

export function renderHiddenTeam(container: HTMLElement, team: OwnedCardView[]): void {
  replaceChildren(container, team.map((card, index) => {
    const node = create('div', 'w-[150px] rounded-[10px] border border-dashed border-[#555] bg-black/50 p-[15px] text-center');
    node.append(create('span', 'text-[2em]', '❓'));
    const summary = create('p', 'mt-[5px] text-[#888]');
    summary.append(document.createTextNode(`Zakup #${index + 1}`), create('br'), document.createTextNode(money(card.purchasePrice ?? card.historicalValue)));
    node.append(summary);
    return node;
  }));
}

export function renderTransferTeam(container: HTMLElement, team: OwnedCardView[], sell: (playerId: string) => void): void {
  replaceChildren(container, team.map((card) => {
    if (card.hidden || !card.realName || !card.stats) {
      const hidden = create('article', `${cardClass} ${disabledCardClass}`);
      hidden.append(create('h3', 'mb-[15px] text-[1.2em] font-bold text-brand', 'Tajemniczy zastępca'));
      hidden.append(detail('Kupiony za', money(card.purchasePrice ?? card.historicalValue)), create('p', 'text-[#aaa]', 'Nazwisko zostanie ujawnione po zamknięciu okna.'));
      return hidden;
    }
    const value = card.transferValue ?? card.currentValue ?? card.historicalValue;
    const purchasePrice = card.purchasePrice ?? card.historicalValue;
    const profit = value - purchasePrice;
    const node = create('article', cardClass);
    node.append(create('h3', 'mb-[15px] text-[1.2em] font-bold text-accent', card.realName));
    node.append(detail('Liga', card.stats.league), detail('Kupiony w', card.boughtInSeason ?? '—'), detail('Kupiony za', money(purchasePrice)));
    const valuation = create('p', 'mt-[15px] border-t border-[#444] pt-[15px] text-[#ccc]');
    valuation.append(document.createTextNode('Wycena (2025/2026):'), create('br'), create('b', `text-[1.3em] ${profit >= 0 ? 'text-brand' : 'text-[#ff3333]'}`, money(value)));
    const button = create('button', `mt-[15px] w-full rounded-[25px] bg-[linear-gradient(90deg,#ff416c_0%,#ff4b2b_100%)] px-[30px] py-3 text-base font-bold text-white uppercase ${card.canSell ? 'cursor-pointer transition-all duration-300 hover:scale-105' : disabledCardClass}`, card.canSell ? 'Sprzedaj kartę' : 'Niedostępny');
    if (card.canSell) button.addEventListener('click', (event) => { event.stopPropagation(); sell(card.id); });
    node.append(valuation, button);
    return node;
  }));
}

export function renderReplacementPool(container: HTMLElement, pool: MysteryCard[], budget: number, pick: (id: string) => void): void {
  replaceChildren(container, pool.map((card) => {
    const canAfford = budget >= card.price;
    const node = create('article', `${cardClass} ${canAfford ? '' : disabledCardClass}`);
    node.append(create('h3', 'mb-[15px] text-[1.1em] font-bold text-accent', 'Tajemnicza karta'));
    appendMysteryDetails(node, card);
    node.append(detail('Cena', money(card.price)));
    node.addEventListener('click', () => canAfford ? pick(card.sessionPickId) : window.alert('Nie stać Cię!'));
    return node;
  }));
}

export function renderCaptainTeam(container: HTMLElement, team: OwnedCardView[], select: (id: string) => void): void {
  replaceChildren(container, team.map((card) => {
    if (!card.realName || !card.stats) return create('article', disabledCardClass, 'Brak danych zawodnika');
    const node = create('article', `${cardClass} text-center before:bg-accent hover:-translate-y-2.5 hover:scale-100 hover:border-accent`);
    node.append(create('h3', 'mb-[15px] text-[1.4em] font-bold text-white', card.realName));
    node.append(detail('Liga dzisiaj', card.stats.league));
    const valuation = create('p', 'my-[5px] text-[0.9em] text-[#ccc]');
    valuation.append(document.createTextNode('Dzisiejsza wycena:'), create('br'), create('b', 'text-[1.2em] text-brand', money(card.currentValue ?? 0)));
    node.append(valuation);
    node.addEventListener('click', () => select(card.id));
    return node;
  }));
}

export function renderResults(container: HTMLElement, players: PlayerView[]): void {
  const winner = players[0];
  if (!winner) return;
  const heading = create('h1', 'text-[3em] font-black text-accent');
  heading.append(document.createTextNode('🏆 Zwycięzca: '), create('span', 'text-brand', winner.username), document.createTextNode(' 🏆'));
  const wrapper = create('div', 'overflow-x-auto');
  const table = create('table', 'mx-auto my-[30px] w-full max-w-[900px] overflow-hidden rounded-[15px] border-separate border-spacing-0');
  const header = create('tr');
  ['Miejsce', 'Menedżer', 'Wartość składu', 'Kapitan', 'Synergia', 'Transfery', 'Wynik'].forEach((label) => header.append(create('th', 'border-b-2 border-brand bg-brand/20 p-[15px] text-center font-bold text-brand uppercase', label)));
  table.append(header);
  players.forEach((player, index) => {
    const result = player.breakdown!;
    const row = create('tr', index === 0 ? 'border-l-4 border-accent bg-accent/10' : '');
    [`#${index + 1}`, player.username, money(result.teamValueBase), `+ ${money(result.captainBonus)}`, `+ ${money(result.synergyBonus)}`, `+ ${money(result.totalProfit)}`, money(result.finalScore)].forEach((value, column) => row.append(create('td', `border-b border-[#333] bg-[#1e1e1ecc] p-[15px] text-center ${column === 6 ? 'font-black text-brand' : 'text-white'}`, value)));
    table.append(row);
  });
  wrapper.append(table);
  const replay = create('button', `${actionButtonClass} mt-5`, 'Zagraj ponownie');
  replay.addEventListener('click', () => window.location.reload());
  container.replaceChildren(heading, wrapper, replay);
}

function appendMysteryDetails(node: HTMLElement, card: MysteryCard): void {
  node.append(detail('Wiek', String(card.displayStats.age)), detail('Liga', card.displayStats.league));
  for (const [key, value] of Object.entries(card.displayStats.activeStats)) node.append(detail(statLabels[key as StatKey] ?? key, String(value)));
}
