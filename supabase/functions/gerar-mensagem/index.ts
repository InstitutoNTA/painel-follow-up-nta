// =====================================================================
// Edge Function: gerar-mensagem
// Recebe { aluno_id, tom?, instrucao?, modo: "diaria" | "manual" } do
// navegador, confere o usuário logado e gera a mensagem com a API do
// Claude. A chave da API fica SOMENTE nos segredos do Supabase.
//
// Segredos/variáveis (Supabase → Edge Functions → Secrets):
//   ANTHROPIC_API_KEY  (obrigatório para gerar)
//   ANTHROPIC_MODEL    (opcional; padrão definido em _shared/gerar.js)
//   ALLOWED_ORIGINS    (opcional; ex.: https://institutonta.github.io)
//   SUPABASE_URL, SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY
//                      (fornecidas automaticamente pelo Supabase)
// =====================================================================
import { createClient } from "npm:@supabase/supabase-js@2.117.3";
import { gerarMensagem, validarPedido, AVISOS } from "../_shared/gerar.js";

const origensPermitidas = (Deno.env.get("ALLOWED_ORIGINS") || "")
  .split(",").map((s) => s.trim()).filter(Boolean);

function cabecalhos(origem: string | null) {
  const permitida = origem && (origensPermitidas.length === 0 || origensPermitidas.includes(origem));
  return {
    "Access-Control-Allow-Origin": permitida ? origem! : (origensPermitidas[0] || "null"),
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Vary": "Origin",
    "Content-Type": "application/json; charset=utf-8",
  };
}

const responder = (corpo: unknown, status: number, origem: string | null) =>
  new Response(JSON.stringify(corpo), { status, headers: cabecalhos(origem) });

Deno.serve(async (req) => {
  const origem = req.headers.get("origin");
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: cabecalhos(origem) });
  if (req.method !== "POST") return responder({ status: "invalido", aviso: AVISOS.invalido }, 405, origem);
  if (origem && origensPermitidas.length > 0 && !origensPermitidas.includes(origem)) {
    return responder({ status: "sem_permissao", aviso: AVISOS.sem_permissao }, 403, origem);
  }

  const url = Deno.env.get("SUPABASE_URL")!;
  const anon = Deno.env.get("SUPABASE_ANON_KEY")!;
  const servico = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

  // 1) Quem está chamando? (token do Supabase Auth enviado pelo navegador)
  const token = (req.headers.get("authorization") || "").replace(/^Bearer\s+/i, "");
  if (!token) return responder({ status: "sem_permissao", aviso: AVISOS.sem_permissao }, 401, origem);
  const clienteUsuario = createClient(url, anon, { auth: { persistSession: false } });
  const { data: dadosUsuario, error: erroUsuario } = await clienteUsuario.auth.getUser(token);
  if (erroUsuario || !dadosUsuario?.user) {
    return responder({ status: "sem_permissao", aviso: "Sua sessão expirou. Entre novamente." }, 401, origem);
  }

  // 2) Pedido válido?
  let corpo: unknown;
  try { corpo = await req.json(); } catch { corpo = null; }
  const pedido = validarPedido(corpo);
  if ("erro" in pedido) return responder({ status: "invalido", aviso: AVISOS.invalido }, 400, origem);

  // 3) Operações no banco com a chave de serviço (nunca enviada ao navegador)
  const admin = createClient(url, servico, { auth: { persistSession: false } });
  const rpc = async (fn: string, args: Record<string, unknown>) => {
    const { data, error } = await admin.rpc(fn, args);
    if (error) {
      console.error(`rpc ${fn} falhou: ${error.code ?? ""}`);   // sem dados pessoais nos logs
      throw Object.assign(new Error("Falha ao acessar o banco."), { codigo: "ia_indisponivel" });
    }
    return data;
  };

  try {
    const resultado = await gerarMensagem({
      rpc,
      fetch,
      chave: Deno.env.get("ANTHROPIC_API_KEY"),
      modelo: Deno.env.get("ANTHROPIC_MODEL"),
      usuarioId: dadosUsuario.user.id,
      pedido,
    });
    const http = resultado.status === "concluida" ? 200
      : resultado.status === "sem_permissao" ? 403
      : resultado.status === "limite" ? 429
      : resultado.status === "nao_encontrado" ? 404
      : resultado.status === "ia_nao_configurada" || resultado.status === "ia_indisponivel" ? 503
      : 409;
    return responder(resultado, http, origem);
  } catch (_e) {
    console.error("gerar-mensagem: falha inesperada");
    return responder({ status: "ia_indisponivel", aviso: AVISOS.ia_indisponivel }, 503, origem);
  }
});
