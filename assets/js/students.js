// =====================================================================
// Lógica de alunos e pendências + telas "Painel do dia" (seção 8) e
// "Cadastro/edição" (seção 9).
// =====================================================================
import {
  PENDENCIAS, MOMENTOS, hojeLocal, diasPendencia, diasEmAberto, tomSugerido, situacaoPrazo,
  vencendoOuVencido, concluido, ativo, temPendenciaAberta, diaUtil, formatarDiaMes, dataPorExtenso, PRAZO_PADRAO,
} from "./regras.js";
import { esc, $, $$, toast, plural, comBotao } from "./ui.js";
import * as api from "./api.js";
import { estado, prazo, recarregar, ir } from "./app.js";
import { bannerGeracao, ligarBannerGeracao } from "./messages.js";

// ---------- Modelo derivado ------------------------------------------------
/** Monta o objeto do aluno com pendências, mensagens (com versões) e respostas. */
export function montarAlunos(d) {
  const porAluno = (lista) => {
    const m = new Map();
    for (const x of lista) { if (!m.has(x.aluno_id)) m.set(x.aluno_id, []); m.get(x.aluno_id).push(x); }
    return m;
  };
  const versoesPorMsg = new Map();
  for (const v of d.versoes) {
    if (!versoesPorMsg.has(v.mensagem_id)) versoesPorMsg.set(v.mensagem_id, []);
    versoesPorMsg.get(v.mensagem_id).push(v);
  }
  const pend = porAluno(d.pendencias), msgs = porAluno(d.mensagens), resp = porAluno(d.respostas);
  const cursos = new Map(d.cursos.map((c) => [c.id, c]));
  const alunos = new Map();
  for (const a of d.alunos) {
    const mensagens = (msgs.get(a.id) || []).map((m) => {
      const versoes = (versoesPorMsg.get(m.id) || []).sort((x, y) => x.versao - y.versao);
      const concluidas = versoes.filter((v) => v.estado_geracao === "concluida");
      return { ...m, versoes, vigente: concluidas.at(-1) || null,
               ultimaFalha: versoes.at(-1)?.estado_geracao === "falhou" ? versoes.at(-1) : null,
               gerando: versoes.some((v) => v.estado_geracao === "gerando") };
    }).sort((x, y) => x.data_referencia.localeCompare(y.data_referencia));
    alunos.set(a.id, {
      ...a,
      curso: cursos.get(a.curso_id) || null,
      pendencias: PENDENCIAS.map((def) => (pend.get(a.id) || []).find((p) => p.tipo === def.tipo)).filter(Boolean),
      mensagens,
      respostas: (resp.get(a.id) || []).sort((x, y) => x.respondida_em.localeCompare(y.respondida_em)),
    });
  }
  return alunos;
}

export const msgHoje = (a, hoje = hojeLocal()) => a.mensagens.find((m) => m.data_referencia === hoje) || null;
export const primeiroContato = (a, hoje = hojeLocal()) =>
  !a.mensagens.some((m) => m.data_referencia < hoje && m.vigente);
export const diaAcompanhamento = (a, hoje = hojeLocal()) =>
  msgHoje(a, hoje)?.dia_acompanhamento ?? a.mensagens.filter((m) => m.data_referencia < hoje && m.vigente).length + 1;
export const sugerido = (a, hoje = hojeLocal()) =>
  tomSugerido({ primeiroContato: primeiroContato(a, hoje), dias: diasEmAberto(a, hoje), prazo: prazo() });

/** Estado da mensagem de hoje: a_gerar | gerando | falhou | pronta | enviada */
export function statusMensagemHoje(a, hoje = hojeLocal()) {
  const m = msgHoje(a, hoje);
  if (!m) return "a_gerar";
  if (m.gerando) return "gerando";
  if (!m.vigente) return m.ultimaFalha ? "falhou" : "a_gerar";
  return m.estado_envio === "enviada" ? "enviada" : "pronta";
}

/** Aluno que deve receber mensagem hoje (dia útil, ativo, com pendência, sem mensagem pronta). */
export const precisaGerarHoje = (a, agora = new Date()) =>
  diaUtil(agora) && ativo(a) && temPendenciaAberta(a) && !msgHoje(a, hojeLocal(agora))?.vigente;

export const mensagemPendenteHoje = (a, agora = new Date()) =>
  diaUtil(agora) && ativo(a) && temPendenciaAberta(a) && statusMensagemHoje(a, hojeLocal(agora)) !== "enviada";

