#!/usr/bin/env bash
# Verifica os tipos da Edge Function com o Deno, numa cópia temporária
# (evita que o Deno use o package.json da raiz).
set -euo pipefail
cd "$(dirname "$0")/.."
TMP="$(mktemp -d)"; trap 'rm -rf "$TMP"' EXIT
cp -r supabase/functions "$TMP/"
echo '{}' > "$TMP/functions/deno.json"
(cd "$TMP/functions" && deno check gerar-mensagem/index.ts)
echo "✓ Edge Function: tipos verificados"
