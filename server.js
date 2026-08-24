const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const fs = require('fs');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: '*' } });

// Obsługa plików statycznych (dla hostingu)
app.use(express.static(path.join(__dirname)));
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'index.html'));
});

// ============================================
// 1. Konfiguracja
// ============================================
const TOP_10_LEAGUES = ['Premier League', 'LaLiga', 'Serie A', 'Bundesliga', 'Ligue 1', 'Liga Portugal', 'Eredivisie', 'Süper Lig', 'Jupiler Pro League', 'Championship'];

const PositionMap = {
    'GK': ['Goalkeeper'], 'CB': ['Centre-Back'], 'FB': ['Right-Back', 'Left-Back'],
    'CM': ['Central Midfield', 'Defensive Midfield', 'Attacking Midfield'],
    'W':  ['Right Winger', 'Left Winger', 'Right Midfield', 'Left Midfield'],
    'ST': ['Centre-Forward', 'Second Striker']
};

const GameModes = {
    'fast': { name: 'Szybki (5 graczy)', budget: 150000000, draftOrder: ['GK', 'CB', 'CM', 'W', 'ST'], transferWindowsAfterRound: [3, 5] },
    'medium': { name: 'Średni (8 graczy)', budget: 250000000, draftOrder: ['GK', 'FB', 'CB', 'CM', 'W', 'CM', 'W', 'ST'], transferWindowsAfterRound: [3, 5, 7] },
    'long': { name: 'Długi (11 graczy)', budget: 350000000, draftOrder: ['GK', 'FB', 'FB', 'CB', 'CB', 'CM', 'CM', 'CM', 'W', 'W', 'ST'], transferWindowsAfterRound: [3, 7, 9, 11] }
};

const forbiddenWords = ['nigger', 'nigga', 'fuck', 'bitch', 'cunt', 'whore', 'faggot', 'retard', 'slut', 'kurw', 'jeb', 'pierdol', 'chuj', 'cipa', 'pizda', 'dziwk', 'szmat', 'pedał', 'debil', 'zjeb', 'sperma', 'cwel'];

function isProfane(nick) {
    const normalized = nick.toLowerCase().replace(/[\W_]+/g, '');
    return forbiddenWords.some(word => normalized.includes(word));
}

let db = {};
let hasValidPlayers = false;

try {
    const data = fs.readFileSync('./game_database.json', 'utf8');
    db = JSON.parse(data);
    
    const playerPeakValues = {};
    for (const season in db) {
        for (const pos in db[season]) {
            db[season][pos].forEach(p => {
                if (!playerPeakValues[p.id]) playerPeakValues[p.id] = 0;
                if (p.historicalValue > playerPeakValues[p.id]) playerPeakValues[p.id] = p.historicalValue;
                if (p.currentValue > playerPeakValues[p.id]) playerPeakValues[p.id] = p.currentValue;
                for (const winSeas in p.transferWindowValues) {
                    if (p.transferWindowValues[winSeas] > playerPeakValues[p.id]) playerPeakValues[p.id] = p.transferWindowValues[winSeas];
                }
            });
        }
    }

    let removedCount = 0;
    for (const season in db) {
        for (const pos in db[season]) {
            const originalLength = db[season][pos].length;
            db[season][pos] = db[season][pos].filter(p => 
                playerPeakValues[p.id] >= 5000000 &&
                TOP_10_LEAGUES.includes(p.stats.league) &&
                p.currentValue > 0 &&
                p.stats.age !== "?" 
            );
            removedCount += (originalLength - db[season][pos].length);
            if (db[season][pos].length > 0) hasValidPlayers = true;
        }
    }
    console.log(`Baza wczytana. Gotowe do gry! Usunięto ${removedCount} niepożądanych wpisów.`);
} catch (err) {
    console.error("BŁĄD BAZY DANYCH:", err);
    process.exit(1);
}

const rooms = {};

function broadcastActiveRooms() {
    const openRooms = Object.values(rooms)
        .filter(r => r.state === 'lobby')
        .map(r => ({ id: r.id, hostName: r.players[0].username, playerCount: r.players.length }));
    io.emit('updateRoomList', openRooms);
}

function getRandomSeason() {
    const seasons = Object.keys(db);
    return seasons[Math.floor(Math.random() * seasons.length)];
}

function generateSessionId() {
    return 'pick_' + Math.random().toString(36).substr(2, 9);
}

function fetchPlayersFromDB(roomId, season, acceptableSubPositions, count) {
    const room = rooms[roomId];
    let possiblePlayers = [];
    
    acceptableSubPositions.forEach(subPos => {
        if (db[season] && db[season][subPos]) possiblePlayers = possiblePlayers.concat(db[season][subPos]);
    });

    const seasonStartYear = parseInt(season.split('/')[0]); 
    possiblePlayers = possiblePlayers.filter(p => {
        const currentAge = parseInt(p.stats.age) + (2024 - seasonStartYear); 
        return currentAge <= 36 && !room.draftedIds.includes(p.id);
    });

    for (let i = possiblePlayers.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [possiblePlayers[i], possiblePlayers[j]] = [possiblePlayers[j], possiblePlayers[i]];
    }

    return possiblePlayers.slice(0, count).map(p => ({
        ...p,
        sessionPickId: generateSessionId()
    }));
}

