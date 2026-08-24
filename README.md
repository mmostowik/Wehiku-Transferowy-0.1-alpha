# Wehikuł Transferowy

Aktualna wersja: **0.2.0-alpha.1**.

Wieloosobowa, przeglądarkowa gra draftowa o budowaniu najcenniejszego składu piłkarskiego. Gracze wybierają ukryte karty z sezonów historycznych, handlują nimi w oknach transferowych 2025/2026, wybierają kapitana i rywalizują wartością końcową zespołu.

## Stack

- Node.js 24, TypeScript 5.9
- Express 5 i Socket.IO 4
- Vite 8 i Tailwind CSS 4
- Zod 4 do walidacji komunikatów sieciowych
- Vitest 4, ESLint 10 i Prettier 3

## Uruchomienie

```powershell
npm install
npm run dev
```

Aplikacja będzie dostępna pod `http://localhost:3000`. Serwer deweloperski Express obsługuje również middleware Vite, dlatego wystarcza jeden proces.

Build produkcyjny:

```powershell
npm run build
$env:NODE_ENV = 'production'
npm start
```

Pełna kontrola jakości:

```powershell
npm run check
```

## Struktura

```text
src/
  client/
    main.ts                 obsługa zdarzeń i stan klienta
    renderers.ts            bezpieczne renderowanie widoków klasami Tailwind
    dom.ts                  mały zestaw narzędzi DOM
    styles.css              wejście Tailwind i tokeny marki
  server/
    config/game.ts          tryby, pozycje i stałe gry
    data/player-repository.ts wczytanie, filtrowanie i losowanie zawodników
    domain/game-engine.ts   maszyna stanów i reguły rozgrywki
    domain/scoring.ts       czysta funkcja punktacji
    realtime/               adapter Socket.IO
    app.ts                  składanie aplikacji
  shared/contracts.ts       kontrakty współdzielone przez klienta i serwer
tests/                      testy domeny, danych i prawdziwego transportu Socket.IO
```

Najważniejszym modułem jest `GameEngine`. Jego interface przyjmuje zamiary graczy i zwraca zdarzenia domenowe; nie zna Socket.IO ani DOM. `PlayerRepository` ukrywa format dużego pliku JSON oraz różnicę między etykietą `2025/2026` a kluczem `2025/26`. Dzięki tym dwóm seamom reguły można testować bez uruchamiania przeglądarki.

## Konfiguracja

- `PORT` — port HTTP, domyślnie `3000`.
- `NODE_ENV=production` — serwowanie gotowego klienta z `dist/client`.
- `GAME_DATABASE_PATH` — opcjonalna, bezwzględna ścieżka do bazy zawodników.

Stan pokojów nadal znajduje się w pamięci procesu, zgodnie z zachowaniem wersji alpha. Kolejnym naturalnym etapem rozwoju jest adapter trwałego przechowywania, dzięki któremu pokoje przetrwają restart procesu.

## Zasady odporności rozgrywki

- gracz może pominąć wybór w drafcie i zakończyć grę z mniejszym składem,
- sprzedaż nie wymusza zakupu zastępcy, a niski budżet jest sygnalizowany przed transakcją,
- rynek zastępczy nie ujawnia nazwisk; zakup zostaje ujawniony po zamknięciu okna,
- okno transferowe zamyka jednogłośne głosowanie aktywnych graczy,
- rozłączenie wstrzymuje grę na trzy minuty i umożliwia wznowienie sesji,
- po upływie czasu host decyduje o dalszym oczekiwaniu lub usunięciu gracza.
