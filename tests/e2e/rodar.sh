#!/usr/bin/env bash
# =====================================================================
# Teste ponta a ponta LOCAL: PostgreSQL + Supabase Auth + PostgREST +
# Edge Function (Deno) + site, operado por um navegador real (Playwright).
# Usa banco descartável e somente dados fictícios. Nada é publicado.
# Pré-requisitos: PostgreSQL 16 local (superusuário), Node 20+, Deno 2,
# Playwright com Chromium. Os binários do Auth e do PostgREST são baixados
# do GitHub na primeira execução (pasta tests/e2e/.bin, ignorada pelo Git).
# =====================================================================
set -euo pipefail
cd "$(dirname "$0")/../.."
RAIZ="$PWD"
BIN="$RAIZ/tests/e2e/.bin"; mkdir -p "$BIN"
TMP="$(mktemp -d)"; DB="painel_e2e_$$"
SEGREDO="segredo-jwt-de-teste-local-com-32-caracteres-ou-mais"

# ---------- binários ----------
if [ ! -x "$BIN/postgrest" ]; then
  curl -sSL https://github.com/PostgREST/postgrest/releases/download/v12.2.3/postgrest-v12.2.3-linux-static-x64.tar.xz | tar -xJ -C "$BIN"
fi
if [ ! -x "$BIN/auth" ]; then
  curl -sSL https://github.com/supabase/auth/releases/download/v2.197.0/auth-v2.197.0-x86.tar.gz | tar -xz -C "$BIN"
fi

