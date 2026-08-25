import { io, type Socket } from 'socket.io-client';
import type { ClientToServerEvents, GameModeKey, OwnedCardView, PlayerView, ServerToClientEvents } from '../shared/contracts';
import { create, element, hide, replaceChildren, show } from './dom';
import { renderCaptainTeam, renderDraftPool, renderHiddenTeam, renderLobbyPlayers, renderReplacementPool, renderResults, renderRooms, renderTransferTeam } from './renderers';

const socket: Socket<ServerToClientEvents, ClientToServerEvents> = io();
const state: { playerId: string; roomId: string; budget: number; team: OwnedCardView[]; isMyTurn: boolean; ready: boolean; disconnectedPlayerId: string } = {
  playerId: '', roomId: '', budget: 0, team: [], isMyTurn: false, ready: false, disconnectedPlayerId: '',
};

const ui = {
  login: element('login'), roomBrowser: element('roomBrowser'), lobby: element('lobby'), game: element('game'),
  tutorial: element('tutorialModal'), replacement: element('replacementModal'), draft: element('draftZone'),
  transfer: element('transferZone'), captain: element('captainZone'),
  username: element<HTMLInputElement>('username'), mode: element<HTMLSelectElement>('modeSelect'),
  rooms: element('activeRoomsList'), lobbyPlayers: element('playerList'), hostControls: element('hostControls'),
  waiting: element('waitingText'), budget: element('myBudget'), round: element('roundNumber'), position: element('posName'),
  season: element('currentSeason'), turnText: element('turnText'), draftPool: element('poolZone'), hiddenTeam: element('myHiddenTeam'),
  transferTeam: element('myTransferTeam'), transferSeason: element('transferSeason'), transferReady: element<HTMLButtonElement>('transferReadyBtn'),
  transferReadyStatus: element('transferReadyStatus'), replacementPool: element('replacementPoolContainer'),
  replacementSeason: element('replacementSeason'),
  declineReplacement: element('declineReplacementBtn'), skipPick: element<HTMLButtonElement>('skipPickBtn'),
  captainTeam: element('myCaptainTeam'), transferLog: element('transferLog'), pauseBanner: element('pauseBanner'),
  disconnectDecision: element('disconnectDecision'), disconnectDecisionText: element('disconnectDecisionText'),
  disconnectWait: element<HTMLButtonElement>('disconnectWaitBtn'), disconnectRemove: element<HTMLButtonElement>('disconnectRemoveBtn'),
};

element('tutorialOpenBtn').addEventListener('click', () => show(ui.tutorial));
element('tutorialCloseBtn').addEventListener('click', () => hide(ui.tutorial));
element('continueBtn').addEventListener('click', showRoomBrowser);
ui.username.addEventListener('keydown', (event) => { if (event.key === 'Enter') showRoomBrowser(); });
element('createRoomBtn').addEventListener('click', () => socket.emit('createRoom', ui.username.value));
element('startGameBtn').addEventListener('click', () => socket.emit('startGame', { roomId: state.roomId, modeKey: ui.mode.value as GameModeKey }));
ui.skipPick.addEventListener('click', () => socket.emit('skipPick', state.roomId));
ui.declineReplacement.addEventListener('click', () => socket.emit('declineReplacement', state.roomId));
ui.transferReady.addEventListener('click', () => socket.emit('setTransferReady', state.roomId));
ui.disconnectWait.addEventListener('click', () => resolveDisconnect('wait'));
ui.disconnectRemove.addEventListener('click', () => resolveDisconnect('remove'));

