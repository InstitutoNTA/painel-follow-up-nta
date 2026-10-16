// =====================================================================
// Configuração PÚBLICA do Supabase (prompt mestre 4.4 e 15).
// Estes dois valores SÃO públicos por natureza: a "anon key" só permite
// o que as políticas RLS liberam — sem login, nada. Nunca coloque aqui a
// "service_role key" nem a chave da API do Claude.
// Onde encontrar: Supabase → Project Settings → API.
// =====================================================================
export const CONFIG = {
  supabaseUrl: "",       // ex.: https://abcdefghijkl.supabase.co
  supabaseAnonKey: "",   // chave "anon" / "publishable"
};
