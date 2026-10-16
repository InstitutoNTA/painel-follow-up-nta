// =====================================================================
// MODO DEMONSTRAÇÃO — substitui assets/js/api.js apenas na prévia.
// Tudo fica na memória do navegador: alunos FICTÍCIOS, nada é salvo e
// as mensagens são exemplos montados aqui, sem chamar a IA.
// A versão real (api.js) usa o Supabase e a API do Claude.
// =====================================================================
import { hojeLocal, PENDENCIAS, diasEmAberto, tomSugerido, nomeDoTime, diasPendencia } from "./regras.js";

export const configurado = true;
export const sb = null;
export class ErroApi extends Error { constructor(m, c) { super(m); this.codigo = c; } }

const uid = () => (crypto.randomUUID ? crypto.randomUUID() : String(Math.random()).slice(2));
const agoraIso = () => new Date().toISOString();
const somar = (dias) => { const d = new Date(hojeLocal() + "T12:00:00Z"); d.setUTCDate(d.getUTCDate() + dias); return d.toISOString().slice(0, 10); };
const espera = (ms) => new Promise((r) => setTimeout(r, ms));

const PERFIL = { id: "demo", nome: "Você (demonstração)", email: "demonstracao@exemplo.invalid", papel: "admin", ativo: true, criado_em: agoraIso() };
const db = {
  cursos: [
    { id: 1, nome: "Engenharia de Dados e Inteligência Artificial", nome_curto: "Eng. de Dados e IA", ordem: 1 },
    { id: 2, nome: "Inteligência Artificial aplicada a Negócios", nome_curto: "IA aplicada a Negócios", ordem: 2 },
    { id: 3, nome: "Arquitetura Avançada em Cloud com Azure", nome_curto: "Cloud com Azure", ordem: 3 },
    { id: 4, nome: "MBA aplicado ao Direito", nome_curto: "MBA aplicado ao Direito", ordem: 4 },
    { id: 5, nome: "Defesa Cibernética", nome_curto: "Defesa Cibernética", ordem: 5 },
  ],
  alunos: [], pendencias: [], mensagens: [], versoes: [], respostas: [],
  config: { id: 1, assinante: "Clara", prazo_padrao: 7, link_acesso: "https://exemplo.invalid/acesso", link_contrato: "", link_documentacao: "" },
};

function recalcular(alunoId) {
  const a = db.alunos.find((x) => x.id === alunoId); if (!a) return;
  const marc = db.pendencias.filter((p) => p.aluno_id === alunoId && p.marcada);
  a.estado_acompanhamento = marc.length && marc.every((p) => p.estado === "resolvida") ? "concluido" : "em_acompanhamento";
}

function novoAluno(dados) {
  const a = { id: uid(), nome: null, email: null, telefone: null, data_compra: null, curso_id: null, momento_profissional: null,
    dor_principal: null, observacoes: null, estado_acompanhamento: "em_acompanhamento", data_cadastro: hojeLocal(),
    criado_em: agoraIso(), ...dados };
  db.alunos.push(a);
  for (const def of PENDENCIAS) {
    db.pendencias.push({ id: uid(), aluno_id: a.id, tipo: def.tipo, marcada: false, estado: "pendente",
      data_referencia: hojeLocal(), dias_informados: null, resolvida_em: null, criado_em: agoraIso() });
  }
  return a;
}

function mudarPendencia(p, m) {
  if ("marcada" in m && m.marcada && !p.marcada) { p.data_referencia = hojeLocal(); p.estado = "pendente"; p.resolvida_em = null; }
  if ("dias_informados" in m && m.dias_informados !== p.dias_informados) p.data_referencia = hojeLocal();
  Object.assign(p, m);
  if (p.estado === "resolvida" && !p.resolvida_em) p.resolvida_em = hojeLocal();
  if (p.estado === "pendente") p.resolvida_em = null;
  recalcular(p.aluno_id);
}

