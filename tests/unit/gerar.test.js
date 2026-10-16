// Testes do prompt do agente e do fluxo da Edge Function, com banco e
// API substituídos por dublês de teste (nenhum serviço real é chamado).
import { test } from "node:test";
import assert from "node:assert/strict";
import { montarPrompt, limparTexto } from "../../supabase/functions/_shared/prompt.js";
import { gerarMensagem, validarPedido, chamarClaude } from "../../supabase/functions/_shared/gerar.js";

const ID = "11111111-2222-4333-8444-555555555555";

const contexto = (extra = {}) => ({
  hoje: "2026-10-19",
  aluno: { id: ID, nome: "Pessoa Fictícia", data_compra: "2026-10-09", data_cadastro: "2026-10-12",
           momento_profissional: "transicao", dor_principal: "Quer migrar para dados", observacoes: "Prefere contato à tarde" },
  curso: "Engenharia de Dados e Inteligência Artificial",
  pendencias: [
    { tipo: "acesso", marcada: true, estado: "pendente", data_referencia: "2026-10-12", dias_informados: null },
    { tipo: "contrato", marcada: true, estado: "pendente", data_referencia: "2026-10-12", dias_informados: 2 },
    { tipo: "documentacao", marcada: false, estado: "pendente", data_referencia: "2026-10-12", dias_informados: null },
  ],
  configuracoes: { assinante: "Clara", prazo_padrao: 7, link_acesso: "https://exemplo.invalid/acesso",
                   link_contrato: "", link_documentacao: "" },
  qtd_mensagens_anteriores: 0, qtd_enviadas: 0,
  ultimas_mensagens: [], ultimas_respostas: [],
  ...extra,
});

test("prompt inclui todos os dados exigidos (seção 14)", () => {
  const { usuario, sistema, dias, primeiroContato } = montarPrompt(contexto(), "Acolhedor", "Cite o bônus");
  assert.equal(dias, 10);
  assert.equal(primeiroContato, true);
  for (const trecho of ["Pessoa Fictícia", "Engenharia de Dados", "Transição de carreira", "Quer migrar para dados",
    "Prefere contato à tarde", "pendente há 10 dias", "pendente há 9 dias", "Prazo configurado: 7",
    "prazo vencido", "https://exemplo.invalid/acesso", "vai enviar o passo a passo em seguida",
    "apresente-se como Clara", "Sucesso do Aluno da Pós-graduação em Engenharia de Dados",
    "INSTRUÇÃO DA EQUIPE PARA ESTA MENSAGEM: Cite o bônus", "TOM ESCOLHIDO: Acolhedor"]) {
    assert.ok(usuario.includes(trecho), `faltou no prompt: ${trecho}`);
  }
  assert.ok(!usuario.includes("Sem documentação") && !usuario.includes("Não subiu"), "pendência desmarcada não entra");
  assert.match(sistema, /Nunca cite o nome da empresa/);
  assert.match(sistema, /No máximo um emoji/);
});

test("sem assinante, o agente não inventa nome", () => {
  const { usuario } = montarPrompt(contexto({ configuracoes: { prazo_padrao: 7 } }), "Acolhedor");
  assert.match(usuario, /Não invente um nome/);
});

test("respostas e mensagens anteriores entram no contexto da IA", () => {
  const { usuario, primeiroContato } = montarPrompt(contexto({
    qtd_mensagens_anteriores: 2,
    ultimas_mensagens: [{ texto: "Olá anterior", tom: "Acolhedor", data_referencia: "2026-10-16", enviada: true }],
    ultimas_respostas: [{ texto: "Vou resolver amanhã", respondida_em: "2026-10-16T15:00:00Z" }],
  }), "Lembrete");
  assert.equal(primeiroContato, false);
  assert.match(usuario, /Olá anterior/);
  assert.match(usuario, /Vou resolver amanhã/);
  assert.match(usuario, /não precisa se apresentar/);
});

test("MBA usa a apresentação própria", () => {
  const { usuario } = montarPrompt(contexto({ curso: "MBA aplicado ao Direito" }), "Firme");
  assert.match(usuario, /Sucesso do Aluno do MBA aplicado ao Direito/);
});

test("limpeza remove aspas e Markdown", () => {
  assert.equal(limparTexto('"**Oi**, tudo bem?"'), "Oi, tudo bem?");
});

test("validação do pedido", () => {
  assert.ok(validarPedido({ aluno_id: ID, modo: "diaria" }).aluno_id);
  assert.equal(validarPedido({ aluno_id: "1; drop table", modo: "diaria" }).erro, "invalido");
  assert.equal(validarPedido({ aluno_id: ID, modo: "diaria", tom: "Bravo" }).erro, "invalido");
  assert.equal(validarPedido({ aluno_id: ID, modo: "outro" }).erro, "invalido");
  assert.equal(validarPedido({ aluno_id: ID, modo: "manual", instrucao: "x".repeat(1001) }).erro, "invalido");
});