// ---------- Filtros ------------------------------------------------------------
const filtros = { pos: "", busca: "", situacao: "", msg: "", mostrar: "ativos", quadro: "" };

const QUADROS = [
  { k: "acompanhamento", rot: "Em acompanhamento", teste: (a) => ativo(a) },
  { k: "contrato", rot: "Não assinou contrato", teste: (a) => ativo(a) && abertaTipo(a, "contrato") },
  { k: "documentacao", rot: "Sem documentação", teste: (a) => ativo(a) && abertaTipo(a, "documentacao") },
  { k: "acesso", rot: "Nunca acessou", teste: (a) => ativo(a) && abertaTipo(a, "acesso") },
  { k: "vencendo", rot: "Vencendo ou vencido", cls: "ambar", teste: (a) => vencendoOuVencido(a, hojeLocal(), prazo()) },
  { k: "msg_hoje", rot: "Mensagens pendentes hoje", cls: "azulc", teste: (a) => mensagemPendenteHoje(a) },
  { k: "resolvidas", rot: "Pendências resolvidas", cls: "verde", teste: (a) => concluido(a) },
];
const abertaTipo = (a, tipo) => a.pendencias.some((p) => p.tipo === tipo && p.marcada && p.estado === "pendente");

function aplicarFiltros(lista) {
  const hoje = hojeLocal();
  const termo = filtros.busca.trim().toLowerCase();
  const digitos = termo.replace(/\D/g, "");
  return lista.filter((a) => {
    if (filtros.quadro) {
      if (!QUADROS.find((q) => q.k === filtros.quadro).teste(a)) return false;
    } else if (filtros.mostrar === "resolvidas" ? !concluido(a) : !ativo(a)) return false;
    if (filtros.pos === "nao_sei" ? a.curso_id !== null : filtros.pos && String(a.curso_id) !== filtros.pos) return false;
    if (termo) {
      const ok = (a.nome || "").toLowerCase().includes(termo) || (a.email || "").toLowerCase().includes(termo)
        || (digitos.length >= 3 && (a.telefone || "").replace(/\D/g, "").includes(digitos));
      if (!ok) return false;
    }
    if (filtros.situacao) {
      if (["acesso", "contrato", "documentacao"].includes(filtros.situacao) && !abertaTipo(a, filtros.situacao)) return false;
      if (filtros.situacao === "vencido" && !(temPendenciaAberta(a) && diasEmAberto(a, hoje) > prazo())) return false;
      if (filtros.situacao === "vencendo" && !vencendoOuVencido(a, hoje, prazo())) return false;
      if (filtros.situacao === "no_prazo" && !(ativo(a) && diasEmAberto(a, hoje) < prazo() - 1)) return false;
    }
    if (filtros.msg) {
      const s = statusMensagemHoje(a, hoje);
      if (filtros.msg === "pronta" && s !== "pronta") return false;
      if (filtros.msg === "enviada" && s !== "enviada") return false;
      if (filtros.msg === "a_gerar" && !["a_gerar", "falhou"].includes(s)) return false;
    }
    return true;
  });
}