// ---------- alunos fictícios de exemplo ----------
function semear() {
  const ex = [
    { a: { nome: "Mariana Teixeira (exemplo)", telefone: "(11) 90000-0001", email: "mariana@exemplo.invalid", data_compra: somar(-12), curso_id: 2,
           momento_profissional: "transicao", dor_principal: "Quer sair do comercial e trabalhar com dados", observacoes: "Prefere contato à tarde" },
      p: { acesso: 0, contrato: null }, msgs: [[-3, "Acolhedor", true], [-1, "Lembrete", true]], resp: [-1, "Oi! Essa semana está corrida, mas vou tentar acessar no fim de semana."] },
    { a: { nome: "Rafael Souza (exemplo)", telefone: "(21) 90000-0002", data_compra: somar(-4), curso_id: 1, momento_profissional: "especializacao",
           dor_principal: "Quer liderar projetos de dados na empresa" }, p: { documentacao: null } },
    { a: { nome: "Juliana Prado (exemplo)", telefone: "(31) 90000-0003", data_compra: somar(-20), curso_id: 4, momento_profissional: "especializacao",
           dor_principal: "Aplicar IA na rotina do escritório" }, p: { contrato: null, documentacao: 5 }, msgs: [[-6, "Lembrete", true], [-2, "Firme", true]] },
    { a: { nome: "Carlos Mendes (exemplo)", telefone: "(41) 90000-0004", data_compra: somar(-2), curso_id: 3, momento_profissional: "transicao" }, p: { acesso: null } },
    { a: { nome: "Patrícia Lima (exemplo)", telefone: "(51) 90000-0005", data_compra: somar(-15), curso_id: 5 }, p: { contrato: null }, resolvidas: ["contrato"] },
  ];
  for (const e of ex) {
    const a = novoAluno(e.a);
    for (const [tipo, n] of Object.entries(e.p)) {
      const p = db.pendencias.find((x) => x.aluno_id === a.id && x.tipo === tipo);
      Object.assign(p, { marcada: true, dias_informados: n, data_referencia: n == null ? hojeLocal() : somar(-2) });
    }
    for (const t of e.resolvidas || []) {
      const p = db.pendencias.find((x) => x.aluno_id === a.id && x.tipo === t);
      Object.assign(p, { estado: "resolvida", resolvida_em: somar(-1) });
    }
    (e.msgs || []).forEach(([d, tom, env], i) => {
      const m = { id: uid(), aluno_id: a.id, data_referencia: somar(d), dia_acompanhamento: i + 1, estado_envio: env ? "enviada" : "nao_enviada",
        enviada_em: env ? agoraIso() : null, criado_em: agoraIso() };
      db.mensagens.push(m);
      db.versoes.push({ id: uid(), mensagem_id: m.id, versao: 1, tom, instrucao: null, estado_geracao: "concluida", erro: null, modelo: "demonstracao",
        enviada_em: m.enviada_em, criado_em: new Date(Date.now() + (d * 864e5)).toISOString(),
        texto: textoExemplo(a, tom, i === 0) });
    });
    if (e.resp) db.respostas.push({ id: uid(), aluno_id: a.id, mensagem_id: null, texto: e.resp[1],
      respondida_em: new Date(Date.now() + e.resp[0] * 864e5).toISOString(), criado_em: agoraIso() });
    recalcular(a.id);
  }
}

