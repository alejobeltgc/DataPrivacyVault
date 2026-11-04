#!/usr/bin/env bash
# Ejecuta en orden los curl del proyecto y guarda cada request y respuesta en evidencias/resultados.md.
# Requisito: el servicio corriendo (npm start). Uso: bash evidencias/run-tests.sh
set -euo pipefail

BASE_URL="${BASE_URL:-http://localhost:3001}"
OUT="$(cd "$(dirname "$0")" && pwd)/resultados.md"

# Datos de ejemplo inventados (los mismos del README).
ORIGINAL='oferta de trabajo para Carlos Mendoza con email cmendoza@example.com y teléfono 3001234567'
PII=('Carlos' 'Mendoza' 'cmendoza@example.com' '3001234567')

# El servicio tiene que estar arriba: cualquier respuesta HTTP sirve (aunque sea un 400).
if ! curl -s -o /dev/null -m 5 -X POST "$BASE_URL/anonymize" -H 'Content-Type: application/json' -d '{}'; then
  echo "No hay servicio en $BASE_URL. Levántalo con: npm start" >&2
  exit 1
fi

# Formatea JSON para leerlo mejor; si no es JSON, lo deja tal cual.
pretty() { node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{try{console.log(JSON.stringify(JSON.parse(s),null,2))}catch{console.log(s)}})'; }

# Lee un campo de un JSON (string vacío si no existe).
field() { node -e 'try{console.log(JSON.parse(process.argv[1])[process.argv[2]] ?? "")}catch{console.log("")}' "$1" "$2"; }

STEP=0
# Llama a POST $1 con el body $2, documenta request y respuesta, y deja el body en $BODY y el código en $CODE.
call() {
  local path="$1" body="$2" raw
  STEP=$((STEP + 1))
  raw="$(curl -s -X POST "$BASE_URL$path" -H 'Content-Type: application/json' -d "$body" -w $'\n%{http_code}')"
  CODE="${raw##*$'\n'}"
  BODY="${raw%$'\n'*}"
  {
    printf '\n### %d. POST %s\n\n**Request**\n\n```bash\n' "$STEP" "$path"
    printf "curl -X POST %s%s -H \"Content-Type: application/json\" -d '%s'\n" "$BASE_URL" "$path" "$body"
    printf '```\n\n**Response** (HTTP %s)\n\n```json\n%s\n```\n\n' "$CODE" "$(printf '%s' "$BODY" | pretty)"
  } >> "$OUT"
}

# Registra una comprobación ✔/✖ en el informe y en la consola; cuenta las fallidas para el código de salida.
FAILED=0
check() {
  local label="$1" ok="$2" mark='✔'
  if [ "$ok" != true ]; then mark='✖'; FAILED=$((FAILED + 1)); fi
  printf -- '- %s %s\n' "$mark" "$label" >> "$OUT"
  echo "$mark $label"
}

# ¿$1 contiene el texto $2? (sin `case` dentro de $(...): bash 3.2 de macOS no lo interpreta bien)
contains() { [[ "$1" == *"$2"* ]]; }
contains_pii() { local p; for p in "${PII[@]}"; do contains "$1" "$p" && return 0; done; return 1; }

{
  echo '# Evidencias de PrivacyVault'
  echo
  echo "- Fecha: $(date '+%Y-%m-%d %H:%M:%S %Z')"
  echo "- Servicio: $BASE_URL"
  echo '- Generado por: `evidencias/run-tests.sh`'
} > "$OUT"

# 1. Anonymize
{ echo; echo '## 1. Anonymize'; } >> "$OUT"
call /anonymize "{\"message\":\"$ORIGINAL\"}"
ANON="$(field "$BODY" anonymizedMessage)"
check 'Responde 200' "$([ "$CODE" = 200 ] && echo true || echo false)"
check 'La respuesta no contiene PII' "$(contains_pii "$ANON" && echo false || echo true)"

# 2. Deanonymize
{ echo; echo '## 2. Deanonymize'; } >> "$OUT"
call /deanonymize "{\"anonymizedMessage\":\"$ANON\"}"
check 'Devuelve el mensaje original exacto' "$([ "$(field "$BODY" message)" = "$ORIGINAL" ] && echo true || echo false)"
call /deanonymize '{"anonymizedMessage":"hola NAME_000000000000"}'
check 'Un token que no existe responde 404 con error claro' "$([ "$CODE" = 404 ] && echo true || echo false)"

# 3. Ciclo completo: anonymize -> deanonymize encadenados, usando la respuesta tal cual
{ echo; echo '## 3. Ciclo completo (anonymize → deanonymize)'; } >> "$OUT"
call /anonymize "{\"message\":\"$ORIGINAL\"}"
CYCLE_ANON="$BODY"
check 'El token es determinista (mismo resultado que en el paso 1)' "$([ "$(field "$CYCLE_ANON" anonymizedMessage)" = "$ANON" ] && echo true || echo false)"
call /deanonymize "$CYCLE_ANON"
check 'El ciclo devuelve el mensaje original exacto' "$([ "$(field "$BODY" message)" = "$ORIGINAL" ] && echo true || echo false)"

# 4. secureChatGPT
{ echo; echo '## 4. secureChatGPT'; } >> "$OUT"
call /secureChatGPT '{"prompt":"Redacta un correo corto para Carlos Mendoza (cmendoza@example.com, teléfono 3001234567) invitándolo a una entrevista de trabajo el lunes."}'
SENT="$(field "$BODY" anonymizedPrompt)"
RESPONSE="$(field "$BODY" response)"
check 'Responde 200' "$([ "$CODE" = 200 ] && echo true || echo false)"
check 'Lo enviado a OpenAI (anonymizedPrompt) no contiene PII' "$( [ -n "$SENT" ] && ! contains_pii "$SENT" && echo true || echo false)"
check 'La respuesta final contiene el nombre real' "$(contains "$RESPONSE" 'Carlos Mendoza' && echo true || echo false)"

echo; echo "Resultados guardados en $OUT"
if [ "$FAILED" -gt 0 ]; then
  echo "$FAILED comprobación(es) fallaron" >&2
  exit 1
fi
