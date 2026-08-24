import type {
  GameModeKey, GamePlayer, LobbyPlayer, MysteryCard, OwnedCardView, PlayerCard,
  PlayerView, PositionCode, RoomState, RoomSummary, StatKey, TransferStatusPayload,
} from '../../shared/contracts.js';
import { GAME_MODES, POSITION_MAP, TRANSFER_SEASON_DISPLAY } from '../config/game.js';
import { PlayerRepository, transferValue } from '../data/player-repository.js';
import { GameError } from './errors.js';
import { validateNickname } from './nickname.js';
import { calculateScore } from './scoring.js';

export type GameEvent =
  | { target: 'all'; name: 'updateRoomList'; payload: RoomSummary[] }
  | { target: 'room'; roomId: string; name: 'newTurn' | 'transferWindowOpen' | 'transferLog' | 'gamePaused' | 'gameResumed' | 'startCaptainSelection' | 'gameOver'; payload: unknown }
  | { target: 'socket'; socketId: string; name: 'joinSuccess' | 'updateLobby' | 'updateMyData' | 'showReplacementModal' | 'closeReplacementDraft' | 'disconnectDecision' | 'transferLog'; payload?: unknown };

interface StoredCard extends PlayerCard {
  acquiredInTransferRound?: number;
}

interface RoomPlayer extends Omit<GamePlayer, 'team'> {
  team: StoredCard[];
  socketId?: string;
  resumeToken: string;
  connected: boolean;
  disconnectedSocketId?: string;
  reconnectDeadline?: number;
}

interface Room {
  id: string;
  hostPlayerId: string;
  state: RoomState;
  players: RoomPlayer[];
  currentRound: number;
  turnOrder: string[];
  turnCursor: number;
  isReverseTurn: boolean;
  defaultBudget: number;
  modeKey?: GameModeKey;
  totalRounds?: number;
  currentSeason?: string;
  pool: PlayerCard[];
  replacementPools: Map<string, PlayerCard[]>;
  replacementPositions: Map<string, PositionCode>;
  readyPlayerIds: Set<string>;
  captainSelections: Set<string>;
  currentActiveStats: StatKey[];
}

type Random = () => number;

export class GameEngine {
  static readonly reconnectGraceMs = 180_000;
  private readonly rooms = new Map<string, Room>();

  constructor(
    private readonly players: PlayerRepository,
    private readonly random: Random = Math.random,
    private readonly now: () => number = Date.now,
  ) {}

  roomListEvent(): GameEvent {
    return { target: 'all', name: 'updateRoomList', payload: this.listRooms() };
  }

  createRoom(socketId: string, rawNickname: unknown): GameEvent[] {
    this.ensureSocketAvailable(socketId);
    const roomId = this.uniqueRoomId();
    const player = this.newPlayer(socketId, validateNickname(rawNickname), 250_000_000);
    const room: Room = {
      id: roomId,
      hostPlayerId: player.id,
      state: 'lobby',
      players: [player],
      currentRound: 1,
      turnOrder: [],
      turnCursor: 0,
      isReverseTurn: false,
      defaultBudget: 250_000_000,
      pool: [],
      replacementPools: new Map(),
      replacementPositions: new Map(),
      readyPlayerIds: new Set(),
      captainSelections: new Set(),
      currentActiveStats: [],
    };
    this.rooms.set(roomId, room);
    return [this.joinSuccessEvent(room, player, false), ...this.lobbyEvents(room), this.roomListEvent()];
  }

  joinRoom(socketId: string, roomId: string, rawNickname: unknown): GameEvent[] {
    this.ensureSocketAvailable(socketId);
    const room = this.requireRoom(roomId);
    if (room.state !== 'lobby') throw new GameError('Gra już trwa!');
    if (room.players.some((player) => player.socketId === socketId)) throw new GameError('Jesteś już w tym pokoju.');
    const nickname = this.uniqueNickname(room, validateNickname(rawNickname));
    const player = this.newPlayer(socketId, nickname, room.defaultBudget);
    room.players.push(player);
    return [this.joinSuccessEvent(room, player, false), ...this.lobbyEvents(room), this.roomListEvent()];
  }

