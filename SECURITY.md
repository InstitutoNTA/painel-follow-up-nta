# Segurança e privacidade — Painel de Follow-up

O painel guarda dados pessoais e acadêmicos de alunos. Esta página resume as proteções implementadas
e as regras de operação.

## Controles implementados

| Requisito | Como está implementado |
|---|---|
| Autenticação individual | Supabase Auth com e-mail e senha (mínimo 10 caracteres). Cadastro aberto desligado: só entra quem é convidado. |
| Autorização no servidor | Row Level Security em **todas** as tabelas. Sem login: nenhuma leitura ou gravação. Logado mas inativo: nenhum dado de aluno. Papéis `operador` e `admin`. |
| Usuário novo | Entra inativo; só um admin ativa. Ninguém altera o próprio papel; o último admin não pode ser desativado. |
| Validação de entradas | Restrições no banco (tamanhos, e-mail, telefone, datas, links só `http(s)`, prazo 1–90, tons válidos) e validação na função de servidor. A tela também valida, mas não é a única barreira. |
| Campos controlados pelo banco | Privilégios por coluna: usuários não alteram estado de acompanhamento, datas de referência, autoria nem dados de geração. |
| Integridade das mensagens | Só a Edge Function (chave de serviço) grava texto gerado. Respostas são somente inserção. |
| Gerações duplicadas | Uma mensagem por aluno por dia (`unique`), trava por aluno durante a reserva e bloqueio de geração simultânea. Recarregar, várias abas ou cliques repetidos não duplicam. |
| Frequência de chamadas à IA | Até 40 gerações a cada 10 minutos por usuário e 10 versões por aluno por dia. |
| Chaves secretas | `ANTHROPIC_API_KEY` e `service_role` só nos segredos do Supabase. O site usa apenas a chave pública `anon`. `.gitignore` bloqueia arquivos `.env`. Teste automatizado procura chaves nos arquivos do site. |
| Proteção do site | Política de segurança de conteúdo (CSP): scripts só do próprio site, conexões só com o Supabase; todo dado exibido passa por escape de HTML. Biblioteca do Supabase copiada no repositório (sem CDN de terceiros). |
| Função de servidor | Exige token de usuário válido (verificado pelo Supabase e pela função), confere se o perfil está ativo, valida o corpo do pedido e aceita origens configuradas em `ALLOWED_ORIGINS`. |
| Erros | Mensagens ao usuário sem detalhes técnicos. Logs da função registram só o tipo de falha, sem dados de alunos nem chaves. |
| Instruções maliciosas | Observações e instruções da equipe são tratadas como contexto; o agente é instruído a não usá-las para ignorar regras de segurança, privacidade ou escrita. |
| URL "difícil de adivinhar" | Não é usada como proteção. Tudo depende de login + RLS. |

## Política de retenção e exclusão

- **Dados de alunos**: mantidos enquanto forem necessários ao acompanhamento. Alunos que concluíram
  as pendências e não precisam mais de histórico devem ser **excluídos** pelo botão “Excluir aluno”
  (dois cliques de confirmação). A exclusão apaga de forma definitiva o aluno, as pendências, o
  histórico de pendências, as mensagens, as versões e as respostas.
- **Auditoria**: registra quem alterou o quê. Ao excluir um aluno, os registros de auditoria com dados
  pessoais dele também são apagados; fica só o fato da exclusão (id, curso, data de cadastro, autor).
- Registros de auditoria são mantidos por **24 meses**. Execute mensalmente no SQL Editor (ou agende com
  `pg_cron`): `select privado.aplicar_retencao();`
- **Backups exportados** contêm dados pessoais: guarde em local com acesso restrito e apague cópias antigas.

## Regras de operação

- Nunca envie senhas ou chaves por chat, e-mail ou mensagem. Configure-as direto no Supabase ou no Console da Anthropic.
- Nunca use dados reais de alunos em demonstrações, prints públicos ou testes. Os testes deste repositório usam só dados fictícios (`exemplo.invalid`).
- Ao desligar alguém do time, desative o usuário em Configurações → Usuários (ou exclua-o em Authentication → Users).
- Troque a `ANTHROPIC_API_KEY` se houver suspeita de vazamento (Console da Anthropic → revogar e criar outra; atualizar o segredo no Supabase).

## Como relatar um problema de segurança

Fale diretamente com o responsável pelo projeto no Instituto NTA. Não abra *issue* pública com detalhes de falhas.
