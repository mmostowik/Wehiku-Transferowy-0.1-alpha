import type {
  DraftCard, GameModeKey, GamePlayer, NewTurnPayload, PlayerCard, PositionCode,
  RoomState, RoomSummary, StatKey,
} from '../../shared/contracts.js';
import { GAME_MODES, POSITION_MAP, TRANSFER_SEASON_DISPLAY } from '../config/game.js';
import { PlayerRepository, transferValue } from '../data/player-repository.js';
import { GameError } from './errors.js';
import { validateNickname } from './nickname.js';
import { calculateScore } from './scoring.js';

export type GameEvent =
  | { target: 'all'; name: 'updateRoomList'; payload: RoomSummary[] }
  | { target: 'room'; roomId: string; name: 'newTurn' | 'transferWindowOpen' | 'playerSold' | 'startCaptainSelection' | 'gameOver'; payload: unknown }
  | { target: 'socket'; socketId: string; name: 'joinSuccess' | 'updateLobby' | 'updateMyData' | 'showReplacementModal' | 'closeReplacementDraft'; payload?: unknown };

interface Room {
  id: string;
  hostId: string;
  state: RoomState;
  players: GamePlayer[];
  currentRound: number;
  turnIndex: number;
  draftedIds: Set<string>;
  isReverseTurn: boolean;
  defaultBudget: number;
  modeKey?: GameModeKey;
  totalRounds?: number;
  currentSeason?: string;
  pool: PlayerCard[];
  replacementPools: Map<string, PlayerCard[]>;
  replacementPositions: Map<string, PositionCode>;
  currentActiveStats: StatKey[];
}

type Random = () => number;

export class GameEngine {
  private readonly rooms = new Map<string, Room>();

  constructor(
    private readonly players: PlayerRepository,
    private readonly random: Random = Math.random,
  ) {}

  roomListEvent(): GameEvent {
    return { target: 'all', name: 'updateRoomList', payload: this.listRooms() };
  }

  createRoom(socketId: string, rawNickname: unknown): GameEvent[] {
    const username = validateNickname(rawNickname);
    const roomId = this.uniqueRoomId();
    const room: Room = {
      id: roomId, hostId: socketId, state: 'lobby', players: [], currentRound: 1,
      turnIndex: 0, draftedIds: new Set(), isReverseTurn: false, defaultBudget: 250_000_000,
      pool: [], replacementPools: new Map(), replacementPositions: new Map(), currentActiveStats: [],
    };
    room.players.push(this.newPlayer(socketId, username, room.defaultBudget));
    this.rooms.set(roomId, room);
    return [
      { target: 'socket', socketId, name: 'joinSuccess', payload: { roomId } },
      ...this.lobbyEvents(room),
      this.roomListEvent(),
    ];
  }

  joinRoom(socketId: string, roomId: string, rawNickname: unknown): GameEvent[] {
    const username = validateNickname(rawNickname);
    const room = this.requireRoom(roomId);
    if (room.state !== 'lobby') throw new GameError('Gra już trwa!');
    if (room.players.some((player) => player.id === socketId)) throw new GameError('Jesteś już w tym pokoju.');
    room.players.push(this.newPlayer(socketId, username, room.defaultBudget));
    return [
      { target: 'socket', socketId, name: 'joinSuccess', payload: { roomId } },
      ...this.lobbyEvents(room),
      this.roomListEvent(),
    ];
  }

