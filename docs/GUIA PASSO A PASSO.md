# 🎯 Guia Passo a Passo - Instalação Portal Captivo

## Método 1: Instalação Automática (Recomendado) ⚡

### Passo 1: Baixar o script de instalação

```bash
cd ~
wget https://seu-servidor.com/quick-setup.sh
# OU copie o conteúdo do script quick-setup.sh
```

### Passo 2: Executar instalação automática

```bash
sudo bash quick-setup.sh
```

O script irá:
- ✅ Criar toda estrutura de pastas
- ✅ Instalar dependências (Node.js, PostgreSQL, NFTables)
- ✅ Configurar banco de dados
- ✅ Criar usuários padrão
- ✅ Configurar serviço systemd

### Passo 3: Copiar arquivos principais

```bash
# Se você já tem os arquivos, copie-os:
sudo cp seu-server.js /opt/captive-portal/server.js
sudo cp seu-index.html /opt/captive-portal/public/index.html
sudo cp seu-admin.html /opt/captive-portal/public/admin.html
```

### Passo 4: Iniciar o serviço

```bash
sudo systemctl start captive-portal
sudo systemctl status captive-portal
```

---

## Método 2: Instalação Manual (Controle Total) 🔧

### Passo 1: Criar estrutura de pastas

```bash
sudo mkdir -p /opt/captive-portal/{public/assets/{css,js,images},config,logs,scripts,systemd,docs}
```

### Passo 2: Instalar dependências do sistema

```bash
sudo apt update
sudo apt install -y nodejs npm postgresql postgresql-contrib nftables
```

### Passo 3: Criar package.json

```bash
sudo nano /opt/captive-portal/package.json
```

Cole o conteúdo:
```json
{
  "name": "captive-portal-bethania",
  "version": "2.0.0",
  "description": "Portal Captivo Bethânia",
  "main": "server.js",
  "scripts": {
    "start": "node server.js"
  },
  "dependencies": {
    "express": "^4.18.2",
    "pg": "^8.11.3",
    "bcryptjs": "^2.4.3",
    "jsonwebtoken": "^9.0.2",
    "dotenv": "^16.3.1"
  }
}
```

### Passo 4: Instalar dependências Node

```bash
cd /opt/captive-portal
sudo npm install
```

### Passo 5: Criar arquivo .env

```bash
sudo nano /opt/captive-portal/.env
```

Cole:
```env
NODE_ENV=production
PORT=3000
JWT_SECRET=sua_chave_secreta_aqui
DB_HOST=localhost
DB_PORT=5432
DB_NAME=captive_portal
DB_USER=portal_user
DB_PASSWORD=sua_senha_aqui
```

### Passo 6: Configurar PostgreSQL

```bash
# Acessar PostgreSQL
sudo -u postgres psql

# Executar comandos:
CREATE USER portal_user WITH PASSWORD 'sua_senha_aqui';
CREATE DATABASE captive_portal OWNER portal_user;
GRANT ALL PRIVILEGES ON DATABASE captive_portal TO portal_user;
\q
```

### Passo 7: Copiar arquivos principais

```bash
# server.js
sudo nano /opt/captive-portal/server.js
# Cole o conteúdo do server.js corrigido

# index.html
sudo nano /opt/captive-portal/public/index.html
# Cole o conteúdo do index.html

# admin.html
sudo nano /opt/captive-portal/public/admin.html
# Cole o conteúdo do admin.html corrigido
```

### Passo 8: Atualizar server.js para servir arquivos

Adicione no início do server.js (depois dos requires):

```javascript
const path = require('path');

// Servir arquivos estáticos
app.use(express.static(path.join(__dirname, 'public')));

// Rotas para páginas
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.get('/admin', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'admin.html'));
});
```

### Passo 9: Configurar NFTables

```bash
sudo nft add table inet filter
sudo nft add set inet filter authenticated_users { type ipv4_addr\; flags timeout\; }
sudo nft add set inet filter admin_users { type ipv4_addr\; flags timeout\; }
```

### Passo 10: Criar serviço systemd

```bash
sudo nano /etc/systemd/system/captive-portal.service
```

Cole:
```ini
[Unit]
Description=Portal Captivo Bethânia
After=network.target postgresql.service
Requires=postgresql.service

[Service]
Type=simple
User=root
WorkingDirectory=/opt/captive-portal
ExecStart=/usr/bin/node /opt/captive-portal/server.js
Restart=always
RestartSec=10
StandardOutput=append:/opt/captive-portal/logs/access.log
StandardError=append:/opt/captive-portal/logs/error.log
Environment=NODE_ENV=production

[Install]
WantedBy=multi-user.target
```

