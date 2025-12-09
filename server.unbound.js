const express = require("express")
const { Pool } = require("pg")
const bcrypt = require("bcryptjs")
const jwt = require("jsonwebtoken")
const { exec } = require("child_process")
const util = require("util")
const execPromise = util.promisify(exec)
const fs = require("fs")
const path = require("path")

const app = express()
app.use(express.json())
// Trust proxy - importante para pegar IP real através do Nginx
app.set("trust proxy", true)

const JWT_SECRET = process.env.JWT_SECRET || "bethania_secret_key_change_in_production"

const pool = new Pool({
  host: "localhost",
  port: 5432,
  database: "captive_portal",
  user: "portal_user",
  password: "portal_password",
})

// =================== Utilitários gerais ===================
function getClientIp(req) {
  const forwarded = req.headers["x-forwarded-for"]
  if (forwarded) {
    const ips = forwarded.split(",").map((ip) => ip.trim())
    return ips[0]
  }
  if (req.headers["x-real-ip"]) {
    return req.headers["x-real-ip"]
  }
  const ip = req.ip || req.connection.remoteAddress
  return ip.replace("::ffff:", "")
}

const authenticate = async (req, res, next) => {
  const token = req.headers.authorization?.split(" ")[1]
  if (!token) return res.status(401).json({ error: "Token não fornecido" })
  try {
    const decoded = jwt.verify(token, JWT_SECRET)
    req.user = decoded
    next()
  } catch (error) {
    res.status(401).json({ error: "Token inválido" })
  }
}

const requireAdmin = async (req, res, next) => {
  if (req.user.role !== "admin") {
    return res.status(403).json({ error: "Acesso negado. Apenas administradores." })
  }
  next()
}

async function addToNftSet(ip, setName) {
  try {
    await execPromise(`nft add element inet filter ${setName} { ${ip} }`)
    console.log(`✅ IP ${ip} adicionado ao set ${setName}`)
    return true
  } catch (error) {
    console.error(`❌ Erro ao adicionar ${ip} ao set ${setName}:`, error.message)
    return false
  }
}

async function removeFromNftSet(ip, setName) {
  try {
    const { stdout } = await execPromise(`nft list set inet filter ${setName} 2>/dev/null || echo ""`)
    if (!stdout.includes(ip)) {
      console.log(`⚠️ IP ${ip} não está no set ${setName}, pulando remoção`)
      return true
    }
    await execPromise(`nft delete element inet filter ${setName} { ${ip} }`)
    console.log(`✅ IP ${ip} removido do set ${setName}`)
    return true
  } catch (error) {
    console.error(`❌ Erro ao remover ${ip} do set ${setName}:`, error.message)
    return false
  }
}

async function logAction(userId, action, details) {
  try {
    await pool.query(`INSERT INTO audit_logs (user_id, action, details) VALUES ($1, $2, $3)`, [
      userId,
      action,
      JSON.stringify(details),
    ])
  } catch (error) {
    console.error("❌ Erro ao registrar ação:", error)
  }
}

// =================== Integração com Unbound (views) ===================
const UNBOUND_CONF = "/etc/unbound/unbound.conf"
const UNBOUND_DIR = "/etc/unbound"
const ACCESS_VIEW_FILE = path.join(UNBOUND_DIR, "conf.d", "access-view.conf")

async function sh(cmd) {
  try {
    const { stdout, stderr } = await execPromise(cmd)
    if (stderr) console.debug(stderr)
    return stdout.trim()
  } catch (e) {
    console.error("❌ Shell:", cmd, e.message)
    throw e
  }
}

// Executa unbound-control com o mesmo arquivo de config
async function unboundCtl(args) {
  return sh(`unbound-control -c ${UNBOUND_CONF} ${args}`)
}

function ensureAccessViewDir() {
  const dir = path.dirname(ACCESS_VIEW_FILE)
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true })
  if (!fs.existsSync(ACCESS_VIEW_FILE)) fs.writeFileSync(ACCESS_VIEW_FILE, "# gerenciado pelo portal\n")
}