socket.on('connect', () => {
  const saved = loadSession();
  if (saved) socket.emit('resumeGame', saved);
});
socket.on('updateRoomList', (rooms) => renderRooms(ui.rooms, rooms, (roomId) => socket.emit('joinRoom', { roomId, username: ui.username.value })));
socket.on('joinSuccess', ({ roomId, playerId, resumeToken, resumed }) => {
  state.roomId = roomId;
  state.playerId = playerId;
  localStorage.setItem('wehikul-session', JSON.stringify({ roomId, resumeToken }));
  hide(ui.login, ui.roomBrowser);
  if (!resumed) show(ui.lobby);
});
socket.on('updateLobby', ({ players, isHost }) => {
  renderLobbyPlayers(ui.lobbyPlayers, players);
  show(ui.lobby);
  hide(ui.game);
  if (isHost) { show(ui.hostControls); hide(ui.waiting); } else { hide(ui.hostControls); show(ui.waiting); }
});
socket.on('newTurn', (turn) => {
  hide(ui.lobby, ui.transfer, ui.captain, ui.replacement);
  show(ui.game, ui.draft);
  ui.season.textContent = turn.season;
  ui.round.textContent = String(turn.roundNumber);
  ui.position.textContent = turn.positionName;
  state.isMyTurn = turn.turnPlayerId === state.playerId;
  ui.turnText.textContent = state.isMyTurn ? 'TWOJA TURA! Wybieraj kartę albo pomiń' : `Wybiera: ${turn.turnPlayerName}...`;
  ui.turnText.classList.toggle('text-brand', state.isMyTurn);
  ui.turnText.classList.toggle('text-accent', !state.isMyTurn);
  if (state.isMyTurn) show(ui.skipPick); else hide(ui.skipPick);
  renderDraftPool(ui.draftPool, turn.pool, state.budget, state.isMyTurn, pickPlayer);
  renderHiddenTeam(ui.hiddenTeam, state.team);
});
socket.on('updateMyData', updatePlayer);
socket.on('transferWindowOpen', ({ season, readyPlayerIds, totalPlayers }) => {
  hide(ui.draft, ui.captain, ui.replacement);
  show(ui.game, ui.transfer);
  ui.transferSeason.textContent = season;
  state.ready = readyPlayerIds.includes(state.playerId);
  ui.transferReadyStatus.textContent = `Gotowi: ${readyPlayerIds.length}/${totalPlayers}`;
  ui.transferReady.disabled = state.ready;
  ui.transferReady.textContent = state.ready ? 'Głos oddany — czekamy na pozostałych' : 'Gotowy — głosuj za zamknięciem okna';
  ui.transferReady.classList.toggle('opacity-50', state.ready);
  renderTransferTeam(ui.transferTeam, state.team, sellPlayer);
});
socket.on('showReplacementModal', ({ season, pool }) => {
  ui.replacementSeason.textContent = season;
  show(ui.replacement);
  renderReplacementPool(ui.replacementPool, pool, state.budget, (sessionPickId) => socket.emit('pickReplacement', { roomId: state.roomId, sessionPickId }));
});
socket.on('closeReplacementDraft', () => hide(ui.replacement));
socket.on('transferLog', ({ message, kind }) => appendTransferLog(message, kind));
socket.on('gamePaused', ({ playerName, reconnectDeadline }) => {
  ui.pauseBanner.textContent = reconnectDeadline > 0
    ? `Gra wstrzymana: ${playerName} utracił połączenie. Ma 3 minuty na powrót.`
    : `Gra nadal wstrzymana — host zdecydował poczekać na gracza ${playerName}.`;
  show(ui.pauseBanner);
});
socket.on('gameResumed', ({ message }) => {
  hide(ui.pauseBanner, ui.disconnectDecision);
  appendTransferLog(message, 'system');
});
socket.on('disconnectDecision', ({ playerId, playerName, waiting }) => {
  state.disconnectedPlayerId = playerId;
  ui.disconnectDecisionText.textContent = waiting
    ? `${playerName} nadal nie wrócił. Możesz usunąć go z gry albo zamknąć to okno i nadal czekać.`
    : `${playerName} nie wrócił przez 3 minuty. Usunąć gracza czy nadal czekać?`;
  ui.disconnectWait.textContent = waiting ? 'Czekaj dalej' : 'Czekaj';
  show(ui.disconnectDecision);
});
socket.on('startCaptainSelection', ({ players }) => {
  hide(ui.draft, ui.transfer, ui.replacement);
  show(ui.game, ui.captain);
  const me = players.find((player) => player.id === state.playerId);
  if (me) {
    updatePlayer(me);
    if (me.team.length) renderCaptainTeam(ui.captainTeam, me.team, selectCaptain);
    else replaceChildren(ui.captainTeam, [create('p', 'text-[#aaa]', 'Nie masz zawodników, więc etap kapitana został pominięty automatycznie.')]);
  }
});
socket.on('gameOver', ({ players }) => {
  localStorage.removeItem('wehikul-session');
  hide(ui.replacement, ui.pauseBanner, ui.disconnectDecision);
  renderResults(ui.game, players);
});
socket.on('errorMsg', (message) => {
  if (message === 'Nie można wznowić tej sesji.') localStorage.removeItem('wehikul-session');
  else window.alert(message);
});