  resumeGame(socketId: string, roomId: string, resumeToken: string): GameEvent[] {
    const room = this.requireRoom(roomId);
    const player = room.players.find((candidate) => candidate.resumeToken === resumeToken);
    if (!player || player.connected) throw new GameError('Nie można wznowić tej sesji.');
    player.socketId = socketId;
    player.connected = true;
    delete player.disconnectedSocketId;
    delete player.reconnectDeadline;

    const events: GameEvent[] = [
      this.joinSuccessEvent(room, player, true),
      this.playerDataEvent(room, player),
    ];
    if (room.state === 'transfer' && room.replacementPools.has(player.id)) {
      events.push(this.replacementModalEvent(room, player));
    }
    if (this.isPaused(room)) return events;

    events.push({ target: 'room', roomId, name: 'gameResumed', payload: { message: `${player.username} wrócił do gry.` } });
    events.push(...this.stateEvents(room));
    return events;
  }

  startGame(socketId: string, roomId: string, modeKey: GameModeKey): GameEvent[] {
    if (!this.players.hasPlayers) throw new GameError('Błąd: baza danych jest pusta.');
    const room = this.requireRoom(roomId);
    this.requireHost(room, socketId);
    if (room.state !== 'lobby') throw new GameError('Gra już trwa!');
    const mode = GAME_MODES[modeKey] ?? GAME_MODES.medium;
    room.modeKey = modeKey in GAME_MODES ? modeKey : 'medium';
    room.totalRounds = mode.draftOrder.length;
    room.defaultBudget = mode.budget;
    room.players.forEach((player) => {
      player.budget = mode.budget;
      player.totalProfit = 0;
      player.team = [];
    });
    return [
      this.roomListEvent(),
      ...room.players.flatMap((player) => player.socketId ? [this.playerDataEvent(room, player)] : []),
      ...this.startNextRound(room),
    ];
  }

  pickPlayer(socketId: string, roomId: string, sessionPickId: string): GameEvent[] {
    const room = this.requirePlayableState(roomId, 'draft');
    const player = this.requireTurnPlayer(room, socketId);
    const cardIndex = room.pool.findIndex((card) => card.sessionPickId === sessionPickId);
    if (cardIndex < 0) throw new GameError('Ta karta nie jest już dostępna.');
    const card = room.pool[cardIndex]!;
    if (player.budget < card.historicalValue) throw new GameError('Brak budżetu! Możesz pominąć wybór.');

    const position = this.mode(room).draftOrder[room.currentRound - 1]!;
    player.budget -= card.historicalValue;
    player.team.push({ ...card, boughtInSeason: room.currentSeason, assignedPosition: position, purchasePrice: card.historicalValue });
    room.pool.splice(cardIndex, 1);
    room.turnCursor += 1;
    return [this.playerDataEvent(room, player), ...this.advanceDraft(room)];
  }

  skipPick(socketId: string, roomId: string): GameEvent[] {
    const room = this.requirePlayableState(roomId, 'draft');
    const player = this.requireTurnPlayer(room, socketId);
    room.turnCursor += 1;
    return [
      { target: 'room', roomId, name: 'transferLog', payload: { message: `${player.username} pominął wybór w tej rundzie.`, kind: 'system' } },
      ...this.advanceDraft(room),
    ];
  }

  sellPlayer(socketId: string, roomId: string, playerId: string): GameEvent[] {
    const room = this.requirePlayableState(roomId, 'transfer');
    const player = this.requirePlayer(room, socketId);
    if (room.readyPlayerIds.has(player.id)) throw new GameError('Jesteś już gotowy.');
    if (room.replacementPools.has(player.id)) throw new GameError('Najpierw zakończ obecny wybór zastępcy.');
    const cardIndex = player.team.findIndex((card) => card.id === playerId);
    if (cardIndex < 0) throw new GameError('Nie znaleziono zawodnika w Twoim składzie.');
    const card = player.team[cardIndex]!;
    if (card.acquiredInTransferRound === room.currentRound) throw new GameError('Nowego zastępcy nie można sprzedać w tym samym oknie.');

    const newPrice = transferValue(card);
    const profit = newPrice - (card.purchasePrice ?? card.historicalValue);
    player.totalProfit += profit;
    player.budget += newPrice;
    player.team.splice(cardIndex, 1);

    const position = card.assignedPosition ?? 'CM';
    const excluded = new Set(player.team.map((candidate) => candidate.id));
    const pool = this.players.draw(TRANSFER_SEASON_DISPLAY, POSITION_MAP[position], 5, excluded, this.random);
    room.replacementPools.set(player.id, pool);
    room.replacementPositions.set(player.id, position);
    return [
      { target: 'room', roomId, name: 'transferLog', payload: { message: `${player.username} sprzedał ${card.realName} za ${(newPrice / 1_000_000).toFixed(1)} mln € (zysk: ${(profit / 1_000_000).toFixed(1)} mln €).`, kind: 'sale' } },
      this.playerDataEvent(room, player),
      this.replacementModalEvent(room, player),
    ];
  }