// Mapear IP -> view (role)
async function mapIpToView(ip, viewName) {
  try {
    ensureAccessViewDir()
    let current = ""
    try { current = fs.readFileSync(ACCESS_VIEW_FILE, "utf8") } catch {}
    const filtered = current.split("\n").filter((l) => l && !l.includes(`${ip}/32`)).join("\n")
    const line = `access-control-view: ${ip}/32 ${viewName}`
    fs.writeFileSync(ACCESS_VIEW_FILE, `${filtered}\n${line}\n`, "utf8")
    await unboundCtl("fast_reload +d")
    console.log(`✅ Unbound: IP ${ip} -> view '${viewName}'`)
  } catch (err) {
    console.error("❌ mapIpToView:", err.message)
  }
}

async function unmapIpFromView(ip) {
  try {
    ensureAccessViewDir()
    let current = ""
    try { current = fs.readFileSync(ACCESS_VIEW_FILE, "utf8") } catch {}
    const filtered = current.split("\n").filter((l) => l && !l.includes(`${ip}/32`)).join("\n")
    fs.writeFileSync(ACCESS_VIEW_FILE, `${filtered}\n`, "utf8")
    await unboundCtl("fast_reload +d")
    console.log(`✅ Unbound: mapeamento removido de ${ip}`)
  } catch (err) {
    console.error("❌ unmapIpFromView:", err.message)
  }
}

// Adicionar/Remover domínio bloqueado (NXDOMAIN por padrão)
async function addBlockedDomainToView(viewName, domain, action = "always_nxdomain") {
  const clean = domain.trim().toLowerCase().replace(/^https?:\/\/|^www\./, "")
  try {
    await unboundCtl(`view_local_zone ${viewName} ${clean} ${action}`)
    console.log(`✅ Unbound: ${clean} -> ${viewName} (${action})`)
  } catch (err) {
    console.error("❌ addBlockedDomainToView:", err.message)
  }
}

async function removeBlockedDomainFromView(viewName, domain) {
  const clean = domain.trim().toLowerCase().replace(/^https?:\/\/|^www\./, "")
  try {
    await unboundCtl(`view_local_zone_remove ${viewName} ${clean}`)
    console.log(`✅ Unbound: removido ${clean} de ${viewName}`)
  } catch (err) {
    console.error("❌ removeBlockedDomainFromView:", err.message)
  }
}

// Sincronizar tudo do banco para o Unbound (na subida da API)
async function syncBlockedSitesToUnbound() {
  try {
    const { rows } = await pool.query(`
      SELECT r.name AS role, bs.domain
      FROM blocked_sites bs
      JOIN roles r ON bs.role_id = r.id
      ORDER BY bs.created_at DESC
    `)
    for (const row of rows) {
      await addBlockedDomainToView(row.role, row.domain)
    }
    console.log("✅ Unbound: sincronização inicial concluída")
  } catch (err) {
    console.error("❌ syncBlockedSitesToUnbound:", err.message)
  }
}

