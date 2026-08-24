import { createServer, type Server as HttpServer } from 'node:http';
import path from 'node:path';
import { io as createClient, type Socket as ClientSocket } from 'socket.io-client';
import { Server } from 'socket.io';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { ClientToServerEvents, ServerToClientEvents } from '../src/shared/contracts';
import { PlayerRepository } from '../src/server/data/player-repository';
import { GameEngine } from '../src/server/domain/game-engine';
import { registerGameEvents } from '../src/server/realtime/register-game-events';

type TestClient = ClientSocket<ServerToClientEvents, ClientToServerEvents>;
const fixturePath = path.resolve('tests/fixtures/player-database.json');
let httpServer: HttpServer;
let io: Server<ClientToServerEvents, ServerToClientEvents>;
let host: TestClient;
let guest: TestClient;
let serverUrl: string;

beforeEach(async () => {
  httpServer = createServer();
  io = new Server<ClientToServerEvents, ServerToClientEvents>(httpServer);
  registerGameEvents(io, new GameEngine(await PlayerRepository.load(fixturePath), () => 0.1234));
  await new Promise<void>((resolve) => httpServer.listen(0, '127.0.0.1', resolve));
  const address = httpServer.address();
  if (!address || typeof address === 'string') throw new Error('Nie udało się uruchomić serwera testowego.');
  serverUrl = `http://127.0.0.1:${address.port}`;
  host = createClient(serverUrl, { transports: ['websocket'] });
  guest = createClient(serverUrl, { transports: ['websocket'] });
  await Promise.all([connected(host), connected(guest)]);
});

afterEach(async () => {
  host.disconnect();
  guest.disconnect();
  await io.close();
});

describe('Socket.IO adapter', () => {
  it('utrzymuje uprawnienia hosta po dołączeniu i przekazuje je po rozłączeniu', async () => {
    const joined = once(host, 'joinSuccess');
    host.emit('createRoom', 'Host');
    const { roomId } = await joined;

    const hostLobby = nextLobbyWithPlayers(host, 2);
    const guestLobby = nextLobbyWithPlayers(guest, 2);
    guest.emit('joinRoom', { roomId, username: 'Gość' });
    expect((await hostLobby).isHost).toBe(true);
    expect((await guestLobby).isHost).toBe(false);

    const promotedLobby = nextLobbyWithPlayers(guest, 1);
    host.disconnect();
    expect((await promotedLobby).isHost).toBe(true);
  });

  it('wznawia trwającą grę po połączeniu nowego socketu z tokenem sesji', async () => {
    const joined = once(host, 'joinSuccess');
    host.emit('createRoom', 'Host');
    const session = await joined;
    const guestLobby = nextLobbyWithPlayers(guest, 2);
    guest.emit('joinRoom', { roomId: session.roomId, username: 'Gość' });
    await guestLobby;

    const started = once(guest, 'newTurn');
    host.emit('startGame', { roomId: session.roomId, modeKey: 'fast' });
    await started;
    const paused = once(guest, 'gamePaused');
    host.disconnect();
    await paused;

    const resumedClient: TestClient = createClient(serverUrl, { transports: ['websocket'] });
    await connected(resumedClient);
    const resumed = once(resumedClient, 'joinSuccess');
    const gameResumed = once(guest, 'gameResumed');
    resumedClient.emit('resumeGame', { roomId: session.roomId, resumeToken: session.resumeToken });
    expect(await resumed).toMatchObject({ roomId: session.roomId, playerId: session.playerId, resumed: true });
    expect((await gameResumed).message).toContain('wrócił');
    resumedClient.disconnect();
  });
});

function connected(socket: TestClient): Promise<void> {
  if (socket.connected) return Promise.resolve();
  return new Promise((resolve, reject) => {
    socket.once('connect', resolve);
    socket.once('connect_error', reject);
  });
}

function once<K extends keyof ServerToClientEvents>(
  socket: TestClient,
  event: K,
): Promise<Parameters<ServerToClientEvents[K]>[0]> {
  return new Promise((resolve) => {
    socket.once(event, ((payload: Parameters<ServerToClientEvents[K]>[0]) => resolve(payload)) as never);
  });
}

function nextLobbyWithPlayers(socket: TestClient, count: number): Promise<Parameters<ServerToClientEvents['updateLobby']>[0]> {
  return new Promise((resolve) => {
    const listener: ServerToClientEvents['updateLobby'] = (payload) => {
      if (payload.players.length !== count) return;
      socket.off('updateLobby', listener);
      resolve(payload);
    };
    socket.on('updateLobby', listener);
  });
}
