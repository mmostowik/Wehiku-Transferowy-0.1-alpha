const FORBIDDEN_WORDS = [
  'nigger', 'nigga', 'fuck', 'bitch', 'cunt', 'whore', 'faggot', 'retard', 'slut',
  'kurw', 'jeb', 'pierdol', 'chuj', 'cipa', 'pizda', 'dziwk', 'szmat', 'pedał',
  'debil', 'zjeb', 'sperma', 'cwel',
];

export function validateNickname(value: unknown): string {
  if (typeof value !== 'string') throw new Error('Wpisz nick!');
  const nickname = value.trim();
  if (!nickname) throw new Error('Wpisz nick!');
  if (nickname.length > 30) throw new Error('Nick może mieć maksymalnie 30 znaków.');
  const normalized = nickname.toLocaleLowerCase('pl').replace(/[\W_]+/gu, '');
  if (FORBIDDEN_WORDS.some((word) => normalized.includes(word))) throw new Error('Nick niedozwolony!');
  return nickname;
}
