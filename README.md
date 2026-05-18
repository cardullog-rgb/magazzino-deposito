# Gestionale Magazzino

Gestionale di magazzino per ristoranti e bar, ottimizzato per uso da iPad dietro
bancone. Modello a **fogli settimanali con riporto** (Iniziale + Entrate − Uscite
= Rimanenza), non magazzino real-time.

## Caratteristiche

- **Foglio settimanale** che replica il foglio cartaceo italiano. La rimanenza
  di una settimana diventa l'iniziale della successiva.
- **Scarico 1-tap** sull'iPad: tap singolo su una riga = −1 unità, long-press =
  dialog con quantità custom. Barra "Annulla" sticky per ogni movimento.
- **Carico in batch**: pagina dedicata per registrare in blocco le entrate di
  più prodotti, raggruppabili per fornitore o categoria.
- **Edit inline**: nome, marca, posizione, soglia minima — modificabili
  cliccando direttamente sul campo.
- **Ruoli admin / staff** con elevazione admin temporanea (5 minuti) per
  ritocchi al volo dall'iPad in modalità banco.
- **Conta fisica** alla chiusura settimanale per riconciliare ammanchi.

## Stack

- Frontend: React 18 + Vite + Tailwind + shadcn/Radix + wouter + react-query
- Backend: Express 5 + Drizzle ORM + better-sqlite3
- Storage: SQLite locale (un singolo file `data.db`)

## Avvio in locale

```bash
npm install
npm run dev          # server su http://localhost:3000
```

Al primo avvio viene creato `data.db` con **un solo utente admin**:

| Username | Password iniziale |
|----------|-------------------|
| `admin`  | `changeme` *(o quella in `INITIAL_ADMIN_PASSWORD`)* |

Al primo login l'app obbliga a scegliere una nuova password.

## Configurazione (env)

| Variabile | Default | Note |
|-----------|---------|------|
| `PORT` | `3000` | Porta HTTP |
| `DB_PATH` | `./data.db` | Path del file SQLite |
| `INITIAL_ADMIN_PASSWORD` | `changeme` | Password admin alla prima installazione |
| `NODE_ENV` | `development` | `production` per build/serve statico |

## Uso quotidiano (cheat-sheet)

### Admin (gestore)

1. **Aggiungi categorie** → sidebar … *(le crei via API o aggiungendo prodotti)*
2. **Aggiungi prodotti**: Scorte → "Nuovo prodotto"
3. **Crea utenti staff**: Utenti → "Nuovo utente"
4. **Chiusura settimanale**: Foglio → "Chiudi foglio" (conta fisica)

### Staff (banco)

- **Scarico**: tap singolo su `−` della riga = −1 unità
- **Carico (in arrivo)**: tap singolo su `+` = +1 unità
- **Quantità custom**: tieni premuto 0.5s su `+`/`−` → si apre il dialog
- **Annullare l'ultima azione**: barra in alto compare per 12 secondi
- **Modifica al volo da staff (PIN admin)**: lucchetto in header → credenziali
  admin → 5 minuti di accesso completo, poi torna automatico alla modalità banco

## Build di produzione

```bash
npm run build        # bundle in ./dist
npm start            # node dist/index.cjs
```

## Test API

```bash
./script/smoke-test.sh      # serve un server attivo su :3000
```

Esegue ~26 controlli end-to-end (login, ruoli, movimenti, undo, batch, edit
inline, conta fisica). Auto-cleanup: i dati di test vengono annullati alla fine.

## Deploy

Vedi [`DEPLOY-RAILWAY.md`](./DEPLOY-RAILWAY.md) per il deploy gratuito su Railway
in ~10 minuti.

## Struttura

```
client/          frontend React (pages, components, lib)
server/          backend Express (routes.ts, storage.ts, crypto-password.ts)
shared/          schema Drizzle condiviso
script/          build.ts, smoke-test.sh
data.db          database SQLite (in .gitignore)
```

## Reset / consegna pulita

```bash
rm data.db data.db-journal data.db-shm data.db-wal 2>/dev/null
npm run dev    # ricrea il DB con solo l'utente admin iniziale
```
