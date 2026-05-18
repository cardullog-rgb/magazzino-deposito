#!/bin/bash
# Smoke test end-to-end del backend.
# Usa: ./script/smoke-test.sh   (dev server deve girare su :3000)
set -u
BASE="${BASE:-http://localhost:3000}"
PASS=0
FAIL=0
RESULTS=()

# ─── helpers ───────────────────────────────────────────────────────────────
green()   { printf "\033[32m%s\033[0m" "$1"; }
red()     { printf "\033[31m%s\033[0m" "$1"; }
yellow()  { printf "\033[33m%s\033[0m" "$1"; }
dim()     { printf "\033[2m%s\033[0m" "$1"; }

# check NAME EXPECTED ACTUAL [DETAIL]
check() {
  local name="$1" expected="$2" actual="$3" detail="${4:-}"
  if [ "$expected" = "$actual" ]; then
    PASS=$((PASS+1))
    printf "  %s %s %s\n" "$(green ✓)" "$name" "$(dim "→ $actual")"
  else
    FAIL=$((FAIL+1))
    printf "  %s %s %s %s\n" "$(red ✗)" "$name" "$(yellow "atteso=$expected got=$actual")" "$(dim "$detail")"
  fi
}

req() {  # METHOD URL [BODY] [USERID] → echo "STATUS\n BODY"
  local method="$1" url="$2" body="${3:-}" uid="${4:-}"
  local args=( -s -o /tmp/sm_body -w '%{http_code}' -X "$method" "$BASE$url" )
  [ -n "$body" ] && args+=( -H "Content-Type: application/json" --data "$body" )
  [ -n "$uid" ] && args+=( -H "x-user-id: $uid" )
  STATUS=$(curl "${args[@]}")
  BODY=$(cat /tmp/sm_body)
}

# ─── start ─────────────────────────────────────────────────────────────────
echo
echo "▶ Smoke test backend ($BASE)"
echo

# ── 1. health
echo "1) Health"
req GET /api/health
check "health" 200 "$STATUS"

# ── 2. login
echo
echo "2) Login & ruoli"
req POST /api/auth/login '{"username":"admin","password":"admin123"}'
check "admin ok" 200 "$STATUS"
ADMIN_ID=$(echo "$BODY" | sed -n 's/.*"id":\([0-9]*\).*/\1/p')
ADMIN_ROLE=$(echo "$BODY" | sed -n 's/.*"role":"\([^"]*\)".*/\1/p')
check "admin role"  "admin" "$ADMIN_ROLE"

req POST /api/auth/login '{"username":"staff","password":"staff123"}'
check "staff ok" 200 "$STATUS"
STAFF_ID=$(echo "$BODY" | sed -n 's/.*"id":\([0-9]*\).*/\1/p')
STAFF_ROLE=$(echo "$BODY" | sed -n 's/.*"role":"\([^"]*\)".*/\1/p')
check "staff role" "staff" "$STAFF_ROLE"

req POST /api/auth/login '{"username":"admin","password":"wrong"}'
check "credenziali errate respinte" 401 "$STATUS"

# ── 3. protezione ruoli
echo
echo "3) Protezione endpoint admin-only"

# Senza auth: 401
req POST /api/products '{"name":"x","categoryId":1}'
check "POST products senza auth → 401" 401 "$STATUS"

# Con staff: 403
req POST /api/products '{"name":"hack","categoryId":1}' "$STAFF_ID"
check "POST products come staff → 403" 403 "$STATUS"

req PUT /api/products/1 '{"name":"hack"}' "$STAFF_ID"
check "PUT products come staff → 403" 403 "$STATUS"

# Con admin: ok
req GET /api/products
check "GET products pubblico → 200" 200 "$STATUS"

# ── 4. foglio aperto e movimento+undo
echo
echo "4) Foglio · movimento + undo"
req GET /api/sheet/current
check "GET sheet current" 200 "$STATUS"
SHEET_ID=$(echo "$BODY" | sed -n 's/.*"sheet":{"id":\([0-9]*\).*/\1/p')

# Stock iniziale prodotto 1
req GET /api/products/1
STOCK_BEFORE=$(echo "$BODY" | sed -n 's/.*"currentStock":\([0-9.]*\).*/\1/p')

# Staff fa scarico di 1
req POST /api/sheet/movement '{"productId":1,"type":"uscita","quantity":1}' "$STAFF_ID"
check "staff scarica 1" 200 "$STATUS"
MV_ID=$(echo "$BODY" | sed -n 's/.*"movement":{"id":\([0-9]*\).*/\1/p')

