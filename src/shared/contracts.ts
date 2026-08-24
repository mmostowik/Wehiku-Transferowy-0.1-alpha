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

export interface RoomSummary {
  id: string;
  hostName: string;
  playerCount: number;
}

export interface DraftCard {
  sessionPickId: string;
  displayStats: {
    age: number | '?';
    league: string;
    activeStats: Partial<Record<StatKey, number>>;
  };
  historicalValue: number;
}

export interface NewTurnPayload {
  roundNumber: number;
  positionName: PositionCode;
  season: string;
  turnPlayerId: string;
  turnPlayerName: string;
  pool: DraftCard[];
  activeStatsKeys: StatKey[];
}

export interface ClientToServerEvents {
  createRoom: (username: string) => void;
  joinRoom: (payload: { roomId: string; username: string }) => void;
  startGame: (payload: { roomId: string; modeKey: GameModeKey }) => void;
  pickPlayer: (payload: { roomId: string; sessionPickId: string }) => void;
  sellPlayer: (payload: { roomId: string; playerId: string }) => void;
  pickReplacement: (payload: { roomId: string; sessionPickId: string }) => void;
  endTransferWindow: (roomId: string) => void;
  selectCaptain: (payload: { roomId: string; cardId: string }) => void;
}

export interface ServerToClientEvents {
  updateRoomList: (rooms: RoomSummary[]) => void;
  joinSuccess: (payload: { roomId: string }) => void;
  updateLobby: (payload: { players: GamePlayer[]; isHost: boolean }) => void;
  newTurn: (payload: NewTurnPayload) => void;
  errorMsg: (message: string) => void;
  updateMyData: (player: GamePlayer) => void;
  transferWindowOpen: (payload: { season: string; hostId: string }) => void;
  showReplacementModal: (pool: PlayerCard[]) => void;
  closeReplacementDraft: () => void;
  playerSold: (payload: { msg: string }) => void;
  startCaptainSelection: (payload: { players: GamePlayer[] }) => void;
  gameOver: (payload: { players: GamePlayer[] }) => void;
}
