// =====================================================================
// Lógica de mensagens: geração individual, lote diário e indicador
// (prompt mestre 8.1 e 13). O servidor garante as regras definitivas
// (dia útil, uma por dia, sem duplicar); aqui só organizamos a fila.
// =====================================================================
import { diaUtil, horaLocal, hojeLocal, diasEmAberto } from "./regras.js";
import { esc, $, toast, plural } from "./ui.js";
import * as api from "./api.js";
import { estado, recarregar, redesenhar } from "./app.js";
import { precisaGerarHoje } from "./students.js";

// Estado do lote em andamento (vale para a aba atual)
export const lote = { ativo: false, feitos: 0, total: 0, falhas: [], parado: "" };
export const gerandoAgora = new Set();   // ids de alunos com geração em curso nesta aba

const PARAR_LOTE = new Set(["ia_nao_configurada", "fim_de_semana", "sem_permissao", "limite"]);

/** Gera (ou gera de novo) a mensagem de um aluno. Devolve o resultado do servidor. */
export async function gerarUma(alunoId, { tom = null, instrucao = "", modo = "manual" } = {}) {
  if (gerandoAgora.has(alunoId)) return { status: "em_andamento" };
  gerandoAgora.add(alunoId);
  try {
    return await api.gerarMensagem({ alunoId, tom, instrucao, modo });
  } finally {
    gerandoAgora.delete(alunoId);
  }
}

/** Lote do dia: alunos ativos, com pendência e sem mensagem pronta hoje. */
export async function gerarLote({ apenas = null } = {}) {
  if (lote.ativo) return;
  const ids = apenas || [...estado.alunos.values()]
    .filter((a) => precisaGerarHoje(a))
    .sort((x, y) => diasEmAberto(y, hojeLocal()) - diasEmAberto(x, hojeLocal()))
    .map((a) => a.id);
  if (!ids.length) { atualizarBanner(); return; }

  Object.assign(lote, { ativo: true, feitos: 0, total: ids.length, falhas: [], parado: "" });
  atualizarBanner();
  let i = 0;
  const trabalhador = async () => {
    while (i < ids.length && !lote.parado) {
      const id = ids[i++];
      const r = await gerarUma(id, { modo: "diaria" });
      if (PARAR_LOTE.has(r.status)) lote.parado = r.aviso || "A geração foi interrompida.";
      else if (!["concluida", "ja_existe", "em_andamento", "concluido", "sem_pendencias"].includes(r.status)) {
        lote.falhas.push({ id, aviso: r.aviso || "Falha ao gerar." });
      }
      lote.feitos++;
      atualizarBanner();
    }
  };
  await Promise.all([trabalhador(), trabalhador()]);   // 2 por vez: rápido sem sobrecarregar a IA
  lote.ativo = false;
  await recarregar().catch(() => {});
  // Só redesenha o painel do dia: em outras telas a pessoa pode estar digitando.
  if ((location.hash || "#/") === "#/") redesenhar(); else atualizarBanner();
  if (lote.parado) toast(lote.parado, "erro");
  else if (lote.falhas.length) toast(`${plural(lote.falhas.length, "mensagem não foi gerada", "mensagens não foram geradas")}. Use “Tentar de novo”.`, "erro");
  else toast("Mensagens de hoje prontas.", "ok");
}

/** Dispara o lote automaticamente no primeiro acesso do dia útil, a partir das 9h. */
export function verificarAutomatico() {
  const agora = new Date();
  if (!diaUtil(agora) || horaLocal(agora) < 9 || lote.ativo) return;
  const chave = `lote-automatico-${hojeLocal(agora)}`;
  let jaRodou = false;
  try { jaRodou = sessionStorage.getItem(chave) === "1"; sessionStorage.setItem(chave, "1"); } catch { /* sem storage */ }
  if (jaRodou) return;
  const pendentes = [...estado.alunos.values()].filter((a) => precisaGerarHoje(a));
  if (pendentes.length) gerarLote();
}

// ---------- Indicador (banner) --------------------------------------------
export function bannerGeracao() {
  const agora = new Date();
  const faltando = [...estado.alunos.values()].filter((a) => precisaGerarHoje(a, agora)).length;
  if (lote.ativo) {
    return `<div class="aviso info"><span class="linha"><span class="giro" aria-hidden="true"></span>
      Preparando as mensagens de hoje: ${lote.feitos} de ${lote.total}</span></div>`;
  }
  let falhas = "";
  if (lote.parado) {
    falhas = `<div class="aviso erro"><span>${esc(lote.parado)}</span>
      <button type="button" class="btn btn-sm" data-acao="retomar-lote">Tentar de novo</button></div>`;
  } else if (lote.falhas.length) {
    falhas = `<div class="aviso erro"><span>${plural(lote.falhas.length, "aluno ficou", "alunos ficaram")} sem mensagem por falha na geração. Os dados estão salvos.</span>
      <button type="button" class="btn btn-sm" data-acao="repetir-falhas">Tentar de novo</button></div>`;
  }
  if (!diaUtil(agora)) {
    return falhas + `<div class="aviso info"><span>Hoje não há geração de mensagens: elas são preparadas de segunda a sexta.</span></div>`;
  }
  if (!faltando) return falhas;
  if (horaLocal(agora) < 9) {
    return falhas + `<div class="aviso info"><span>As mensagens de hoje ficam prontas a partir das 9h</span>
      <button type="button" class="btn btn-sm btn-primario" data-acao="gerar-lote">Gerar agora</button></div>`;
  }
  return falhas + `<div class="aviso info"><span>${plural(faltando, "aluno ainda está", "alunos ainda estão")} sem a mensagem de hoje</span>
    <button type="button" class="btn btn-sm btn-primario" data-acao="gerar-lote">Gerar mensagens de hoje</button></div>`;
}

export function atualizarBanner() {
  const el = $("#banner-geracao");
  if (el) { el.innerHTML = bannerGeracao(); ligarBannerGeracao(el); }
}

export function ligarBannerGeracao(raiz) {
  raiz.querySelector('[data-acao="gerar-lote"]')?.addEventListener("click", () => gerarLote());
  raiz.querySelector('[data-acao="retomar-lote"]')?.addEventListener("click", () => { lote.parado = ""; gerarLote(); });
  raiz.querySelector('[data-acao="repetir-falhas"]')?.addEventListener("click", () => {
    const ids = lote.falhas.map((f) => f.id);
    lote.falhas = [];
    gerarLote({ apenas: ids });
  });
}