  startGame(socketId: string, roomId: string, modeKey: GameModeKey): GameEvent[] {
    if (!this.players.hasPlayers) throw new GameError('Błąd: Baza danych jest pusta.');
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
    });
    return [this.roomListEvent(), ...this.startNextRound(room)];
  }

  pickPlayer(socketId: string, roomId: string, sessionPickId: string): GameEvent[] {
    const room = this.requireState(roomId, 'draft');
    if (this.turnPlayer(room).id !== socketId) throw new GameError('To nie jest Twoja tura.');
    const cardIndex = room.pool.findIndex((card) => card.sessionPickId === sessionPickId);
    if (cardIndex < 0) throw new GameError('Ta karta nie jest już dostępna.');
    const card = room.pool[cardIndex]!;
    const player = this.requirePlayer(room, socketId);
    if (player.budget < card.historicalValue) throw new GameError('Brak budżetu!');

    const position = this.mode(room).draftOrder[room.currentRound - 1]!;
    player.budget -= card.historicalValue;
    player.team.push({ ...card, boughtInSeason: room.currentSeason, assignedPosition: position, purchasePrice: card.historicalValue });
    room.draftedIds.add(card.id);
    room.pool.splice(cardIndex, 1);
    room.turnIndex += 1;

    const events: GameEvent[] = [{ target: 'socket', socketId, name: 'updateMyData', payload: player }];
    if (room.turnIndex < room.players.length) return [...events, this.turnEvent(room)];

    room.turnIndex = 0;
    room.currentRound += 1;
    room.isReverseTurn = !room.isReverseTurn;
    if (this.mode(room).transferWindowsAfterRound.includes(room.currentRound - 1)) return [...events, ...this.startTransferWindow(room)];
    if (room.currentRound > room.totalRounds!) return [...events, ...this.startCaptainSelection(room)];
    return [...events, ...this.startNextRound(room)];
  }

  sellPlayer(socketId: string, roomId: string, playerId: string): GameEvent[] {
    const room = this.requireState(roomId, 'transfer');
    const player = this.requirePlayer(room, socketId);
    const cardIndex = player.team.findIndex((card) => card.id === playerId);
    if (cardIndex < 0) throw new GameError('Nie znaleziono zawodnika w Twoim składzie.');
    const card = player.team[cardIndex]!;
    const newPrice = transferValue(card);
    const profit = newPrice - (card.purchasePrice ?? card.historicalValue);
    player.totalProfit += profit;
    player.budget += newPrice;
    player.team.splice(cardIndex, 1);

    const position = card.assignedPosition ?? 'CM';
    const pool = this.players.draw(TRANSFER_SEASON_DISPLAY, POSITION_MAP[position], 5, room.draftedIds, this.random);
    room.replacementPools.set(socketId, pool);
    room.replacementPositions.set(socketId, position);
    return [
      { target: 'room', roomId, name: 'playerSold', payload: { msg: `🔥 ${player.username} sprzedał ${card.realName} za ${(newPrice / 1_000_000).toFixed(1)}M € (Profit: ${(profit / 1_000_000).toFixed(1)}M €)!` } },
      { target: 'socket', socketId, name: 'updateMyData', payload: player },
      { target: 'socket', socketId, name: 'showReplacementModal', payload: pool },
    ];
  }

  pickReplacement(socketId: string, roomId: string, sessionPickId: string): GameEvent[] {
    const room = this.requireState(roomId, 'transfer');
    const player = this.requirePlayer(room, socketId);
    const pool = room.replacementPools.get(socketId) ?? [];
    const cardIndex = pool.findIndex((card) => card.sessionPickId === sessionPickId);
    if (cardIndex < 0) throw new GameError('Ta karta zastępcza nie jest już dostępna.');
    const card = pool[cardIndex]!;
    const price = transferValue(card);
    if (player.budget < price) throw new GameError('Brak budżetu na tego zawodnika!');
    player.budget -= price;
    player.team.push({
      ...card,
      boughtInSeason: TRANSFER_SEASON_DISPLAY,
      assignedPosition: room.replacementPositions.get(socketId) ?? 'CM',
      purchasePrice: price,
    });
    room.draftedIds.add(card.id);
    room.replacementPools.delete(socketId);
    room.replacementPositions.delete(socketId);
    return [
      { target: 'socket', socketId, name: 'updateMyData', payload: player },
      { target: 'socket', socketId, name: 'closeReplacementDraft' },
    ];
  }

  endTransferWindow(socketId: string, roomId: string): GameEvent[] {
    const room = this.requireState(roomId, 'transfer');
    this.requireHost(room, socketId);
    return room.currentRound > room.totalRounds! ? this.startCaptainSelection(room) : this.startNextRound(room);
  }

  selectCaptain(socketId: string, roomId: string, cardId: string): GameEvent[] {
    const room = this.requireState(roomId, 'captain');
    const player = this.requirePlayer(room, socketId);
    if (player.captainId) throw new GameError('Kapitan został już wybrany.');
    if (!player.team.some((card) => card.id === cardId)) throw new GameError('Kapitan musi należeć do Twojego składu.');
    player.captainId = cardId;
    return room.players.every((candidate) => candidate.captainId) ? this.finishGame(room) : [];
  }

  disconnect(socketId: string): GameEvent[] {
    const events: GameEvent[] = [];
    for (const [roomId, room] of this.rooms) {
      const index = room.players.findIndex((player) => player.id === socketId);
      if (index < 0) continue;
      room.players.splice(index, 1);
      room.replacementPools.delete(socketId);
      room.replacementPositions.delete(socketId);
      if (!room.players.length) {
        this.rooms.delete(roomId);
      } else {
        if (room.hostId === socketId) room.hostId = room.players[0]!.id;
        room.turnIndex = Math.min(room.turnIndex, room.players.length - 1);
        if (room.state === 'lobby') events.push(...this.lobbyEvents(room));
        else if (room.state === 'draft') events.push(this.turnEvent(room));
        else if (room.state === 'captain' && room.players.every((player) => player.captainId)) events.push(...this.finishGame(room));
      }
    }
    events.push(this.roomListEvent());
    return events;
  }

  private listRooms(): RoomSummary[] {
    return [...this.rooms.values()]
      .filter((room) => room.state === 'lobby' && room.players[0])
      .map((room) => ({ id: room.id, hostName: room.players[0]!.username, playerCount: room.players.length }));
  }

  private lobbyEvents(room: Room): GameEvent[] {
    return room.players.map((player) => ({
      target: 'socket' as const,
      socketId: player.id,
      name: 'updateLobby' as const,
      payload: { players: room.players, isHost: player.id === room.hostId },
    }));
  }

  private startNextRound(room: Room): GameEvent[] {
    room.state = 'draft';
    room.currentSeason = this.players.randomSeason(this.random);
    const position = this.mode(room).draftOrder[room.currentRound - 1]!;
    const count = room.players.length >= 4 ? 7 : 5;
    room.pool = this.players.draw(room.currentSeason, POSITION_MAP[position], count, room.draftedIds, this.random);
    if (!room.pool.length) throw new GameError(`Brak dostępnych zawodników dla pozycji ${position}.`);
    const defensive = ['GK', 'CB', 'FB'].includes(position);
    const stats: StatKey[] = defensive
      ? ['minutesPlayed', 'yellowCards']
      : ['goals', 'assists', 'minutesPlayed', 'yellowCards'];
    stats.sort(() => this.random() - 0.5);
    room.currentActiveStats = stats.slice(0, 3);
    return [this.turnEvent(room)];
  }

  private startTransferWindow(room: Room): GameEvent[] {
    room.state = 'transfer';
    room.currentSeason = TRANSFER_SEASON_DISPLAY;
    return [{ target: 'room', roomId: room.id, name: 'transferWindowOpen', payload: { season: TRANSFER_SEASON_DISPLAY, hostId: room.hostId } }];
  }

  private startCaptainSelection(room: Room): GameEvent[] {
    room.state = 'captain';
    room.players.forEach((player) => { delete player.captainId; });
    return [{ target: 'room', roomId: room.id, name: 'startCaptainSelection', payload: { players: room.players } }];
  }

  private finishGame(room: Room): GameEvent[] {
    room.state = 'finished';
    room.players.forEach((player) => { player.breakdown = calculateScore(player); });
    room.players.sort((left, right) => right.breakdown!.finalScore - left.breakdown!.finalScore);
    return [{ target: 'room', roomId: room.id, name: 'gameOver', payload: { players: room.players } }];
  }

  private turnEvent(room: Room): GameEvent {
    const player = this.turnPlayer(room);
    const position = this.mode(room).draftOrder[room.currentRound - 1]!;
    const pool: DraftCard[] = room.pool.map((card) => ({
      sessionPickId: card.sessionPickId!,
      displayStats: {
        age: card.stats.age,
        league: card.stats.league,
        activeStats: Object.fromEntries(room.currentActiveStats.map((key) => [key, card.stats[key] ?? 0])),
      },
      historicalValue: card.historicalValue,
    }));
    const payload: NewTurnPayload = {
      roundNumber: room.currentRound,
      positionName: position,
      season: room.currentSeason!,
      turnPlayerId: player.id,
      turnPlayerName: player.username,
      pool,
      activeStatsKeys: room.currentActiveStats,
    };
    return { target: 'room', roomId: room.id, name: 'newTurn', payload };
  }

  private turnPlayer(room: Room): GamePlayer {
    const index = room.isReverseTurn ? room.players.length - 1 - room.turnIndex : room.turnIndex;
    const player = room.players[index];
    if (!player) throw new GameError('Nie można ustalić aktywnego gracza.');
    return player;
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

  private requireState(roomId: string, state: RoomState): Room {
    const room = this.requireRoom(roomId);
    if (room.state !== state) throw new GameError('Ta akcja nie jest teraz dostępna.');
    return room;
  }

  private requirePlayer(room: Room, socketId: string): GamePlayer {
    const player = room.players.find((candidate) => candidate.id === socketId);
    if (!player) throw new GameError('Nie należysz do tego pokoju.');
    return player;
  }

  private requireHost(room: Room, socketId: string): void {
    if (room.hostId !== socketId) throw new GameError('Tylko host może wykonać tę akcję.');
  }

  private newPlayer(id: string, username: string, budget: number): GamePlayer {
    return { id, username, budget, team: [], totalProfit: 0 };
  }

  private uniqueRoomId(): string {
    for (let attempt = 0; attempt < 100; attempt += 1) {
      const id = Math.floor(1000 + this.random() * 9000).toString();
      if (!this.rooms.has(id)) return id;
    }
    throw new GameError('Nie udało się utworzyć pokoju. Spróbuj ponownie.');
  }
}
