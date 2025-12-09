# 🔐 Portal Captivo Bethânia - Credenciais e Instruções

## 📋 Credenciais Padrão

### Usuário Admin
- **Usuário:** `admin`
- **Senha:** `admin123`
- **Permissões:** Acesso total ao painel administrativo

### Usuário Professor
- **Usuário:** `professor`
- **Senha:** `professor123`
- **Permissões:** Acesso à internet com possíveis restrições

### Usuário Aluno
- **Usuário:** `aluno`
- **Senha:** `aluno123`
- **Permissões:** Acesso à internet com restrições definidas

---

## 🔄 Como Resetar as Senhas

As senhas são automaticamente resetadas quando você reinicia o servidor. O banco de dados usa a cláusula `ON CONFLICT DO UPDATE`, que atualiza as senhas para os valores padrão sempre que o servidor é iniciado.

Para resetar manualmente:
```bash
node server.js
```

---

## ✅ Principais Correções Implementadas

### 1. **Endpoints da API Admin Corrigidos**
- Antes: `/api/sessions` (incorreto)
- Agora: `/api/admin/sessions` (correto)
- Todos os endpoints admin foram corrigidos

### 2. **Listagem de Sites Bloqueados**
- Corrigido para aceitar filtro por role
- Endpoint: `/api/admin/blocked-sites/:roleId`
- `roleId = 0` ou vazio lista todos os sites

### 3. **Gerenciamento de Usuários**
- Implementado CRUD completo
- Criar, editar e excluir usuários
- Resetar senhas de usuários

### 4. **Dashboard com Estatísticas**
- Sessões ativas em tempo real
- Total de usuários
- Logins nas últimas 24 horas
- Estatísticas por role

### 5. **Logs de Auditoria**
- Nova aba "Logs" no painel admin
- Rastreamento de todas as ações administrativas
- Histórico de logins e logouts

---

## 🎯 Funcionalidades do Painel Admin

### Dashboard
- Visualização de estatísticas gerais
- Contadores em tempo real
- Distribuição de usuários por role

### Sessões Ativas
- Lista todas as sessões conectadas
- Mostra IP, usuário, role e tempo de expiração
- Botão para desconectar sessões manualmente

### Gerenciar Roles
- Editar duração de acesso (em segundos)
- Configurar acesso irrestrito (sem bloqueios)
- 3 roles padrão: admin, professor, aluno

### Sites Bloqueados
- Adicionar domínios bloqueados por role
- Filtrar sites por role específica
- Remover bloqueios

### Usuários
- Criar novos usuários
- Editar usuários existentes
- Resetar senhas
- Excluir usuários
- Ver sessões ativas por usuário

### Logs
- Auditoria completa de ações
- Filtro por usuário e ação
- Últimas 100 entradas

---

## 🚀 Como Usar

### 1. Iniciar o Servidor
```bash
npm install
node server.js
```

### 2. Acessar o Portal
- Portal de Login: `http://seu-servidor/`
- Painel Admin: `http://seu-servidor/admin.html`

### 3. Login como Admin
1. Acesse o portal principal
2. Use: `admin` / `admin123`
3. Você será redirecionado ou pode acessar `/admin.html`

### 4. Gerenciar o Sistema
- Crie usuários para professores e alunos
- Configure durações de acesso
- Bloqueie sites conforme necessário
- Monitore sessões ativas

---

## ⚙️ Configurações de Role

### Admin
- **Duração padrão:** 3600 segundos (1 hora)
- **Acesso irrestrito:** Sim
- **Bloqueios:** Nenhum

### Professor
- **Duração padrão:** 3600 segundos (1 hora)
- **Acesso irrestrito:** Não
- **Bloqueios:** Conforme configurado

### Aluno
- **Duração padrão:** 3600 segundos (1 hora)
- **Acesso irrestrito:** Não
- **Bloqueios:** Conforme configurado

---

## 🔧 Troubleshooting

### Problema: Não consigo fazer login no admin
**Solução:** Verifique se está usando as credenciais corretas:
- Usuário: `admin`
- Senha: `admin123`

### Problema: As alterações não são salvas
**Solução:** Verifique:
1. Se você está logado como admin
2. Se o token JWT não expirou (faça login novamente)
3. Se o banco de dados está rodando

### Problema: Sites bloqueados não aparecem
**Solução:** 
1. Verifique se há sites cadastrados para a role selecionada
2. Use "Todas as roles" no filtro para ver todos os sites
3. Atualize a página

### Problema: Não consigo desconectar sessões
**Solução:**
1. Certifique-se de ter permissão de admin
2. Verifique se a sessão ainda está ativa
3. Tente recarregar a lista de sessões

---

## 📝 Notas Importantes

1. **Segurança:** Altere o `JWT_SECRET` em produção
2. **Banco de Dados:** As credenciais do PostgreSQL estão no código
3. **NFTables:** Os comandos nft precisam de permissões root
4. **Proxy:** O servidor está configurado para confiar em proxies (Nginx)

---

## 🎨 Melhorias Visuais

- Interface moderna e responsiva
- Badges coloridos para diferentes roles
- Alertas de sucesso/erro
- Modais para edição
- Tabelas organizadas e legíveis

---

## 📧 Suporte

Para dúvidas ou problemas:
1. Verifique os logs do servidor (`console.log`)
2. Verifique os logs do navegador (F12)
3. Consulte este documento

---

**Última atualização:** Dezembro 2025
**Versão:** 2.0 - Corrigida e Completa
