import { describe, expect, it } from 'vitest';
import { validateNickname } from '../src/server/domain/nickname';

describe('validateNickname', () => {
  it('przycina poprawny nick', () => expect(validateNickname('  Mateusz  ')).toBe('Mateusz'));
  it('odrzuca pusty i zbyt długi nick', () => {
    expect(() => validateNickname('  ')).toThrow('Wpisz nick!');
    expect(() => validateNickname('x'.repeat(31))).toThrow('maksymalnie 30');
  });
});