function getTurnPlayerId(room) {
    let index = room.turnIndex;
    if (room.isReverseTurn) {
        index = room.players.length - 1 - room.turnIndex;
    }
    return room.players[index].id;
}

// ============================================
// 2. Logika Socket.io
// ============================================
io.on('connection', (socket) => {
    broadcastActiveRooms();

    socket.on('createRoom', (username) => {
        if (!username || username.trim() === '') return socket.emit('errorMsg', 'Wpisz nick!');
        if (isProfane(username)) return socket.emit('errorMsg', 'Nick niedozwolony!');

        const roomId = Math.floor(1000 + Math.random() * 9000).toString();
        // Domyślny budżet startowy (domyślnie tryb medium/250M, zaktualizuje się przy starcie gry)
        rooms[roomId] = { id: roomId, host: socket.id, state: 'lobby', players: [], currentRound: 1, turnIndex: 0, draftedIds: [], isReverseTurn: false, defaultBudget: 250000000 };
        
        socket.join(roomId);
        rooms[roomId].players.push({ id: socket.id, username: username, budget: rooms[roomId].defaultBudget, team: [] });
        
        socket.emit('joinSuccess', { roomId });
        io.to(roomId).emit('updateLobby', { players: rooms[roomId].players, isHost: true });
        broadcastActiveRooms();
    });

    socket.on('joinRoom', ({ roomId, username }) => {
        if (!username || username.trim() === '') return socket.emit('errorMsg', 'Wpisz nick!');
        if (isProfane(username)) return socket.emit('errorMsg', 'Nick niedozwolony!');
        if (!rooms[roomId]) return socket.emit('errorMsg', 'Pokój nie istnieje!');
        if (rooms[roomId].state !== 'lobby') return socket.emit('errorMsg', 'Gra już trwa!');

        socket.join(roomId);
        // Przypisujemy graczowi od razu domyślny budżet pokoju
        rooms[roomId].players.push({ id: socket.id, username: username, budget: rooms[roomId].defaultBudget, team: [] });
        
        socket.emit('joinSuccess', { roomId });
        io.to(roomId).emit('updateLobby', { players: rooms[roomId].players, isHost: rooms[roomId].host === socket.id });
        broadcastActiveRooms();
    });

    socket.on('startGame', ({ roomId, modeKey }) => {
        if (!hasValidPlayers) return socket.emit('errorMsg', 'Błąd: Baza danych jest pusta. Sprawdź pliki JSON.');
        const room = rooms[roomId];
        if (room.host !== socket.id) return;

        room.mode = GameModes[modeKey] || GameModes['medium'];
        room.totalRounds = room.mode.draftOrder.length;
        
        // Aktualizujemy budżety graczy zgodnie z wybranym trybem gry
        room.defaultBudget = room.mode.budget;
        room.players.forEach(p => p.budget = room.mode.budget);
        
        room.state = 'playing';
        broadcastActiveRooms();
        startNextRound(roomId);
    });

    socket.on('pickPlayer', ({ roomId, sessionPickId }) => {
        const room = rooms[roomId];
        if (!room || room.state !== 'draft') return;

        const currentPlayerId = getTurnPlayerId(room);
        if (currentPlayerId !== socket.id) return;

        const playerToBuyIndex = room.pool.findIndex(p => p.sessionPickId === sessionPickId);
        if (playerToBuyIndex === -1) return;

        const playerToBuy = room.pool[playerToBuyIndex];
        const currentPlayer = room.players.find(p => p.id === socket.id);

        if (currentPlayer.budget >= playerToBuy.historicalValue) {
            currentPlayer.budget -= playerToBuy.historicalValue;
            currentPlayer.team.push({ ...playerToBuy, boughtInSeason: room.currentSeason });
            room.draftedIds.push(playerToBuy.id);
            
            room.pool.splice(playerToBuyIndex, 1);
            room.turnIndex++;
            
            // Wysyłamy zaktualizowane dane gracza (w tym nowy budżet) natychmiast po zakupie
            socket.emit('updateMyData', currentPlayer);

            if (room.turnIndex >= room.players.length) {
                room.turnIndex = 0;
                room.currentRound++;
                room.isReverseTurn = !room.isReverseTurn;

                if (room.mode.transferWindowsAfterRound.includes(room.currentRound - 1)) {
                     startTransferWindow(roomId);
                } else if (room.currentRound > room.totalRounds) {
                     startCaptainSelection(roomId);
                } else {
                     startNextRound(roomId);
                }
            } else {
                emitGameState(roomId);
            }
        } else {
            socket.emit('errorMsg', 'Brak budżetu!');
        }
    });

    socket.on('sellPlayer', ({ roomId, playerId }) => {
        const room = rooms[roomId];
        if (!room || room.state !== 'transfer') return;

        const player = room.players.find(p => p.id === socket.id);
        const playerIndex = player.team.findIndex(p => p.id === playerId);

        if (playerIndex !== -1) {
            const card = player.team[playerIndex];
            const winVal = card.transferWindowValues[room.currentSeason];
            const newPrice = (winVal !== undefined && winVal > 0) ? winVal : Math.floor(card.historicalValue / 2);
            
            player.budget += newPrice;
            player.team.splice(playerIndex, 1);
            
            io.to(roomId).emit('playerSold', { msg: `🔥 ${player.username} sprzedał zawodnika ${card.realName} za ${(newPrice/1000000).toFixed(1)}M €!` });
            socket.emit('updateMyData', player);
        }
    });

    socket.on('endTransferWindow', (roomId) => {
        const room = rooms[roomId];
        if (room && room.host === socket.id && room.state === 'transfer') {
             if (room.currentRound > room.totalRounds) {
                 startCaptainSelection(roomId);
             } else {
                 startNextRound(roomId);
             }
        }
    });

    socket.on('selectCaptain', ({ roomId, cardId }) => {
        const room = rooms[roomId];
        const player = room.players.find(p => p.id === socket.id);
        
        if (!player.captainId) {
            player.captainId = cardId;
            room.captainsSelected++;
            if (room.captainsSelected === room.players.length) endGame(roomId);
        }
    });
});

