// =====================================================================
// Mensagens por MODELO automático (sem IA).
// Monta o texto a partir do tom escolhido e dos dados do aluno, seguindo
// as regras do prompt mestre (seção 14): português do Brasil, tom humano,
// 2 a 4 parágrafos curtos, no máximo um emoji, dias em aberto, ação clara,
// links configurados (ou aviso de que o passo a passo vem em seguida),
// apresentação no primeiro contato e nunca o nome da empresa.
// Arquivo sem dependências do navegador: testável com Node.
// =====================================================================
import { PENDENCIAS, MOMENTOS, diasPendencia, pendenciasAbertas, nomeDoTime } from "./regras.js";

export const MARCA_MODELO = "modelo-automatico";

const ETAPA = { acesso: "Acesso à plataforma", contrato: "Contrato", documentacao: "Documentação" };

const primeiroNome = (nome) => String(nome || "").trim().split(/\s+/)[0] || "";

// Variações por tom: a escolha muda conforme o dia de acompanhamento,
// para o aluno não receber sempre a mesma frase.
const FECHAMENTOS = {
  Acolhedor: [
    "Qualquer dúvida, é só me chamar por aqui que eu te ajudo no que precisar. 😊",
    "Estou por aqui para o que você precisar, combinado? Conte comigo nessa jornada.",
    "Se travar em alguma parte, me chama que resolvemos juntos.",
  ],
  Lembrete: [
    "Consegue separar uns minutinhos hoje para resolver isso? Se surgir qualquer dúvida, me chama.",
    "Que tal resolver ainda hoje? Leva pouco tempo e eu fico à disposição se precisar de ajuda.",
    "Se conseguir fazer isso hoje, já fica tudo certo para você seguir no curso. Estou por aqui.",
  ],
  Firme: [
    "É importante resolver isso nos próximos dias para você não perder o ritmo do curso. Posso te ajudar agora, se quiser.",
    "Preciso da sua ajuda para resolvermos isso o quanto antes. Me responde aqui que te ajudo no passo a passo.",
    "Vamos resolver isso juntos ainda esta semana? Me diz o melhor horário que eu te acompanho.",
  ],
  Urgente: [
    "Preciso falar com você hoje sobre isso. Me responde aqui quando puder que resolvemos juntos rapidinho.",
    "Esse ponto precisa da sua atenção hoje. Me chama aqui que te ajudo a resolver em poucos minutos.",
    "Quero muito te ajudar a resolver isso ainda hoje. Me responde assim que puder, por favor.",
  ],
};

const ABERTURAS = {
  Acolhedor: ["Oi{n}! Tudo bem?", "Olá{n}, tudo certo por aí?", "Oi{n}! Como você está?"],
  Lembrete: ["Oi{n}, tudo bem?", "Olá{n}! Passando rapidinho por aqui.", "Oi{n}! Tudo certo?"],
  Firme: ["Oi{n}, tudo bem?", "Olá{n}, tudo certo?", "Oi{n}!"],
  Urgente: ["Oi{n}, tudo bem?", "Olá{n}!", "Oi{n}, preciso falar com você."],
};

/**
 * @param {object} p
 * @param {object} p.aluno        aluno com pendencias
 * @param {string} p.curso        nome do curso (ou "")
 * @param {object} p.config       configuracoes (assinante, links)
 * @param {string} p.tom          Acolhedor | Lembrete | Firme | Urgente
 * @param {boolean} p.primeiroContato
 * @param {number} p.dia          dia de acompanhamento (para variar o texto)
 * @param {string} p.hoje         AAAA-MM-DD
 * @param {string} [p.extra]      frase extra digitada pela equipe
 */
export function montarMensagemModelo({ aluno, curso, config, tom, primeiroContato, dia = 1, hoje, extra = "" }) {
  const v = Math.max(0, (Number(dia) || 1) - 1);
  const pick = (lista) => lista[v % lista.length];
  const nome = primeiroNome(aluno.nome);
  const assinante = String(config?.assinante || "").trim();
  const time = nomeDoTime(curso);

  // 1) Saudação (+ apresentação no primeiro contato)
  let p1 = pick(ABERTURAS[tom]).replace("{n}", nome ? `, ${nome}` : "");
  if (primeiroContato) {
    p1 += assinante
      ? ` Aqui é ${assinante}, do ${time}. Vou te acompanhar por aqui para garantir que tudo dê certo no seu início.`
      : ` Sou do ${time} e vou te acompanhar por aqui para garantir que tudo dê certo no seu início.`;
  }

  // 2) Pendências com dias em aberto + conexão com a dor/momento
  const abertas = pendenciasAbertas(aluno);
  const itens = abertas.map((p) => {
    const def = PENDENCIAS.find((d) => d.tipo === p.tipo);
    const dias = diasPendencia(aluno, p, hoje);
    return { def, dias };
  });
  const descricao = itens.map(({ def, dias }) =>
    `${def.acao} (${dias === 1 ? "há 1 dia" : `há ${dias} dias`})`);
  let p2 = descricao.length === 1
    ? `Vi que ainda falta ${descricao[0]}.`
    : `Vi que ainda faltam algumas etapas: ${descricao.slice(0, -1).join(", ")} e ${descricao.at(-1)}.`;
  const dor = String(aluno.dor_principal || "").trim().replace(/[.!]+$/, "");
  const momento = aluno.momento_profissional;
  if (dor) {
    p2 += ` Sei que você quer ${dor.charAt(0).toLowerCase()}${dor.slice(1)}, e esse passo é importante para chegar lá.`;
  } else if (momento === "transicao") {
    p2 += " Esse passo é importante para a sua transição de carreira.";
  } else if (momento === "especializacao") {
    p2 += " Esse passo é importante para você aproveitar a especialização desde o começo.";
  }

  // 3) Passo a passo: links configurados ou aviso
  const comLink = itens.filter(({ def }) => String(config?.[def.link] || "").trim());
  const semLink = itens.filter(({ def }) => !String(config?.[def.link] || "").trim());
  const partes = [];
  if (comLink.length === 1) partes.push(`O passo a passo está aqui: ${String(config[comLink[0].def.link]).trim()}`);
  else if (comLink.length > 1) {
    partes.push("Deixo aqui o passo a passo de cada etapa:\n" + comLink.map(({ def }) =>
      `• ${ETAPA[def.tipo]}: ${String(config[def.link]).trim()}`).join("\n"));
  }
  if (semLink.length) {
    partes.push(comLink.length
      ? `Para ${semLink.map(({ def }) => ETAPA[def.tipo].toLowerCase()).join(" e ")}, vou te enviar o passo a passo em seguida.`
      : "Vou te enviar o passo a passo em seguida.");
  }
  const p3 = partes.join(" ");

  // 4) Fechamento conforme o tom
  const p4 = pick(FECHAMENTOS[tom]);

  const frase = String(extra || "").trim();
  return [p1, p2, p3, frase, p4].filter(Boolean).join("\n\n");
}

export const descricaoMomento = (m) => (m && m !== "nao_sei" ? MOMENTOS[m] : "");
export const ehModelo = (modelo) => modelo === MARCA_MODELO;
