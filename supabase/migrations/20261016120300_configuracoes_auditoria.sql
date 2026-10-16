-- =====================================================================
-- Painel de Follow-up | 004 — Configurações e auditoria
-- =====================================================================

create table public.configuracoes (
  id                 smallint primary key default 1 check (id = 1),   -- linha única
  assinante          text not null default '' check (char_length(assinante) <= 120),
  prazo_padrao       integer not null default 7 check (prazo_padrao between 1 and 90),
  link_acesso        text not null default '' check (char_length(link_acesso) <= 500
                       and (link_acesso = '' or link_acesso ~* '^https?://')),
  link_contrato      text not null default '' check (char_length(link_contrato) <= 500
                       and (link_contrato = '' or link_contrato ~* '^https?://')),
  link_documentacao  text not null default '' check (char_length(link_documentacao) <= 500
                       and (link_documentacao = '' or link_documentacao ~* '^https?://')),
  atualizado_em      timestamptz not null default now(),
  atualizado_por     uuid
);
insert into public.configuracoes (id) values (1);

create trigger configuracoes_atualizacao before update on public.configuracoes
  for each row execute function privado.carimbar_atualizacao();

-- =====================================================================
-- Auditoria: quem mudou o quê e quando (somente inserção via gatilho)
-- =====================================================================
create table public.auditoria (
  id           bigint generated always as identity primary key,
  tabela       text not null,
  registro_id  text not null,
  operacao     text not null check (operacao in ('INSERT', 'UPDATE', 'DELETE')),
  antes        jsonb,
  depois       jsonb,
  usuario_id   uuid,
  criado_em    timestamptz not null default now()
);
create index auditoria_registro_idx on public.auditoria (tabela, registro_id, criado_em desc);
create index auditoria_data_idx     on public.auditoria (criado_em desc);

create or replace function privado.auditar()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_antes  jsonb := case when tg_op in ('UPDATE', 'DELETE') then to_jsonb(old) end;
  v_depois jsonb := case when tg_op in ('INSERT', 'UPDATE') then to_jsonb(new) end;
begin
  -- não registra atualizações que só mexeram em carimbos de data
  if tg_op = 'UPDATE' and (v_antes - 'atualizado_em' - 'atualizado_por')
                        = (v_depois - 'atualizado_em' - 'atualizado_por') then
    return null;
  end if;
  insert into public.auditoria (tabela, registro_id, operacao, antes, depois, usuario_id)
  values (tg_table_name, coalesce(v_depois ->> 'id', v_antes ->> 'id'), tg_op, v_antes, v_depois, auth.uid());
  return null;
end $$;

create trigger auditoria_alunos        after insert or update or delete on public.alunos
  for each row execute function privado.auditar();
create trigger auditoria_configuracoes after update on public.configuracoes
  for each row execute function privado.auditar();
create trigger auditoria_perfis        after insert or update or delete on public.perfis
  for each row execute function privado.auditar();
create trigger auditoria_mensagens     after update or delete on public.mensagens
  for each row execute function privado.auditar();
create trigger auditoria_respostas     after insert or delete on public.respostas
  for each row execute function privado.auditar();
