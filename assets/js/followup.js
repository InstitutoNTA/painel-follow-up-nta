// =====================================================================
// Tela de acompanhamento individual (prompt mestre, seção 11).
// =====================================================================
import {
  PENDENCIAS, MOMENTOS, TONS, hojeLocal, diasPendencia, diasEmAberto, situacaoPrazo,
  concluido, temPendenciaAberta, formatarData, diaUtil,
} from "./regras.js";
import { esc, $, $$, toast, comBotao, confirmarEmDoisCliques, copiarTexto } from "./ui.js";
import * as api from "./api.js";
import { estado, prazo, recarregar, ir } from "./app.js";
import { msgHoje, sugerido, diaAcompanhamento, barraUsuario } from "./students.js";
import { gerarUma, gerandoAgora } from "./messages.js";
import { CONFIG } from "./config.js";

const MODO_MODELO = CONFIG.modoMensagens === "modelo";

const tomEscolhido = new Map();   // aluno -> tom selecionado na tela
const rascunho = new Map();       // aluno -> instrução digitada (mantida se a geração falhar)

const dataHora = (iso) => new Intl.DateTimeFormat("pt-BR", {
  timeZone: "America/Sao_Paulo", day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit",
}).format(new Date(iso));

export function renderAcompanhamento(raiz, id) {
  const a = estado.alunos.get(id);
  if (!a) { toast("Aluno não encontrado.", "erro"); ir("#/"); return; }
  const hoje = hojeLocal();
  const dias = diasEmAberto(a, hoje);
  const sit = situacaoPrazo(dias, prazo());
  const fim = concluido(a);
  const m = msgHoje(a, hoje);
  const sug = sugerido(a, hoje);
  const tom = tomEscolhido.get(id) || m?.vigente?.tom || sug;
  const gerando = gerandoAgora.has(id) || m?.gerando;

  raiz.innerHTML = `
    <div class="container">
      ${barraUsuario()}
      <a class="btn btn-sm voltar" href="#/">← Painel do dia</a>
      <header class="cartao" id="cab-aluno">
        <div class="linha entre">
          <div>
            <h1>${esc(a.nome || "Aluno sem nome")}</h1>
            <div class="dados-aluno">
              <span>${esc(a.email || "E-mail não informado")}</span>
              <span>${esc(a.telefone || "Telefone não informado")}</span>
              <span>Compra: ${a.data_compra ? esc(formatarData(a.data_compra)) : "não informada"}</span>
              <span>${esc(a.curso?.nome || "Curso não informado")}</span>
            </div>
          </div>
          <a class="btn" href="#/editar/${esc(a.id)}">Editar dados</a>
        </div>
        <div class="linha mt">
          ${fim ? `<span class="tag verde">Acompanhamento concluído</span>`
               : temPendenciaAberta(a) ? `<span class="tag">Dias em aberto: <strong>&nbsp;${dias}</strong></span>
                 <span class="tag ${sit.classe === "vencido" ? "verm" : sit.classe === "vencendo" ? "ambar" : ""}">${esc(sit.texto)}</span>`
               : `<span class="tag">Nenhuma pendência marcada</span>`}
        </div>
      </header>

      <div class="detalhe">
        <div>
          ${fim ? `<section class="cartao"><div class="aviso ok"><span><strong>Acompanhamento concluído.</strong>
              Todas as pendências foram resolvidas; novas mensagens não são geradas para este aluno.
              Se alguma pendência for desmarcada, ele volta ao acompanhamento.</span></div></section>`
            : cartaoMensagem(a, m, tom, sug, gerando, hoje)}

          <section class="cartao" aria-labelledby="t-resp">
            <h2 id="t-resp" class="cartao-titulo">O aluno respondeu?</h2>
            <form id="form-resposta">
              <label class="sr-only" for="resposta">Resposta do aluno</label>
              <textarea id="resposta" maxlength="4000" placeholder="Cole aqui a resposta do aluno"></textarea>
              <div class="linha mt"><button class="btn btn-primario" type="submit">Salvar resposta</button></div>
            </form>
            ${a.respostas.length ? `<ul class="lista-hist">
              ${[...a.respostas].reverse().map((r) => `<li><div class="small muted">${esc(dataHora(r.respondida_em))}</div>
                <div class="texto-mensagem">${esc(r.texto)}</div></li>`).join("")}</ul>`
              : `<p class="muted small">Nenhuma resposta registrada.</p>`}
          </section>

          <section class="cartao" aria-labelledby="t-hist">
            <h2 id="t-hist" class="cartao-titulo">Histórico de mensagens</h2>
            ${historico(a)}
          </section>
        </div>

        <aside>
          <section class="cartao" aria-labelledby="t-pend">
            <h2 id="t-pend" class="cartao-titulo">Pendências</h2>
            ${a.pendencias.filter((p) => p.marcada).map((p) => {
              const def = PENDENCIAS.find((d) => d.tipo === p.tipo);
              const resolvida = p.estado === "resolvida";
              return `<div class="pend-linha">
                <label class="check"><input type="checkbox" data-pend="${esc(p.id)}" ${resolvida ? "checked" : ""}>
                  ${esc(def.rotulo)}</label>
                <div class="small ${resolvida ? "" : "muted"}">${resolvida
                  ? `Resolvida em ${esc(formatarData(p.resolvida_em))}`
                  : `Pendente há ${diasPendencia(a, p, hoje)} dias`}</div>
              </div>`;
            }).join("") || `<p class="muted small">Nenhuma pendência marcada. Use “Editar dados” para marcar.</p>`}
            <p class="dica">Marque quando o aluno resolver. Desmarcar reabre a pendência.</p>
          </section>

          <section class="cartao">
            <h2 class="cartao-titulo">Perfil do aluno</h2>
            <dl class="resumo-lateral">
              <dt>Momento profissional</dt><dd>${esc(MOMENTOS[a.momento_profissional] || "Não informado")}</dd>
              <dt>Dor principal</dt><dd>${esc(a.dor_principal || "Não informada")}</dd>
              <dt>Curso</dt><dd>${esc(a.curso?.nome || "Não informado")}</dd>
            </dl>
          </section>

          <section class="cartao">
            <h2 class="cartao-titulo"><label for="obs" class="sr-only">Observações</label>Observações</h2>
            <textarea id="obs" maxlength="4000" placeholder="Consideradas em todas as mensagens futuras">${esc(a.observacoes || "")}</textarea>
            <div class="linha mt"><button class="btn" type="button" id="salvar-obs">Salvar observações</button></div>
          </section>

          <section class="cartao">
            <button class="btn btn-perigo largura-total" type="button" id="excluir">Excluir aluno</button>
            <p class="dica">Remove o aluno, as pendências, as mensagens e as respostas dele. A ação não pode ser desfeita.</p>
          </section>
        </aside>
      </div>
    </div>`;

  ligarEventos(raiz, a, m, tom);

  // "Salvar e gerar 1ª mensagem" vindo do cadastro
  try {
    if (sessionStorage.getItem("gerar-primeira") === id) {
      sessionStorage.removeItem("gerar-primeira");
      if (!fim) gerar(raiz, a, { tom: null, instrucao: "", botao: $("#gerar", raiz) });
    }
  } catch { /* sem storage */ }
}