function startNextRound(roomId) {
    const room = rooms[roomId];
    room.state = 'draft';
    room.currentSeason = getRandomSeason();
    
    const requiredPositionCode = room.mode.draftOrder[room.currentRound - 1];
    
    let totalCardsToFetch = 5;
    if (room.players.length >= 4) totalCardsToFetch = 7;

    room.pool = fetchPlayersFromDB(roomId, room.currentSeason, PositionMap[requiredPositionCode], totalCardsToFetch);
    emitGameState(roomId);
}

function emitGameState(roomId) {
    const room = rooms[roomId];
    const turnPlayerId = getTurnPlayerId(room);
    const turnPlayerObj = room.players.find(p => p.id === turnPlayerId);
    
    const clientPool = room.pool.map(p => ({
        sessionPickId: p.sessionPickId,
        stats: p.stats, 
        historicalValue: p.historicalValue
    }));

    io.to(roomId).emit('newTurn', {
        roundNumber: room.currentRound,
        positionName: room.mode.draftOrder[room.currentRound - 1], 
        season: room.currentSeason,
        turnPlayerId: turnPlayerId,
        turnPlayerName: turnPlayerObj.username,
        pool: clientPool
    });
}

function startTransferWindow(roomId) {
    const room = rooms[roomId];
    room.state = 'transfer';
    room.currentSeason = getRandomSeason(); 
    io.to(roomId).emit('transferWindowOpen', { season: room.currentSeason, hostId: room.host });
}

function startCaptainSelection(roomId) {
    const room = rooms[roomId];
    room.state = 'captain';
    room.captainsSelected = 0;
    io.to(roomId).emit('startCaptainSelection', { players: room.players });
}

function endGame(roomId) {
    const room = rooms[roomId];
    room.state = 'finished';

    room.players.forEach(player => {
        let teamValue = 0;
        let leagueCounts = {};
        let captainBonus = 0;

        player.team.forEach(card => {
            const cv = card.currentValue || 0;
            teamValue += cv;
            if (card.id === player.captainId) captainBonus = cv;
            const league = card.stats.league;
            leagueCounts[league] = (leagueCounts[league] || 0) + 1;
        });

        const maxLeagueCount = Math.max(0, ...Object.values(leagueCounts));
        let synergyMultiplier = maxLeagueCount >= 3 ? 1.15 : 1.0;

        const totalTeamValue = teamValue + captainBonus;
        const teamValueAfterSynergy = totalTeamValue * synergyMultiplier;
        
        player.breakdown = {
            teamValueBase: teamValue,
            captainBonus: captainBonus,
            synergyBonus: teamValueAfterSynergy - totalTeamValue,
            finalScore: player.budget + teamValueAfterSynergy,
            budget: player.budget
        };
    });

    room.players.sort((a, b) => b.breakdown.finalScore - a.breakdown.finalScore);
    io.to(roomId).emit('gameOver', { players: room.players });
}

// Obsługa portu w środowiskach chmurowych
const port = process.env.PORT || 3000;
server.listen(port, () => {
    console.log(`Serwer działa na porcie ${port}!`);
});