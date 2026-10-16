// Utilidades de interface: escape de HTML, avisos e confirmação em 2 cliques.

/** Escapa texto para inserir com segurança em HTML. Use SEMPRE em dados do banco. */
export const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) =>
  ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

export const $ = (sel, raiz = document) => raiz.querySelector(sel);
export const $$ = (sel, raiz = document) => [...raiz.querySelectorAll(sel)];

let timerToast;
export function toast(msg, tipo = "") {
  const t = $("#toast");
  t.textContent = msg;
  t.className = tipo;
  t.hidden = false;
  clearTimeout(timerToast);
  timerToast = setTimeout(() => { t.hidden = true; }, tipo === "erro" ? 6500 : 3800);
}

export const plural = (n, um, varios) => `${n} ${n === 1 ? um : varios}`;

export const carregandoHtml = (texto = "Carregando…") =>
  `<div class="carregando"><span class="giro" aria-hidden="true"></span> ${esc(texto)}</div>`;

/**
 * Botão que exige dois cliques (prompt mestre 11.4). O primeiro muda o
 * botão para o estado de confirmação; sem o segundo em 6 s, volta ao normal.
 */
export function confirmarEmDoisCliques(botao, textoConfirmar, acao) {
  const original = botao.textContent;
  let armado = false, timer;
  const desarmar = () => {
    armado = false; botao.classList.remove("confirmando"); botao.textContent = original;
    botao.removeAttribute("aria-live");
  };
  botao.addEventListener("click", async () => {
    if (!armado) {
      armado = true;
      botao.classList.add("confirmando");
      botao.setAttribute("aria-live", "assertive");
      botao.textContent = textoConfirmar;
      clearTimeout(timer);
      timer = setTimeout(desarmar, 6000);
      return;
    }
    clearTimeout(timer);
    botao.disabled = true;
    botao.textContent = "Excluindo…";
    try { await acao(); } finally { botao.disabled = false; desarmar(); }
  });
}

/** Desativa um botão enquanto a promessa roda. */
export async function comBotao(botao, textoEspera, fn) {
  const original = botao.innerHTML;
  botao.disabled = true;
  if (textoEspera) botao.innerHTML = `<span class="giro" aria-hidden="true"></span> ${esc(textoEspera)}`;
  try { return await fn(); } finally { botao.disabled = false; botao.innerHTML = original; }
}

export async function copiarTexto(texto) {
  try {
    await navigator.clipboard.writeText(texto);
    return true;
  } catch {
    const area = document.createElement("textarea");
    area.value = texto;
    area.setAttribute("readonly", "");
    area.style.position = "fixed"; area.style.opacity = "0";
    document.body.appendChild(area);
    area.select();
    const ok = document.execCommand("copy");
    area.remove();
    return ok;
  }
}