function cartaoMensagem(a, m, tom, sug, gerando, hoje) {
  const util = diaUtil();
  const v = m?.vigente;
  const enviada = m?.estado_envio === "enviada";
  const falha = !v && m?.ultimaFalha;
  return `
  <section class="cartao" aria-labelledby="t-msg">
    <div class="cartao-titulo">
      <h2 id="t-msg">Mensagem de hoje · dia ${diaAcompanhamento(a, hoje)}</h2>
      <span class="small muted">Sugerido pelo agente: <strong>${esc(sug)}</strong></span>
    </div>
    <div class="tons" role="group" aria-label="Tom da mensagem">
      ${TONS.map((t) => `<button type="button" class="btn btn-sm tom-${t} ${t === tom ? "selecionado" : ""}" data-tom="${t}"
        aria-pressed="${t === tom}">${t}</button>`).join("")}
    </div>
    <details class="recolhido" ${rascunho.get(a.id) ? "open" : ""}>
      <summary>${MODO_MODELO ? "Frase extra para incluir (opcional)" : "O que mudar na mensagem (opcional)"}</summary>
      <label class="sr-only" for="instrucao">${MODO_MODELO ? "Frase extra para incluir na mensagem" : "O que mudar na mensagem"}</label>
      ${MODO_MODELO ? `<p class="dica">A frase entra na mensagem exatamente como você escrever, antes do fechamento.</p>` : ""}
      <textarea id="instrucao" maxlength="1000" placeholder="${MODO_MODELO ? "Ex.: Lembrando que a aula de boas-vindas é na quinta-feira, às 19h." : "Ex.: mencionar que a aula de boas-vindas é quinta-feira"}">${esc(rascunho.get(a.id) || "")}</textarea>
    </details>
    ${!util ? `<div class="aviso info"><span>As mensagens são geradas somente de segunda a sexta-feira.</span></div>` : ""}
    <div id="area-msg">
      ${gerando ? `<div class="carregando"><span class="giro" aria-hidden="true"></span> Gerando a mensagem…</div>`
        : v ? `<div class="texto-mensagem" id="texto-msg">${esc(v.texto)}</div>
               <div class="small muted">Tom ${esc(v.tom)} · versão ${v.versao}${v.modelo === "modelo-automatico" ? " · modelo automático" : ""}${v.instrucao ? ` · ${MODO_MODELO ? "frase extra" : "instrução"}: “${esc(v.instrucao)}”` : ""}</div>`
        : falha ? `<div class="aviso erro"><span>A última tentativa falhou: ${esc(falha.erro || "erro desconhecido")}. Os dados estão salvos.</span></div>`
        : `<p class="muted">Nenhuma mensagem gerada hoje para este aluno.</p>`}
    </div>
    <div class="linha mt">
      ${v ? `<button type="button" class="btn" id="copiar">Copiar mensagem</button>` : ""}
      <button type="button" class="btn ${v ? "" : "btn-primario"}" id="gerar" ${!util || gerando ? "disabled" : ""}>
        ${v ? "Gerar nova mensagem" : falha ? "Tentar de novo" : "Gerar mensagem"}</button>
      ${v ? (enviada
        ? `<span class="tag verde">Enviada ✓</span><button type="button" class="btn-link" id="desfazer">desfazer</button>`
        : `<button type="button" class="btn btn-primario" id="enviada">Marcar como enviada</button>`) : ""}
    </div>
  </section>`;
}

