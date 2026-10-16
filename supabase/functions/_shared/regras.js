// =====================================================================
// Regras de negócio do Painel de Follow-up (prompt mestre, seção 10).
// Arquivo ÚNICO usado pelo navegador e pela Edge Function: não depende
// de nenhuma biblioteca e trabalha só com datas "AAAA-MM-DD" (sem horário),
// para evitar erros de conversão entre UTC e o fuso de Brasília.
// =====================================================================

export const FUSO = "America/Sao_Paulo";
export const TONS = ["Acolhedor", "Lembrete", "Firme", "Urgente"];
export const PRAZO_PADRAO = 7;

export const PENDENCIAS = [
  { tipo: "acesso",       rotulo: "Nunca acessou a plataforma", curto: "Nunca acessou",
    acao: "acessar a plataforma pela primeira vez", link: "link_acesso" },
  { tipo: "contrato",     rotulo: "Não assinou o contrato",     curto: "Não assinou contrato",
    acao: "assinar o contrato", link: "link_contrato" },
  { tipo: "documentacao", rotulo: "Não subiu a documentação",   curto: "Sem documentação",
    acao: "subir a documentação", link: "link_documentacao" },
];

export const MOMENTOS = {
  transicao: "Transição de carreira",
  especializacao: "Especialização",
  nao_sei: "Não sei",
};

// ---------- Datas no fuso de Brasília ------------------------------------
const partes = (data, opcoes) =>
  Object.fromEntries(new Intl.DateTimeFormat("en-CA", { timeZone: FUSO, ...opcoes })
    .formatToParts(data).map((p) => [p.type, p.value]));

/** Data local de Brasília no formato AAAA-MM-DD. */
export function hojeLocal(agora = new Date()) {
  const p = partes(agora, { year: "numeric", month: "2-digit", day: "2-digit" });
  return `${p.year}-${p.month}-${p.day}`;
}

/** Hora (0–23) em Brasília. */
export function horaLocal(agora = new Date()) {
  return Number(partes(agora, { hour: "2-digit", hourCycle: "h23" }).hour);
}

/** Segunda a sexta em Brasília? */
export function diaUtil(agora = new Date()) {
  const d = new Date(hojeLocal(agora) + "T12:00:00Z").getUTCDay();
  return d >= 1 && d <= 5;
}

/** Número de dias entre duas datas AAAA-MM-DD (b − a). */
export function diferencaDias(a, b) {
  const [y1, m1, d1] = a.split("-").map(Number);
  const [y2, m2, d2] = b.split("-").map(Number);
  return Math.round((Date.UTC(y2, m2 - 1, d2) - Date.UTC(y1, m1 - 1, d1)) / 864e5);
}

export const formatarData = (s) => (s ? s.slice(0, 10).split("-").reverse().join("/") : "");
export const formatarDiaMes = (s) => (s ? s.slice(0, 10).split("-").reverse().slice(0, 2).join("/") : "");

export function dataPorExtenso(agora = new Date()) {
  const t = new Intl.DateTimeFormat("pt-BR", {
    timeZone: FUSO, weekday: "long", day: "numeric", month: "long", year: "numeric",
  }).format(agora);
  return t.charAt(0).toUpperCase() + t.slice(1);
}

// ---------- Pendências e dias ---------------------------------------------
export const pendenciasMarcadas = (aluno) => (aluno.pendencias || []).filter((p) => p.marcada);
export const pendenciasAbertas = (aluno) => pendenciasMarcadas(aluno).filter((p) => p.estado === "pendente");
export const concluido = (aluno) =>
  pendenciasMarcadas(aluno).length > 0 && pendenciasAbertas(aluno).length === 0;
export const ativo = (aluno) => !concluido(aluno);
export const temPendenciaAberta = (aluno) => pendenciasAbertas(aluno).length > 0;

/**
 * Dias de uma pendência (10.1):
 *  - com "Pendente há N dias": N + dias desde a data em que N foi registrado;
 *  - sem N: desde a data da compra; sem compra: desde a data de cadastro.
 * Pendência resolvida para de contar na data da resolução.
 */
export function diasPendencia(aluno, p, hoje) {
  if (!p || !p.marcada) return null;
  const fim = p.estado === "resolvida" && p.resolvida_em ? p.resolvida_em : hoje;
  if (p.dias_informados !== null && p.dias_informados !== undefined && p.dias_informados !== "") {
    return Number(p.dias_informados) + Math.max(0, diferencaDias(p.data_referencia || hoje, fim));
  }
  const base = aluno.data_compra || aluno.data_cadastro || hoje;
  return Math.max(0, diferencaDias(base, fim));
}

/** Maior número de dias entre as pendências ainda não resolvidas (10.2). */
export function diasEmAberto(aluno, hoje) {
  return pendenciasAbertas(aluno).reduce((m, p) => Math.max(m, diasPendencia(aluno, p, hoje) || 0), 0);
}

/** Tom sugerido (10.3). A primeira mensagem é sempre Acolhedor. */
export function tomSugerido({ primeiroContato, dias, prazo }) {
  const P = Math.max(1, Number(prazo) || PRAZO_PADRAO);
  if (primeiroContato) return "Acolhedor";
  if (dias < P / 2) return "Acolhedor";
  if (dias < P) return "Lembrete";
  if (dias <= P + 7) return "Firme";
  return "Urgente";
}

/** Situação do prazo exibida no acompanhamento. */
export function situacaoPrazo(dias, prazo) {
  const P = Math.max(1, Number(prazo) || PRAZO_PADRAO);
  if (dias > P) return { texto: "prazo vencido", classe: "vencido" };
  if (dias === P) return { texto: "vence hoje", classe: "vencendo" };
  const faltam = P - dias;
  return { texto: faltam === 1 ? "falta 1 dia" : `faltam ${faltam} dias`, classe: faltam === 1 ? "vencendo" : "" };
}

/** Vencendo ou vencido (10.4): ativo, com pendência e dias ≥ P − 1. */
export function vencendoOuVencido(aluno, hoje, prazo) {
  const P = Math.max(1, Number(prazo) || PRAZO_PADRAO);
  return ativo(aluno) && temPendenciaAberta(aluno) && diasEmAberto(aluno, hoje) >= P - 1;
}

// ---------- Apresentação institucional (14.2) ------------------------------
export function nomeDoTime(curso) {
  if (!curso) return "Sucesso do Aluno da Pós-graduação";
  if (curso === "MBA aplicado ao Direito") return "Sucesso do Aluno do MBA aplicado ao Direito";
  return `Sucesso do Aluno da Pós-graduação em ${curso}`;
}
