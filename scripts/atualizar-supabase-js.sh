#!/usr/bin/env bash
# Atualiza a cópia local da biblioteca do Supabase usada pelo navegador.
# A biblioteca fica no próprio repositório (sem CDN): menos dependência
# externa e a política de segurança do site só permite scripts do próprio site.
# Uso: scripts/atualizar-supabase-js.sh 2.117.3
set -euo pipefail
VERSAO="${1:?informe a versão, ex.: 2.117.3}"
cd "$(dirname "$0")/.."
TMP="$(mktemp -d)"; trap 'rm -rf "$TMP"' EXIT
(cd "$TMP" && npm init -y >/dev/null && npm i --silent "@supabase/supabase-js@$VERSAO" esbuild@0.25 \
  && echo 'export { createClient } from "@supabase/supabase-js";' > entrada.js \
  && npx esbuild entrada.js --bundle --format=esm --minify --platform=browser --target=es2020 --legal-comments=eof --outfile=saida.js)
{ echo "/*! @supabase/supabase-js $VERSAO — empacotado localmente com esbuild (ver scripts/atualizar-supabase-js.sh). Licença MIT. */"
  cat "$TMP/saida.js"; } > assets/vendor/supabase-js.esm.js
echo "✓ assets/vendor/supabase-js.esm.js atualizado para $VERSAO"
