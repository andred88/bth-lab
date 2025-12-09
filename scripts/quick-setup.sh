#!/bin/bash

# Script de instalação rápida do Portal Captivo Bethânia
# Execute: sudo bash quick-setup.sh

set -e  # Parar em caso de erro

echo "╔════════════════════════════════════════════════════════╗"
echo "║     🚀 Portal Captivo Bethânia - Instalação Rápida    ║"
echo "╚════════════════════════════════════════════════════════╝"
echo ""

# Verificar se é root
if [ "$EUID" -ne 0 ]; then 
   echo "❌ Este script precisa ser executado como root"
   echo "   Execute: sudo bash quick-setup.sh"
   exit 1
fi

# Verificar se já existe instalação
if [ -d "/opt/captive-portal" ]; then
    echo "⚠️  Detectada instalação existente em /opt/captive-portal"
    echo "   Deseja fazer backup e reinstalar? (s/n)"
    read -r response
    if [[ "$response" =~ ^([sS][iI][mM]|[sS])$ ]]; then
        echo "📦 Fazendo backup..."
        mv /opt/captive-portal /opt/captive-portal.backup.$(date +%Y%m%d_%H%M%S)
    else
        echo "❌ Instalação cancelada"
        exit 0
    fi
fi

# 1. Criar estrutura de pastas
echo ""
echo "📁 Criando estrutura de pastas..."
mkdir -p /opt/captive-portal
mkdir -p /opt/captive-portal/public/assets/{css,js,images}
mkdir -p /opt/captive-portal/config
mkdir -p /opt/captive-portal/logs
mkdir -p /opt/captive-portal/scripts
mkdir -p /opt/captive-portal/systemd
mkdir -p /opt/captive-portal/docs

# 2. Instalar dependências do sistema
echo ""
echo "📦 Instalando dependências do sistema..."
apt update -qq
apt install -y nodejs npm postgresql postgresql-contrib nftables > /dev/null 2>&1

echo "   ✓ Node.js $(node --version)"
echo "   ✓ npm $(npm --version)"
echo "   ✓ PostgreSQL instalado"
echo "   ✓ NFTables instalado"

# 3. Criar package.json
echo ""
echo "📝 Criando package.json..."
cat > /opt/captive-portal/package.json << 'EOF'
{
  "name": "captive-portal-bethania",
  "version": "2.0.0",
  "description": "Portal Captivo para Laboratório Bethânia",
  "main": "server.js",
  "scripts": {
    "start": "node server.js",
    "dev": "nodemon server.js"
  },
  "dependencies": {
    "express": "^4.18.2",
    "pg": "^8.11.3",
    "bcryptjs": "^2.4.3",
    "jsonwebtoken": "^9.0.2",
    "dotenv": "^16.3.1"
  }
}
EOF

# 4. Instalar dependências Node
echo ""
echo "📦 Instalando dependências do Node.js..."
cd /opt/captive-portal
npm install --silent > /dev/null 2>&1
echo "   ✓ Dependências instaladas"

# 5. Criar arquivo .env
echo ""
echo "🔐 Configurando variáveis de ambiente..."
cat > /opt/captive-portal/.env << 'EOF'
# Servidor
NODE_ENV=production
PORT=3000

# JWT - ALTERE EM PRODUÇÃO!
JWT_SECRET=bethania_super_secret_key_change_me_12345

# PostgreSQL
DB_HOST=localhost
DB_PORT=5432
DB_NAME=captive_portal
DB_USER=portal_user
DB_PASSWORD=portal_pass_123

# NFTables
NFT_TABLE=inet filter
NFT_SET_AUTH=authenticated_users
NFT_SET_ADMIN=admin_users
EOF
chmod 600 /opt/captive-portal/.env

# 6. Configurar PostgreSQL
echo ""
echo "🗄️  Configurando PostgreSQL..."

# Iniciar PostgreSQL se não estiver rodando
systemctl start postgresql

# Criar usuário e banco
sudo -u postgres psql << 'EOF' > /dev/null 2>&1
-- Remover se já existir
DROP DATABASE IF EXISTS captive_portal;
DROP USER IF EXISTS portal_user;