req GET /api/products/1
STOCK_AFTER=$(echo "$BODY" | sed -n 's/.*"currentStock":\([0-9.]*\).*/\1/p')
EXPECTED=$(awk "BEGIN{print $STOCK_BEFORE - 1}")
check "stock decrementato di 1" "$EXPECTED" "$STOCK_AFTER" "before=$STOCK_BEFORE"

# Admin NON può fare undo del movimento di staff senza allowAnyUser? Sì, admin sempre può.
# Test: staff annulla il proprio
req POST /api/sheet/movement/undo "{\"movementId\":$MV_ID}" "$STAFF_ID"
check "staff annulla movimento" 200 "$STATUS"

req GET /api/products/1
STOCK_RESTORED=$(echo "$BODY" | sed -n 's/.*"currentStock":\([0-9.]*\).*/\1/p')
check "stock ripristinato" "$STOCK_BEFORE" "$STOCK_RESTORED"

# Movimento di staff + undo da altro utente staff → 403/400 (no perm)
# Per testarlo serve un altro staff. Salto.

# ── 5. batch carico admin
echo
echo "5) Carico batch (admin)"
req POST /api/sheet/movements/batch \
  '{"items":[{"productId":1,"type":"entrata","quantity":2},{"productId":2,"type":"entrata","quantity":1}]}' "$ADMIN_ID"
check "batch ok" 200 "$STATUS"
# Salvo gli id dei movimenti del batch per cleanup
BATCH_IDS=$(echo "$BODY" | python3 -c '
import sys, json
data = json.load(sys.stdin)
print(" ".join(str(m["id"]) for m in data.get("movements", [])))
' 2>/dev/null)

req GET /api/products/1
S1=$(echo "$BODY" | sed -n 's/.*"currentStock":\([0-9.]*\).*/\1/p')
EXP1=$(awk "BEGIN{print $STOCK_BEFORE + 2}")
check "stock +2 dopo batch" "$EXP1" "$S1"

# Batch malformato
req POST /api/sheet/movements/batch '{"items":[]}' "$ADMIN_ID"
check "batch vuoto → 400" 400 "$STATUS"

req POST /api/sheet/movements/batch '{"items":[{"productId":1,"type":"ciao","quantity":1}]}' "$ADMIN_ID"
check "batch tipo invalido → 400" 400 "$STATUS"

# ── 6. PUT product (inline edit) admin
echo
echo "6) Edit inline prodotto (admin)"
req PUT /api/products/1 '{"minStock":99}' "$ADMIN_ID"
check "PUT minStock admin" 200 "$STATUS"
NEW_MIN=$(echo "$BODY" | sed -n 's/.*"minStock":\([0-9.]*\).*/\1/p')
check "minStock aggiornato" "99" "$NEW_MIN"

# Ripristino
req PUT /api/products/1 '{"minStock":4}' "$ADMIN_ID" > /dev/null

# ── 7. conta fisica
echo
echo "7) Conta fisica"
# Catturo i valori "veri" prima del test
PRE_COUNT_JSON=$(curl -s "$BASE/api/sheet/current")
req POST /api/sheet/count '{"productId":1,"count":7}' "$STAFF_ID"
check "staff registra conta" 200 "$STATUS"

# ── 8. macro acqua
echo
echo "8) Macro categories"
req GET /api/categories
ACQUA_MACRO=$(echo "$BODY" | python3 -c '
import sys, json
data = json.load(sys.stdin)
for c in data:
  if c["name"] == "Acqua":
    print(c["macroCategory"]); break
' 2>/dev/null)
check "Acqua → macro 'acqua'" "acqua" "$ACQUA_MACRO"

# ── 9. CRUD categoria come staff → 403
echo
echo "9) Categorie admin-only"
req POST /api/categories '{"name":"x","section":"bevande"}' "$STAFF_ID"
check "POST categorie come staff → 403" 403 "$STATUS"

# ── cleanup ────────────────────────────────────────────────────────────────
# Lo script deve essere idempotente: annulla i movimenti creati e ripristina
# la conta fisica. Non resta nulla nel foglio reale.
echo
echo "10) Cleanup (auto-reset stato)"
for mid in $BATCH_IDS; do
  req POST /api/sheet/movement/undo "{\"movementId\":$mid}" "$ADMIN_ID"
  check "undo mov $mid" 200 "$STATUS"
done
# Resetta la conta fisica registrata (non c'è endpoint, lo segnalo soltanto)
printf "  %s reset conta fisica → richiede SQL manuale se serve\n" "$(yellow ⚠)"

# ── summary ────────────────────────────────────────────────────────────────
echo
echo "─────────────────────────────────────"
printf "Risultato: %s / %s\n" "$(green "$PASS passati")" "$([ "$FAIL" = 0 ] && green "0 falliti" || red "$FAIL falliti")"
echo "─────────────────────────────────────"
[ "$FAIL" -eq 0 ] && exit 0 || exit 1