// Texto de EXEMPLO (na versão real, quem escreve é a IA com as regras do prompt mestre)
function textoExemplo(a, tom, primeiro, instrucao = "") {
  const nome = (a.nome || "").replace(/\s*\(exemplo\)/, "").split(" ")[0];
  const curso = db.cursos.find((c) => c.id === a.curso_id)?.nome || "";
  const aluno = { ...a, pendencias: db.pendencias.filter((p) => p.aluno_id === a.id) };
  const abertas = aluno.pendencias.filter((p) => p.marcada && p.estado === "pendente");
  const p = abertas[0];
  const def = p ? PENDENCIAS.find((d) => d.tipo === p.tipo) : null;
  const dias = p ? diasPendencia(aluno, p, hojeLocal()) : 0;
  const link = def ? db.config[def.link] : "";
  const ola = nome ? `Oi, ${nome}! Tudo bem?` : "Oi! Tudo bem?";
  const apres = primeiro ? ` Aqui é a ${db.config.assinante || "equipe"}, do ${nomeDoTime(curso)}, e vou te acompanhar por aqui.` : "";
  const dor = a.dor_principal ? ` Sei que você quer ${a.dor_principal.charAt(0).toLowerCase() + a.dor_principal.slice(1)}, e esse primeiro passo faz diferença.` : "";
  const acao = def ? `Vi que ainda falta ${def.acao} (já são ${dias} dias).` : "";
  const passo = def ? (link ? ` O passo a passo está aqui: ${link}` : " Vou te mandar o passo a passo em seguida.") : "";
  const tons = {
    Acolhedor: "Se precisar de qualquer ajuda, é só me chamar que resolvemos juntos. 😊",
    Lembrete: "Consegue separar uns minutinhos hoje para isso? Estou por aqui se surgir dúvida.",
    Firme: "É importante resolver isso nos próximos dias para você não perder o ritmo do curso. Posso te ajudar agora mesmo, se quiser.",
    Urgente: "Preciso falar com você hoje sobre isso. Me responde aqui quando puder que resolvemos juntos rapidinho.",
  };
  return [ola + apres, acao + dor + passo, tons[tom], instrucao ? `(Ajuste pedido: ${instrucao})` : ""].filter(Boolean).join("\n\n");
}

semear();