// ---------- Tela: Painel do dia --------------------------------------------
export function renderPainel(raiz) {
  const hoje = hojeLocal();
  const todos = [...estado.alunos.values()];
  const cfg = estado.config || {};

  raiz.innerHTML = `
    <div class="container">
      ${barraUsuario()}
      <header class="cabecalho">
        <div>
          <div class="rotulo-topo">Sucesso do Aluno · Pós-graduação</div>
          <h1>Acompanhamento de alunos</h1>
          <div class="muted">${esc(dataPorExtenso())} · mensagens prontas às 9h, de segunda a sexta</div>
        </div>
        <div class="acoes">
          <a class="btn" href="#/configuracoes">Configurações</a>
          <a class="btn btn-primario" href="#/novo">+ Cadastrar aluno</a>
        </div>
      </header>
      ${!(cfg.assinante || "").trim() ? `<div class="aviso alerta"><span>O nome de quem assina as mensagens ainda não foi configurado. O agente não vai inventar um nome.</span>
        <a class="btn btn-sm" href="#/configuracoes">Configurar agora</a></div>` : ""}
      <div id="banner-geracao">${bannerGeracao()}</div>
      ${todos.length === 0 ? `
        <div class="cartao vazio">
          <h2>Nenhum aluno cadastrado ainda</h2>
          <p class="muted">Cadastre o primeiro aluno para começar o acompanhamento.</p>
          <a class="btn btn-primario" href="#/novo">Cadastrar aluno</a>
        </div>` : `
      <section class="resumos" aria-label="Resumo do dia">
        ${QUADROS.map((q) => `
          <button type="button" class="card-resumo ${q.cls || ""} ${filtros.quadro === q.k ? "ativo" : ""}" data-quadro="${q.k}"
                  aria-pressed="${filtros.quadro === q.k}">
            <span class="num">${todos.filter(q.teste).length}</span><span class="rot">${esc(q.rot)}</span>
          </button>`).join("")}
      </section>
      <div class="filtros-pos" role="group" aria-label="Filtrar por pós-graduação">
        <button type="button" class="chip ${filtros.pos === "" ? "ativo" : ""}" data-pos="">Todas as pós<span class="qtd">${todos.length}</span></button>
        ${estado.cursos.map((c) => `<button type="button" class="chip ${filtros.pos === String(c.id) ? "ativo" : ""}" data-pos="${c.id}">
          ${esc(c.nome_curto)}<span class="qtd">${todos.filter((a) => a.curso_id === c.id).length}</span></button>`).join("")}
        ${todos.some((a) => a.curso_id === null) ? `<button type="button" class="chip ${filtros.pos === "nao_sei" ? "ativo" : ""}" data-pos="nao_sei">
          Curso não informado<span class="qtd">${todos.filter((a) => a.curso_id === null).length}</span></button>` : ""}
      </div>
      <div class="filtros">
        <div class="busca"><label class="sr-only" for="f-busca">Buscar</label>
          <input id="f-busca" type="search" placeholder="Buscar por nome, e-mail ou telefone" value="${esc(filtros.busca)}"></div>
        <div><label class="sr-only" for="f-situacao">Situação</label>
          <select id="f-situacao">
            ${[["", "Todas as situações"], ["acesso", "Nunca acessou"], ["contrato", "Não assinou contrato"],
               ["documentacao", "Sem documentação"], ["vencendo", "Vencendo ou vencido"], ["vencido", "Prazo vencido"],
               ["no_prazo", "Dentro do prazo"]].map(([v, t]) => `<option value="${v}" ${filtros.situacao === v ? "selected" : ""}>${t}</option>`).join("")}
          </select></div>
        <div><label class="sr-only" for="f-msg">Mensagem de hoje</label>
          <select id="f-msg">
            ${[["", "Mensagem de hoje: todas"], ["pronta", "Pronta para enviar"], ["enviada", "Enviada"], ["a_gerar", "A gerar"]]
              .map(([v, t]) => `<option value="${v}" ${filtros.msg === v ? "selected" : ""}>${t}</option>`).join("")}
          </select></div>
        <div><label class="sr-only" for="f-mostrar">Mostrar</label>
          <select id="f-mostrar" ${filtros.quadro ? "disabled" : ""}>
            <option value="ativos" ${filtros.mostrar === "ativos" ? "selected" : ""}>Mostrar: Em acompanhamento</option>
            <option value="resolvidas" ${filtros.mostrar === "resolvidas" ? "selected" : ""}>Mostrar: Pendências resolvidas</option>
          </select></div>
      </div>
      ${filtros.quadro ? `<p class="small muted">Filtrando pelo quadro “${esc(QUADROS.find((q) => q.k === filtros.quadro).rot)}”.
        <button type="button" class="btn-link" id="limpar-quadro">Limpar</button></p>` : ""}
      <div id="area-tabela"></div>
      <p class="rodape-tabela">O aluno sai do acompanhamento quando todas as pendências dele são marcadas como resolvidas. Se ele só responder, continua recebendo mensagens.</p>`}
    </div>`;

  ligarBannerGeracao(raiz);
  if (todos.length === 0) return;
  renderTabela();

  $$("[data-quadro]", raiz).forEach((b) => b.addEventListener("click", () => {
    filtros.quadro = filtros.quadro === b.dataset.quadro ? "" : b.dataset.quadro;
    renderPainel(raiz);
  }));
  $$("[data-pos]", raiz).forEach((b) => b.addEventListener("click", () => { filtros.pos = b.dataset.pos; renderPainel(raiz); }));
  $("#limpar-quadro", raiz)?.addEventListener("click", () => { filtros.quadro = ""; renderPainel(raiz); });
  $("#f-busca", raiz).addEventListener("input", (e) => { filtros.busca = e.target.value; renderTabela(); });
  for (const [id, chave] of [["#f-situacao", "situacao"], ["#f-msg", "msg"], ["#f-mostrar", "mostrar"]]) {
    $(id, raiz).addEventListener("change", (e) => { filtros[chave] = e.target.value; renderTabela(); });
  }
}

