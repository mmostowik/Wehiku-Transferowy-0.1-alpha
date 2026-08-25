export type GameModeKey = 'fast' | 'medium' | 'long';
export type PositionCode = 'GK' | 'CB' | 'FB' | 'CM' | 'W' | 'ST';
export type RoomState = 'lobby' | 'draft' | 'transfer' | 'captain' | 'finished';
export type StatKey = 'goals' | 'assists' | 'minutesPlayed' | 'yellowCards';

export interface PlayerStats {
  age: number | '?';
  league: string;
  goals?: number;
  assists?: number;
  minutesPlayed?: number;
  yellowCards?: number;
}

export interface PlayerCard {
  id: string;
  realName: string;
  stats: PlayerStats;
  historicalValue: number;
  transferWindowValues: Record<string, number>;
  currentValue: number;
  sessionPickId?: string;
  boughtInSeason?: string;
  assignedPosition?: PositionCode;
  purchasePrice?: number;
}

export interface OwnedCardView {
  id: string;
  hidden: boolean;
  historicalValue: number;
  purchasePrice?: number;
  boughtInSeason?: string;
  assignedPosition?: PositionCode;
  realName?: string;
  stats?: PlayerStats;
  currentValue?: number;
  transferValue?: number;
  canSell?: boolean;
}

export interface ScoreBreakdown {
  teamValueBase: number;
  captainBonus: number;
  synergyBonus: number;
  totalProfit: number;
  finalScore: number;
}

export interface GamePlayer {
  id: string;
  username: string;
  budget: number;
  team: PlayerCard[];
  totalProfit: number;
  captainId?: string;
  breakdown?: ScoreBreakdown;
}

export interface PlayerView {
  id: string;
  username: string;
  budget: number;
  team: OwnedCardView[];
  totalProfit: number;
  captainId?: string;
  breakdown?: ScoreBreakdown;
  connected: boolean;
}

export interface LobbyPlayer {
  id: string;
  username: string;
  connected: boolean;
}

export interface RoomSummary {
  id: string;
  hostName: string;
  playerCount: number;
}

export interface MysteryCard {
  sessionPickId: string;
  displayStats: {
    age: number | '?';
    league: string;
    activeStats: Partial<Record<StatKey, number>>;
  };
  price: number;
}

export interface NewTurnPayload {
  roundNumber: number;
  positionName: PositionCode;
  season: string;
  turnPlayerId: string;
  turnPlayerName: string;
  pool: MysteryCard[];
  activeStatsKeys: StatKey[];
}

export interface TransferStatusPayload {
  season: string;
  hostPlayerId: string;
  readyPlayerIds: string[];
  totalPlayers: number;
}

export interface ReplacementMarketPayload {
  season: string;
  pool: MysteryCard[];
}

export interface ClientToServerEvents {
  createRoom: (username: string) => void;
  joinRoom: (payload: { roomId: string; username: string }) => void;
  resumeGame: (payload: { roomId: string; resumeToken: string }) => void;
  startGame: (payload: { roomId: string; modeKey: GameModeKey }) => void;
  pickPlayer: (payload: { roomId: string; sessionPickId: string }) => void;
  skipPick: (roomId: string) => void;
  sellPlayer: (payload: { roomId: string; playerId: string }) => void;
  pickReplacement: (payload: { roomId: string; sessionPickId: string }) => void;
  declineReplacement: (roomId: string) => void;
  setTransferReady: (roomId: string) => void;
  resolveDisconnect: (payload: { roomId: string; playerId: string; action: 'remove' | 'wait' }) => void;
  selectCaptain: (payload: { roomId: string; cardId: string }) => void;
}

export interface ServerToClientEvents {
  updateRoomList: (rooms: RoomSummary[]) => void;
  joinSuccess: (payload: { roomId: string; playerId: string; resumeToken: string; resumed: boolean }) => void;
  updateLobby: (payload: { players: LobbyPlayer[]; isHost: boolean }) => void;
  newTurn: (payload: NewTurnPayload) => void;
  errorMsg: (message: string) => void;
  updateMyData: (player: PlayerView) => void;
  transferWindowOpen: (payload: TransferStatusPayload) => void;
  showReplacementModal: (payload: ReplacementMarketPayload) => void;
  closeReplacementDraft: () => void;
  transferLog: (payload: { message: string; kind: 'sale' | 'reveal' | 'system' }) => void;
  gamePaused: (payload: { playerName: string; reconnectDeadline: number }) => void;
  gameResumed: (payload: { message: string }) => void;
  disconnectDecision: (payload: { playerId: string; playerName: string; waiting: boolean }) => void;
  startCaptainSelection: (payload: { players: PlayerView[] }) => void;
  gameOver: (payload: { players: PlayerView[] }) => void;
}
