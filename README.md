# WA CAPI Tracker

Rastreamento de cliques em links de WhatsApp com atribuição completa via Facebook Conversions API.

## Como funciona

1. Cliente cola um snippet de uma linha no site
2. O script intercepta cliques em links do WhatsApp e gera um ID único (ex: `WA-8F3K2P`)
3. O ID aparece na mensagem que o cliente envia no WhatsApp
4. Quando fechar a venda, você registra no painel com o ID + valor
5. O sistema envia automaticamente para o Facebook CAPI como evento `Purchase`

---

## Deploy na Hostinger VPS (Ubuntu)

### 1. Requisitos

```bash
# Instalar Node.js 20
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt-get install -y nodejs

# Instalar PM2
npm install -g pm2

# Instalar Caddy
sudo apt install -y debian-keyring debian-archive-keyring apt-transport-https
curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/gpg.key' | sudo gpg --dearmor -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt' | sudo tee /etc/apt/sources.list.d/caddy-stable.list
sudo apt update && sudo apt install caddy
```

### 2. Clonar e instalar

```bash
git clone https://github.com/seu-usuario/wacapi.git /var/www/wacapi
cd /var/www/wacapi
npm install --production
```

### 3. Configurar variáveis de ambiente

```bash
cp .env.example .env
nano .env
```

Edite:
```
PORT=3000
SESSION_SECRET=gere_uma_string_aleatoria_longa_aqui
DATABASE_URL=./data/wacapi.db
PUBLIC_BASE_URL=https://seudominio.com
```

Gere um secret seguro:
```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

### 4. Criar banco de dados

```bash
npm run db:migrate
```

### 5. Criar primeiro usuário

```bash
npm run seed
# ou com credenciais customizadas:
npm run seed -- admin@seudominio.com minhasenha "Meu Nome"
```

### 6. Iniciar com PM2

```bash
# Criar pasta de logs
mkdir -p logs

pm2 start ecosystem.config.js
pm2 save
pm2 startup  # siga as instruções para iniciar com o sistema
```

### 7. Configurar Caddy como reverse proxy

```bash
sudo nano /etc/caddy/Caddyfile
```

Cole:
```
seudominio.com {
    reverse_proxy localhost:3000
}
```

```bash
sudo systemctl reload caddy
```

### 8. Verificar instalação

```bash
curl https://seudominio.com/health
# Deve retornar: {"status":"ok","timestamp":"..."}
```

---

## Desenvolvimento local

```bash
cp .env.example .env
# Edite o .env

npm install
npm run db:migrate
npm run seed
npm run dev
```

Acesse: http://localhost:3000

---

## Scripts disponíveis

| Comando | Descrição |
|---------|-----------|
| `npm start` | Inicia o servidor |
| `npm run dev` | Inicia com hot reload (nodemon) |
| `npm run db:migrate` | Cria/atualiza as tabelas do banco |
| `npm run seed` | Cria o primeiro usuário admin |

---

## Instalação do snippet nos sites dos clientes

No painel, acesse o site → copie o snippet → cole antes do `</body>`:

```html
<script src="https://seudominio.com/tracker.js" data-site="ID_DO_SITE" async></script>
```

Funciona em WordPress, Wix, Elementor, páginas estáticas — qualquer site com HTML.

---

## Fluxo de uso

1. **Configure o site** no painel com o Pixel ID e Token da API do Facebook
2. **Instale o snippet** no site do cliente
3. **Monitore os cliques** na página de detalhes do site
4. **Registre vendas** pelo menu "+ Registrar Venda" usando o ID que aparece na conversa do WhatsApp
