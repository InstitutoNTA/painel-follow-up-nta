// =====================================================================
// Comunicação com o Supabase (banco, login e função de servidor).
// O navegador usa apenas a chave pública "anon"; tudo é filtrado por RLS.
// =====================================================================
import { createClient } from "../vendor/supabase-js.esm.js";
import { CONFIG } from "./config.js";

export const configurado = Boolean(CONFIG.supabaseUrl && CONFIG.supabaseAnonKey);

export const sb = configurado
  ? createClient(CONFIG.supabaseUrl, CONFIG.supabaseAnonKey, {
      auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true },
    })
  : null;

// ---------- Erros em linguagem simples -------------------------------------
export class ErroApi extends Error {
  constructor(mensagem, codigo) { super(mensagem); this.codigo = codigo; }
}

function traduzir(erro) {
  if (!erro) return null;
  const c = erro.code || "";
  if (c === "42501" || /permission|row-level security/i.test(erro.message || ""))
    return new ErroApi("Você não tem permissão para esta ação.", "permissao");
  if (c === "23514") return new ErroApi(erro.message && !/violates check/.test(erro.message)
    ? erro.message : "Algum campo tem um valor inválido. Confira e tente de novo.", "validacao");
  if (c === "23503") return new ErroApi("Um dos dados selecionados não existe mais. Recarregue a página.", "referencia");
  if (c === "23505") return new ErroApi("Este registro já existe.", "duplicado");
  if (c === "22023") return new ErroApi(erro.message, "formato");
  if (/fetch|network|Failed to fetch/i.test(erro.message || ""))
    return new ErroApi("Sem conexão com o servidor. Verifique a internet e tente de novo.", "rede");
  return new ErroApi("Não foi possível concluir agora. Tente de novo em instantes.", "desconhecido");
}

async function exec(promessa) {
  let r;
  try { r = await promessa; } catch (e) { throw traduzir(e); }
  if (r.error) throw traduzir(r.error);
  return r.data;
}

/** Busca todas as linhas de uma tabela, em páginas (o Supabase limita 1000 por vez). */
async function buscarTudo(tabela, colunas = "*", ordem = "criado_em") {
  const tamanho = 1000;
  let de = 0, todas = [];
  for (;;) {
    const lote = await exec(sb.from(tabela).select(colunas).order(ordem, { ascending: true })
      .order("id", { ascending: true }).range(de, de + tamanho - 1));
    todas = todas.concat(lote);
    if (lote.length < tamanho) return todas;
    de += tamanho;
  }
}

// ---------- Autenticação ---------------------------------------------------
export async function sessaoAtual() {
  const { data } = await sb.auth.getSession();
  return data.session;
}
export const entrar = (email, senha) => exec(sb.auth.signInWithPassword({ email, password: senha }))
  .catch((e) => { throw new ErroApi("E-mail ou senha incorretos, ou acesso ainda não liberado.", e.codigo); });
export const sair = () => sb.auth.signOut();
export const enviarRecuperacao = (email) =>
  exec(sb.auth.resetPasswordForEmail(email, { redirectTo: location.origin + location.pathname }));
export const definirSenha = (senha) => exec(sb.auth.updateUser({ password: senha }));
export const aoMudarSessao = (fn) => sb.auth.onAuthStateChange((evento, sessao) => fn(evento, sessao));

export async function meuPerfil(userId) {
  const r = await exec(sb.from("perfis").select("*").eq("id", userId).maybeSingle());
  return r;
}

// ---------- Carga de dados -------------------------------------------------
export async function carregarTudo() {
  const [cursos, alunos, pendencias, mensagens, versoes, respostas, config] = await Promise.all([
    exec(sb.from("cursos").select("*").order("ordem")),
    buscarTudo("alunos"),
    buscarTudo("pendencias"),
    buscarTudo("mensagens"),
    buscarTudo("mensagem_versoes"),
    buscarTudo("respostas", "*", "respondida_em"),
    exec(sb.from("configuracoes").select("*").eq("id", 1).maybeSingle()),
  ]);
  return { cursos, alunos, pendencias, mensagens, versoes, respostas, config };
}

// ---------- Alunos e pendências --------------------------------------------
const CAMPOS_ALUNO = ["nome", "email", "telefone", "data_compra", "curso_id", "momento_profissional",
  "dor_principal", "observacoes"];

function limparAluno(dados) {
  const saida = {};
  for (const c of CAMPOS_ALUNO) {
    if (!(c in dados)) continue;
    const v = dados[c];
    saida[c] = v === "" || v === undefined ? null : v;
  }
  return saida;
}

/** Cria o aluno e aplica as pendências marcadas. Devolve o id. */
export async function criarAluno(dados, pendencias) {
  const aluno = await exec(sb.from("alunos").insert(limparAluno(dados)).select("id").single());
  await salvarPendencias(aluno.id, pendencias);
  return aluno.id;
}

export async function atualizarAluno(id, dados, pendencias) {
  await exec(sb.from("alunos").update(limparAluno(dados)).eq("id", id));
  if (pendencias) await salvarPendencias(id, pendencias);
}