# ---------- tokens (JWT HS256) ----------
jwt() { node -e '
  const c=require("crypto"),b=(o)=>Buffer.from(JSON.stringify(o)).toString("base64url");
  const h=b({alg:"HS256",typ:"JWT"}),p=b({role:process.argv[1],iss:"supabase",iat:1700000000,exp:2100000000});
  console.log(h+"."+p+"."+c.createHmac("sha256",process.argv[2]).update(h+"."+p).digest("base64url"));' "$1" "$SEGREDO"; }
ANON="$(jwt anon)"; SERVICO="$(jwt service_role)"

PIDS=()
encerrar() { for p in "${PIDS[@]:-}"; do kill "$p" 2>/dev/null || true; done; dropdb --if-exists "$DB" >/dev/null 2>&1 || true; rm -rf "$TMP"; }
trap encerrar EXIT
esperar() { for _ in $(seq 1 60); do curl -s -o /dev/null "$1" && return 0; sleep 0.5; done; echo "✗ não subiu: $1"; cat "$TMP"/*.log | tail -40; exit 1; }

# ---------- banco ----------
createdb "$DB"
psql -X -q -v ON_ERROR_STOP=1 -d "$DB" <<'SQL'
do $$ begin
  if not exists (select 1 from pg_roles where rolname='anon') then create role anon nologin; end if;
  if not exists (select 1 from pg_roles where rolname='authenticated') then create role authenticated nologin; end if;
  if not exists (select 1 from pg_roles where rolname='service_role') then create role service_role nologin bypassrls; end if;
  if not exists (select 1 from pg_roles where rolname='authenticator') then create role authenticator login noinherit password 'teste'; end if;
  if not exists (select 1 from pg_roles where rolname='supabase_auth_admin') then create role supabase_auth_admin login createrole password 'teste'; end if;
end $$;
grant anon, authenticated, service_role to authenticator;
create schema if not exists auth authorization supabase_auth_admin;
create schema if not exists extensions;
grant usage on schema auth, extensions, public to anon, authenticated, service_role;
alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
SQL
psql -X -q -d "$DB" -c "grant create on database $DB to supabase_auth_admin; alter role supabase_auth_admin set search_path = auth"

# ---------- Supabase Auth ----------
env GOTRUE_DB_DRIVER=postgres DATABASE_URL="postgres://supabase_auth_admin:teste@localhost:5432/$DB?sslmode=disable" \
  GOTRUE_SITE_URL=http://localhost:8080 API_EXTERNAL_URL=http://localhost:54321/auth/v1 GOTRUE_API_HOST=127.0.0.1 PORT=9999 \
  GOTRUE_JWT_SECRET="$SEGREDO" GOTRUE_JWT_AUD=authenticated GOTRUE_JWT_DEFAULT_GROUP_NAME=authenticated \
  GOTRUE_JWT_ADMIN_ROLES=service_role GOTRUE_DISABLE_SIGNUP=true GOTRUE_EXTERNAL_EMAIL_ENABLED=true \
  GOTRUE_MAILER_AUTOCONFIRM=true GOTRUE_RATE_LIMIT_EMAIL_SENT=1000 GOTRUE_LOG_LEVEL=warn GOTRUE_JWT_EXP=604800 \
  bash -c "cd \"$BIN\" && ./auth migrate && exec ./auth serve" >"$TMP/auth.log" 2>&1 & PIDS+=($!)
esperar http://127.0.0.1:9999/health
for _ in $(seq 1 60); do [ "$(psql -X -qAt -d "$DB" -c "select to_regclass('auth.users') is not null")" = t ] && break; sleep 0.5; done
[ "$(psql -X -qAt -d "$DB" -c "select to_regclass('auth.users') is not null")" = t ] || { echo "✗ Auth não criou as tabelas"; tail -30 "$TMP/auth.log"; exit 1; }
psql -X -q -d "$DB" -c "grant usage on schema auth to postgres; grant select on auth.users to postgres" >/dev/null 2>&1 || true

# ---------- relógio do teste: dia útil mais recente, 10h em Brasília ----------
AGORA_TESTE="$(node -e '
  const f=(d)=>new Intl.DateTimeFormat("en-CA",{timeZone:"America/Sao_Paulo"}).format(d);
  let d=new Date(); for(;;){ const dia=new Date(f(d)+"T12:00:00Z").getUTCDay(); if(dia>=1&&dia<=5) break; d=new Date(d-864e5); }
  console.log(f(d)+"T10:00:00-03:00");')"
psql -X -q -d "$DB" -c "alter database $DB set painel.agora_teste = '$AGORA_TESTE'"
echo "relógio do teste: $AGORA_TESTE"

# ---------- migrations do projeto ----------
for f in supabase/migrations/*.sql; do psql -X -q -v ON_ERROR_STOP=1 -d "$DB" -f "$f"; done

# ---------- PostgREST ----------
cat >"$TMP/pgrst.conf" <<EOF
db-uri = "postgres://authenticator:teste@localhost:5432/$DB"
db-schemas = "public"
db-anon-role = "anon"
jwt-secret = "$SEGREDO"
server-port = 3000
server-host = "127.0.0.1"
EOF
"$BIN/postgrest" "$TMP/pgrst.conf" >"$TMP/rest.log" 2>&1 & PIDS+=($!)
esperar http://127.0.0.1:3000/

# ---------- Edge Function (Deno) ----------
cp -r supabase/functions "$TMP/functions"; echo '{}' > "$TMP/functions/deno.json"
(cd "$TMP/functions" && env SUPABASE_URL=http://localhost:54321 SUPABASE_ANON_KEY="$ANON" SUPABASE_SERVICE_ROLE_KEY="$SERVICO" \
  ANTHROPIC_API_KEY=chave-falsa-de-teste ANTHROPIC_BASE_URL=http://127.0.0.1:8787 \
  deno run --allow-net --allow-env --allow-read gerar-mensagem/index.ts >"$TMP/funcao.log" 2>&1) & PIDS+=($!)

# ---------- gateway, site e dublê da IA ----------
E2E_MODO="${E2E_MODO:-ia}" E2E_ANON_KEY="$ANON" E2E_LOG_IA="$TMP/ia.log" node tests/e2e/servidor.mjs >"$TMP/site.log" 2>&1 & PIDS+=($!)
esperar http://127.0.0.1:8080/
for _ in $(seq 1 60); do curl -s -o /dev/null -X OPTIONS http://127.0.0.1:8000/ && break; sleep 0.5; done

# ---------- usuários de teste ----------
criar() { curl -sS -X POST http://localhost:54321/auth/v1/admin/users -H "apikey: $SERVICO" -H "authorization: Bearer $SERVICO" \
  -H "content-type: application/json" -d "{\"email\":\"$1\",\"password\":\"$2\",\"email_confirm\":true}" | node -pe 'JSON.parse(require("fs").readFileSync(0)).id'; }
ID_ADMIN="$(criar admin.teste@exemplo.invalid senha-admin-teste-123)"
ID_CLARA="$(criar operadora.teste@exemplo.invalid senha-operadora-teste-123)"
criar visitante.teste@exemplo.invalid senha-visitante-teste-123 >/dev/null
psql -X -q -d "$DB" -c "update public.perfis set papel='admin', ativo=true, nome='Admin Teste' where id='$ID_ADMIN';
                       update public.perfis set ativo=true, nome='Operadora Teste' where id='$ID_CLARA';"

# ---------- navegador ----------
E2E_AGORA="$AGORA_TESTE" E2E_ANON_KEY="$ANON" E2E_DB="$DB" E2E_LOG_IA="$TMP/ia.log" E2E_SAIDA="${E2E_SAIDA:-$RAIZ/tests/e2e/.saida}" \
  node "tests/e2e/${E2E_FLUXO:-fluxo.mjs}"