// =================== Endpoints ===================
app.post("/api/auth/login", async (req, res) => {
  const { username, password } = req.body
  const clientIp = getClientIp(req)
  console.log(`🔐 Tentativa de login: ${username} do IP: ${clientIp}`)
  if (!clientIp || clientIp === "127.0.0.1" || clientIp === "::1") {
    console.error("❌ IP inválido detectado:", clientIp)
    return res.status(400).json({ error: "IP inválido. Verifique configuração do proxy." })
  }
  try {
    const result = await pool.query(
      `SELECT u.*, r.name as role_name, r.access_duration, r.unrestricted_access
       FROM users u
       JOIN roles r ON u.role_id = r.id
       WHERE u.username = $1`,
      [username],
    )
    if (result.rows.length === 0) {
      console.log(`❌ Usuário não encontrado: ${username}`)
      return res.status(401).json({ error: "Credenciais inválidas" })
    }
    const user = result.rows[0]
    const validPassword = await bcrypt.compare(password, user.password_hash)
    if (!validPassword) {
      console.log(`❌ Senha inválida para: ${username}`)
      return res.status(401).json({ error: "Credenciais inválidas" })
    }

    const expiryTime = new Date(Date.now() + user.access_duration * 1000)
    await pool.query(
      `INSERT INTO sessions (user_id, ip_address, expiry_time)
       VALUES ($1, $2, $3)`,
      [user.id, clientIp, expiryTime],
    )

    const setName = user.unrestricted_access ? "admin_users" : "authenticated_users"
    const added = await addToNftSet(clientIp, setName)
    if (!added) {
      console.error(`❌ Falha ao adicionar IP ${clientIp} ao NFTables`)
    }

    // >>> Mapear IP -> view conforme a role <<<
    await mapIpToView(clientIp, user.role_name)

    await logAction(user.id, "LOGIN", { ip: clientIp, role: user.role_name })
    const token = jwt.sign({ id: user.id, username: user.username, role: user.role_name }, JWT_SECRET, {
      expiresIn: user.access_duration,
    })
    console.log(`✅ Login bem-sucedido: ${username} (${user.role_name}) - IP: ${clientIp}`)
    res.json({
      success: true,
      token,
      user: { id: user.id, username: user.username, role: user.role_name },
      expiresIn: user.access_duration,
    })
  } catch (error) {
    console.error("❌ Erro no login:", error)
    res.status(500).json({ error: "Erro interno do servidor" })
  }
})

app.get("/api/auth/status", authenticate, async (req, res) => {
  const clientIp = getClientIp(req)
  try {
    const result = await pool.query(
      `SELECT s.*, u.username, r.name as role
       FROM sessions s
       JOIN users u ON s.user_id = u.id
       JOIN roles r ON u.role_id = r.id
       WHERE s.ip_address = $1 AND s.active = true AND s.expiry_time > NOW()
       ORDER BY s.login_time DESC LIMIT 1`,
      [clientIp],
    )
    if (result.rows.length === 0) {
      return res.status(401).json({ active: false })
    }
    res.json({ active: true, session: result.rows[0] })
  } catch (error) {
    console.error("❌ Erro ao verificar status:", error)
    res.status(500).json({ error: "Erro interno do servidor" })
  }
})

app.post("/api/auth/logout", authenticate, async (req, res) => {
  const clientIp = getClientIp(req)
  console.log(`🚪 Logout solicitado para IP: ${clientIp}`)
  try {
    await pool.query(`UPDATE sessions SET active = false WHERE ip_address = $1 AND active = true`, [clientIp])
    await removeFromNftSet(clientIp, "authenticated_users")
    await removeFromNftSet(clientIp, "admin_users")

    // >>> Remover mapeamento IP -> view <<<
    await unmapIpFromView(clientIp)

    await logAction(req.user.id, "LOGOUT", { ip: clientIp })
    console.log(`✅ Logout realizado para IP: ${clientIp}`)
    res.json({ success: true, message: "Logout realizado com sucesso" })
  } catch (error) {
    console.error("❌ Erro no logout:", error)
    res.status(500).json({ error: "Erro interno do servidor" })
  }
})

app.get("/api/roles", authenticate, async (req, res) => {
  try {
    const result = await pool.query(`SELECT * FROM roles ORDER BY name`)
    res.json(result.rows)
  } catch (error) {
    console.error("❌ Erro ao listar roles:", error)
    res.status(500).json({ error: "Erro interno do servidor" })
  }
})