function showRoomBrowser(): void {
  if (!ui.username.value.trim()) { window.alert('Podaj nick!'); return; }
  hide(ui.login);
  show(ui.roomBrowser);
}

function updatePlayer(player: PlayerView): void {
  state.playerId = player.id;
  state.budget = player.budget;
  state.team = player.team;
  ui.budget.textContent = state.budget.toLocaleString('pl-PL');
  renderTransferTeam(ui.transferTeam, state.team, sellPlayer);
  renderHiddenTeam(ui.hiddenTeam, state.team);
}

function pickPlayer(sessionPickId: string, canAfford: boolean): void {
  if (!state.isMyTurn) return;
  if (!canAfford) { window.alert('Nie stać Cię na tego zawodnika. Możesz pominąć wybór.'); return; }
  socket.emit('pickPlayer', { roomId: state.roomId, sessionPickId });
}

function sellPlayer(playerId: string): void {
  const warning = state.budget < 15_000_000 ? '\n\nUwaga: masz mniej niż 15 mln € i po sprzedaży może nie być Cię stać na zmiennika.' : '';
  if (window.confirm(`Na pewno chcesz sprzedać tego zawodnika? Możesz zakończyć okno bez zastępcy.${warning}`)) {
    socket.emit('sellPlayer', { roomId: state.roomId, playerId });
  }
}

function selectCaptain(cardId: string): void {
  if (!window.confirm('Czy ten zawodnik ma zostać Twoim kapitanem?')) return;
  socket.emit('selectCaptain', { roomId: state.roomId, cardId });
  replaceChildren(ui.captainTeam, [create('p', 'text-[#aaa]', 'Oczekiwanie na wybór pozostałych graczy...')]);
}

function resolveDisconnect(action: 'remove' | 'wait'): void {
  socket.emit('resolveDisconnect', { roomId: state.roomId, playerId: state.disconnectedPlayerId, action });
  if (action === 'wait') hide(ui.disconnectDecision);
}

function appendTransferLog(message: string, kind: 'sale' | 'reveal' | 'system'): void {
  const colors = { sale: 'border-brand', reveal: 'border-accent', system: 'border-[#777]' };
  const entry = create('div', `rounded-[10px] border-l-4 ${colors[kind]} bg-[#222]/95 p-3 text-sm text-white shadow-lg`, message);
  ui.transferLog.prepend(entry);
  while (ui.transferLog.childElementCount > 8) ui.transferLog.lastElementChild?.remove();
}

function loadSession(): { roomId: string; resumeToken: string } | undefined {
  try {
    const parsed = JSON.parse(localStorage.getItem('wehikul-session') ?? 'null') as unknown;
    if (!parsed || typeof parsed !== 'object' || !('roomId' in parsed) || !('resumeToken' in parsed)) return undefined;
    return { roomId: String(parsed.roomId), resumeToken: String(parsed.resumeToken) };
  } catch {
    localStorage.removeItem('wehikul-session');
    return undefined;
  }
}
