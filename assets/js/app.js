// =====================================================================
// Painel de Follow-up — inicialização, login e navegação.
// Rotas: #/  #/novo  #/editar/:id  #/aluno/:id  #/configuracoes
// =====================================================================
import * as api from "./api.js";
import { esc, $, toast, carregandoHtml, comBotao } from "./ui.js";
import { PRAZO_PADRAO } from "./regras.js";
import { montarAlunos, renderPainel, renderFormulario, renderTabela } from "./students.js";
import { renderAcompanhamento } from "./followup.js";
import { renderConfiguracoes } from "./settings.js";
import { verificarAutomatico, atualizarBanner } from "./messages.js";

export const estado = {
  sessao: null, perfil: null, cursos: [], alunos: new Map(), config: null,
  carregadoEm: 0, erroCarga: "",
};
export const prazo = () => Math.max(1, Number(estado.config?.prazo_padrao) || PRAZO_PADRAO);

const raiz = $("#app");
// Tipo do link de e-mail (convite ou recuperação de senha), lido antes de a biblioteca limpar o endereço
const tipoLink = new URLSearchParams(location.hash.replace(/^#/, "")).get("type")
  || new URLSearchParams(location.search).get("type");
let precisaDefinirSenha = tipoLink === "invite" || tipoLink === "recovery";
let ultimoUsuario = null;

export function ir(hash) {
  if (location.hash === hash) redesenhar(); else location.hash = hash;
}

export async function recarregar() {
  const d = await api.carregarTudo();
  estado.cursos = d.cursos;
  estado.config = d.config;
  estado.alunos = montarAlunos(d);
  estado.carregadoEm = Date.now();
  estado.erroCarga = "";
}

// ---------- Telas sem login -------------------------------------------------
function telaNaoConfigurado() {
  raiz.innerHTML = `<div class="tela-login"><div class="cartao">
    <h1>Painel de Follow-up</h1>
    <div class="aviso alerta mt"><span>O painel ainda não foi conectado ao banco de dados.
      Preencha <strong>assets/js/config.js</strong> com a URL e a chave pública do Supabase (veja o README).</span></div>
  </div></div>`;
}

function telaLogin(mensagem = "") {
  raiz.innerHTML = `<div class="tela-login"><div class="cartao">
    <div class="rotulo-topo">Sucesso do Aluno · Pós-graduação</div>
    <h1>Painel de Follow-up</h1>
    <p class="muted">Entre com o e-mail e a senha do seu acesso individual.</p>
    ${mensagem ? `<div class="aviso info"><span>${esc(mensagem)}</span></div>` : ""}
    <form id="form-login" novalidate>
      <div class="campo"><label for="email">E-mail</label><input id="email" type="email" autocomplete="username" required></div>
      <div class="campo"><label for="senha">Senha</label><input id="senha" type="password" autocomplete="current-password" required></div>
      <button class="btn btn-primario largura-total" type="submit">Entrar</button>
    </form>
    <button type="button" class="btn-link mt" id="esqueci">Esqueci minha senha</button>
  </div></div>`;
  $("#form-login").addEventListener("submit", async (e) => {
    e.preventDefault();
    const email = $("#email").value.trim(), senha = $("#senha").value;
    if (!email || !senha) { toast("Informe e-mail e senha.", "erro"); return; }
    await comBotao(e.submitter, "Entrando…", async () => {
      try { await api.entrar(email, senha); } catch (erro) { toast(erro.message, "erro"); }
    });
  });
  $("#esqueci").addEventListener("click", async () => {
    const email = $("#email").value.trim();
    if (!email) { toast("Digite seu e-mail no campo acima e clique de novo.", "erro"); return; }
    try { await api.enviarRecuperacao(email); } catch { /* não revela se o e-mail existe */ }
    toast("Se o e-mail estiver cadastrado, você receberá um link para criar uma nova senha.", "ok");
  });
}

function telaDefinirSenha() {
  raiz.innerHTML = `<div class="tela-login"><div class="cartao">
    <h1>Defina sua senha</h1>
    <p class="muted">Crie a senha que você vai usar para entrar no painel. Use pelo menos 10 caracteres.</p>
    <form id="form-senha" novalidate>
      <div class="campo"><label for="nova">Nova senha</label><input id="nova" type="password" autocomplete="new-password" minlength="10"></div>
      <div class="campo"><label for="repetir">Repita a senha</label><input id="repetir" type="password" autocomplete="new-password" minlength="10"></div>
      <button class="btn btn-primario largura-total" type="submit">Salvar senha</button>
    </form></div></div>`;
  $("#form-senha").addEventListener("submit", async (e) => {
    e.preventDefault();
    const nova = $("#nova").value, repetir = $("#repetir").value;
    if (nova.length < 10) { toast("A senha precisa ter pelo menos 10 caracteres.", "erro"); return; }
    if (nova !== repetir) { toast("As senhas não são iguais.", "erro"); return; }
    await comBotao(e.submitter, "Salvando…", async () => {
      try {
        await api.definirSenha(nova);
        precisaDefinirSenha = false;
        toast("Senha definida.", "ok");
        history.replaceState(null, "", location.pathname + "#/");
        iniciarSessao();
      } catch { toast("Não foi possível salvar a senha. Peça um novo convite ou link de recuperação.", "erro"); }
    });
  });
}

function telaAguardando() {
  raiz.innerHTML = `<div class="tela-login"><div class="cartao">
    <h1>Acesso aguardando liberação</h1>
    <p>Seu login está correto, mas o acesso aos dados ainda não foi liberado por um administrador.</p>
    <p class="muted small">${esc(estado.sessao?.user?.email || "")}</p>
    <button class="btn" type="button" id="sair">Sair</button></div></div>`;
  $("#sair").addEventListener("click", () => api.sair());
}

// ---------- Navegação --------------------------------------------------------
export function redesenhar() {
  if (!estado.perfil?.ativo) return;
  if (estado.erroCarga) {
    raiz.innerHTML = `<div class="container"><div class="aviso erro"><span>${esc(estado.erroCarga)}</span>
      <button class="btn btn-sm" type="button" id="tentar">Tentar de novo</button></div></div>`;
    $("#tentar").addEventListener("click", () => carregarEExibir());
    return;
  }
  const rota = location.hash.replace(/^#/, "") || "/";
  const [, tela, id] = rota.split("/");
  window.scrollTo(0, 0);
  if (!tela) renderPainel(raiz);
  else if (tela === "novo") renderFormulario(raiz);
  else if (tela === "editar" && id) renderFormulario(raiz, id);
  else if (tela === "aluno" && id) renderAcompanhamento(raiz, id);
  else if (tela === "configuracoes") renderConfiguracoes(raiz);
  else { location.hash = "#/"; return; }
  raiz.querySelector('[data-acao="sair"]')?.addEventListener("click", () => api.sair());
}

async function carregarEExibir() {
  raiz.innerHTML = carregandoHtml("Carregando os dados…");
  try {
    await recarregar();
  } catch (erro) {
    estado.erroCarga = erro.message || "Não foi possível carregar os dados.";
  }
  redesenhar();
  if (!estado.erroCarga) verificarAutomatico();
}

async function iniciarSessao() {
  estado.sessao = await api.sessaoAtual();
  if (!estado.sessao) { telaLogin(); return; }
  ultimoUsuario = estado.sessao.user.id;
  if (precisaDefinirSenha) { telaDefinirSenha(); return; }
  try {
    estado.perfil = await api.meuPerfil(estado.sessao.user.id);
  } catch {
    raiz.innerHTML = `<div class="container"><div class="aviso erro"><span>Não foi possível conferir seu acesso. Verifique a conexão.</span>
      <button class="btn btn-sm" type="button" id="tentar">Tentar de novo</button></div></div>`;
    $("#tentar").addEventListener("click", iniciarSessao);
    return;
  }
  if (!estado.perfil?.ativo) { telaAguardando(); return; }
  await carregarEExibir();
}

// ---------- Início ------------------------------------------------------------
if (!api.configurado) {
  telaNaoConfigurado();
} else {
  api.aoMudarSessao((evento, sessao) => {
    if (evento === "PASSWORD_RECOVERY") { precisaDefinirSenha = true; telaDefinirSenha(); return; }
    if (evento === "SIGNED_OUT") {
      ultimoUsuario = null;
      Object.assign(estado, { sessao: null, perfil: null, alunos: new Map(), config: null });
      telaLogin("Você saiu do painel.");
      return;
    }
    if (evento === "SIGNED_IN" && sessao?.user?.id !== ultimoUsuario) {
      ultimoUsuario = sessao?.user?.id;
      setTimeout(iniciarSessao, 0);   // fora do callback da biblioteca
    }
  });
  window.addEventListener("hashchange", () => {
    if (/access_token|error_description/.test(location.hash)) return;
    redesenhar();
  });
  // Atualiza ao voltar para a aba (ex.: outra pessoa alterou dados em outro navegador)
  window.addEventListener("focus", async () => {
    if (!estado.perfil?.ativo || Date.now() - estado.carregadoEm < 30_000) return;
    try {
      await recarregar();
      if ((location.hash || "#/") === "#/") { renderTabela(); atualizarBanner(); }
      verificarAutomatico();
    } catch { /* tenta de novo no próximo foco */ }
  });
  // Muda o indicador quando passa das 9h com o painel aberto
  setInterval(() => { if (estado.perfil?.ativo) { atualizarBanner(); verificarAutomatico(); } }, 60_000);
  iniciarSessao();
}