app.get("/api/admin/sessions", authenticate, requireAdmin, async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT s.id, s.ip_address, u.username, r.name as role,
             s.login_time, s.expiry_time, s.active
      FROM sessions s
      JOIN users u ON s.user_id = u.id
      JOIN roles r ON u.role_id = r.id
      WHERE s.active = true AND s.expiry_time > NOW()
      ORDER BY s.login_time DESC
    `)
    res.json(result.rows)
  } catch (error) {
    console.error("❌ Erro ao listar sessões:", error)
    res.status(500).json({ error: "Erro interno do servidor" })
  }
})

app.post("/api/admin/disconnect/:sessionId", authenticate, requireAdmin, async (req, res) => {
  const { sessionId } = req.params
  try {
    const result = await pool.query(`SELECT ip_address FROM sessions WHERE id = $1`, [sessionId])
    if (result.rows.length === 0) {
      return res.status(404).json({ error: "Sessão não encontrada" })
    }
    const { ip_address } = result.rows[0]
    await pool.query(`UPDATE sessions SET active = false WHERE id = $1`, [sessionId])
    await removeFromNftSet(ip_address, "authenticated_users")
    await removeFromNftSet(ip_address, "admin_users")
    await unmapIpFromView(ip_address)
    await logAction(req.user.id, "DISCONNECT_SESSION", { sessionId, ip: ip_address })
    res.json({ success: true, message: "Sessão desconectada" })
  } catch (error) {
    console.error("❌ Erro ao desconectar sessão:", error)
    res.status(500).json({ error: "Erro interno do servidor" })
  }
})

app.get("/api/admin/users", authenticate, requireAdmin, async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT u.id, u.username, r.name as role, u.created_at,
             (SELECT COUNT(*) FROM sessions WHERE user_id = u.id AND active = true) as active_sessions
      FROM users u
      JOIN roles r ON u.role_id = r.id
      ORDER BY u.created_at DESC
    `)
    res.json(result.rows)
  } catch (error) {
    console.error("❌ Erro ao listar usuários:", error)
    res.status(500).json({ error: "Erro interno do servidor" })
  }
})

app.post("/api/admin/users", authenticate, requireAdmin, async (req, res) => {
  const { username, password, role_id } = req.body
  try {
    const passwordHash = await bcrypt.hash(password, 10)
    const result = await pool.query(`
      INSERT INTO users (username, password_hash, role_id)
      VALUES ($1, $2, $3)
      RETURNING id, username, role_id
    `, [username, passwordHash, role_id])
    await logAction(req.user.id, "CREATE_USER", { username, role_id })
    res.status(201).json(result.rows[0])
  } catch (error) {
    console.error("❌ Erro ao criar usuário:", error)
    res.status(500).json({ error: "Erro ao criar usuário. Verifique se o usuário já existe." })
  }
})

app.put("/api/admin/users/:userId", authenticate, requireAdmin, async (req, res) => {
  const { userId } = req.params
  const { password, role_id } = req.body
  try {
    if (password) {
      const passwordHash = await bcrypt.hash(password, 10)
      await pool.query(`UPDATE users SET password_hash = $1, role_id = $2 WHERE id = $3`, [passwordHash, role_id, userId])
    } else {
      await pool.query(`UPDATE users SET role_id = $1 WHERE id = $2`, [role_id, userId])
    }
    await logAction(req.user.id, "UPDATE_USER", { userId, role_id })
    res.json({ success: true })
  } catch (error) {
    console.error("❌ Erro ao atualizar usuário:", error)
    res.status(500).json({ error: "Erro ao atualizar usuário" })
  }
})

app.delete("/api/admin/users/:userId", authenticate, requireAdmin, async (req, res) => {
  const { userId } = req.params
  try {
    await pool.query(`DELETE FROM users WHERE id = $1`, [userId])
    await logAction(req.user.id, "DELETE_USER", { userId })
    res.json({ success: true })
  } catch (error) {
    console.error("❌ Erro ao deletar usuário:", error)
    res.status(500).json({ error: "Erro ao deletar usuário" })
  }
})

app.put("/api/admin/roles/:roleId", authenticate, requireAdmin, async (req, res) => {
  const { roleId } = req.params
  const { access_duration, unrestricted_access } = req.body
  try {
    await pool.query(`UPDATE roles SET access_duration = $1, unrestricted_access = $2 WHERE id = $3`, [access_duration, unrestricted_access, roleId])
    await logAction(req.user.id, "UPDATE_ROLE", { roleId, access_duration, unrestricted_access })
    res.json({ success: true })
  } catch (error) {
    console.error("❌ Erro ao atualizar role:", error)
    res.status(500).json({ error: "Erro ao atualizar role" })
  }
})