  pickReplacement(socketId: string, roomId: string, sessionPickId: string): GameEvent[] {
    const room = this.requirePlayableState(roomId, 'transfer');
    const player = this.requirePlayer(room, socketId);
    const pool = room.replacementPools.get(player.id) ?? [];
    const card = pool.find((candidate) => candidate.sessionPickId === sessionPickId);
    if (!card) throw new GameError('Ta karta zastępcza nie jest już dostępna.');
    const price = transferValue(card);
    if (player.budget < price) throw new GameError('Brak budżetu na tego zawodnika!');
    player.budget -= price;
    player.team.push({
      ...card,
      boughtInSeason: TRANSFER_SEASON_DISPLAY,
      assignedPosition: room.replacementPositions.get(player.id) ?? 'CM',
      purchasePrice: price,
      acquiredInTransferRound: room.currentRound,
    });
    this.clearReplacement(room, player.id);
    return [this.playerDataEvent(room, player), { target: 'socket', socketId, name: 'closeReplacementDraft' }];
  }

  declineReplacement(socketId: string, roomId: string): GameEvent[] {
    const room = this.requirePlayableState(roomId, 'transfer');
    const player = this.requirePlayer(room, socketId);
    if (!room.replacementPools.has(player.id)) throw new GameError('Nie masz otwartego rynku zastępczego.');
    this.clearReplacement(room, player.id);
    return [{ target: 'socket', socketId, name: 'closeReplacementDraft' }];
  }

  setTransferReady(socketId: string, roomId: string): GameEvent[] {
    const room = this.requirePlayableState(roomId, 'transfer');
    const player = this.requirePlayer(room, socketId);
    if (room.replacementPools.has(player.id)) throw new GameError('Najpierw wybierz zastępcę albo z niego zrezygnuj.');
    room.readyPlayerIds.add(player.id);
    const status = this.transferStatusEvent(room);
    const events = [this.playerDataEvent(room, player), status];
    if (!room.players.every((candidate) => room.readyPlayerIds.has(candidate.id))) return events;
    return [...events, ...this.finishTransferWindow(room)];
  }

  selectCaptain(socketId: string, roomId: string, cardId: string): GameEvent[] {
    const room = this.requirePlayableState(roomId, 'captain');
    const player = this.requirePlayer(room, socketId);
    if (room.captainSelections.has(player.id)) throw new GameError('Kapitan został już wybrany.');
    if (!player.team.some((card) => card.id === cardId)) throw new GameError('Kapitan musi należeć do Twojego składu.');
    player.captainId = cardId;
    room.captainSelections.add(player.id);
    return room.players.every((candidate) => room.captainSelections.has(candidate.id)) ? this.finishGame(room) : [];
  }

  disconnect(socketId: string): GameEvent[] {
    const events: GameEvent[] = [];
    for (const [roomId, room] of this.rooms) {
      const player = room.players.find((candidate) => candidate.socketId === socketId);
      if (!player) continue;
      if (room.state === 'lobby' || room.state === 'finished') {
        this.removePlayer(room, player.id);
        if (!room.players.length) this.rooms.delete(roomId);
        else if (room.state === 'lobby') {
          if (room.hostPlayerId === player.id) room.hostPlayerId = room.players[0]!.id;
          events.push(...this.lobbyEvents(room));
        }
        continue;
      }

      player.connected = false;
      player.disconnectedSocketId = socketId;
      player.reconnectDeadline = this.now() + GameEngine.reconnectGraceMs;
      delete player.socketId;
      room.readyPlayerIds.delete(player.id);
      events.push({ target: 'room', roomId, name: 'gamePaused', payload: { playerName: player.username, reconnectDeadline: player.reconnectDeadline } });
    }
    events.push(this.roomListEvent());
    return events;
  }