-- Criar novo
CREATE USER portal_user WITH PASSWORD 'portal_pass_123';
CREATE DATABASE captive_portal OWNER portal_user;
GRANT ALL PRIVILEGES ON DATABASE captive_portal TO portal_user;
EOF

echo "   ✓ Banco de dados criado"
echo "   ✓ Usuário: portal_user"
echo "   ✓ Banco: captive_portal"

# 7. Configurar NFTables
echo ""
echo "🔥 Configurando NFTables..."

# Criar sets básicos
nft add table inet filter 2>/dev/null || true
nft add set inet filter authenticated_users { type ipv4_addr\; flags timeout\; } 2>/dev/null || true
nft add set inet filter admin_users { type ipv4_addr\; flags timeout\; } 2>/dev/null || true

echo "   ✓ Tabela inet filter criada"
echo "   ✓ Set authenticated_users criado"
echo "   ✓ Set admin_users criado"

# 8. Verificar se os arquivos principais existem
echo ""
echo "📄 Verificando arquivos principais..."

files_needed=("server.js" "public/index.html" "public/admin.html")
missing_files=()

for file in "${files_needed[@]}"; do
    if [ ! -f "/opt/captive-portal/$file" ]; then
        missing_files+=("$file")
    fi
done

if [ ${#missing_files[@]} -gt 0 ]; then
    echo ""
    echo "⚠️  ATENÇÃO: Arquivos faltando!"
    echo ""
    echo "   Você precisa copiar os seguintes arquivos para /opt/captive-portal:"
    for file in "${missing_files[@]}"; do
        echo "   - $file"
    done
    echo ""
    echo "   Depois de copiar os arquivos, execute:"
    echo "   sudo systemctl start captive-portal"
    echo ""
    SKIP_SERVICE=true
else
    echo "   ✓ Todos os arquivos encontrados"
fi

# 9. Criar systemd service
echo ""
echo "⚙️  Configurando serviço systemd..."

cat > /etc/systemd/system/captive-portal.service << 'EOF'
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
EOF

systemctl daemon-reload
systemctl enable captive-portal.service
echo "   ✓ Serviço configurado para iniciar automaticamente"

# 10. Criar scripts auxiliares
echo ""
echo "🛠️  Criando scripts auxiliares..."

# Script de backup
cat > /opt/captive-portal/scripts/backup-db.sh << 'EOF'
#!/bin/bash
BACKUP_DIR="/opt/captive-portal/backups"
mkdir -p $BACKUP_DIR
FILENAME="captive_portal_$(date +%Y%m%d_%H%M%S).sql"
sudo -u postgres pg_dump captive_portal > "$BACKUP_DIR/$FILENAME"
echo "✅ Backup criado: $FILENAME"
# Manter apenas últimos 7 backups
ls -t $BACKUP_DIR/*.sql | tail -n +8 | xargs -r rm
EOF

# Script de restart
cat > /opt/captive-portal/scripts/restart.sh << 'EOF'
#!/bin/bash
echo "🔄 Reiniciando Portal Captivo..."
systemctl restart captive-portal
sleep 2
systemctl status captive-portal --no-pager
EOF

# Script de logs
cat > /opt/captive-portal/scripts/view-logs.sh << 'EOF'
#!/bin/bash
echo "📋 Logs do Portal Captivo"
echo "========================"
echo ""
echo "Pressione Ctrl+C para sair"
echo ""
tail -f /opt/captive-portal/logs/access.log /opt/captive-portal/logs/error.log
EOF

chmod +x /opt/captive-portal/scripts/*.sh
echo "   ✓ Scripts criados em /opt/captive-portal/scripts/"

# 11. Criar documentação
echo ""
echo "📚 Criando documentação..."

cat > /opt/captive-portal/docs/CREDENTIALS.md << 'EOF'
# 🔐 Credenciais Padrão

## Usuários do Sistema

### Admin
- Usuário: `admin`
- Senha: `admin123`
- Acesso: Total (painel administrativo)

### Professor
- Usuário: `professor`
- Senha: `professor123`
- Acesso: Internet com possíveis restrições

### Aluno
- Usuário: `aluno`
- Senha: `aluno123`
- Acesso: Internet com restrições

## URLs

- Portal de Login: http://seu-servidor:3000/
- Painel Admin: http://seu-servidor:3000/admin.html

## Banco de Dados

- Host: localhost
- Porta: 5432
- Banco: captive_portal
- Usuário: portal_user
- Senha: portal_pass_123

## Importante

⚠️ ALTERE ESTAS SENHAS EM PRODUÇÃO!
EOF

cat > /opt/captive-portal/docs/COMMANDS.md << 'EOF'
# 🔧 Comandos Úteis

## Gerenciar Serviço

```bash
# Ver status
sudo systemctl status captive-portal

# Iniciar
sudo systemctl start captive-portal

# Parar
sudo systemctl stop captive-portal

# Reiniciar
sudo systemctl restart captive-portal

# Ver logs em tempo real
sudo bash /opt/captive-portal/scripts/view-logs.sh
```

## Banco de Dados

```bash
# Acessar PostgreSQL
sudo -u postgres psql captive_portal

# Fazer backup
sudo bash /opt/captive-portal/scripts/backup-db.sh

# Restaurar backup
sudo -u postgres psql captive_portal < backup.sql
```

## NFTables

```bash
# Listar IPs autenticados
sudo nft list set inet filter authenticated_users

# Listar IPs admin
sudo nft list set inet filter admin_users

# Limpar sets
sudo nft flush set inet filter authenticated_users
sudo nft flush set inet filter admin_users
```
EOF

echo "   ✓ Documentação criada em /opt/captive-portal/docs/"

# 12. Definir permissões
echo ""
echo "🔒 Configurando permissões..."
chown -R root:root /opt/captive-portal
chmod 755 /opt/captive-portal
chmod 755 /opt/captive-portal/logs
chmod 600 /opt/captive-portal/.env
echo "   ✓ Permissões configuradas"

# Finalização
echo ""
echo "╔════════════════════════════════════════════════════════╗"
echo "║              ✅ Instalação Concluída!                  ║"
echo "╚════════════════════════════════════════════════════════╝"
echo ""

if [ "$SKIP_SERVICE" = true ]; then
    echo "⚠️  PRÓXIMOS PASSOS:"
    echo ""
    echo "   1. Copie os arquivos principais para /opt/captive-portal:"
    echo "      - server.js"
    echo "      - public/index.html"
    echo "      - public/admin.html"
    echo ""
    echo "   2. Inicie o serviço:"
    echo "      sudo systemctl start captive-portal"
    echo ""
else
    # Tentar iniciar o serviço
    echo "🚀 Iniciando serviço..."
    systemctl start captive-portal
    sleep 2
    
    if systemctl is-active --quiet captive-portal; then
        echo "   ✓ Serviço iniciado com sucesso!"
        echo ""
        echo "📍 ACESSO:"
        echo "   Portal: http://$(hostname -I | awk '{print $1}'):3000/"
        echo "   Admin:  http://$(hostname -I | awk '{print $1}'):3000/admin.html"
        echo ""
    else
        echo "   ⚠️  Erro ao iniciar serviço"
        echo "   Verifique os logs: sudo journalctl -u captive-portal -n 50"
        echo ""
    fi
fi

echo "🔐 CREDENCIAIS PADRÃO:"
echo "   Admin:     admin / admin123"
echo "   Professor: professor / professor123"
echo "   Aluno:     aluno / aluno123"
echo ""
echo "📚 DOCUMENTAÇÃO:"
echo "   Credenciais: /opt/captive-portal/docs/CREDENTIALS.md"
echo "   Comandos:    /opt/captive-portal/docs/COMMANDS.md"
echo ""
echo "🛠️  SCRIPTS ÚTEIS:"
echo "   Backup:      sudo bash /opt/captive-portal/scripts/backup-db.sh"
echo "   Restart:     sudo bash /opt/captive-portal/scripts/restart.sh"
echo "   Ver logs:    sudo bash /opt/captive-portal/scripts/view-logs.sh"
echo ""
echo "⚠️  IMPORTANTE: Altere as senhas padrão em produção!"
echo ""
