import { createServer as createHttpServer, type Server as HttpServer } from 'node:http';
import path from 'node:path';
import express from 'express';
import { Server } from 'socket.io';
import type { ClientToServerEvents, ServerToClientEvents } from '../shared/contracts.js';
import { PlayerRepository } from './data/player-repository.js';
import { GameEngine } from './domain/game-engine.js';
import { registerGameEvents } from './realtime/register-game-events.js';

export interface Application {
  httpServer: HttpServer;
  io: Server<ClientToServerEvents, ServerToClientEvents>;
}

export async function createApplication(): Promise<Application> {
  const app = express();
  const httpServer = createHttpServer(app);
  const io = new Server<ClientToServerEvents, ServerToClientEvents>(httpServer, {
    cors: process.env.NODE_ENV === 'production' ? undefined : { origin: true },
  });

  const databasePath = process.env.GAME_DATABASE_PATH ?? path.resolve('game_database.json');
  const repository = await PlayerRepository.load(databasePath);
  console.log(`Baza wczytana. Usunięto ${repository.removedEntries} wpisów.`);
  registerGameEvents(io, new GameEngine(repository));

  if (process.env.NODE_ENV === 'production') {
    const clientPath = path.resolve('dist/client');
    app.use(express.static(clientPath));
    app.get('*splat', (_request, response) => response.sendFile(path.join(clientPath, 'index.html')));
  } else {
    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({ server: { middlewareMode: true }, appType: 'spa' });
    app.use(vite.middlewares);
  }

  return { httpServer, io };
}
