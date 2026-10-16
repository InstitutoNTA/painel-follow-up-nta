#!/usr/bin/env bash
# Roda as migrations e os testes do banco num PostgreSQL local DESCARTÁVEL.
# Nunca aponte para o banco de produção: o script apaga e recria o banco.
# Uso: tests/sql/rodar.sh   (variáveis opcionais: PGHOST, PGPORT, PGUSER)
set -euo pipefail
cd "$(dirname "$0")/../.."

DB="painel_teste_$$"
PSQL=(psql -X -q -v ON_ERROR_STOP=1)

cleanup() { dropdb --if-exists "$DB" >/dev/null 2>&1 || true; }
trap cleanup EXIT

createdb "$DB"
"${PSQL[@]}" -d "$DB" -f tests/sql/00_supabase_stub.sql
for f in supabase/migrations/*.sql; do
  echo "→ aplicando $(basename "$f")"
  "${PSQL[@]}" -d "$DB" -f "$f"
done
echo "→ executando testes"
"${PSQL[@]}" -d "$DB" -f tests/sql/10_testes_rls.sql 2>&1 | sed -n 's/^.*NOTICE:  //p; /FALHOU/p; /ERROR/p'
echo "✓ banco: todos os testes passaram"