app.get("/api/admin/blocked-sites/:roleId", authenticate, requireAdmin, async (req, res) => {
  const { roleId } = req.params
  try {
    const result = await pool.query(`SELECT * FROM blocked_sites WHERE role_id = $1 ORDER BY created_at DESC`, [roleId])
    res.json(result.rows)
  } catch (error) {
    console.error("❌ Erro ao listar sites bloqueados:", error)
    res.status(500).json({ error: "Erro interno do servidor" })
  }
})

app.post("/api/admin/blocked-sites", authenticate, requireAdmin, async (req, res) => {
  const { domain, role_id } = req.body
  try {
    const inserted = await pool.query(`
      INSERT INTO blocked_sites (domain, role_id)
      VALUES ($1, $2)
      RETURNING *
    `, [domain, role_id])

    // Obter nome da role para aplicar na view
    const r = await pool.query(`SELECT name FROM roles WHERE id = $1`, [role_id])
    const roleName = r.rows[0]?.name
    if (roleName) {
      await addBlockedDomainToView(roleName, domain)
    } else {
      console.warn(`⚠️ Role id ${role_id} não encontrada para aplicar no Unbound`)
    }

    await logAction(req.user.id, "ADD_BLOCKED_SITE", { domain, role_id })
    res.status(201).json(inserted.rows[0])
  } catch (error) {
    console.error("❌ Erro ao adicionar site bloqueado:", error)
    res.status(500).json({ error: "Erro ao adicionar site bloqueado" })
  }
})

app.delete("/api/admin/blocked-sites/:siteId", authenticate, requireAdmin, async (req, res) => {
  const { siteId } = req.params
  try {
    // Pegar domain e role antes de remover para desfazer na view
    const cur = await pool.query(`SELECT domain, role_id FROM blocked_sites WHERE id = $1`, [siteId])
    if (cur.rows.length === 0) {
      return res.status(404).json({ error: "Registro não encontrado" })
    }
    const { domain, role_id } = cur.rows[0]
    const r = await pool.query(`SELECT name FROM roles WHERE id = $1`, [role_id])
    const roleName = r.rows[0]?.name

    await pool.query(`DELETE FROM blocked_sites WHERE id = $1`, [siteId])

    if (roleName) {
      await removeBlockedDomainFromView(roleName, domain)
    }

    await logAction(req.user.id, "REMOVE_BLOCKED_SITE", { siteId, domain, role_id })
    res.json({ success: true })
  } catch (error) {
    console.error("❌ Erro ao remover site bloqueado:", error)
    res.status(500).json({ error: "Erro ao remover site bloqueado" })
  }
})

app.get("/api/admin/logs", authenticate, requireAdmin, async (req, res) => {
  const { limit = 100 } = req.query
  try {
    const result = await pool.query(`
      SELECT l.id, l.action, l.details, l.created_at, u.username
      FROM audit_logs l
      JOIN users u ON l.user_id = u.id
      ORDER BY l.created_at DESC
      LIMIT $1
    `, [limit])
    res.json(result.rows)
  } catch (error) {
    console.error("❌ Erro ao listar logs:", error)
    res.status(500).json({ error: "Erro interno do servidor" })
  }
})

app.get("/api/admin/stats", authenticate, requireAdmin, async (req, res) => {
  try {
    const activeSessions = await pool.query(`SELECT COUNT(*) as count FROM sessions WHERE active = true AND expiry_time > NOW()`)    
    const totalUsers = await pool.query(`SELECT COUNT(*) as count FROM users`)
    const roleStats = await pool.query(`
      SELECT r.name, COUNT(u.id) as count FROM roles r
      LEFT JOIN users u ON r.id = u.role_id
      GROUP BY r.id, r.name
    `)
    const loginsTodayCount = await pool.query(`
      SELECT COUNT(*) as count FROM sessions WHERE login_time > NOW() - INTERVAL '24 hours'
    `)
    res.json({
      activeSessions: Number.parseInt(activeSessions.rows[0].count),
      totalUsers: Number.parseInt(totalUsers.rows[0].count),
      roleStats: roleStats.rows,
      loginsToday: Number.parseInt(loginsTodayCount.rows[0].count),
    })
  } catch (error) {
    console.error("❌ Erro ao buscar estatísticas:", error)
    res.status(500).json({ error: "Erro interno do servidor" })
  }
})