  expireDisconnect(disconnectedSocketId: string): GameEvent[] {
    for (const room of this.rooms.values()) {
      const player = room.players.find((candidate) => !candidate.connected && candidate.disconnectedSocketId === disconnectedSocketId);
      if (!player) continue;
      return this.disconnectDecisionEvents(room, player);
    }
    return [];
  }

  expirePlayerDisconnect(roomId: string, playerId: string): GameEvent[] {
    const room = this.rooms.get(roomId);
    const player = room?.players.find((candidate) => candidate.id === playerId && !candidate.connected);
    return room && player ? this.disconnectDecisionEvents(room, player) : [];
  }

  resolveDisconnect(socketId: string, roomId: string, playerId: string, action: 'remove' | 'wait'): GameEvent[] {
    const room = this.requireRoom(roomId);
    this.requireHost(room, socketId);
    const player = room.players.find((candidate) => candidate.id === playerId && !candidate.connected);
    if (!player) throw new GameError('Ten gracz wrócił już do gry albo został usunięty.');
    if (action === 'wait') {
      player.reconnectDeadline = this.now() + GameEngine.reconnectGraceMs;
      return [{ target: 'room', roomId, name: 'gamePaused', payload: { playerName: player.username, reconnectDeadline: player.reconnectDeadline } }];
    }

    this.removePlayer(room, playerId);
    if (!room.players.length) {
      this.rooms.delete(roomId);
      return [this.roomListEvent()];
    }
    const events: GameEvent[] = [{ target: 'room', roomId, name: 'transferLog', payload: { message: `${player.username} został usunięty z gry.`, kind: 'system' } }];
    if (this.isPaused(room)) {
      const nextExpired = room.players.find((candidate) => !candidate.connected && (candidate.reconnectDeadline ?? 0) <= this.now());
      const host = this.host(room);
      if (nextExpired && host?.socketId) {
        events.push({ target: 'socket', socketId: host.socketId, name: 'disconnectDecision', payload: { playerId: nextExpired.id, playerName: nextExpired.username, waiting: false } });
      }
    } else {
      events.push({ target: 'room', roomId, name: 'gameResumed', payload: { message: 'Gra została wznowiona.' } });
      if (room.state === 'transfer' && room.players.every((candidate) => room.readyPlayerIds.has(candidate.id))) events.push(...this.finishTransferWindow(room));
      else if (room.state === 'captain' && room.players.every((candidate) => room.captainSelections.has(candidate.id))) events.push(...this.finishGame(room));
      else events.push(...this.stateEvents(room));
    }
    events.push(this.roomListEvent());
    return events;
  }

  private advanceDraft(room: Room): GameEvent[] {
    this.advancePastMissingPlayers(room);
    if (room.turnCursor < room.turnOrder.length) return [this.turnEvent(room)];
    room.currentRound += 1;
    room.isReverseTurn = !room.isReverseTurn;
    if (this.mode(room).transferWindowsAfterRound.includes(room.currentRound - 1)) return this.startTransferWindow(room);
    if (room.currentRound > room.totalRounds!) return this.startCaptainSelection(room);
    return this.startNextRound(room);
  }

  private startNextRound(room: Room): GameEvent[] {
    const season = this.players.randomSeason(this.random);
    const position = this.mode(room).draftOrder[room.currentRound - 1]!;
    const count = room.players.length >= 4 ? 7 : 5;
    const pool = this.players.draw(season, POSITION_MAP[position], count, new Set(), this.random);
    if (!pool.length) throw new GameError(`Brak dostępnych zawodników dla pozycji ${position}.`);
    const defensive = ['GK', 'CB', 'FB'].includes(position);
    const stats: StatKey[] = defensive ? ['minutesPlayed', 'yellowCards'] : ['goals', 'assists', 'minutesPlayed', 'yellowCards'];
    stats.sort(() => this.random() - 0.5);

    room.state = 'draft';
    room.currentSeason = season;
    room.pool = pool;
    room.currentActiveStats = stats.slice(0, 3);
    room.turnOrder = room.players.map((player) => player.id);
    if (room.isReverseTurn) room.turnOrder.reverse();
    room.turnCursor = 0;
    return [this.turnEvent(room)];
  }

