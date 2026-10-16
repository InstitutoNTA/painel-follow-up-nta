// As regras de negócio ficam num único arquivo, compartilhado com a
// Edge Function, para que navegador e servidor calculem igual.
export * from "../../supabase/functions/_shared/regras.js";
