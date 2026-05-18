# 🚀 Deploy su Railway — Guida completa

**Tempo stimato: ~10 minuti. Nessuna carta di credito richiesta.**

---

## Cosa otterrai

- URL tipo `https://magazzino-deposito-production.up.railway.app`
- Sempre online (non si addormenta)
- Database persistente (i dati non si perdono mai)
- HTTPS automatico
- Gratuito fino a $5/mese di utilizzo (= circa 500 ore, sufficiente per uso professionale leggero)

---

## Passo 1 — Crea account GitHub (se non ce l'hai)

👉 https://github.com → "Sign up" → crea account gratuito

---

## Passo 2 — Carica il codice su GitHub

### Opzione A — Da terminale (Mac/Linux)

```bash
cd magazzino-deposito
git init
git add .
git commit -m "prima versione gestionale"
```

Poi vai su https://github.com/new, crea un repository **privato** chiamato `magazzino-deposito`, e segui le istruzioni che ti mostra GitHub per collegarlo:

```bash
git remote add origin https://github.com/TUO-USERNAME/magazzino-deposito.git
git push -u origin main
```

### Opzione B — Da browser (più semplice)

1. Vai su https://github.com/new
2. Nome: `magazzino-deposito`, scegli **Private**
3. Clicca "Create repository"
4. Clicca "uploading an existing file"
5. Trascina TUTTA la cartella `magazzino-deposito` (escludi `node_modules` e `dist` se ci sono)

---

## Passo 3 — Crea account Railway

👉 https://railway.app → "Login with GitHub" → autorizza

---

## Passo 4 — Crea nuovo progetto su Railway

1. Dal dashboard Railway clicca **"New Project"**
2. Scegli **"Deploy from GitHub repo"**
3. Seleziona il repository `magazzino-deposito`
4. Railway detecta il Dockerfile automaticamente e inizia il build

---

## Passo 5 — Aggiungi il Volume (database persistente)

**IMPORTANTE: farlo PRIMA che l'app giri, altrimenti perdi i dati ad ogni deploy.**

1. Nel progetto Railway, clicca sul tuo servizio
2. Vai su tab **"Volumes"**
3. Clicca **"Add Volume"**
4. Mount path: `/data`
5. Clicca **"Add"**

---

## Passo 6 — Imposta le variabili d'ambiente

Nel tuo servizio Railway → tab **"Variables"** → aggiungi:

| Variabile | Valore |
|-----------|--------|
| `DB_PATH` | `/data/data.db` |
| `NODE_ENV` | `production` |
| `PORT` | `8080` |

Clicca **"Deploy"** dopo aver salvato le variabili.

---

## Passo 7 — Ottieni il tuo URL

1. Tab **"Settings"** → sezione **"Networking"**
2. Clicca **"Generate Domain"**
3. Railway genera un URL tipo `magazzino-xyz.up.railway.app`

**Questo è il tuo URL privato.** Condividilo solo con i tuoi collaboratori.

---

## Passo 8 — Primo accesso

Apri il tuo URL nel browser e accedi con:

| Username | Password | Ruolo |
|----------|----------|-------|
| `admin` | `admin123` | Admin |
| `staff` | `staff123` | Staff |

**Cambia subito le password** dalla sezione Utenti dopo il primo accesso!

---

## Aggiornamenti futuri

Ogni volta che vuoi aggiornare l'app, fai push su GitHub:

```bash
git add .
git commit -m "aggiornamento"
git push
```

Railway rideploya in automatico in 2-3 minuti. I dati rimangono intatti.

---

## Accesso da iPad / iPhone

1. Apri Safari sul tuo iPad
2. Vai all'URL del gestionale
3. Tocca l'icona **Condividi** (quadrato con freccia)
4. **"Aggiungi alla schermata Home"**
5. Si apre come app a schermo intero, senza barra di Safari

---

## Sicurezza inclusa

- ✅ HTTPS automatico (connessione cifrata)
- ✅ Rate limiting sul login (max 20 tentativi per 15 minuti)
- ✅ URL non indovinabile
- ✅ Login obbligatorio per qualsiasi dato
- ✅ Ruoli admin/staff (lo staff non vede la gestione utenti)

---

## Costi

Railway piano Hobby: **$5/mese** di crediti gratuiti inclusi.
Un'app leggera come questa consuma circa **$0.50–1.00/mese**.
Con i crediti gratuiti, **non paghi nulla**.

Se superi i crediti (molto improbabile), Railway ti avvisa via email prima di addebitare qualcosa.