  private startTransferWindow(room: Room): GameEvent[] {
    room.state = 'transfer';
    room.currentSeason = TRANSFER_SEASON_DISPLAY;
    room.readyPlayerIds.clear();
    room.replacementPools.clear();
    room.replacementPositions.clear();
    return [...room.players.flatMap((player) => player.socketId ? [this.playerDataEvent(room, player)] : []), this.transferStatusEvent(room)];
  }

  private finishTransferWindow(room: Room): GameEvent[] {
    const events: GameEvent[] = [];
    for (const player of room.players) {
      const revealed = player.team.filter((card) => card.acquiredInTransferRound === room.currentRound);
      if (player.socketId && revealed.length) {
        events.push({ target: 'socket', socketId: player.socketId, name: 'transferLog', payload: { message: `Twój zastępca: ${revealed.map((card) => card.realName).join(', ')}.`, kind: 'reveal' } });
      }
      revealed.forEach((card) => { delete card.acquiredInTransferRound; });
    }
    room.readyPlayerIds.clear();
    return room.currentRound > room.totalRounds! ? [...events, ...this.startCaptainSelection(room)] : [...events, ...this.startNextRound(room)];
  }

  private startCaptainSelection(room: Room): GameEvent[] {
    room.state = 'captain';
    room.captainSelections.clear();
    room.players.forEach((player) => {
      delete player.captainId;
      if (!player.team.length) room.captainSelections.add(player.id);
    });
    const event: GameEvent = { target: 'room', roomId: room.id, name: 'startCaptainSelection', payload: { players: room.players.map((player) => this.playerView(room, player, true)) } };
    return room.players.every((player) => room.captainSelections.has(player.id)) ? [event, ...this.finishGame(room)] : [event];
  }

  private finishGame(room: Room): GameEvent[] {
    room.state = 'finished';
    room.players.forEach((player) => { player.breakdown = calculateScore(player); });
    room.players.sort((left, right) => right.breakdown!.finalScore - left.breakdown!.finalScore);
    return [{ target: 'room', roomId: room.id, name: 'gameOver', payload: { players: room.players.map((player) => this.playerView(room, player, true)) } }];
  }

  private stateEvents(room: Room): GameEvent[] {
    if (room.state === 'lobby') return this.lobbyEvents(room);
    if (room.state === 'draft') return [this.turnEvent(room)];
    if (room.state === 'transfer') return [...room.players.flatMap((player) => player.socketId ? [this.playerDataEvent(room, player)] : []), this.transferStatusEvent(room)];
    if (room.state === 'captain') return [{ target: 'room', roomId: room.id, name: 'startCaptainSelection', payload: { players: room.players.map((player) => this.playerView(room, player, true)) } }];
    return [];
  }

  private disconnectDecisionEvents(room: Room, player: RoomPlayer): GameEvent[] {
    const events: GameEvent[] = [];
    if (room.hostPlayerId === player.id) {
      const replacementHost = room.players.find((candidate) => candidate.connected);
      if (replacementHost) {
        room.hostPlayerId = replacementHost.id;
        events.push({ target: 'room', roomId: room.id, name: 'transferLog', payload: { message: `${replacementHost.username} został nowym hostem.`, kind: 'system' } });
        if (room.state === 'transfer') events.push(this.transferStatusEvent(room));
      }
    }
    const host = this.host(room);
    if (host?.socketId) events.push({ target: 'socket', socketId: host.socketId, name: 'disconnectDecision', payload: { playerId: player.id, playerName: player.username, waiting: false } });
    return events;
  }

