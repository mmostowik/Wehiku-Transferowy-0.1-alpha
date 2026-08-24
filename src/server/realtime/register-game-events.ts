import type { Server, Socket } from 'socket.io';
import { z } from 'zod';
import type { ClientToServerEvents, ServerToClientEvents } from '../../shared/contracts.js';
import type { GameEngine, GameEvent } from '../domain/game-engine.js';

type GameServer = Server<ClientToServerEvents, ServerToClientEvents>;
type GameSocket = Socket<ClientToServerEvents, ServerToClientEvents>;

const roomIdSchema = z.string().regex(/^\d{4}$/);
const identifierSchema = z.string().min(1).max(100);
const gameModeSchema = z.enum(['fast', 'medium', 'long']);

export function registerGameEvents(io: GameServer, engine: GameEngine): void {
  io.on('connection', (socket) => {
    dispatch(io, engine.roomListEvent());

    socket.on('createRoom', (username) => {
      safely(socket, () => {
        const events = engine.createRoom(socket.id, username);
        const joined = events.find((event) => event.name === 'joinSuccess');
        if (joined?.payload && typeof joined.payload === 'object' && 'roomId' in joined.payload) {
          void socket.join(String(joined.payload.roomId));
        }
        dispatchAll(io, events);
      });
    });

    socket.on('joinRoom', (raw) => {
      safely(socket, () => {
        const payload = z.object({ roomId: roomIdSchema, username: z.string() }).parse(raw);
        const events = engine.joinRoom(socket.id, payload.roomId, payload.username);
        void socket.join(payload.roomId);
        dispatchAll(io, events);
      });
    });

    socket.on('startGame', (raw) => {
      safely(socket, () => {
        const payload = z.object({ roomId: roomIdSchema, modeKey: gameModeSchema }).parse(raw);
        dispatchAll(io, engine.startGame(socket.id, payload.roomId, payload.modeKey));
      });
    });

    socket.on('pickPlayer', (raw) => {
      safely(socket, () => {
        const payload = z.object({ roomId: roomIdSchema, sessionPickId: identifierSchema }).parse(raw);
        dispatchAll(io, engine.pickPlayer(socket.id, payload.roomId, payload.sessionPickId));
      });
    });

    socket.on('sellPlayer', (raw) => {
      safely(socket, () => {
        const payload = z.object({ roomId: roomIdSchema, playerId: identifierSchema }).parse(raw);
        dispatchAll(io, engine.sellPlayer(socket.id, payload.roomId, payload.playerId));
      });
    });

    socket.on('pickReplacement', (raw) => {
      safely(socket, () => {
        const payload = z.object({ roomId: roomIdSchema, sessionPickId: identifierSchema }).parse(raw);
        dispatchAll(io, engine.pickReplacement(socket.id, payload.roomId, payload.sessionPickId));
      });
    });

    socket.on('endTransferWindow', (rawRoomId) => {
      safely(socket, () => {
        const roomId = roomIdSchema.parse(rawRoomId);
        dispatchAll(io, engine.endTransferWindow(socket.id, roomId));
      });
    });

    socket.on('selectCaptain', (raw) => {
      safely(socket, () => {
        const payload = z.object({ roomId: roomIdSchema, cardId: identifierSchema }).parse(raw);
        dispatchAll(io, engine.selectCaptain(socket.id, payload.roomId, payload.cardId));
      });
    });

    socket.on('disconnect', () => dispatchAll(io, engine.disconnect(socket.id)));
  });
}

function safely(socket: GameSocket, action: () => void): void {
  try {
    action();
  } catch (error) {
    const message = error instanceof z.ZodError
      ? 'Otrzymano nieprawidłowe dane.'
      : error instanceof Error ? error.message : 'Wystąpił nieoczekiwany błąd.';
    socket.emit('errorMsg', message);
  }
}

function dispatchAll(io: GameServer, events: GameEvent[]): void {
  events.forEach((event) => dispatch(io, event));
}

function dispatch(io: GameServer, event: GameEvent): void {
  const target = event.target === 'all' ? io
    : event.target === 'room' ? io.to(event.roomId)
    : io.to(event.socketId);

  switch (event.name) {
    case 'updateRoomList': target.emit('updateRoomList', event.payload); break;
    case 'joinSuccess': target.emit('joinSuccess', event.payload as { roomId: string }); break;
    case 'updateLobby': target.emit('updateLobby', event.payload as Parameters<ServerToClientEvents['updateLobby']>[0]); break;
    case 'newTurn': target.emit('newTurn', event.payload as Parameters<ServerToClientEvents['newTurn']>[0]); break;
    case 'updateMyData': target.emit('updateMyData', event.payload as Parameters<ServerToClientEvents['updateMyData']>[0]); break;
    case 'transferWindowOpen': target.emit('transferWindowOpen', event.payload as Parameters<ServerToClientEvents['transferWindowOpen']>[0]); break;
    case 'showReplacementModal': target.emit('showReplacementModal', event.payload as Parameters<ServerToClientEvents['showReplacementModal']>[0]); break;
    case 'closeReplacementDraft': target.emit('closeReplacementDraft'); break;
    case 'playerSold': target.emit('playerSold', event.payload as Parameters<ServerToClientEvents['playerSold']>[0]); break;
    case 'startCaptainSelection': target.emit('startCaptainSelection', event.payload as Parameters<ServerToClientEvents['startCaptainSelection']>[0]); break;
    case 'gameOver': target.emit('gameOver', event.payload as Parameters<ServerToClientEvents['gameOver']>[0]); break;
  }
}