// Limpar sessões expiradas a cada minuto
setInterval(async () => {
  try {
    const expired = await pool.query(`SELECT DISTINCT ip_address FROM sessions WHERE active = true AND expiry_time < NOW()`)    
    for (const row of expired.rows) {
      await removeFromNftSet(row.ip_address, "authenticated_users")
      await removeFromNftSet(row.ip_address, "admin_users")
      await unmapIpFromView(row.ip_address)
    }
    await pool.query(`UPDATE sessions SET active = false WHERE expiry_time < NOW()`)    
    if (expired.rows.length > 0) {
      console.log(`🧹 ${expired.rows.length} sessões expiradas removidas`)
    }
  } catch (error) {
    console.error("❌ Erro ao limpar sessões:", error)
  }
}, 60000)

const PORT = 3000
initDatabase()
  .then(async () => {
    // Sincroniza bloqueios cadastrados no banco com Unbound
    await syncBlockedSitesToUnbound()

    app.listen(PORT, "0.0.0.0", () => {
      console.log(`🚀 API do Portal Captivo rodando na porta ${PORT}`)
      console.log(`📡 Aceitando conexões de qualquer IP`)
    })
  })
  .catch((err) => {
    console.error("❌ Erro ao inicializar banco de dados:", err)
    process.exit(1)
  })

// =================== Inicialização do Banco (inalterada da versão anterior) ===================
async function initDatabase() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS roles (
      id SERIAL PRIMARY KEY,
      name VARCHAR(50) UNIQUE NOT NULL,
      access_duration INTEGER DEFAULT 3600,
      unrestricted_access BOOLEAN DEFAULT FALSE,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    );
  `)
  await pool.query(`
    CREATE TABLE IF NOT EXISTS users (
      id SERIAL PRIMARY KEY,
      username VARCHAR(100) UNIQUE NOT NULL,
      password_hash VARCHAR(255) NOT NULL,
      role_id INTEGER REFERENCES roles(id),
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    );
  `)
  await pool.query(`
    CREATE TABLE IF NOT EXISTS blocked_sites (
      id SERIAL PRIMARY KEY,
      domain VARCHAR(255) NOT NULL,
      role_id INTEGER REFERENCES roles(id),
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(domain, role_id)
    );
  `)
  await pool.query(`
    CREATE TABLE IF NOT EXISTS sessions (
      id SERIAL PRIMARY KEY,
      user_id INTEGER REFERENCES users(id),
      ip_address VARCHAR(45) NOT NULL,
      mac_address VARCHAR(17),
      login_time TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      expiry_time TIMESTAMP NOT NULL,
      active BOOLEAN DEFAULT TRUE
    );
  `)
  await pool.query(`
    CREATE TABLE IF NOT EXISTS audit_logs (
      id SERIAL PRIMARY KEY,
      user_id INTEGER REFERENCES users(id),
      action VARCHAR(255) NOT NULL,
      details TEXT,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    );
  `)

  const roles = [
    { name: "admin", duration: 3600, unrestricted: true },
    { name: "professor", duration: 3600, unrestricted: false },
    { name: "aluno", duration: 3600, unrestricted: false },
  ]
  for (const role of roles) {
    await pool.query(
      `INSERT INTO roles (name, access_duration, unrestricted_access)
       VALUES ($1, $2, $3) ON CONFLICT (name) DO NOTHING`,
      [role.name, role.duration, role.unrestricted],
    )
  }

  const adminHash = await bcrypt.hash("admin123", 10)
  const adminRole = await pool.query(`SELECT id FROM roles WHERE name = 'admin'`)
  await pool.query(
    `INSERT INTO users (username, password_hash, role_id)
     VALUES ($1, $2, $3) ON CONFLICT (username) DO NOTHING`,
    ["admin", adminHash, adminRole.rows[0].id],
  )
  console.log("✅ Banco de dados inicializado com sucesso")
}
