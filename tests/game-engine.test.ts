import path from 'node:path';
import { beforeEach, describe, expect, it } from 'vitest';
import { PlayerRepository } from '../src/server/data/player-repository';
import { GameEngine, type GameEvent } from '../src/server/domain/game-engine';

const fixturePath = path.resolve('tests/fixtures/player-database.json');
let engine: GameEngine;

beforeEach(async () => {
  engine = new GameEngine(await PlayerRepository.load(fixturePath), () => 0.1234);
});

function roomIdFrom(events: GameEvent[]): string {
  const joined = events.find((event) => event.name === 'joinSuccess');
  if (!joined || !joined.payload || typeof joined.payload !== 'object' || !('roomId' in joined.payload)) throw new Error('Brak joinSuccess');
  return String(joined.payload.roomId);
}

function joinData(events: GameEvent[]): { roomId: string; playerId: string; resumeToken: string } {
  const joined = events.find((event) => event.name === 'joinSuccess');
  if (!joined?.payload || typeof joined.payload !== 'object') throw new Error('Brak joinSuccess');
  return joined.payload as { roomId: string; playerId: string; resumeToken: string };
}

function eventPayload<T>(events: GameEvent[], name: GameEvent['name']): T {
  const event = events.find((candidate) => candidate.name === name);
  if (!event) throw new Error(`Brak zdarzenia ${name}`);
  return event.payload as T;
}

describe('GameEngine lobby', () => {
  it('wysyła flagę hosta osobno każdemu graczowi', () => {
    const roomId = roomIdFrom(engine.createRoom('host-socket', 'Host'));
    const events = engine.joinRoom('guest-socket', roomId, 'Gość');
    const lobbyEvents = events.filter((event) => event.name === 'updateLobby');

    expect(lobbyEvents).toEqual(expect.arrayContaining([
      expect.objectContaining({ socketId: 'host-socket', payload: expect.objectContaining({ isHost: true }) }),
      expect.objectContaining({ socketId: 'guest-socket', payload: expect.objectContaining({ isHost: false }) }),
    ]));
  });

  it('usuwa pusty pokój po rozłączeniu ostatniego gracza', () => {
    engine.createRoom('host-socket', 'Host');
    const events = engine.disconnect('host-socket');
    const roomList = events.at(-1);
    expect(roomList).toMatchObject({ name: 'updateRoomList', payload: [] });
  });

  it('przekazuje rolę hosta po rozłączeniu dotychczasowego hosta', () => {
    const roomId = roomIdFrom(engine.createRoom('host-socket', 'Host'));
    engine.joinRoom('guest-socket', roomId, 'Gość');
    const events = engine.disconnect('host-socket');
    expect(events).toContainEqual(expect.objectContaining({
      socketId: 'guest-socket',
      name: 'updateLobby',
      payload: expect.objectContaining({ isHost: true }),
    }));
  });

  it('numeruje zduplikowane nicki w obrębie pokoju', () => {
    const roomId = roomIdFrom(engine.createRoom('host-socket', 'Jan'));
    const events = engine.joinRoom('guest-socket', roomId, 'jan');
    const lobby = eventPayload<{ players: Array<{ username: string }> }>(events, 'updateLobby');
    expect(lobby.players.map((player) => player.username)).toContain('jan (2)');
  });
});

