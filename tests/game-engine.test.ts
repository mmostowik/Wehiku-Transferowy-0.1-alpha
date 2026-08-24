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
});
