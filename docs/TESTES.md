# Registro de testes

Última execução local: 16/10/2026, ambiente de desenvolvimento (Linux, PostgreSQL 16, Node 22, Deno 2.9,
Supabase Auth v2.197.0, PostgREST v12.2.3, Chromium). Somente dados fictícios.

| Conjunto | Resultado |
|---|---|
| Banco (`npm run test:db`) | **93 verificações aprovadas** |
| Regras, prompt e função (`npm run test:unit`) | **24 testes aprovados** |
| Tipos da Edge Function (`npm run check:function`) | **aprovado** |
| Ponta a ponta no navegador (`npm run test:e2e`) | **25 etapas aprovadas** |

O teste ponta a ponta usa um **dublê da API do Claude** (devolve um texto fixo marcado “TESTE”), para
validar o fluxo sem custo. A chamada real à API só pode ser validada depois que a chave for configurada
no Supabase (ver “Pendente”).

## Cobertura dos testes obrigatórios (prompt mestre, seção 17)

| Item | Onde é testado | Situação |
|---|---|---|
| Cadastro com campos vazios | banco + navegador | ✅ |
| Edição de aluno | navegador | ✅ |
| Persistência após recarregar | navegador | ✅ |
| Acesso aos mesmos dados por outro navegador autorizado | navegador (outra sessão, outro usuário) | ✅ local · ⏳ produção |
| Cálculo de dias por pendência | unitário + banco | ✅ |
| Maior número de dias em aberto | unitário | ✅ |
| Classificação de tom | unitário | ✅ |
| Sete quadros de resumo | navegador | ✅ |
| Filtros por curso, situação e pesquisa | navegador | ✅ |
| Geração da primeira mensagem | navegador (dublê da IA) + unitário | ✅ local · ⏳ API real |
| Nova geração sem perda do histórico | banco + navegador | ✅ |
| Registro de respostas | banco + navegador | ✅ |
| Respostas no contexto da IA | banco + unitário + navegador | ✅ |
| Marcação e reversão de envio | banco + navegador | ✅ |
| Resolução e reabertura de pendências | banco + navegador | ✅ |
| Exclusão com confirmação | navegador (2 cliques) + banco (retenção) | ✅ |
| Persistência das configurações | navegador | ✅ |
| Exportação e importação JSON | banco + navegador | ✅ |
| Bloqueio de usuários não autorizados | banco (anon, inativo, operador) + navegador + API direta | ✅ |
| Proteção das chaves secretas | navegador (varredura dos arquivos do site) + unitário | ✅ |
| Funcionamento responsivo | navegador (375 px) | ✅ |
| Fins de semana e antes das 9h | banco + unitário + navegador | ✅ |
| Ausência de mensagens diárias duplicadas | banco + navegador (recarregar) | ✅ |
| Recuperação de falhas de banco e IA | banco + unitário | ✅ |
| URL de produção sem depender do Claude aberto | — | ⏳ depende da publicação |

## Detalhe da última execução no navegador

```
ok - API recusa leitura sem login (chave pública sozinha)
ok - site sem login mostra a tela de entrada
ok - usuário logado mas não liberado não vê dados
ok - senha errada é recusada
ok - operadora entra e vê o estado inicial vazio
ok - configurações persistem
ok - cadastro com todos os campos vazios
ok - cadastro completo + “Salvar e gerar 1ª mensagem”
ok - a IA recebeu os dados certos (servidor, chave só no servidor)
ok - copiar não marca como enviada; marcar e desfazer funcionam
ok - resposta do aluno é registrada e usada na próxima geração
ok - “Gerar nova mensagem” com outro tom e instrução preserva o histórico
ok - edição de dados não reinicia a contagem de dias
ok - painel: quadros, filtros por curso, situação e busca
ok - resolver todas as pendências conclui; reabrir volta ao acompanhamento
ok - lote diário às 10h gera para quem falta, sem duplicar ao recarregar
ok - persistência após recarregar e acesso por outro navegador autorizado
ok - exportar backup
ok - exclusão exige dois cliques
ok - importar backup (admin): prévia, confirmação e sem duplicar
ok - antes das 9h: mensagem “ficam prontas a partir das 9h” e “Gerar agora”
ok - fim de semana: sem geração
ok - celular (375 px): tabela com rolagem horizontal e layout responsivo
ok - nenhuma chave secreta nos arquivos do site
ok - sem erros de JavaScript no console
✓ navegador: 25 etapas aprovadas
```
