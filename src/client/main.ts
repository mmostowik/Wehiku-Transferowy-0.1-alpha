import { io, type Socket } from 'socket.io-client';
import type { ClientToServerEvents, GameModeKey, GamePlayer, PlayerCard, ServerToClientEvents } from '../shared/contracts';
import { create, element, hide, replaceChildren, show } from './dom';
import { renderCaptainTeam, renderDraftPool, renderHiddenTeam, renderLobbyPlayers, renderReplacementPool, renderResults, renderRooms, renderTransferTeam } from './renderers';

const socket: Socket<ServerToClientEvents, ClientToServerEvents> = io();
const state: { socketId: string; roomId: string; budget: number; team: PlayerCard[]; isMyTurn: boolean } = {
  socketId: '', roomId: '', budget: 0, team: [], isMyTurn: false,
};

const ui = {
  login: element('login'), roomBrowser: element('roomBrowser'), lobby: element('lobby'), game: element('game'),
  tutorial: element('tutorialModal'), replacement: element('replacementModal'), draft: element('draftZone'),
  transfer: element('transferZone'), captain: element('captainZone'), overlay: element('overlay'),
  username: element<HTMLInputElement>('username'), mode: element<HTMLSelectElement>('modeSelect'),
  rooms: element('activeRoomsList'), lobbyPlayers: element('playerList'), hostControls: element('hostControls'),
  waiting: element('waitingText'), budget: element('myBudget'), round: element('roundNumber'), position: element('posName'),
  season: element('currentSeason'), turnText: element('turnText'), draftPool: element('poolZone'), hiddenTeam: element('myHiddenTeam'),
  transferTeam: element('myTransferTeam'), transferSeason: element('transferSeason'), endTransfer: element('endTransferBtn'),
  replacementPool: element('replacementPoolContainer'), captainTeam: element('myCaptainTeam'), overlayMessage: element('overlayMsg'),
};

element('tutorialOpenBtn').addEventListener('click', () => show(ui.tutorial));
element('tutorialCloseBtn').addEventListener('click', () => hide(ui.tutorial));
element('continueBtn').addEventListener('click', showRoomBrowser);
ui.username.addEventListener('keydown', (event) => { if (event.key === 'Enter') showRoomBrowser(); });
element('createRoomBtn').addEventListener('click', () => socket.emit('createRoom', ui.username.value));
element('startGameBtn').addEventListener('click', () => socket.emit('startGame', { roomId: state.roomId, modeKey: ui.mode.value as GameModeKey }));
ui.endTransfer.addEventListener('click', () => socket.emit('endTransferWindow', state.roomId));

socket.on('connect', () => { state.socketId = socket.id ?? ''; });
socket.on('updateRoomList', (rooms) => renderRooms(ui.rooms, rooms, (roomId) => socket.emit('joinRoom', { roomId, username: ui.username.value })));
socket.on('joinSuccess', ({ roomId }) => { state.roomId = roomId; hide(ui.roomBrowser); show(ui.lobby); });
socket.on('updateLobby', ({ players, isHost }) => {
  const me = players.find((player) => player.id === state.socketId);
  if (me) updatePlayer(me);
  renderLobbyPlayers(ui.lobbyPlayers, players);
  if (isHost) { show(ui.hostControls); hide(ui.waiting); } else { hide(ui.hostControls); show(ui.waiting); }
});
socket.on('newTurn', (turn) => {
  hide(ui.lobby, ui.transfer, ui.captain);
  show(ui.game, ui.draft);
  ui.season.textContent = turn.season;
  ui.round.textContent = String(turn.roundNumber);
  ui.position.textContent = turn.positionName;
  state.isMyTurn = turn.turnPlayerId === state.socketId;
  ui.turnText.textContent = state.isMyTurn ? 'TWOJA TURA! Wybieraj kartę' : `Wybiera: ${turn.turnPlayerName}...`;
  ui.turnText.classList.toggle('text-brand', state.isMyTurn);
  ui.turnText.classList.toggle('text-accent', !state.isMyTurn);
  renderDraftPool(ui.draftPool, turn.pool, state.budget, state.isMyTurn, pickPlayer);
  renderHiddenTeam(ui.hiddenTeam, state.team);
});
socket.on('updateMyData', updatePlayer);
socket.on('transferWindowOpen', ({ season, hostId }) => {
  hide(ui.draft, ui.captain);
  show(ui.game, ui.transfer);
  ui.transferSeason.textContent = season;
  renderTransferTeam(ui.transferTeam, state.team, sellPlayer);
  if (hostId === state.socketId) show(ui.endTransfer); else hide(ui.endTransfer);
});
socket.on('showReplacementModal', (pool) => {
  show(ui.replacement);
  renderReplacementPool(ui.replacementPool, pool, state.budget, (sessionPickId) => socket.emit('pickReplacement', { roomId: state.roomId, sessionPickId }));
});
socket.on('closeReplacementDraft', () => hide(ui.replacement));
socket.on('playerSold', ({ msg }) => {
  const icon = create('span', 'text-[1.5em]', '💰');
  ui.overlayMessage.replaceChildren(icon, create('br'), document.createTextNode(msg));
  show(ui.overlay);
  window.setTimeout(() => hide(ui.overlay), 2500);
});
socket.on('startCaptainSelection', ({ players }) => {
  hide(ui.draft, ui.transfer);
  show(ui.game, ui.captain);
  const me = players.find((player) => player.id === state.socketId);
  if (me) renderCaptainTeam(ui.captainTeam, me.team, selectCaptain);
});
socket.on('gameOver', ({ players }) => renderResults(ui.game, players));
socket.on('errorMsg', (message) => window.alert(message));

function showRoomBrowser(): void {
  if (!ui.username.value.trim()) { window.alert('Podaj nick!'); return; }
  hide(ui.login);
  show(ui.roomBrowser);
}

function updatePlayer(player: GamePlayer): void {
  state.budget = player.budget;
  state.team = player.team;
  ui.budget.textContent = state.budget.toLocaleString('pl-PL');
  renderTransferTeam(ui.transferTeam, state.team, sellPlayer);
  renderHiddenTeam(ui.hiddenTeam, state.team);
}

function pickPlayer(sessionPickId: string, canAfford: boolean): void {
  if (!state.isMyTurn) return;
  if (!canAfford) { window.alert('Nie stać Cię na tego zawodnika!'); return; }
  socket.emit('pickPlayer', { roomId: state.roomId, sessionPickId });
}

function sellPlayer(playerId: string): void {
  if (window.confirm('Na pewno chcesz sprzedać tego zawodnika za jego wycenę z 2025/2026? Otrzymasz budżet i wybierzesz zastępcę!')) {
    socket.emit('sellPlayer', { roomId: state.roomId, playerId });
  }
}

function selectCaptain(cardId: string): void {
  if (!window.confirm('Czy ten zawodnik ma zostać Twoim kapitanem? Jego ostateczna cena zostanie podwojona w wynikach!')) return;
  socket.emit('selectCaptain', { roomId: state.roomId, cardId });
  const waiting = create('div', 'mx-auto max-w-[500px] rounded-[20px] border border-white/10 bg-white/5 p-10 shadow-[0_8px_32px_rgba(0,0,0,0.37)] backdrop-blur-[10px]');
  waiting.append(create('h3', 'text-brand', 'Zanotowano!'), create('p', 'text-[#aaa]', 'Oczekiwanie na wybór pozostałych graczy...'));
  replaceChildren(ui.captainTeam, [waiting]);
}
