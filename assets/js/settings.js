// =====================================================================
// Configurações (seção 12), backup e gestão de usuários (admin).
// =====================================================================
import { esc, $, $$, toast, comBotao } from "./ui.js";
import * as api from "./api.js";
import { estado, recarregar } from "./app.js";
import { barraUsuario } from "./students.js";

export function renderConfiguracoes(raiz) {
  const c = estado.config || {};
  const admin = estado.perfil?.papel === "admin";
  raiz.innerHTML = `
    <div class="container">
      ${barraUsuario()}
      <a class="btn btn-sm voltar" href="#/">← Painel do dia</a>
      <h1>Configurações</h1>
      <p class="muted">Valem para todo o time. Nenhum link é obrigatório: sem link, o agente avisa que vai enviar o passo a passo em seguida.</p>

      <form id="form-config" class="cartao" novalidate>
        <div class="grade-2">
          <div class="campo"><label for="assinante">Nome de quem assina as mensagens</label>
            <input id="assinante" name="assinante" type="text" maxlength="120" value="${esc(c.assinante || "")}"></div>
          <div class="campo"><label for="prazo_padrao">Prazo para resolver pendências (dias)</label>
            <input id="prazo_padrao" name="prazo_padrao" type="number" min="1" max="90" inputmode="numeric" value="${esc(c.prazo_padrao ?? 7)}">
            <div class="dica">Padrão: 7 dias.</div></div>
        </div>
        <div class="campo"><label for="link_acesso">Link do passo a passo para acessar a plataforma</label>
          <input id="link_acesso" name="link_acesso" type="url" maxlength="500" placeholder="https://" value="${esc(c.link_acesso || "")}"></div>
        <div class="campo"><label for="link_contrato">Link do passo a passo para assinar o contrato</label>
          <input id="link_contrato" name="link_contrato" type="url" maxlength="500" placeholder="https://" value="${esc(c.link_contrato || "")}"></div>
        <div class="campo"><label for="link_documentacao">Link do passo a passo para subir a documentação</label>
          <input id="link_documentacao" name="link_documentacao" type="url" maxlength="500" placeholder="https://" value="${esc(c.link_documentacao || "")}"></div>
        <button type="submit" class="btn btn-primario">Salvar configurações</button>
      </form>

      <section class="cartao">
        <h2 class="cartao-titulo">Backup</h2>
        <p class="muted small">O banco online é a fonte oficial dos dados. O backup é uma cópia de segurança com alunos,
          pendências, mensagens (todas as versões), respostas e configurações. Guarde o arquivo em local protegido:
          ele contém dados pessoais.</p>
        <div class="linha">
          <button type="button" class="btn" id="exportar">Exportar backup</button>
          ${admin ? `<label class="btn" for="arquivo-backup">Importar backup</label>
            <input id="arquivo-backup" type="file" accept="application/json,.json" class="sr-only">`
            : `<span class="small muted">Importar backup: somente administradores.</span>`}
        </div>
        <div id="previa-import"></div>
      </section>

      ${admin ? `<section class="cartao" id="usuarios">
        <h2 class="cartao-titulo">Usuários</h2>
        <p class="muted small">Convide pessoas pelo painel do Supabase (Authentication → Users → Invite user). Elas aparecem aqui
          como inativas e só acessam os dados depois de ativadas.</p>
        <div id="lista-usuarios">Carregando…</div>
      </section>` : ""}
    </div>`;

  $("#form-config", raiz).addEventListener("submit", async (e) => {
    e.preventDefault();
    const f = Object.fromEntries(new FormData(e.target));
    const prazo = Number(f.prazo_padrao);
    if (!Number.isInteger(prazo) || prazo < 1 || prazo > 90) { toast("O prazo deve ser um número de 1 a 90 dias.", "erro"); return; }
    for (const k of ["link_acesso", "link_contrato", "link_documentacao"]) {
      if (f[k].trim() && !/^https?:\/\//i.test(f[k].trim())) { toast("Os links devem começar com https:// (ou http://).", "erro"); return; }
    }
    await comBotao(e.submitter, "Salvando…", async () => {
      try { await api.salvarConfig(f); await recarregar(); toast("Configurações salvas.", "ok"); }
      catch (erro) { toast(erro.message, "erro"); }
    });
  });

  $("#exportar", raiz).addEventListener("click", (e) => comBotao(e.currentTarget, "Exportando…", async () => {
    try {
      const dados = await api.exportarBackup();
      const blob = new Blob([JSON.stringify(dados, null, 2)], { type: "application/json" });
      const link = document.createElement("a");
      link.href = URL.createObjectURL(blob);
      link.download = `backup-painel-follow-up-${new Date().toISOString().slice(0, 10)}.json`;
      document.body.appendChild(link); link.click(); link.remove();
      setTimeout(() => URL.revokeObjectURL(link.href), 2000);
      toast(`Backup exportado com ${dados.alunos.length} aluno(s).`, "ok");
    } catch (erro) { toast(erro.message, "erro"); }
  }));

  $("#arquivo-backup", raiz)?.addEventListener("change", (e) => prepararImportacao(raiz, e.target));
  if (admin) carregarUsuarios(raiz);
}

// ---------- Importação: validar → prévia → confirmar ------------------------
async function prepararImportacao(raiz, input) {
  const area = $("#previa-import", raiz);
  const arquivo = input.files?.[0];
  input.value = "";
  if (!arquivo) return;
  if (arquivo.size > 25 * 1024 * 1024) { area.innerHTML = aviso("erro", "Arquivo grande demais (máximo 25 MB)."); return; }
  let dados;
  try { dados = JSON.parse(await arquivo.text()); }
  catch { area.innerHTML = aviso("erro", "O arquivo não é um JSON válido."); return; }
  if (!dados || dados.formato !== "painel-follow-up-nta" || dados.versao !== 1 || !Array.isArray(dados.alunos)) {
    area.innerHTML = aviso("erro", "Este arquivo não é um backup do Painel de Follow-up.");
    return;
  }
  area.innerHTML = `<p class="muted">Conferindo o arquivo…</p>`;
  try {
    const previa = await api.importarBackup(dados, { simular: true, substituirConfig: false });
    area.innerHTML = `
      <div class="aviso alerta"><div>
        <strong>Prévia da importação</strong> (nada foi gravado ainda)<br>
        ${previa.alunos_novos} aluno(s) novo(s) · ${previa.alunos_ignorados} já existente(s) serão ignorados<br>
        ${previa.mensagens_novas} mensagem(ns), ${previa.versoes_novas} versão(ões) e ${previa.respostas_novas} resposta(s)
        <label class="check"><input type="checkbox" id="subst-config"> Substituir também as configurações atuais pelas do arquivo</label>
      </div></div>
      <div class="linha"><button type="button" class="btn btn-primario" id="confirmar-import" ${previa.alunos_novos ? "" : "disabled"}>Confirmar importação</button>
        <button type="button" class="btn" id="cancelar-import">Cancelar</button></div>`;
    $("#cancelar-import", raiz).addEventListener("click", () => { area.innerHTML = ""; });
    $("#confirmar-import", raiz).addEventListener("click", (e) => comBotao(e.currentTarget, "Importando…", async () => {
      try {
        const r = await api.importarBackup(dados, { simular: false, substituirConfig: $("#subst-config", raiz).checked });
        await recarregar();
        area.innerHTML = aviso("ok", `Importação concluída: ${r.alunos_novos} aluno(s) novo(s).`);
      } catch (erro) { area.innerHTML = aviso("erro", erro.message); }
    }));
  } catch (erro) {
    area.innerHTML = aviso("erro", erro.message);
  }
}

const aviso = (tipo, texto) => `<div class="aviso ${tipo}"><span>${esc(texto)}</span></div>`;

// ---------- Usuários --------------------------------------------------------
async function carregarUsuarios(raiz) {
  const area = $("#lista-usuarios", raiz);
  try {
    const perfis = await api.listarPerfis();
    area.innerHTML = `<div class="tabela-rolagem"><table>
      <thead><tr><th>Pessoa</th><th>Papel</th><th>Acesso</th></tr></thead>
      <tbody>${perfis.map((p) => `<tr data-perfil="${esc(p.id)}">
        <td><strong>${esc(p.nome || "—")}</strong><span class="sub">${esc(p.email)}</span></td>
        <td><label class="sr-only" for="papel-${esc(p.id)}">Papel</label>
          <select id="papel-${esc(p.id)}" data-campo="papel">
            <option value="operador" ${p.papel === "operador" ? "selected" : ""}>Operador(a)</option>
            <option value="admin" ${p.papel === "admin" ? "selected" : ""}>Administrador(a)</option></select></td>
        <td><label class="check"><input type="checkbox" data-campo="ativo" ${p.ativo ? "checked" : ""}> Ativo</label></td>
      </tr>`).join("")}</tbody></table></div>`;
    $$("[data-campo]", area).forEach((el) => el.addEventListener("change", async () => {
      const id = el.closest("tr").dataset.perfil;
      const mudanca = el.dataset.campo === "ativo" ? { ativo: el.checked } : { papel: el.value };
      try { await api.atualizarPerfil(id, mudanca); toast("Usuário atualizado.", "ok"); }
      catch (erro) { toast(erro.message, "erro"); carregarUsuarios(raiz); }
    }));
  } catch (erro) {
    area.innerHTML = aviso("erro", erro.message);
  }
}