describe('GameEngine gameplay safeguards', () => {
  it('pozwala pominąć każdą kartę i kończy jednoosobową grę z pustym składem', () => {
    const { roomId } = joinData(engine.createRoom('host', 'Solo'));
    engine.startGame('host', roomId, 'fast');

    engine.skipPick('host', roomId);
    engine.skipPick('host', roomId);
    const firstWindow = engine.skipPick('host', roomId);
    expect(firstWindow.some((event) => event.name === 'transferWindowOpen')).toBe(true);
    engine.setTransferReady('host', roomId);
    engine.skipPick('host', roomId);
    const secondWindow = engine.skipPick('host', roomId);
    expect(secondWindow.some((event) => event.name === 'transferWindowOpen')).toBe(true);
    const finished = engine.setTransferReady('host', roomId);

    expect(finished.some((event) => event.name === 'startCaptainSelection')).toBe(true);
    expect(finished.some((event) => event.name === 'gameOver')).toBe(true);
  });

  it('anonimizuje draft i rynek zastępczy, pozwala zrezygnować ze zmiennika', () => {
    const host = joinData(engine.createRoom('host', 'Host'));
    const guest = joinData(engine.joinRoom('guest', host.roomId, 'Gość'));
    const started = engine.startGame('host', host.roomId, 'fast');
    const firstTurn = eventPayload<{ pool: Array<{ sessionPickId: string }> }>(started, 'newTurn');
    expect(JSON.stringify(firstTurn)).not.toContain('Bramkarz');

    const hostPick = engine.pickPlayer('host', host.roomId, firstTurn.pool[0]!.sessionPickId);
    const hiddenPlayer = eventPayload<{ team: Array<{ id: string } & Record<string, unknown>> }>(hostPick, 'updateMyData');
    expect(hiddenPlayer.team[0]).toMatchObject({ hidden: true });
    expect(hiddenPlayer.team[0]).not.toHaveProperty('realName');
    const guestTurn = eventPayload<{ pool: Array<{ sessionPickId: string }> }>(hostPick, 'newTurn');
    engine.pickPlayer('guest', host.roomId, guestTurn.pool[0]!.sessionPickId);

    engine.skipPick('guest', host.roomId);
    engine.skipPick('host', host.roomId);
    engine.skipPick('host', host.roomId);
    engine.skipPick('guest', host.roomId);

    const sold = engine.sellPlayer('host', host.roomId, hiddenPlayer.team[0]!.id);
    const replacement = eventPayload<{ season: string; pool: Array<Record<string, unknown>> }>(sold, 'showReplacementModal');
    expect(replacement.season).toBe('2015/16');
    expect(JSON.stringify(replacement.pool)).not.toContain('Bramkarz');
    expect(replacement.pool[0]).not.toHaveProperty('realName');
    expect(() => engine.setTransferReady('host', host.roomId)).toThrow('Najpierw wybierz zastępcę');
    expect(engine.declineReplacement('host', host.roomId)).toContainEqual(expect.objectContaining({ name: 'closeReplacementDraft' }));

    const firstReady = engine.setTransferReady('host', host.roomId);
    expect(firstReady.some((event) => event.name === 'newTurn')).toBe(false);
    expect(() => engine.setTransferReady('guest', host.roomId)).not.toThrow();
    expect(host.playerId).not.toBe(guest.playerId);
  });

  it('pozwala różnym graczom kupić tego samego zastępcę, ale blokuje jego ponowną sprzedaż w tym oknie', () => {
    const host = joinData(engine.createRoom('host', 'Host'));
    engine.joinRoom('guest', host.roomId, 'Gość');
    const started = engine.startGame('host', host.roomId, 'fast');
    const hostTurn = eventPayload<{ pool: Array<{ sessionPickId: string }> }>(started, 'newTurn');
    const hostPick = engine.pickPlayer('host', host.roomId, hostTurn.pool[0]!.sessionPickId);
    const guestTurn = eventPayload<{ pool: Array<{ sessionPickId: string }> }>(hostPick, 'newTurn');
    const guestPick = engine.pickPlayer('guest', host.roomId, guestTurn.pool[0]!.sessionPickId);
    const hostDrafted = eventPayload<{ team: Array<{ id: string }> }>(hostPick, 'updateMyData').team[0]!.id;
    const guestDrafted = eventPayload<{ team: Array<{ id: string }> }>(guestPick, 'updateMyData').team[0]!.id;
    engine.skipPick('guest', host.roomId);
    engine.skipPick('host', host.roomId);
    engine.skipPick('host', host.roomId);
    engine.skipPick('guest', host.roomId);

    const hostReplacement = eventPayload<{ season: string; pool: Array<{ sessionPickId: string }> }>(engine.sellPlayer('host', host.roomId, hostDrafted), 'showReplacementModal');
    const guestReplacement = eventPayload<{ season: string; pool: Array<{ sessionPickId: string }> }>(engine.sellPlayer('guest', host.roomId, guestDrafted), 'showReplacementModal');
    const hostBought = eventPayload<{ team: Array<{ id: string; hidden: boolean; realName?: string; boughtInSeason?: string; purchasePrice?: number; historicalValue: number }> }>(engine.pickReplacement('host', host.roomId, hostReplacement.pool[0]!.sessionPickId), 'updateMyData');
    const guestBought = eventPayload<{ team: Array<{ id: string }> }>(engine.pickReplacement('guest', host.roomId, guestReplacement.pool[0]!.sessionPickId), 'updateMyData');

    expect(hostReplacement.season).toBe('2015/16');
    expect(guestReplacement.season).toBe('2015/16');
    expect(hostBought.team[0]).toEqual(expect.objectContaining({ hidden: true, boughtInSeason: '2015/16' }));
    expect(hostBought.team[0]!.purchasePrice).toBe(hostBought.team[0]!.historicalValue);
    expect(hostBought.team[0]).not.toHaveProperty('realName');
    expect(guestBought.team[0]?.id).toBe(hostBought.team[0]!.id);
    expect(() => engine.sellPlayer('host', host.roomId, hostBought.team[0]!.id)).toThrow('nie można sprzedać');
    engine.setTransferReady('host', host.roomId);
    const closed = engine.setTransferReady('guest', host.roomId);
    expect(closed).toContainEqual(expect.objectContaining({ name: 'transferLog', socketId: 'host', payload: expect.objectContaining({ kind: 'reveal' }) }));
  });

  it('wstrzymuje turę po rozłączeniu, pozwala wrócić i zachowuje aktywnego gracza', () => {
    const host = joinData(engine.createRoom('host', 'Host'));
    engine.joinRoom('guest', host.roomId, 'Gość');
    const started = engine.startGame('host', host.roomId, 'fast');
    const turn = eventPayload<{ pool: Array<{ sessionPickId: string }> }>(started, 'newTurn');
    engine.pickPlayer('host', host.roomId, turn.pool[0]!.sessionPickId);

    expect(engine.disconnect('host')).toContainEqual(expect.objectContaining({ name: 'gamePaused' }));
    expect(() => engine.skipPick('guest', host.roomId)).toThrow('Gra jest wstrzymana');
    const expired = engine.expireDisconnect('host');
    expect(expired).toContainEqual(expect.objectContaining({ name: 'disconnectDecision', socketId: 'guest' }));
    engine.resolveDisconnect('guest', host.roomId, host.playerId, 'wait');
    const resumed = engine.resumeGame('host-new', host.roomId, host.resumeToken);
    expect(resumed.some((event) => event.name === 'gameResumed')).toBe(true);
    const resumedTurn = eventPayload<{ turnPlayerId: string }>(resumed, 'newTurn');
    expect(resumedTurn.turnPlayerId).not.toBe(host.playerId);
    expect(() => engine.skipPick('guest', host.roomId)).not.toThrow();
  });

  it('po 3 minutach pozwala nowemu hostowi usunąć poprzedniego i wznowić tę samą turę', () => {
    const host = joinData(engine.createRoom('host', 'Host'));
    const guest = joinData(engine.joinRoom('guest', host.roomId, 'Gość'));
    const started = engine.startGame('host', host.roomId, 'fast');
    const turn = eventPayload<{ pool: Array<{ sessionPickId: string }> }>(started, 'newTurn');
    engine.pickPlayer('host', host.roomId, turn.pool[0]!.sessionPickId);
    engine.disconnect('host');
    engine.expireDisconnect('host');

    const removed = engine.resolveDisconnect('guest', host.roomId, host.playerId, 'remove');
    expect(removed.some((event) => event.name === 'gameResumed')).toBe(true);
    expect(eventPayload<{ turnPlayerId: string }>(removed, 'newTurn').turnPlayerId).toBe(guest.playerId);
    expect(() => engine.skipPick('guest', host.roomId)).not.toThrow();
  });
});