  private turnEvent(room: Room): GameEvent {
    const player = this.turnPlayer(room);
    const position = this.mode(room).draftOrder[room.currentRound - 1]!;
    const pool = room.pool.map((card) => this.mysteryCard(card, card.historicalValue, room.currentActiveStats));
    return {
      target: 'room', roomId: room.id, name: 'newTurn', payload: {
        roundNumber: room.currentRound,
        positionName: position,
        season: room.currentSeason!,
        turnPlayerId: player.id,
        turnPlayerName: player.username,
        pool,
        activeStatsKeys: room.currentActiveStats,
      },
    };
  }

  private transferStatusEvent(room: Room): GameEvent {
    const payload: TransferStatusPayload = {
      season: TRANSFER_SEASON_DISPLAY,
      hostPlayerId: room.hostPlayerId,
      readyPlayerIds: [...room.readyPlayerIds],
      totalPlayers: room.players.length,
    };
    return { target: 'room', roomId: room.id, name: 'transferWindowOpen', payload };
  }

  private replacementModalEvent(room: Room, player: RoomPlayer): GameEvent {
    const position = room.replacementPositions.get(player.id) ?? 'CM';
    const defensive = ['GK', 'CB', 'FB'].includes(position);
    const stats: StatKey[] = defensive ? ['minutesPlayed', 'yellowCards'] : ['goals', 'assists', 'minutesPlayed'];
    const pool = (room.replacementPools.get(player.id) ?? []).map((card) => this.mysteryCard(card, transferValue(card), stats));
    return { target: 'socket', socketId: player.socketId!, name: 'showReplacementModal', payload: pool };
  }

  private mysteryCard(card: PlayerCard, price: number, stats: StatKey[]): MysteryCard {
    return {
      sessionPickId: card.sessionPickId!,
      displayStats: {
        age: card.stats.age,
        league: card.stats.league,
        activeStats: Object.fromEntries(stats.map((key) => [key, card.stats[key] ?? 0])),
      },
      price,
    };
  }

  private playerDataEvent(room: Room, player: RoomPlayer): GameEvent {
    return { target: 'socket', socketId: player.socketId!, name: 'updateMyData', payload: this.playerView(room, player) };
  }

  private playerView(room: Room, player: RoomPlayer, forceReveal = false): PlayerView {
    return {
      id: player.id,
      username: player.username,
      budget: player.budget,
      totalProfit: player.totalProfit,
      captainId: player.captainId,
      breakdown: player.breakdown,
      connected: player.connected,
      team: player.team.map((card): OwnedCardView => {
        const visible = forceReveal || room.state === 'captain' || room.state === 'finished'
          || (room.state === 'transfer' && card.acquiredInTransferRound !== room.currentRound);
        const base: OwnedCardView = {
          id: card.id,
          hidden: !visible,
          historicalValue: card.historicalValue,
          purchasePrice: card.purchasePrice,
          boughtInSeason: card.boughtInSeason,
          assignedPosition: card.assignedPosition,
        };
        if (!visible) return base;
        return {
          ...base,
          realName: card.realName,
          stats: card.stats,
          currentValue: card.currentValue,
          transferValue: transferValue(card),
          canSell: room.state === 'transfer' && card.acquiredInTransferRound !== room.currentRound && !room.readyPlayerIds.has(player.id),
        };
      }),
    };
  }

  private lobbyEvents(room: Room): GameEvent[] {
    const players: LobbyPlayer[] = room.players.map(({ id, username, connected }) => ({ id, username, connected }));
    return room.players.flatMap((player) => player.socketId ? [{
      target: 'socket' as const,
      socketId: player.socketId,
      name: 'updateLobby' as const,
      payload: { players, isHost: player.id === room.hostPlayerId },
    }] : []);
  }

  private joinSuccessEvent(room: Room, player: RoomPlayer, resumed: boolean): GameEvent {
    return { target: 'socket', socketId: player.socketId!, name: 'joinSuccess', payload: { roomId: room.id, playerId: player.id, resumeToken: player.resumeToken, resumed } };
  }

  private listRooms(): RoomSummary[] {
    return [...this.rooms.values()]
      .filter((room) => room.state === 'lobby')
      .flatMap((room) => {
        const host = this.host(room);
        return host ? [{ id: room.id, hostName: host.username, playerCount: room.players.length }] : [];
      });
  }