// ---------- API com a mesma "cara" da real ----------
const copia = (o) => JSON.parse(JSON.stringify(o));
export async function sessaoAtual() { return { user: { id: "demo", email: PERFIL.email }, access_token: "demo" }; }
export async function entrar() {}
export async function sair() { location.reload(); }
export async function enviarRecuperacao() {}
export async function definirSenha() {}
export function aoMudarSessao() { return { data: { subscription: { unsubscribe() {} } } }; }
export async function meuPerfil() { return copia(PERFIL); }
export async function carregarTudo() {
  await espera(120);
  return copia({ cursos: db.cursos, alunos: db.alunos, pendencias: db.pendencias, mensagens: db.mensagens,
    versoes: db.versoes, respostas: db.respostas, config: db.config });
}
const limpar = (d) => Object.fromEntries(Object.entries(d).map(([k, v]) => [k, v === "" || v === undefined ? null : v]));
export async function criarAluno(dados, pend) { const a = novoAluno(limpar(dados)); await salvarPendencias(a.id, pend); return a.id; }
export async function atualizarAluno(id, dados, pend) {
  Object.assign(db.alunos.find((a) => a.id === id), limpar(dados));
  if (pend) await salvarPendencias(id, pend);
}
export async function salvarPendencias(alunoId, lista) {
  for (const m of lista) { const { tipo, ...rest } = m; mudarPendencia(db.pendencias.find((p) => p.aluno_id === alunoId && p.tipo === tipo), rest); }
}
export async function resolverPendencia(id, resolvida) { mudarPendencia(db.pendencias.find((p) => p.id === id), { estado: resolvida ? "resolvida" : "pendente" }); }
export async function salvarObservacoes(id, texto) { db.alunos.find((a) => a.id === id).observacoes = texto.trim() || null; }
export async function excluirAluno(id) {
  const msgs = db.mensagens.filter((m) => m.aluno_id === id).map((m) => m.id);
  db.versoes = db.versoes.filter((v) => !msgs.includes(v.mensagem_id));
  for (const k of ["mensagens", "respostas", "pendencias"]) db[k] = db[k].filter((x) => x.aluno_id !== id);
  db.alunos = db.alunos.filter((a) => a.id !== id);
}
export async function marcarEnvio(mensagemId, enviada) {
  const m = db.mensagens.find((x) => x.id === mensagemId);
  const vig = db.versoes.filter((v) => v.mensagem_id === m.id && v.estado_geracao === "concluida").sort((a, b) => b.versao - a.versao)[0];
  m.estado_envio = enviada ? "enviada" : "nao_enviada"; m.enviada_em = enviada ? agoraIso() : null;
  if (vig) vig.enviada_em = m.enviada_em;
}
export async function registrarResposta(alunoId, texto, mensagemId) {
  db.respostas.push({ id: uid(), aluno_id: alunoId, mensagem_id: mensagemId || null, texto: texto.trim(), respondida_em: agoraIso(), criado_em: agoraIso() });
}
export async function gerarMensagem({ alunoId, tom, instrucao, modo }) {
  await espera(700);
  const a = db.alunos.find((x) => x.id === alunoId);
  if (!a) return { status: "nao_encontrado", aviso: "Aluno não encontrado." };
  if (a.estado_acompanhamento === "concluido") return { status: "concluido", aviso: "Este aluno já concluiu todas as pendências." };
  const aluno = { ...a, pendencias: db.pendencias.filter((p) => p.aluno_id === a.id) };
  if (!aluno.pendencias.some((p) => p.marcada && p.estado === "pendente")) return { status: "sem_pendencias", aviso: "Marque ao menos uma pendência em aberto." };
  const hoje = hojeLocal();
  let m = db.mensagens.find((x) => x.aluno_id === a.id && x.data_referencia === hoje);
  const anteriores = db.mensagens.filter((x) => x.aluno_id === a.id && x.data_referencia < hoje).length;
  if (m && modo === "diaria") return { status: "ja_existe", aviso: "A mensagem de hoje já está pronta." };
  if (!m) { m = { id: uid(), aluno_id: a.id, data_referencia: hoje, dia_acompanhamento: anteriores + 1, estado_envio: "nao_enviada", enviada_em: null, criado_em: agoraIso() }; db.mensagens.push(m); }
  const t = tom || tomSugerido({ primeiroContato: anteriores === 0, dias: diasEmAberto(aluno, hoje), prazo: db.config.prazo_padrao });
  const versao = db.versoes.filter((v) => v.mensagem_id === m.id).length + 1;
  db.versoes.push({ id: uid(), mensagem_id: m.id, versao, tom: t, instrucao: instrucao || null, estado_geracao: "concluida", erro: null,
    modelo: "demonstracao", enviada_em: null, criado_em: agoraIso(), texto: textoExemplo(a, t, anteriores === 0, instrucao) });
  m.estado_envio = "nao_enviada"; m.enviada_em = null;
  return { status: "concluida", tom: t };
}
export async function salvarConfig(c) {
  Object.assign(db.config, { assinante: (c.assinante || "").trim(), prazo_padrao: Number(c.prazo_padrao), link_acesso: (c.link_acesso || "").trim(),
    link_contrato: (c.link_contrato || "").trim(), link_documentacao: (c.link_documentacao || "").trim() });
}
export async function listarPerfis() {
  return [PERFIL, { id: "clara", nome: "Clara (exemplo)", email: "clara@exemplo.invalid", papel: "operador", ativo: true, criado_em: agoraIso() }];
}
export async function atualizarPerfil() {}
export async function exportarBackup() {
  return { formato: "painel-follow-up-nta", versao: 1, exportado_em: agoraIso(), alunos: db.alunos, pendencias: db.pendencias,
    mensagens: db.mensagens, mensagem_versoes: db.versoes, respostas: db.respostas, configuracoes: db.config };
}
export async function importarBackup() {
  return { alunos_novos: 0, alunos_ignorados: db.alunos.length, mensagens_novas: 0, versoes_novas: 0, respostas_novas: 0, simulacao: true };
}