const ROTULO_MSG = {
  a_gerar: ["A gerar", ""], gerando: ["Gerando…", "azulc"], falhou: ["Falhou — tentar de novo", "verm"],
  pronta: ["Pronta para enviar", "azulc"], enviada: ["Enviada", "verde"],
};

export function renderTabela() {
  const area = $("#area-tabela");
  if (!area) return;
  const hoje = hojeLocal();
  const lista = aplicarFiltros([...estado.alunos.values()])
    .sort((x, y) => diasEmAberto(y, hoje) - diasEmAberto(x, hoje) || (x.nome || "").localeCompare(y.nome || "", "pt-BR"));
  if (!lista.length) {
    area.innerHTML = `<div class="cartao vazio">Nenhum aluno encontrado com estes filtros.</div>`;
    return;
  }
  area.innerHTML = `
    <div class="tabela-rolagem">
      <table>
        <thead><tr><th>Aluno</th><th>Pendências</th><th>Pós</th><th>Perfil</th><th>Dias em aberto</th><th>Tom de hoje</th><th>Mensagem</th></tr></thead>
        <tbody>
          ${lista.map((a) => {
            const dias = diasEmAberto(a, hoje);
            const sit = situacaoPrazo(dias, prazo());
            const m = msgHoje(a, hoje);
            const st = statusMensagemHoje(a, hoje);
            const [rot, cls] = ROTULO_MSG[st];
            const tom = m?.vigente?.tom || (ativo(a) && temPendenciaAberta(a) ? sugerido(a, hoje) : "");
            const ultimaResposta = a.respostas.at(-1);
            const pend = a.pendencias.filter((p) => p.marcada).map((p) => {
              const def = PENDENCIAS.find((d) => d.tipo === p.tipo);
              return p.estado === "resolvida"
                ? `<span class="tag verde">${esc(def.curto)} ✓</span>`
                : `<span class="tag">${esc(def.curto)} · ${diasPendencia(a, p, hoje)}d</span>`;
            }).join("") || `<span class="muted small">Nenhuma marcada</span>`;
            return `<tr tabindex="0" data-id="${esc(a.id)}">
              <td><strong>${esc(a.nome || "Sem nome")}</strong><span class="sub">${esc(a.telefone || "—")}</span>
                ${ultimaResposta ? `<span class="sub">Respondeu em ${esc(formatarDiaMes(ultimaResposta.respondida_em))}</span>` : ""}</td>
              <td>${pend}</td>
              <td>${esc(a.curso?.nome_curto || "Não informado")}</td>
              <td>${esc(a.momento_profissional && a.momento_profissional !== "nao_sei" ? MOMENTOS[a.momento_profissional] : "—")}</td>
              <td>${concluido(a) ? `<span class="tag verde">Concluído</span>`
                : temPendenciaAberta(a) ? `<strong class="${sit.classe === "vencido" ? "vencido" : ""}">${dias}</strong>
                  <span class="sub ${esc(sit.classe)}">${esc(sit.texto)}</span>` : "—"}</td>
              <td>${tom ? `<span class="tag tom-${esc(tom)}">${esc(tom)}</span>` : "—"}</td>
              <td>${concluido(a) || !temPendenciaAberta(a) ? "—" : `<span class="tag ${cls}">${rot}</span>`}</td>
            </tr>`;
          }).join("")}
        </tbody>
      </table>
    </div>`;
  $$("tbody tr", area).forEach((tr) => {
    const abrir = () => ir(`#/aluno/${tr.dataset.id}`);
    tr.addEventListener("click", abrir);
    tr.addEventListener("keydown", (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); abrir(); } });
  });
}

export function barraUsuario() {
  const p = estado.perfil;
  return `<div class="barra-usuario"><span>${esc(p?.nome || p?.email || "")}${p?.papel === "admin" ? " · administrador" : ""}</span>
    <button type="button" class="btn-link" data-acao="sair">Sair</button></div>`;
}