/** pendencias: [{tipo, marcada, dias_informados}] — só envia o que mudou de fato. */
export async function salvarPendencias(alunoId, pendencias) {
  for (const p of pendencias) {
    const mudanca = { marcada: p.marcada };
    if ("dias_informados" in p) mudanca.dias_informados = p.dias_informados;
    await exec(sb.from("pendencias").update(mudanca).eq("aluno_id", alunoId).eq("tipo", p.tipo));
  }
}

export const resolverPendencia = (id, resolvida) =>
  exec(sb.from("pendencias").update(resolvida ? { estado: "resolvida" } : { estado: "pendente" }).eq("id", id));

export const salvarObservacoes = (id, texto) =>
  exec(sb.from("alunos").update({ observacoes: texto.trim() || null }).eq("id", id));

export const excluirAluno = (id) => exec(sb.from("alunos").delete().eq("id", id).select("id"))
  .then((linhas) => { if (!linhas?.length) throw new ErroApi("O aluno não foi excluído (sem permissão ou já removido).", "permissao"); });

// ---------- Mensagens e respostas ------------------------------------------
export const marcarEnvio = (mensagemId, enviada) =>
  exec(sb.from("mensagens").update({ estado_envio: enviada ? "enviada" : "nao_enviada" }).eq("id", mensagemId));

export const registrarResposta = (alunoId, texto, mensagemId) =>
  exec(sb.from("respostas").insert({ aluno_id: alunoId, texto: texto.trim(), mensagem_id: mensagemId || null }));

/**
 * Chama a função de servidor que gera a mensagem com a API do Claude.
 * Devolve sempre um objeto {status, aviso?, texto?...}; não lança erro de HTTP.
 */
export async function gerarMensagem({ alunoId, tom = null, instrucao = "", modo }) {
  const sessao = await sessaoAtual();
  if (!sessao) return { status: "sem_permissao", aviso: "Sua sessão expirou. Entre novamente." };
  let resp;
  try {
    resp = await fetch(`${CONFIG.supabaseUrl}/functions/v1/gerar-mensagem`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        apikey: CONFIG.supabaseAnonKey,
        authorization: `Bearer ${sessao.access_token}`,
      },
      body: JSON.stringify({ aluno_id: alunoId, tom, instrucao, modo }),
    });
  } catch {
    return { status: "rede", aviso: "Sem conexão com o servidor. Os dados estão salvos; tente de novo." };
  }
  let corpo = null;
  try { corpo = await resp.json(); } catch { /* resposta sem JSON */ }
  if (corpo && corpo.status) return corpo;
  if (resp.status === 404) return { status: "ia_nao_configurada",
    aviso: "A função de geração ainda não foi publicada no servidor. Os dados estão salvos." };
  return { status: "ia_indisponivel", aviso: "O servidor não respondeu como esperado. Tente de novo em instantes." };
}

/** Grava uma mensagem escrita por modelo automático (sem IA). Mesmas regras do banco. */
export async function gerarMensagemModelo({ alunoId, tom, texto, instrucao = "", modo }) {
  try {
    const { data, error } = await sb.rpc("gerar_mensagem_modelo", {
      p_aluno: alunoId, p_tom: tom, p_texto: texto, p_modo: modo, p_instrucao: instrucao || null,
    });
    if (error) {
      if (error.code === "42501") return { status: "sem_permissao" };
      if (error.code === "PGRST202") return { status: "ia_nao_configurada",
        aviso: "A atualização do banco para mensagens automáticas ainda não foi aplicada." };
      return { status: "ia_indisponivel", aviso: traduzir(error).message };
    }
    return data;
  } catch {
    return { status: "rede", aviso: "Sem conexão com o servidor. Os dados estão salvos; tente de novo." };
  }
}

// ---------- Configurações ---------------------------------------------------
export const salvarConfig = (c) => exec(sb.from("configuracoes").update({
  assinante: (c.assinante || "").trim(),
  prazo_padrao: Number(c.prazo_padrao),
  link_acesso: (c.link_acesso || "").trim(),
  link_contrato: (c.link_contrato || "").trim(),
  link_documentacao: (c.link_documentacao || "").trim(),
}).eq("id", 1));

// ---------- Usuários (admin) -----------------------------------------------
export const listarPerfis = () => exec(sb.from("perfis").select("*").order("criado_em"));
export const atualizarPerfil = (id, mudanca) => exec(sb.from("perfis").update(mudanca).eq("id", id));

// ---------- Backup ------------------------------------------------------------
export async function exportarBackup() {
  const d = await carregarTudo();
  return {
    formato: "painel-follow-up-nta",
    versao: 1,
    exportado_em: new Date().toISOString(),
    alunos: d.alunos,
    pendencias: d.pendencias,
    mensagens: d.mensagens,
    mensagem_versoes: d.versoes,
    respostas: d.respostas,
    configuracoes: d.config,
  };
}

export const importarBackup = (dados, { simular, substituirConfig }) =>
  exec(sb.rpc("importar_backup", { p_dados: dados, p_simular: simular, p_substituir_config: substituirConfig }));
