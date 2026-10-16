-- =====================================================================
-- Painel de Follow-up | 001 — Base: extensões, funções auxiliares,
-- perfis de usuário e cursos
-- =====================================================================
-- Convenções
--   * Esquema "public": tabelas expostas pela API do Supabase (sempre com RLS).
--   * Esquema "privado": funções auxiliares que NÃO são expostas pela API.
--   * Datas "de calendário" usam o fuso America/Sao_Paulo (privado.hoje()).
-- =====================================================================

create extension if not exists pgcrypto with schema extensions;
create extension if not exists pg_trgm  with schema extensions;

create schema if not exists privado;
revoke all on schema privado from public;
grant usage on schema privado to authenticated, service_role;

-- Relógio do sistema ---------------------------------------------------
-- privado.agora() = now(). Só nos testes automatizados o parâmetro de sessão
-- "painel.agora_teste" simula outro horário (ex.: sábado, 8h). Ele não pode ser
-- definido pela API do Supabase: clientes não executam SET.
create or replace function privado.agora()
returns timestamptz
language sql
stable
set search_path = ''
as $$ select coalesce(nullif(current_setting('painel.agora_teste', true), '')::timestamptz, now()) $$;

-- Data de hoje no fuso de Brasília
create or replace function privado.hoje()
returns date
language sql
stable
set search_path = ''
as $$ select (privado.agora() at time zone 'America/Sao_Paulo')::date $$;

-- Atualiza "atualizado_em" e "atualizado_por" ---------------------------
create or replace function privado.carimbar_atualizacao()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.atualizado_em := now();
  new.atualizado_por := auth.uid();
  return new;
end $$;

-- =====================================================================
-- Perfis de usuário (1 linha por usuário do Supabase Auth)
-- =====================================================================
create table public.perfis (
  id            uuid primary key references auth.users (id) on delete cascade,
  nome          text not null default '' check (char_length(nome) <= 120),
  email         text not null default '' check (char_length(email) <= 254),
  papel         text not null default 'operador' check (papel in ('admin', 'operador')),
  -- Novo usuário entra INATIVO: só acessa dados depois que um admin ativar.
  ativo         boolean not null default false,
  criado_em     timestamptz not null default now(),
  atualizado_em timestamptz not null default now(),
  atualizado_por uuid
);
comment on table public.perfis is 'Usuários do painel. Papel admin gerencia usuários; operador usa o painel.';

create trigger perfis_atualizacao before update on public.perfis
  for each row execute function privado.carimbar_atualizacao();

-- Cria o perfil automaticamente quando um usuário é convidado/criado no Auth
create or replace function privado.criar_perfil()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.perfis (id, email, nome)
  values (new.id, coalesce(new.email, ''), coalesce(new.raw_user_meta_data ->> 'nome', ''))
  on conflict (id) do nothing;
  return new;
end $$;

create trigger ao_criar_usuario after insert on auth.users
  for each row execute function privado.criar_perfil();

-- Autorização: usuário logado E ativo? --------------------------------
create or replace function privado.usuario_ativo()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (select 1 from public.perfis p where p.id = auth.uid() and p.ativo)
$$;

create or replace function privado.eh_admin()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (select 1 from public.perfis p where p.id = auth.uid() and p.ativo and p.papel = 'admin')
$$;

revoke all on function privado.usuario_ativo(), privado.eh_admin() from public;
grant execute on function privado.usuario_ativo(), privado.eh_admin(), privado.hoje(), privado.agora() to authenticated, service_role;

-- Impede que um usuário altere o próprio papel/ativação sem ser admin,
-- e que o último admin ativo seja rebaixado ou desativado.
create or replace function privado.proteger_perfis()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if auth.uid() is not null and not privado.eh_admin()
     and (new.papel is distinct from old.papel or new.ativo is distinct from old.ativo) then
    raise exception 'Somente administradores podem alterar papel ou ativação.' using errcode = '42501';
  end if;
  if old.papel = 'admin' and old.ativo and not (new.papel = 'admin' and new.ativo)
     and (select count(*) from public.perfis where papel = 'admin' and ativo) <= 1 then
    raise exception 'O painel precisa de pelo menos um administrador ativo.' using errcode = '23514';
  end if;
  return new;
end $$;

create trigger perfis_protecao before update on public.perfis
  for each row execute function privado.proteger_perfis();

-- =====================================================================
-- Cursos (lista fechada; novos cursos só com autorização)
-- =====================================================================
create table public.cursos (
  id         smallint primary key,
  nome       text not null unique check (char_length(nome) between 1 and 120),
  nome_curto text not null check (char_length(nome_curto) between 1 and 60),
  ordem      smallint not null,
  ativo      boolean not null default true
);

insert into public.cursos (id, nome, nome_curto, ordem) values
  (1, 'Engenharia de Dados e Inteligência Artificial', 'Eng. de Dados e IA',      1),
  (2, 'Inteligência Artificial aplicada a Negócios',   'IA aplicada a Negócios',  2),
  (3, 'Arquitetura Avançada em Cloud com Azure',       'Cloud com Azure',         3),
  (4, 'MBA aplicado ao Direito',                       'MBA aplicado ao Direito', 4),
  (5, 'Defesa Cibernética',                            'Defesa Cibernética',      5);
