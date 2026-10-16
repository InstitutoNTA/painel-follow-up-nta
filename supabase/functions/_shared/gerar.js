// =====================================================================
// Núcleo da geração de mensagens (usado pela Edge Function).
// Sem dependências do Deno: recebe "rpc" e "fetch" por parâmetro, o que
// permite testar com Node sem chamar serviços reais.
// =====================================================================
import { TONS, tomSugerido } from "./regras.js";
import { montarPrompt, limparTexto } from "./prompt.js";

export const MODELO_PADRAO = "claude-sonnet-5-5";
const URL_API_PADRAO = "https://api.anthropic.com";
const TEMPO_LIMITE_MS = 45_000;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Mensagens mostradas à equipe (sem detalhes técnicos ou segredos)
export const AVISOS = {
  ia_nao_configurada: "A geração de mensagens ainda não foi configurada no servidor. Os dados estão salvos; tente de novo depois da configuração.",
  ia_indisponivel: "O serviço de IA não respondeu agora. Os dados estão salvos; tente de novo em alguns minutos.",
  fim_de_semana: "As mensagens são geradas somente de segunda a sexta-feira.",
  concluido: "Este aluno já concluiu todas as pendências e não recebe novas mensagens.",
  sem_pendencias: "Marque ao menos uma pendência em aberto para gerar a mensagem.",
  em_andamento: "Já existe uma mensagem sendo gerada para este aluno. Aguarde alguns segundos.",
  ja_existe: "A mensagem de hoje deste aluno já está pronta.",
  limite: "Muitas mensagens geradas em pouco tempo. Aguarde alguns minutos e tente de novo.",
  sem_permissao: "Seu usuário não tem permissão para gerar mensagens.",
  nao_encontrado: "Aluno não encontrado.",
  invalido: "Pedido inválido.",
};

/** Valida o corpo do pedido vindo do navegador. */
export function validarPedido(corpo) {
  if (!corpo || typeof corpo !== "object") return { erro: "invalido" };
  const { aluno_id, tom, instrucao, modo } = corpo;
  if (typeof aluno_id !== "string" || !UUID.test(aluno_id)) return { erro: "invalido" };
  if (tom != null && !TONS.includes(tom)) return { erro: "invalido" };
  if (instrucao != null && (typeof instrucao !== "string" || instrucao.length > 1000)) return { erro: "invalido" };
  if (!["diaria", "manual"].includes(modo)) return { erro: "invalido" };
  return { aluno_id, tom: tom || null, instrucao: (instrucao || "").trim(), modo };
}

/** Chama a API do Claude e devolve o texto. Lança erro com .codigo seguro. */
export async function chamarClaude({ fetch, chave, modelo, sistema, usuario, urlBase = URL_API_PADRAO }) {
  const controle = new AbortController();
  const timer = setTimeout(() => controle.abort(), TEMPO_LIMITE_MS);
  let resp;
  try {
    resp = await fetch(`${String(urlBase).replace(/\/+$/, "")}/v1/messages`, {
      method: "POST",
      signal: controle.signal,
      headers: {
        "content-type": "application/json",
        "x-api-key": chave,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: modelo,
        max_tokens: 700,
        system: sistema,
        messages: [{ role: "user", content: usuario }],
      }),
    });
  } catch (e) {
    const erro = new Error(e?.name === "AbortError" ? "Tempo esgotado ao chamar a IA." : "Falha de rede ao chamar a IA.");
    erro.codigo = "ia_indisponivel";
    throw erro;
  } finally {
    clearTimeout(timer);
  }
  if (!resp.ok) {
    const erro = new Error(`A IA recusou o pedido (HTTP ${resp.status}).`);
    erro.codigo = resp.status === 401 || resp.status === 403 ? "ia_nao_configurada" : "ia_indisponivel";
    throw erro;
  }
  const dados = await resp.json();
  const texto = (dados.content || []).filter((b) => b.type === "text").map((b) => b.text).join("\n");
  if (dados.stop_reason === "refusal" || !texto.trim()) {
    const erro = new Error("A IA não escreveu a mensagem. Ajuste a instrução ou as observações e tente de novo.");
    erro.codigo = "ia_indisponivel";
    throw erro;
  }
  return { texto: limparTexto(texto), modelo: dados.model || modelo };
}

/**
 * Fluxo completo de uma geração.
 * @param {object} p
 * @param {(fn: string, args: Record<string, unknown>) => Promise<any>} p.rpc  chamada ao banco com service_role
 * @param {typeof fetch} p.fetch
 * @param {string|undefined} p.chave   ANTHROPIC_API_KEY
 * @param {string|undefined} p.modelo  ANTHROPIC_MODEL
 * @param {string|undefined} p.urlBase ANTHROPIC_BASE_URL (opcional; padrão: API oficial)
 * @param {string} p.usuarioId         id do usuário autenticado
 * @param {object} p.pedido            resultado de validarPedido
 */
export async function gerarMensagem({ rpc, fetch, chave, modelo, urlBase, usuarioId, pedido }) {
  if (!chave) return { status: "ia_nao_configurada", aviso: AVISOS.ia_nao_configurada };

  // 1) contexto para decidir o tom sugerido
  const ctx0 = await rpc("srv_contexto_geracao", { p_aluno: pedido.aluno_id });
  if (!ctx0 || !ctx0.aluno) return { status: "nao_encontrado", aviso: AVISOS.nao_encontrado };
  const preview = montarPrompt(ctx0, "Acolhedor", "");
  const sugerido = tomSugerido({
    primeiroContato: preview.primeiroContato,
    dias: preview.dias,
    prazo: ctx0.configuracoes?.prazo_padrao,
  });
  const tom = pedido.tom || sugerido;

  // 2) reserva atômica no banco (dia útil, duplicidade, limites, concluído)
  const reserva = await rpc("srv_reservar_geracao", {
    p_aluno: pedido.aluno_id, p_usuario: usuarioId, p_tom: tom,
    p_instrucao: pedido.instrucao, p_modo: pedido.modo,
  });
  if (reserva?.status !== "reservada") {
    const status = reserva?.status || "invalido";
    return { status, aviso: AVISOS[status] || AVISOS.invalido, mensagem_id: reserva?.mensagem_id ?? null };
  }

  // 3) contexto atualizado + chamada à IA
  try {
    const ctx = await rpc("srv_contexto_geracao", { p_aluno: pedido.aluno_id });
    const { sistema, usuario } = montarPrompt(ctx, tom, pedido.instrucao);
    const r = await chamarClaude({ fetch, chave, modelo: modelo || MODELO_PADRAO, sistema, usuario,
      urlBase: urlBase || URL_API_PADRAO });
    const fim = await rpc("srv_concluir_geracao", { p_versao: reserva.versao_id, p_texto: r.texto, p_modelo: r.modelo });
    if (fim?.status !== "concluida") {
      return { status: "ia_indisponivel", aviso: AVISOS.ia_indisponivel };
    }
    return {
      status: "concluida", tom, sugerido, texto: r.texto,
      versao_id: reserva.versao_id, mensagem_id: reserva.mensagem_id,
      versao: reserva.versao, dia_acompanhamento: reserva.dia_acompanhamento,
    };
  } catch (e) {
    const codigo = e?.codigo || "ia_indisponivel";
    await rpc("srv_falhar_geracao", { p_versao: reserva.versao_id, p_erro: e?.message || "Falha ao gerar." })
      .catch(() => {});
    return { status: codigo, aviso: AVISOS[codigo] || AVISOS.ia_indisponivel, mensagem_id: reserva.mensagem_id };
  }
}