// ---------- Tela: Cadastro e edição ---------------------------------------
export function renderFormulario(raiz, id = null) {
  const a = id ? estado.alunos.get(id) : null;
  if (id && !a) { toast("Aluno não encontrado.", "erro"); ir("#/"); return; }
  const v = (c) => esc(a?.[c] ?? "");
  const pend = (tipo) => a?.pendencias.find((p) => p.tipo === tipo);

  raiz.innerHTML = `
    <div class="container">
      ${barraUsuario()}
      <a class="btn btn-sm voltar" href="${a ? `#/aluno/${esc(a.id)}` : "#/"}">← Voltar</a>
      <h1>${a ? "Editar dados do aluno" : "Cadastrar aluno"}</h1>
      <p class="muted">Nenhum campo é obrigatório.</p>
      <form id="form-aluno" class="form-layout" novalidate>
        <div>
          <section class="cartao">
            <h2 class="cartao-titulo">Dados do aluno</h2>
            <div class="campo"><label for="nome">Nome</label><input id="nome" name="nome" type="text" maxlength="160" autocomplete="off" value="${v("nome")}"></div>
            <div class="grade-2">
              <div class="campo"><label for="email">E-mail</label><input id="email" name="email" type="email" maxlength="254" autocomplete="off" value="${v("email")}"></div>
              <div class="campo"><label for="telefone">Telefone/WhatsApp</label><input id="telefone" name="telefone" type="tel" maxlength="40" autocomplete="off" value="${v("telefone")}"></div>
            </div>
            <div class="campo"><label for="data_compra">Data da compra</label><input id="data_compra" name="data_compra" type="date" value="${v("data_compra")}" min="2015-01-01" max="2100-12-31"></div>
          </section>
          <section class="cartao">
            <h2 class="cartao-titulo">Pendências</h2>
            ${PENDENCIAS.map((def) => {
              const p = pend(def.tipo);
              const marcada = p ? p.marcada : false;
              return `<div class="pend-form">
                <label class="check"><input type="checkbox" name="p_${def.tipo}" ${marcada ? "checked" : ""}> ${esc(def.rotulo)}
                  ${p?.marcada && p.estado === "resolvida" ? `<span class="tag verde">resolvida</span>` : ""}</label>
                <div><label class="sr-only" for="d_${def.tipo}">Pendente há N dias</label>
                  <input id="d_${def.tipo}" name="d_${def.tipo}" type="number" min="0" max="3650" inputmode="numeric"
                         placeholder="Pendente há N dias" value="${p?.dias_informados ?? ""}"></div>
              </div>`;
            }).join("")}
            <p class="dica">Em branco: contamos a partir da data da compra, ou de hoje se ela também não for informada.</p>
          </section>
          <section class="cartao">
            <h2 class="cartao-titulo">Perguntas do agente</h2>
            <fieldset class="sem-moldura">
              <legend>Momento profissional</legend>
              <div class="opcoes">
                ${[["transicao", "Transição de carreira"], ["especializacao", "Especialização"], ["nao_sei", "Não sei"]].map(([k, t]) =>
                  `<label class="opcao"><input type="radio" name="momento_profissional" value="${k}" ${a?.momento_profissional === k ? "checked" : ""}><span>${t}</span></label>`).join("")}
              </div>
            </fieldset>
            <div class="campo"><label for="dor_principal">Dor principal</label>
              <textarea id="dor_principal" name="dor_principal" maxlength="2000" placeholder="O que o aluno quer resolver com a pós?">${v("dor_principal")}</textarea></div>
            <div class="campo"><label for="curso_id">Curso</label>
              <select id="curso_id" name="curso_id">
                <option value="">Não sei</option>
                ${estado.cursos.map((c) => `<option value="${c.id}" ${a?.curso_id === c.id ? "selected" : ""}>${esc(c.nome)}</option>`).join("")}
              </select></div>
            <div class="campo"><label for="observacoes">Observações</label>
              <textarea id="observacoes" name="observacoes" maxlength="4000" placeholder="Informações que o agente deve considerar em todas as mensagens futuras">${v("observacoes")}</textarea></div>
          </section>
        </div>
        <aside class="lateral-fixa">
          <div class="cartao">
            <h2 class="cartao-titulo">Resumo</h2>
            <dl class="resumo-lateral" id="resumo-lateral"></dl>
            <div class="pilha">
              ${a ? `<button type="submit" class="btn btn-primario largura-total" data-modo="salvar">Salvar alterações</button>`
                  : `<button type="submit" class="btn btn-primario largura-total" data-modo="gerar">Salvar e gerar 1ª mensagem</button>
                     <button type="submit" class="btn largura-total" data-modo="salvar">Só salvar</button>`}
            </div>
          </div>
        </aside>
      </form>
    </div>`;

  const form = $("#form-aluno", raiz);
  const ler = () => {
    const f = new FormData(form);
    const dados = {
      nome: (f.get("nome") || "").trim(), email: (f.get("email") || "").trim(), telefone: (f.get("telefone") || "").trim(),
      data_compra: f.get("data_compra") || "", curso_id: f.get("curso_id") ? Number(f.get("curso_id")) : null,
      momento_profissional: f.get("momento_profissional") || null,
      dor_principal: (f.get("dor_principal") || "").trim(), observacoes: (f.get("observacoes") || "").trim(),
    };
    const pendencias = PENDENCIAS.map((def) => {
      const bruto = f.get(`d_${def.tipo}`);
      return { tipo: def.tipo, marcada: f.get(`p_${def.tipo}`) === "on",
               dias_informados: bruto === "" || bruto === null ? null : Math.max(0, Math.min(3650, parseInt(bruto, 10) || 0)) };
    });
    return { dados, pendencias };
  };

  const atualizarResumo = () => {
    const { dados, pendencias } = ler();
    const hoje = hojeLocal();
    const simulado = {
      data_compra: dados.data_compra || null, data_cadastro: a?.data_cadastro || hoje,
      pendencias: pendencias.filter((p) => p.marcada).map((p) => {
        const atual = pend(p.tipo);
        const mesmaContagem = atual && atual.marcada && atual.dias_informados === p.dias_informados;
        return { tipo: p.tipo, marcada: true, estado: atual?.marcada ? atual.estado : "pendente",
                 resolvida_em: atual?.marcada ? atual.resolvida_em : null, dias_informados: p.dias_informados,
                 data_referencia: mesmaContagem ? atual.data_referencia : hoje };
      }),
      mensagens: a?.mensagens || [],
    };
    const dias = diasEmAberto(simulado, hoje);
    const sit = situacaoPrazo(dias, prazo());
    const tom = tomSugerido({ primeiroContato: a ? primeiroContato(a, hoje) : true, dias, prazo: prazo() });
    $("#resumo-lateral", raiz).innerHTML = `
      <dt>Dias em aberto</dt><dd>${temPendenciaAberta(simulado) ? dias : "—"}</dd>
      <dt>Prazo configurado</dt><dd>${prazo()} dias</dd>
      <dt>Situação do prazo</dt><dd class="${esc(sit.classe)}">${temPendenciaAberta(simulado) ? esc(sit.texto) : "sem pendência aberta"}</dd>
      <dt>Tom sugerido</dt><dd><span class="tag tom-${esc(tom)}">${esc(tom)}</span></dd>`;
  };
  form.addEventListener("input", atualizarResumo);
  atualizarResumo();

  let modo = "salvar";
  $$("button[type=submit]", form).forEach((b) => b.addEventListener("click", () => { modo = b.dataset.modo; }));
  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    const botao = $(`button[data-modo="${modo}"]`, form);
    const { dados, pendencias } = ler();
    if (dados.email && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(dados.email)) { toast("Confira o e-mail informado.", "erro"); return; }
    if (dados.telefone && !/^[0-9+()\s.-]*$/.test(dados.telefone)) { toast("O telefone deve ter só números e símbolos como ( ) + -.", "erro"); return; }
    // Só envia "dias" de pendências cujo número mudou (não reinicia a contagem).
    const pendEnviar = pendencias.map((p) => {
      const atual = pend(p.tipo);
      const saida = { tipo: p.tipo, marcada: p.marcada };
      if (!atual || atual.dias_informados !== p.dias_informados) saida.dias_informados = p.dias_informados;
      return saida;
    });
    await comBotao(botao, "Salvando…", async () => {
      try {
        let alvo = id;
        if (a) await api.atualizarAluno(a.id, dados, pendEnviar);
        else alvo = await api.criarAluno(dados, pendEnviar);
        await recarregar();
        toast("Dados salvos.", "ok");
        if (!a && modo === "gerar") {
          sessionStorage.setItem("gerar-primeira", alvo);
        }
        ir(`#/aluno/${alvo}`);
      } catch (erro) {
        toast(erro.message || "Não foi possível salvar.", "erro");
      }
    });
  });
}