function historico(a) {
  const versoes = a.mensagens.flatMap((m) => m.versoes.filter((v) => v.estado_geracao !== "gerando")
    .map((v) => ({ ...v, data: m.data_referencia, dia: m.dia_acompanhamento })))
    .sort((x, y) => y.criado_em.localeCompare(x.criado_em));
  if (!versoes.length) return `<p class="muted small">Nenhuma mensagem gerada ainda.</p>`;
  return `<ul class="lista-hist">${versoes.map((v) => `<li>
    <div class="linha small">
      <strong>${esc(formatarData(v.data))}</strong><span class="muted">dia ${esc(v.dia ?? "—")} · versão ${v.versao}</span>
      <span class="tag tom-${esc(v.tom)}">${esc(v.tom)}</span>
      ${v.modelo === "modelo-automatico" ? `<span class="tag">Modelo automático</span>` : ""}
      ${v.estado_geracao === "falhou" ? `<span class="tag verm">Falhou</span>`
        : v.enviada_em ? `<span class="tag verde">Enviada</span>` : `<span class="tag">Não enviada</span>`}
    </div>
    ${v.instrucao ? `<div class="small muted">Instrução usada: ${esc(v.instrucao)}</div>` : ""}
    ${v.estado_geracao === "concluida" ? `<details class="recolhido"><summary>Ver texto</summary><div class="texto-mensagem">${esc(v.texto)}</div></details>`
      : `<div class="small muted">${esc(v.erro || "")}</div>`}
  </li>`).join("")}</ul>`;
}

