// =====================================================================
// Configuração PÚBLICA do Supabase (prompt mestre 4.4 e 15).
// Estes dois valores SÃO públicos por natureza: a "anon key" só permite
// o que as políticas RLS liberam — sem login, nada. Nunca coloque aqui a
// "service_role key" nem a chave da API do Claude.
// Onde encontrar: Supabase → Project Settings → API.
// =====================================================================
export const CONFIG = {
  supabaseUrl: "https://seqzfanzbkgkbukzvmkf.supabase.co",
  supabaseAnonKey: "sb_publishable_C_V3ge45gBSxWxOyeTthCQ_tg4YQM_g",   // chave pública "publishable"
  // Como as mensagens são escritas:
  //  "modelo" = modelos automáticos prontos, sem custo (padrão atual);
  //  "ia"     = API do Claude pela função de servidor (exige a chave nos segredos do Supabase).
  modoMensagens: "modelo",
};
