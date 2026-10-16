-- =====================================================================
-- Painel de Follow-up | 005 — Permissões e políticas RLS
-- =====================================================================
-- Princípios
--   * Visitante sem login (anon): não lê nem grava NADA.
--   * Usuário logado mas INATIVO: não lê nem grava dados de alunos.
--   * Operador ativo: usa o painel (alunos, pendências, envio, respostas,
--     configurações).
--   * Admin ativo: tudo do operador + gerenciar usuários, excluir alunos e
--     consultar a auditoria.
--   * Textos de mensagens geradas: gravados só pelo servidor (service_role).
-- =====================================================================

-- 1) Liga RLS em todas as tabelas ------------------------------------------
alter table public.perfis               enable row level security;
alter table public.cursos               enable row level security;
alter table public.alunos               enable row level security;
alter table public.pendencias           enable row level security;
alter table public.pendencias_historico enable row level security;
alter table public.mensagens            enable row level security;
alter table public.mensagem_versoes     enable row level security;
alter table public.respostas            enable row level security;
alter table public.configuracoes        enable row level security;
alter table public.auditoria            enable row level security;

-- 2) Remove privilégios padrão e concede só o necessário -------------------
revoke all on all tables    in schema public from anon, authenticated;
revoke all on all sequences in schema public from anon, authenticated;

grant select                         on public.cursos               to authenticated;
grant select, update (nome)          on public.perfis               to authenticated;
grant update (papel, ativo)          on public.perfis               to authenticated;  -- filtrado por RLS: só admin
grant select, delete                 on public.alunos               to authenticated;
grant insert (nome, email, telefone, data_compra, curso_id, momento_profissional,
              dor_principal, observacoes)
                                     on public.alunos               to authenticated;
grant update (nome, email, telefone, data_compra, curso_id, momento_profissional,
              dor_principal, observacoes)
                                     on public.alunos               to authenticated;
grant select                         on public.pendencias           to authenticated;
grant update (marcada, estado, data_referencia, dias_informados, resolvida_em)
                                     on public.pendencias           to authenticated;
grant select                         on public.pendencias_historico to authenticated;
grant select                         on public.mensagens            to authenticated;
grant update (estado_envio)          on public.mensagens            to authenticated;
grant select                         on public.mensagem_versoes     to authenticated;
grant select, delete                 on public.respostas            to authenticated;
grant insert (aluno_id, mensagem_id, texto, respondida_em)
                                     on public.respostas            to authenticated;
grant select                         on public.configuracoes        to authenticated;
grant update (assinante, prazo_padrao, link_acesso, link_contrato, link_documentacao)
                                     on public.configuracoes        to authenticated;
grant select                         on public.auditoria            to authenticated;

-- O servidor (Edge Functions) usa service_role, que ignora RLS.
grant all on all tables    in schema public to service_role;
grant all on all sequences in schema public to service_role;

-- 3) Políticas ---------------------------------------------------------------

-- Perfis: cada um vê o próprio; admin vê e gerencia todos.
create policy perfis_ler on public.perfis for select to authenticated
  using (id = auth.uid() or privado.eh_admin());
create policy perfis_editar_proprio on public.perfis for update to authenticated
  using (id = auth.uid() or privado.eh_admin())
  with check (id = auth.uid() or privado.eh_admin());

-- Cursos: leitura para usuários ativos.
create policy cursos_ler on public.cursos for select to authenticated
  using (privado.usuario_ativo());

-- Alunos
create policy alunos_ler on public.alunos for select to authenticated
  using (privado.usuario_ativo());
create policy alunos_inserir on public.alunos for insert to authenticated
  with check (privado.usuario_ativo());
create policy alunos_editar on public.alunos for update to authenticated
  using (privado.usuario_ativo()) with check (privado.usuario_ativo());
create policy alunos_excluir on public.alunos for delete to authenticated
  using (privado.eh_admin());

-- Pendências (as linhas são criadas pelo banco; o usuário só atualiza)
create policy pendencias_ler on public.pendencias for select to authenticated
  using (privado.usuario_ativo());
create policy pendencias_editar on public.pendencias for update to authenticated
  using (privado.usuario_ativo()) with check (privado.usuario_ativo());

create policy pendencias_historico_ler on public.pendencias_historico for select to authenticated
  using (privado.usuario_ativo());

-- Mensagens: leitura e marcação de envio
create policy mensagens_ler on public.mensagens for select to authenticated
  using (privado.usuario_ativo());
create policy mensagens_envio on public.mensagens for update to authenticated
  using (privado.usuario_ativo()) with check (privado.usuario_ativo());

create policy mensagem_versoes_ler on public.mensagem_versoes for select to authenticated
  using (privado.usuario_ativo());

-- Respostas: leitura e inserção; exclusão só admin (correção de erro)
create policy respostas_ler on public.respostas for select to authenticated
  using (privado.usuario_ativo());
create policy respostas_inserir on public.respostas for insert to authenticated
  with check (privado.usuario_ativo());
create policy respostas_excluir on public.respostas for delete to authenticated
  using (privado.eh_admin());

-- Configurações
create policy configuracoes_ler on public.configuracoes for select to authenticated
  using (privado.usuario_ativo());
create policy configuracoes_editar on public.configuracoes for update to authenticated
  using (privado.usuario_ativo()) with check (privado.usuario_ativo());

-- Auditoria: só admin lê; ninguém grava diretamente.
create policy auditoria_ler on public.auditoria for select to authenticated
  using (privado.eh_admin());

-- 4) Funções internas não podem ser chamadas pela API ----------------------
revoke execute on all functions in schema privado from public, anon;
grant  execute on function privado.usuario_ativo(), privado.eh_admin(), privado.hoje()
  to authenticated, service_role;