async function gerar(raiz, a, { tom, instrucao, botao }) {
  const area = $("#area-msg", raiz);
  if (area) area.innerHTML = `<div class="carregando"><span class="giro" aria-hidden="true"></span> Gerando a mensagem…</div>`;
  if (botao) botao.disabled = true;
  const r = await gerarUma(a.id, { tom, instrucao, modo: "manual" });
  if (r.status === "concluida") {
    tomEscolhido.delete(a.id);
    rascunho.delete(a.id);               // limpa a instrução da tela (ela fica no histórico)
    toast("Mensagem gerada.", "ok");
  } else {
    if (instrucao) rascunho.set(a.id, instrucao);
    toast(r.aviso || "Não foi possível gerar agora. Tente de novo.", "erro");
  }
  await recarregar().catch(() => {});
  if (location.hash === `#/aluno/${a.id}`) renderAcompanhamento(raiz, a.id);
}

function ligarEventos(raiz, a, m, tomAtual) {
  $$("[data-tom]", raiz).forEach((b) => b.addEventListener("click", () => {
    tomEscolhido.set(a.id, b.dataset.tom);
    $$("[data-tom]", raiz).forEach((x) => {
      const sel = x === b;
      x.classList.toggle("selecionado", sel);
      x.setAttribute("aria-pressed", String(sel));
    });
  }));

  $("#gerar", raiz)?.addEventListener("click", (e) => {
    const tom = tomEscolhido.get(a.id) || $("[data-tom].selecionado", raiz)?.dataset.tom || tomAtual;
    gerar(raiz, a, { tom, instrucao: $("#instrucao", raiz)?.value || "", botao: e.currentTarget });
  });

  $("#copiar", raiz)?.addEventListener("click", async () => {
    const ok = await copiarTexto(m.vigente.texto);       // copiar NÃO altera o envio
    toast(ok ? "Mensagem copiada. Cole no WhatsApp." : "Não foi possível copiar. Selecione o texto manualmente.", ok ? "ok" : "erro");
  });

  const envio = async (botao, enviada) => comBotao(botao, "", async () => {
    try { await api.marcarEnvio(m.id, enviada); await recarregar(); renderAcompanhamento(raiz, a.id); }
    catch (e) { toast(e.message, "erro"); }
  });
  $("#enviada", raiz)?.addEventListener("click", (e) => envio(e.currentTarget, true));
  $("#desfazer", raiz)?.addEventListener("click", (e) => envio(e.currentTarget, false));

  $("#form-resposta", raiz).addEventListener("submit", async (e) => {
    e.preventDefault();
    const texto = $("#resposta", raiz).value.trim();
    if (!texto) { toast("Cole a resposta do aluno antes de salvar.", "erro"); return; }
    await comBotao(e.submitter || $("#form-resposta button", raiz), "Salvando…", async () => {
      try {
        const ultima = [...a.mensagens].reverse().find((x) => x.vigente);
        await api.registrarResposta(a.id, texto, ultima?.id);
        await recarregar();
        toast("Resposta salva. Ela será considerada nas próximas mensagens.", "ok");
        renderAcompanhamento(raiz, a.id);
      } catch (erro) { toast(erro.message, "erro"); }
    });
  });

  $$("[data-pend]", raiz).forEach((c) => c.addEventListener("change", async () => {
    c.disabled = true;
    try {
      await api.resolverPendencia(c.dataset.pend, c.checked);
      await recarregar();
      const atualizado = estado.alunos.get(a.id);
      if (atualizado && concluido(atualizado)) toast("Todas as pendências resolvidas: acompanhamento concluído.", "ok");
      renderAcompanhamento(raiz, a.id);
    } catch (erro) {
      c.checked = !c.checked; c.disabled = false;
      toast(erro.message, "erro");
    }
  }));

  $("#salvar-obs", raiz).addEventListener("click", (e) => comBotao(e.currentTarget, "Salvando…", async () => {
    try { await api.salvarObservacoes(a.id, $("#obs", raiz).value); await recarregar(); toast("Observações salvas.", "ok"); }
    catch (erro) { toast(erro.message, "erro"); }
  }));

  confirmarEmDoisCliques($("#excluir", raiz), "Confirmar exclusão definitiva", async () => {
    try { await api.excluirAluno(a.id); await recarregar(); toast("Aluno excluído.", "ok"); ir("#/"); }
    catch (erro) { toast(erro.message, "erro"); }
  });
}