  private requirePlayableState(roomId: string, state: RoomState): Room {
    const room = this.requireState(roomId, state);
    if (this.isPaused(room)) throw new GameError('Gra jest wstrzymana do czasu powrotu rozłączonego gracza.');
    return room;
  }

  private requireTurnPlayer(room: Room, socketId: string): RoomPlayer {
    const player = this.requirePlayer(room, socketId);
    if (this.turnPlayer(room).id !== player.id) throw new GameError('To nie jest Twoja tura.');
    return player;
  }

  private turnPlayer(room: Room): RoomPlayer {
    const playerId = room.turnOrder[room.turnCursor];
    const player = room.players.find((candidate) => candidate.id === playerId);
    if (!player) throw new GameError('Nie można ustalić aktywnego gracza.');
    return player;
  }

  private advancePastMissingPlayers(room: Room): void {
    while (room.turnCursor < room.turnOrder.length && !room.players.some((player) => player.id === room.turnOrder[room.turnCursor])) room.turnCursor += 1;
  }

  private removePlayer(room: Room, playerId: string): void {
    const index = room.players.findIndex((player) => player.id === playerId);
    if (index >= 0) room.players.splice(index, 1);
    room.replacementPools.delete(playerId);
    room.replacementPositions.delete(playerId);
    room.readyPlayerIds.delete(playerId);
    room.captainSelections.delete(playerId);
    this.advancePastMissingPlayers(room);
  }

  private clearReplacement(room: Room, playerId: string): void {
    room.replacementPools.delete(playerId);
    room.replacementPositions.delete(playerId);
  }

  private isPaused(room: Room): boolean {
    return room.players.some((player) => !player.connected);
  }

  private host(room: Room): RoomPlayer | undefined {
    return room.players.find((player) => player.id === room.hostPlayerId);
  }

  private mode(room: Room) {
    if (!room.modeKey) throw new GameError('Tryb gry nie został wybrany.');
    return GAME_MODES[room.modeKey];
  }

  private requireRoom(roomId: string): Room {
    const room = this.rooms.get(roomId);
    if (!room) throw new GameError('Pokój nie istnieje!');
    return room;
  }

  private ensureSocketAvailable(socketId: string): void {
    if ([...this.rooms.values()].some((room) => room.players.some((player) => player.socketId === socketId))) {
      throw new GameError('Jesteś już w innym pokoju.');
    }
  }

  private requireState(roomId: string, state: RoomState): Room {
    const room = this.requireRoom(roomId);
    if (room.state !== state) throw new GameError('Ta akcja nie jest teraz dostępna.');
    return room;
  }

  private requirePlayer(room: Room, socketId: string): RoomPlayer {
    const player = room.players.find((candidate) => candidate.socketId === socketId && candidate.connected);
    if (!player) throw new GameError('Nie należysz do tego pokoju.');
    return player;
  }

  private requireHost(room: Room, socketId: string): void {
    if (this.requirePlayer(room, socketId).id !== room.hostPlayerId) throw new GameError('Tylko host może wykonać tę akcję.');
  }

  private newPlayer(socketId: string, username: string, budget: number): RoomPlayer {
    return { id: crypto.randomUUID(), socketId, resumeToken: crypto.randomUUID(), connected: true, username, budget, team: [], totalProfit: 0 };
  }

  private uniqueNickname(room: Room, requested: string): string {
    const used = new Set(room.players.map((player) => player.username.toLocaleLowerCase('pl-PL')));
    if (!used.has(requested.toLocaleLowerCase('pl-PL'))) return requested;
    for (let suffix = 2; suffix < 100; suffix += 1) {
      const candidate = `${requested} (${suffix})`;
      if (!used.has(candidate.toLocaleLowerCase('pl-PL'))) return candidate;
    }
    throw new GameError('Nie udało się utworzyć unikalnego nicku.');
  }

  private uniqueRoomId(): string {
    for (let attempt = 0; attempt < 100; attempt += 1) {
      const id = Math.floor(1000 + this.random() * 9000).toString();
      if (!this.rooms.has(id)) return id;
    }
    throw new GameError('Nie udało się utworzyć pokoju. Spróbuj ponownie.');
  }
}