// Dublê do banco: registra chamadas
function bancoFalso(reserva = { status: "reservada", versao_id: "v1", mensagem_id: "m1", versao: 1, dia_acompanhamento: 1 }) {
  const chamadas = [];
  const rpc = async (fn, args) => {
    chamadas.push([fn, args]);
    if (fn === "srv_contexto_geracao") return contexto();
    if (fn === "srv_reservar_geracao") return reserva;
    if (fn === "srv_concluir_geracao") return { status: "concluida" };
    if (fn === "srv_falhar_geracao") return { status: "falhou" };
  };
  return { rpc, chamadas };
}
const apiOk = async (_url, opcoes) => ({
  ok: true, status: 200,
  json: async () => ({ model: "modelo-teste", stop_reason: "end_turn",
    content: [{ type: "text", text: `"Texto gerado para ${JSON.parse(opcoes.body).messages[0].content.length > 0 ? "teste" : ""}"` }] }),
});

test("sem chave configurada: avisa e não reserva nada", async () => {
  const { rpc, chamadas } = bancoFalso();
  const r = await gerarMensagem({ rpc, fetch: apiOk, chave: "", usuarioId: ID, pedido: validarPedido({ aluno_id: ID, modo: "diaria" }) });
  assert.equal(r.status, "ia_nao_configurada");
  assert.equal(chamadas.length, 0);
});

test("fluxo completo: tom sugerido, chamada à API e conclusão", async () => {
  const { rpc, chamadas } = bancoFalso();
  let corpoEnviado, cabecalhos;
  const fetch = async (url, op) => { corpoEnviado = JSON.parse(op.body); cabecalhos = op.headers; return apiOk(url, op); };
  const r = await gerarMensagem({ rpc, fetch, chave: "chave-de-teste", usuarioId: ID,
    pedido: validarPedido({ aluno_id: ID, modo: "manual", instrucao: "Mais curta" }) });
  assert.equal(r.status, "concluida");
  assert.equal(r.tom, "Acolhedor", "primeiro contato");
  assert.equal(r.texto, "Texto gerado para teste");
  assert.equal(cabecalhos["x-api-key"], "chave-de-teste");
  assert.equal(corpoEnviado.model, "claude-sonnet-5-5");
  assert.ok(corpoEnviado.messages[0].content.includes("Mais curta"));
  assert.deepEqual(chamadas.map((c) => c[0]),
    ["srv_contexto_geracao", "srv_reservar_geracao", "srv_contexto_geracao", "srv_concluir_geracao"]);
  assert.equal(chamadas[1][1].p_usuario, ID);
});

test("reserva negada (ex.: já existe hoje) não chama a IA", async () => {
  const { rpc, chamadas } = bancoFalso({ status: "ja_existe", mensagem_id: "m1" });
  let chamouApi = false;
  const r = await gerarMensagem({ rpc, fetch: async () => { chamouApi = true; }, chave: "k", usuarioId: ID,
    pedido: validarPedido({ aluno_id: ID, modo: "diaria" }) });
  assert.equal(r.status, "ja_existe");
  assert.equal(chamouApi, false);
  assert.equal(chamadas.length, 2);
});

test("falha da IA registra a falha e permite nova tentativa", async () => {
  const { rpc, chamadas } = bancoFalso();
  const r = await gerarMensagem({ rpc, fetch: async () => ({ ok: false, status: 529, json: async () => ({}) }),
    chave: "k", usuarioId: ID, pedido: validarPedido({ aluno_id: ID, modo: "diaria" }) });
  assert.equal(r.status, "ia_indisponivel");
  assert.equal(chamadas.at(-1)[0], "srv_falhar_geracao");
  assert.ok(!JSON.stringify(r).includes("k\""), "resposta não expõe a chave");
});

test("chave inválida vira 'ia_nao_configurada'", async () => {
  await assert.rejects(
    chamarClaude({ fetch: async () => ({ ok: false, status: 401 }), chave: "x", modelo: "m", sistema: "", usuario: "" }),
    (e) => e.codigo === "ia_nao_configurada");
});

test("recusa ou texto vazio não vira mensagem", async () => {
  await assert.rejects(
    chamarClaude({ fetch: async () => ({ ok: true, json: async () => ({ stop_reason: "refusal", content: [] }) }),
      chave: "x", modelo: "m", sistema: "", usuario: "" }),
    (e) => e.codigo === "ia_indisponivel");
});
