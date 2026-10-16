-- =====================================================================
-- Painel de Follow-up | 007 — Mensagens por MODELO automático (sem IA)
-- =====================================================================
-- Usado enquanto a API do Claude não estiver ativa. O navegador monta o
-- texto a partir dos modelos de cada tom e grava por esta função, que
-- reaproveita TODAS as regras da geração com IA (dia útil, uma mensagem
-- por aluno por dia, nada para concluídos, limite de frequência,
-- histórico de versões). A versão fica marcada como modelo = 'modelo-automatico',
-- para nunca ser confundida com texto escrito pela IA.
-- =====================================================================
create or replace function public.gerar_mensagem_modelo(
  p_aluno     uuid,
  p_tom       text,
  p_texto     text,
  p_modo      text,
  p_instrucao text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_reserva jsonb;
  v_fim     jsonb;
begin
  if not privado.usuario_ativo() then
    raise exception 'Sem permissão.' using errcode = '42501';
  end if;
  if coalesce(char_length(btrim(p_texto)), 0) not between 1 and 6000 then
    return jsonb_build_object('status', 'invalido', 'motivo', 'texto');
  end if;

  v_reserva := public.srv_reservar_geracao(p_aluno, auth.uid(), p_tom, p_instrucao, p_modo);
  if v_reserva ->> 'status' <> 'reservada' then
    return v_reserva;
  end if;

  v_fim := public.srv_concluir_geracao((v_reserva ->> 'versao_id')::uuid, p_texto, 'modelo-automatico');
  return v_reserva || v_fim;
end $$;

revoke all on function public.gerar_mensagem_modelo(uuid, text, text, text, text) from public, anon;
grant execute on function public.gerar_mensagem_modelo(uuid, text, text, text, text) to authenticated;
