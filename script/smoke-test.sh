#!/bin/bash
# Smoke test end-to-end del backend.
# Parte da uno stato pulito (admin/changeme + mustChangePassword), o da uno
# stato già configurato (pass via SMOKE_ADMIN_PASS).
#
# Uso:
#   ./script/smoke-test.sh                          # admin/changeme (primo avvio)
#   SMOKE_ADMIN_PASS=mia-pwd ./script/smoke-test.sh # se hai già cambiato pwd
set -u
BASE="${BASE:-http://localhost:3000}"
ADMIN_PASS_IN="${SMOKE_ADMIN_PASS:-changeme}"
PASS=0
FAIL=0

# ─── helpers ───────────────────────────────────────────────────────────────
green()  { printf "\033[32m%s\033[0m" "$1"; }
red()    { printf "\033[31m%s\033[0m" "$1"; }
yellow() { printf "\033[33m%s\033[0m" "$1"; }
dim()    { printf "\033[2m%s\033[0m" "$1"; }

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

req() {
  local method="$1" url="$2" body="${3:-}" uid="${4:-}"
  local args=( -s -o /tmp/sm_body -w '%{http_code}' -X "$method" "$BASE$url" )
  [ -n "$body" ] && args+=( -H "Content-Type: application/json" --data "$body" )
  [ -n "$uid" ] && args+=( -H "x-user-id: $uid" )
  STATUS=$(curl "${args[@]}")
  BODY=$(cat /tmp/sm_body)
}

json_get() {  # extract numeric field from BODY: json_get id
  echo "$BODY" | python3 -c "
import sys, json
try:
  d = json.load(sys.stdin)
  v = d.get('$1')
  print(v if v is not None else '')
except Exception:
  print('')
" 2>/dev/null
}

# ─── start ─────────────────────────────────────────────────────────────────
echo
echo "▶ Smoke test backend ($BASE)"
echo "  admin pass iniziale: $ADMIN_PASS_IN"
echo

# ── 1. health
echo "1) Health"
req GET /api/health
check "health" 200 "$STATUS"

# ── 2. login admin
echo
echo "2) Login admin"
req POST /api/auth/login "{\"username\":\"admin\",\"password\":\"$ADMIN_PASS_IN\"}"
check "admin ok" 200 "$STATUS"
ADMIN_ID=$(json_get id)
ADMIN_MUST=$(json_get mustChangePassword)

# Se è il primo accesso (mustChangePassword), imposto una pwd "smoketest-pwd"
TEST_PASS="smoketest-pwd"
if [ "$ADMIN_MUST" = "True" ] || [ "$ADMIN_MUST" = "true" ]; then
  req POST /api/auth/change-password "{\"newPassword\":\"$TEST_PASS\"}" "$ADMIN_ID"
  check "cambio pwd obbligatorio" 200 "$STATUS"
  ADMIN_PASS_IN="$TEST_PASS"
fi

req POST /api/auth/login '{"username":"admin","password":"wrong"}'
check "credenziali errate respinte" 401 "$STATUS"

# ── 3. crea categoria + prodotto temporanei per i test del foglio
echo
echo "3) Setup temporaneo (categoria + prodotto + staff)"
TS=$(date +%s)
req POST /api/categories \
  "{\"name\":\"_smoke-$TS\",\"section\":\"bevande\",\"macroCategory\":\"acqua\",\"icon\":\"🧪\",\"color\":\"#888888\",\"sortOrder\":999}" \
  "$ADMIN_ID"
check "POST categoria admin" 200 "$STATUS"
CAT_ID=$(json_get id)

req POST /api/products \
  "{\"categoryId\":$CAT_ID,\"name\":\"_smoke-prod-$TS\",\"unit\":\"pz\",\"unitSize\":\"\",\"packSize\":1,\"currentStock\":10,\"minStock\":2,\"idealStock\":20,\"location\":\"\",\"notes\":\"\",\"active\":true,\"brand\":\"\",\"supplier\":\"\"}" \
  "$ADMIN_ID"
check "POST prodotto admin" 200 "$STATUS"
PROD_ID=$(json_get id)

req POST /api/users \
  "{\"name\":\"_smoke-staff-$TS\",\"username\":\"smoke-staff-$TS\",\"password\":\"staff-test-pwd\",\"role\":\"staff\",\"color\":\"#3b82f6\",\"active\":true}" \
  "$ADMIN_ID"
check "POST utente staff" 200 "$STATUS"
STAFF_ID=$(json_get id)

# ── 4. login staff
echo
echo "4) Login staff"
req POST /api/auth/login "{\"username\":\"smoke-staff-$TS\",\"password\":\"staff-test-pwd\"}"
check "staff ok" 200 "$STATUS"
check "staff role" "staff" "$(json_get role)"