### Passo 11: Ativar e iniciar serviço

```bash
sudo systemctl daemon-reload
sudo systemctl enable captive-portal.service
sudo systemctl start captive-portal.service
sudo systemctl status captive-portal.service
```

---

## ✅ Verificação Pós-Instalação

### 1. Verificar serviço

```bash
sudo systemctl status captive-portal
```

Deve mostrar: **active (running)**

### 2. Verificar logs

```bash
tail -f /opt/captive-portal/logs/access.log
```

Deve mostrar:
```
🚀 API do Portal Captivo rodando na porta 3000
✅ Banco de dados inicializado com sucesso
📋 CREDENCIAIS PADRÃO:
   Admin: admin / admin123
   ...
```

### 3. Testar conexão ao banco

```bash
sudo -u postgres psql captive_portal -c "SELECT * FROM roles;"
```

Deve listar: admin, professor, aluno

### 4. Verificar NFTables

```bash
sudo nft list sets
```

Deve mostrar: authenticated_users e admin_users

### 5. Testar acesso web

```bash
# Descobrir IP do servidor
hostname -I

# Acessar:
# http://SEU_IP:3000/
# http://SEU_IP:3000/admin.html
```

---

## 🔧 Solução de Problemas

### Problema: Serviço não inicia

```bash
# Ver logs detalhados
sudo journalctl -u captive-portal -n 50 --no-pager

# Testar manualmente
cd /opt/captive-portal
sudo node server.js
```

### Problema: Erro de conexão com banco

```bash
# Verificar se PostgreSQL está rodando
sudo systemctl status postgresql

# Testar conexão
sudo -u postgres psql -c "SELECT version();"

# Verificar usuário e banco
sudo -u postgres psql -c "\du"
sudo -u postgres psql -c "\l"
```

### Problema: Erro ao adicionar IP no NFTables

```bash
# Verificar se NFTables está ativo
sudo nft list tables

# Recriar sets
sudo nft delete table inet filter
sudo nft add table inet filter
sudo nft add set inet filter authenticated_users { type ipv4_addr\; flags timeout\; }
sudo nft add set inet filter admin_users { type ipv4_addr\; flags timeout\; }
```

### Problema: Permissões negadas

```bash
# Ajustar permissões
sudo chown -R root:root /opt/captive-portal
sudo chmod 755 /opt/captive-portal
sudo chmod 755 /opt/captive-portal/logs
sudo chmod 600 /opt/captive-portal/.env
```

### Problema: Porta 3000 em uso

```bash
# Verificar o que está usando a porta
sudo lsof -i :3000

# Alterar porta no .env
sudo nano /opt/captive-portal/.env
# Mudar: PORT=3001

# Reiniciar
sudo systemctl restart captive-portal
```

---

## 🎨 Personalização

### Alterar logo

```bash
# Copiar sua logo
sudo cp sua-logo.png /opt/captive-portal/public/assets/images/logo.png

# Editar index.html para usar a logo
sudo nano /opt/captive-portal/public/index.html
```

### Alterar cores

Edite o CSS inline nos arquivos HTML ou crie um arquivo CSS separado:

```bash
sudo nano /opt/captive-portal/public/assets/css/custom.css
```

### Alterar textos

```bash
# Página de login
sudo nano /opt/captive-portal/public/index.html

# Painel admin
sudo nano /opt/captive-portal/public/admin.html
```

---

## 📊 Comandos de Manutenção

```bash
# Ver status
sudo systemctl status captive-portal

# Reiniciar
sudo systemctl restart captive-portal

# Ver logs em tempo real
tail -f /opt/captive-portal/logs/access.log

# Fazer backup do banco
sudo -u postgres pg_dump captive_portal > backup_$(date +%Y%m%d).sql

# Limpar sessões expiradas manualmente
sudo -u postgres psql captive_portal -c "UPDATE sessions SET active = false WHERE expiry_time < NOW();"

# Ver IPs conectados
sudo nft list set inet filter authenticated_users
sudo nft list set inet filter admin_users
```

---

## 🚀 Pronto!

Seu portal captivo está instalado e funcionando!

**Acesse:**
- Portal: http://seu-ip:3000/
- Admin: http://seu-ip:3000/admin.html

**Credenciais padrão:**
- Admin: `admin` / `admin123`
- Professor: `professor` / `professor123`
- Aluno: `aluno` / `aluno123`

⚠️ **IMPORTANTE:** Altere as senhas padrão em produção!
