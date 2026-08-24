import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';

describe('interaktywne elementy interfejsu', () => {
  it('utrzymuje przycisk Jak grać nad nagłówkiem', async () => {
    const html = await readFile('index.html', 'utf8');
    const tutorialButton = html.match(/<button id="tutorialOpenBtn"[^>]+>/)?.[0];
    expect(tutorialButton).toContain('z-10');
  });

  it('udostępnia pominięcie draftu, rezygnację ze zmiennika i głos gotowości', async () => {
    const html = await readFile('index.html', 'utf8');
    expect(html).toContain('id="skipPickBtn"');
    expect(html).toContain('id="declineReplacementBtn"');
    expect(html).toContain('id="transferReadyBtn"');
    expect(html).not.toContain('id="endTransferBtn"');
  });
});