# ── 5. protezione admin-only
echo
echo "5) Protezione endpoint admin-only"
req POST /api/products '{"name":"x","categoryId":1}'
check "POST products senza auth → 401" 401 "$STATUS"
req POST /api/products '{"name":"hack","categoryId":1}' "$STAFF_ID"
check "POST products staff → 403" 403 "$STATUS"
req PUT  "/api/products/$PROD_ID" '{"name":"hack"}' "$STAFF_ID"
check "PUT products staff → 403" 403 "$STATUS"
req POST /api/categories '{"name":"x","section":"bevande"}' "$STAFF_ID"
check "POST categorie staff → 403" 403 "$STATUS"
req GET /api/products
check "GET products pubblico → 200" 200 "$STATUS"

# ── 6. foglio: movimento + undo
echo
echo "6) Foglio · movimento + undo"
req GET /api/sheet/current
check "GET sheet current" 200 "$STATUS"
req GET "/api/products/$PROD_ID"
STOCK_BEFORE=$(json_get currentStock)

req POST /api/sheet/movement "{\"productId\":$PROD_ID,\"type\":\"uscita\",\"quantity\":1}" "$STAFF_ID"
check "staff scarica 1" 200 "$STATUS"
MV_ID=$(echo "$BODY" | python3 -c "import sys,json;print(json.load(sys.stdin).get('movement',{}).get('id',''))" 2>/dev/null)

req GET "/api/products/$PROD_ID"
EXPECTED=$(awk "BEGIN{print $STOCK_BEFORE - 1}")
check "stock −1" "$EXPECTED" "$(json_get currentStock)"

req POST /api/sheet/movement/undo "{\"movementId\":$MV_ID}" "$STAFF_ID"
check "staff annulla movimento" 200 "$STATUS"
req GET "/api/products/$PROD_ID"
check "stock ripristinato" "$STOCK_BEFORE" "$(json_get currentStock)"

# ── 7. batch carico admin
echo
echo "7) Carico batch (admin)"
req POST /api/sheet/movements/batch \
  "{\"items\":[{\"productId\":$PROD_ID,\"type\":\"entrata\",\"quantity\":2}]}" "$ADMIN_ID"
check "batch ok" 200 "$STATUS"
BATCH_MOV=$(echo "$BODY" | python3 -c "
import sys, json
d = json.load(sys.stdin)
print(' '.join(str(m['id']) for m in d.get('movements',[])))
" 2>/dev/null)
req GET "/api/products/$PROD_ID"
EXP=$(awk "BEGIN{print $STOCK_BEFORE + 2}")
check "stock +2 dopo batch" "$EXP" "$(json_get currentStock)"

req POST /api/sheet/movements/batch '{"items":[]}' "$ADMIN_ID"
check "batch vuoto → 400" 400 "$STATUS"
req POST /api/sheet/movements/batch \
  "{\"items\":[{\"productId\":$PROD_ID,\"type\":\"ciao\",\"quantity\":1}]}" "$ADMIN_ID"
check "batch tipo invalido → 400" 400 "$STATUS"

# ── 8. edit inline (PUT)
echo
echo "8) Edit inline prodotto (admin)"
req PUT "/api/products/$PROD_ID" '{"minStock":99}' "$ADMIN_ID"
check "PUT minStock admin" 200 "$STATUS"
check "minStock aggiornato" "99" "$(json_get minStock)"

# ── 9. password
echo
echo "9) Cambio password"
req POST /api/auth/change-password \
  "{\"currentPassword\":\"$ADMIN_PASS_IN\",\"newPassword\":\"$ADMIN_PASS_IN-v2\"}" "$ADMIN_ID"
check "cambio pwd con current ok" 200 "$STATUS"
# Ripristino
req POST /api/auth/change-password \
  "{\"currentPassword\":\"$ADMIN_PASS_IN-v2\",\"newPassword\":\"$ADMIN_PASS_IN\"}" "$ADMIN_ID"
check "ripristino pwd" 200 "$STATUS"
req POST /api/auth/change-password \
  "{\"currentPassword\":\"sbagliata\",\"newPassword\":\"validissima-123\"}" "$ADMIN_ID"
check "current errata → 401" 401 "$STATUS"
req POST /api/auth/change-password '{"newPassword":"abc"}' "$ADMIN_ID"
check "pwd troppo corta → 400" 400 "$STATUS"

# ── 10. cleanup
echo
echo "10) Cleanup"
for mid in $BATCH_MOV; do
  req POST /api/sheet/movement/undo "{\"movementId\":$mid}" "$ADMIN_ID"
  check "undo mov $mid" 200 "$STATUS"
done
req DELETE "/api/users/$STAFF_ID" '' "$ADMIN_ID"
check "delete staff temp" 200 "$STATUS"
req DELETE "/api/products/$PROD_ID" '' "$ADMIN_ID"
check "delete prodotto temp" 200 "$STATUS"
req DELETE "/api/categories/$CAT_ID" '' "$ADMIN_ID"
check "delete categoria temp" 200 "$STATUS"

# ── summary ────────────────────────────────────────────────────────────────
echo
echo "─────────────────────────────────────"
printf "Risultato: %s · %s\n" \
  "$(green "$PASS passati")" \
  "$([ "$FAIL" = 0 ] && green "0 falliti" || red "$FAIL falliti")"
echo "─────────────────────────────────────"
[ "$FAIL" -eq 0 ] && exit 0 || exit 1
