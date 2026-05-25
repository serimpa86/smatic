const initSqlJs = require('sql.js');
const path = require('path');
const fs = require('fs');
const bcrypt = require('bcryptjs');
const { v4: uuidv4 } = require('uuid');

const DB_PATH = process.env.DB_PATH || path.join(__dirname, '..', 'data', 'billing.db');
let _db = null;
let _SQL = null;

function log(msg) {
  const ts = new Date().toISOString();
  process.stderr.write(`[DB ${ts}] ${msg}\n`);
}

function all(sql, params = []) {
  if (!_db) throw new Error('Database not initialized');
  const stmt = _db.prepare(sql);
  if (params.length > 0) stmt.bind(params);
  const results = [];
  while (stmt.step()) results.push(stmt.getAsObject());
  stmt.free();
  return results;
}

function get(sql, params = []) {
  const results = all(sql, params);
  return results.length > 0 ? results[0] : null;
}

function run(sql, params = []) {
  if (!_db) throw new Error('Database not initialized');
  _db.run(sql, params);
  save();
}

function transaction(fn) {
  if (!_db) throw new Error('Database not initialized');
  _db.exec('BEGIN');
  try { fn(); _db.exec('COMMIT'); save(); }
  catch (e) { try { _db.exec('ROLLBACK'); } catch(e2) {} throw e; }
}

function save() {
  if (!_db) return;
  fs.writeFileSync(DB_PATH, Buffer.from(_db.export()));
}

function exec(sql) {
  if (!_db) throw new Error('Database not initialized');
  _db.exec(sql);
}

function getDb() {
  return { all, get, run, transaction, save, exec, _raw: () => _db };
}

async function initDb() {
  const ts = Date.now();
  try {
    const dir = path.dirname(DB_PATH);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    log('Directory ensured at ' + dir);

    const wasmPath = path.join(__dirname, '..', 'node_modules', 'sql.js', 'dist', 'sql-wasm.wasm');
    const wasmExists = fs.existsSync(wasmPath);
    log('WASM file exists at ' + wasmPath + ': ' + wasmExists);

    const opts = {};
    if (wasmExists) opts.locateFile = () => wasmPath;
    _SQL = await initSqlJs(opts);
  let buf = null;
  if (fs.existsSync(DB_PATH)) {
    buf = fs.readFileSync(DB_PATH);
    log('Existing DB loaded, size: ' + buf.length);
  } else {
    log('No existing DB, creating new one');
  }
  _db = new _SQL.Database(buf);
  exec('PRAGMA foreign_keys = ON');

  exec(`CREATE TABLE IF NOT EXISTS users (
    id TEXT PRIMARY KEY, email TEXT UNIQUE NOT NULL,
    password_hash TEXT NOT NULL, name TEXT DEFAULT '',
    role TEXT DEFAULT 'user', is_active INTEGER DEFAULT 1,
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT DEFAULT (datetime('now'))
  )`);

  try { exec("ALTER TABLE users ADD COLUMN role TEXT DEFAULT 'user'"); } catch (e) {}
  try { exec('ALTER TABLE users ADD COLUMN is_active INTEGER DEFAULT 1'); } catch (e) {}
  try { exec("ALTER TABLE users ADD COLUMN language TEXT DEFAULT 'es'"); } catch (e) {}

  exec(`CREATE TABLE IF NOT EXISTS system_config (
    id TEXT PRIMARY KEY DEFAULT 'global',
    app_name TEXT DEFAULT 'Smatic',
    app_tagline TEXT DEFAULT 'Sistema de Facturación Inteligente',
    company_name TEXT DEFAULT 'Smatic Inc.',
    support_email TEXT DEFAULT '',
    smtp_host TEXT DEFAULT '', smtp_port INTEGER DEFAULT 587,
    smtp_user TEXT DEFAULT '', smtp_pass TEXT DEFAULT '',
    smtp_from_email TEXT DEFAULT '', smtp_from_name TEXT DEFAULT '',
    stripe_public_key TEXT DEFAULT '', stripe_secret_key TEXT DEFAULT '',
    paypal_client_id TEXT DEFAULT '', paypal_secret TEXT DEFAULT '',
    max_users INTEGER DEFAULT 100,
    allow_public_signup INTEGER DEFAULT 1,
    maintenance_mode INTEGER DEFAULT 0,
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT DEFAULT (datetime('now'))
  )`);

  exec(`CREATE TABLE IF NOT EXISTS audit_log (
    id TEXT PRIMARY KEY, user_id TEXT, action TEXT NOT NULL,
    details TEXT DEFAULT '', ip_address TEXT DEFAULT '',
    created_at TEXT DEFAULT (datetime('now'))
  )`);

  exec(`CREATE TABLE IF NOT EXISTS business_settings (
    id TEXT PRIMARY KEY DEFAULT 'main', user_id TEXT NOT NULL,
    business_name TEXT DEFAULT 'Mi Empresa',
    business_address TEXT DEFAULT '', business_phone TEXT DEFAULT '',
    business_email TEXT DEFAULT '', website TEXT DEFAULT '',
    currency TEXT DEFAULT 'USD', currency_symbol TEXT DEFAULT '$',
    fiscal_year_start TEXT DEFAULT '01-01', default_tax_rate REAL DEFAULT 0,
    language TEXT DEFAULT 'es', timezone TEXT DEFAULT 'UTC',
    logo_url TEXT DEFAULT '', invoice_prefix TEXT DEFAULT 'INV-',
    quote_prefix TEXT DEFAULT 'QTE-', credit_note_prefix TEXT DEFAULT 'CN-',
    payment_terms TEXT DEFAULT '30',
    next_invoice_number INTEGER DEFAULT 1001,
    next_quote_number INTEGER DEFAULT 1001,
    next_credit_note_number INTEGER DEFAULT 1001,
    created_at TEXT DEFAULT (datetime('now'))
  )`);

  exec(`CREATE TABLE IF NOT EXISTS customers (
    id TEXT PRIMARY KEY, user_id TEXT NOT NULL,
    name TEXT NOT NULL, email TEXT DEFAULT '', phone TEXT DEFAULT '',
    contact_person TEXT DEFAULT '', salesperson TEXT DEFAULT '',
    group_name TEXT DEFAULT '', billing_address TEXT DEFAULT '',
    shipping_address TEXT DEFAULT '', payment_terms TEXT DEFAULT '30',
    payment_method TEXT DEFAULT '', tax_exempt INTEGER DEFAULT 0,
    notes TEXT DEFAULT '', printed_info TEXT DEFAULT '',
    active INTEGER DEFAULT 1,
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT DEFAULT (datetime('now'))
  )`);

  exec(`CREATE TABLE IF NOT EXISTS customer_groups (
    id TEXT PRIMARY KEY, user_id TEXT NOT NULL, name TEXT NOT NULL,
    created_at TEXT DEFAULT (datetime('now'))
  )`);

  exec(`CREATE TABLE IF NOT EXISTS items (
    id TEXT PRIMARY KEY, user_id TEXT NOT NULL,
    code TEXT DEFAULT '', name TEXT NOT NULL,
    description TEXT DEFAULT '', price REAL DEFAULT 0,
    cost_price REAL DEFAULT 0, tax_rate REAL DEFAULT 0,
    tax_name TEXT DEFAULT '', unit TEXT DEFAULT '',
    stock_quantity REAL DEFAULT 0, stock_warning_level REAL DEFAULT 0,
    track_inventory INTEGER DEFAULT 0, active INTEGER DEFAULT 1,
    image_url TEXT DEFAULT '', qr_code TEXT DEFAULT '',
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT DEFAULT (datetime('now'))
  )`);
  try { exec("ALTER TABLE items ADD COLUMN image_url TEXT DEFAULT ''"); } catch (e) {}
  try { exec("ALTER TABLE items ADD COLUMN qr_code TEXT DEFAULT ''"); } catch (e) {}

  exec(`CREATE TABLE IF NOT EXISTS taxes (
    id TEXT PRIMARY KEY, user_id TEXT NOT NULL,
    name TEXT NOT NULL, rate REAL NOT NULL DEFAULT 0,
    is_compound INTEGER DEFAULT 0, rate2 REAL DEFAULT 0,
    is_default INTEGER DEFAULT 0, show_zero INTEGER DEFAULT 0,
    created_at TEXT DEFAULT (datetime('now'))
  )`);

  exec(`CREATE TABLE IF NOT EXISTS invoices (
    id TEXT PRIMARY KEY, user_id TEXT NOT NULL,
    invoice_number TEXT NOT NULL, customer_id TEXT,
    customer_name TEXT DEFAULT '', customer_email TEXT DEFAULT '',
    customer_address TEXT DEFAULT '', customer_shipping TEXT DEFAULT '',
    date TEXT DEFAULT (date('now')),
    due_date TEXT DEFAULT (date('now', '+30 days')),
    payment_terms TEXT DEFAULT '30', po_number TEXT DEFAULT '',
    salesperson TEXT DEFAULT '', status TEXT DEFAULT 'draft',
    currency TEXT DEFAULT 'USD', currency_symbol TEXT DEFAULT '$',
    subtotal REAL DEFAULT 0, discount_amount REAL DEFAULT 0,
    discount_type TEXT DEFAULT 'percentage', shipping_cost REAL DEFAULT 0,
    shipping_tax REAL DEFAULT 0, tax_total REAL DEFAULT 0,
    total REAL DEFAULT 0, amount_paid REAL DEFAULT 0,
    amount_due REAL DEFAULT 0, notes TEXT DEFAULT '',
    private_notes TEXT DEFAULT '', footer TEXT DEFAULT '',
    is_recurring INTEGER DEFAULT 0, recurring_frequency TEXT DEFAULT '',
    recurring_next_date TEXT DEFAULT '', recurring_end_date TEXT DEFAULT '',
    recurring_occurrences INTEGER DEFAULT 0, recurring_count INTEGER DEFAULT 0,
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT DEFAULT (datetime('now'))
  )`);

  exec(`CREATE TABLE IF NOT EXISTS invoice_items (
    id TEXT PRIMARY KEY, invoice_id TEXT NOT NULL,
    item_id TEXT, item_code TEXT DEFAULT '', description TEXT DEFAULT '',
    quantity REAL DEFAULT 1, unit_price REAL DEFAULT 0,
    discount REAL DEFAULT 0, discount_type TEXT DEFAULT 'percentage',
    tax_rate REAL DEFAULT 0, tax_name TEXT DEFAULT '',
    total REAL DEFAULT 0, sort_order INTEGER DEFAULT 0
  )`);

  exec(`CREATE TABLE IF NOT EXISTS quotes (
    id TEXT PRIMARY KEY, user_id TEXT NOT NULL,
    quote_number TEXT NOT NULL, customer_id TEXT,
    customer_name TEXT DEFAULT '', customer_email TEXT DEFAULT '',
    customer_address TEXT DEFAULT '', customer_shipping TEXT DEFAULT '',
    date TEXT DEFAULT (date('now')),
    expiry_date TEXT DEFAULT (date('now', '+30 days')),
    payment_terms TEXT DEFAULT '30', po_number TEXT DEFAULT '',
    salesperson TEXT DEFAULT '', status TEXT DEFAULT 'draft',
    currency TEXT DEFAULT 'USD', currency_symbol TEXT DEFAULT '$',
    subtotal REAL DEFAULT 0, discount_amount REAL DEFAULT 0,
    discount_type TEXT DEFAULT 'percentage', shipping_cost REAL DEFAULT 0,
    tax_total REAL DEFAULT 0, total REAL DEFAULT 0,
    notes TEXT DEFAULT '', private_notes TEXT DEFAULT '',
    footer TEXT DEFAULT '', converted_to_invoice_id TEXT DEFAULT '',
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT DEFAULT (datetime('now'))
  )`);

  exec(`CREATE TABLE IF NOT EXISTS quote_items (
    id TEXT PRIMARY KEY, quote_id TEXT NOT NULL,
    item_id TEXT, item_code TEXT DEFAULT '', description TEXT DEFAULT '',
    quantity REAL DEFAULT 1, unit_price REAL DEFAULT 0,
    discount REAL DEFAULT 0, discount_type TEXT DEFAULT 'percentage',
    tax_rate REAL DEFAULT 0, tax_name TEXT DEFAULT '',
    total REAL DEFAULT 0, sort_order INTEGER DEFAULT 0
  )`);

  exec(`CREATE TABLE IF NOT EXISTS payments (
    id TEXT PRIMARY KEY, user_id TEXT NOT NULL,
    invoice_id TEXT, customer_id TEXT, customer_name TEXT DEFAULT '',
    payment_number TEXT DEFAULT '', date TEXT DEFAULT (date('now')),
    method TEXT DEFAULT '', reference TEXT DEFAULT '',
    amount REAL DEFAULT 0, notes TEXT DEFAULT '',
    created_at TEXT DEFAULT (datetime('now'))
  )`);

  exec(`CREATE TABLE IF NOT EXISTS refunds (
    id TEXT PRIMARY KEY, user_id TEXT NOT NULL,
    payment_id TEXT, customer_id TEXT, customer_name TEXT DEFAULT '',
    refund_number TEXT DEFAULT '', date TEXT DEFAULT (date('now')),
    amount REAL DEFAULT 0, reason TEXT DEFAULT '',
    created_at TEXT DEFAULT (datetime('now'))
  )`);

  exec(`CREATE TABLE IF NOT EXISTS credit_notes (
    id TEXT PRIMARY KEY, user_id TEXT NOT NULL,
    credit_note_number TEXT NOT NULL, invoice_id TEXT,
    customer_id TEXT, customer_name TEXT DEFAULT '',
    customer_email TEXT DEFAULT '', date TEXT DEFAULT (date('now')),
    status TEXT DEFAULT 'open', currency TEXT DEFAULT 'USD',
    currency_symbol TEXT DEFAULT '$', subtotal REAL DEFAULT 0,
    tax_total REAL DEFAULT 0, total REAL DEFAULT 0,
    amount_applied REAL DEFAULT 0, reason TEXT DEFAULT '',
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT DEFAULT (datetime('now'))
  )`);

  exec(`CREATE TABLE IF NOT EXISTS credit_note_items (
    id TEXT PRIMARY KEY, credit_note_id TEXT NOT NULL,
    item_id TEXT, description TEXT DEFAULT '',
    quantity REAL DEFAULT 1, unit_price REAL DEFAULT 0,
    tax_rate REAL DEFAULT 0, tax_name TEXT DEFAULT '',
    total REAL DEFAULT 0
  )`);

  exec(`CREATE TABLE IF NOT EXISTS invoice_templates (
    id TEXT PRIMARY KEY, user_id TEXT NOT NULL,
    name TEXT DEFAULT 'Default', content TEXT DEFAULT '',
    is_default INTEGER DEFAULT 0,
    created_at TEXT DEFAULT (datetime('now'))
  )`);

  exec(`CREATE TABLE IF NOT EXISTS sessions (
    id TEXT PRIMARY KEY, user_id TEXT NOT NULL,
    token TEXT NOT NULL, expires_at TEXT NOT NULL,
    created_at TEXT DEFAULT (datetime('now'))
  )`);

  exec(`CREATE TABLE IF NOT EXISTS companies (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL DEFAULT 'Mi Empresa',
    business_name TEXT DEFAULT '',
    cuit TEXT DEFAULT '',
    tax_category TEXT DEFAULT 'responsable_inscripto',
    industry TEXT DEFAULT '',
    address TEXT DEFAULT '', phone TEXT DEFAULT '',
    email TEXT DEFAULT '', website TEXT DEFAULT '',
    logo_url TEXT DEFAULT '',
    currency TEXT DEFAULT 'ARS',
    currency_symbol TEXT DEFAULT '$',
    timezone TEXT DEFAULT 'America/Argentina/Buenos_Aires',
    fiscal_year_start TEXT DEFAULT '01-01',
    afip_env TEXT DEFAULT 'testing',
    afip_cert TEXT DEFAULT '', afip_key TEXT DEFAULT '',
    afip_point_of_sale TEXT DEFAULT '0001',
    fiscal_printer_type TEXT DEFAULT 'none',
    printer_connection TEXT DEFAULT '',
    printer_port TEXT DEFAULT '',
    modules_active TEXT DEFAULT '[]',
    setup_completed INTEGER DEFAULT 0,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT DEFAULT CURRENT_TIMESTAMP
  )`);

  // --- Add company_id to existing tables ---
  try { exec("ALTER TABLE users ADD COLUMN company_id TEXT"); } catch (e) {}
  try { exec("ALTER TABLE business_settings ADD COLUMN company_id TEXT"); } catch (e) {}
  try { exec("ALTER TABLE customers ADD COLUMN company_id TEXT"); } catch (e) {}
  try { exec("ALTER TABLE customer_groups ADD COLUMN company_id TEXT"); } catch (e) {}
  try { exec("ALTER TABLE items ADD COLUMN company_id TEXT"); } catch (e) {}
  try { exec("ALTER TABLE taxes ADD COLUMN company_id TEXT"); } catch (e) {}
  try { exec("ALTER TABLE invoices ADD COLUMN company_id TEXT"); } catch (e) {}
  try { exec("ALTER TABLE quotes ADD COLUMN company_id TEXT"); } catch (e) {}
  try { exec("ALTER TABLE payments ADD COLUMN company_id TEXT"); } catch (e) {}
  try { exec("ALTER TABLE refunds ADD COLUMN company_id TEXT"); } catch (e) {}
  try { exec("ALTER TABLE credit_notes ADD COLUMN company_id TEXT"); } catch (e) {}
  try { exec("ALTER TABLE invoice_templates ADD COLUMN company_id TEXT"); } catch (e) {}
  try { exec("ALTER TABLE invoice_items ADD COLUMN company_id TEXT"); } catch (e) {}
  try { exec("ALTER TABLE quote_items ADD COLUMN company_id TEXT"); } catch (e) {}
  try { exec("ALTER TABLE credit_note_items ADD COLUMN company_id TEXT"); } catch (e) {}
  try { exec("ALTER TABLE sessions ADD COLUMN company_id TEXT"); } catch (e) {}

  migrateToMultiCompany();
  seed();
  save();
  log('initDb completed in ' + (Date.now() - ts) + 'ms');
  } catch (e) {
    log('FATAL initDb error: ' + (e && e.stack || e));
    throw e;
  }
}

function migrateToMultiCompany() {
  // Check if any user has an orphaned company_id (company row missing) and fix
  const orphaned = all("SELECT u.id, u.email, u.company_id FROM users u WHERE u.company_id IS NOT NULL AND u.company_id != '' AND NOT EXISTS (SELECT 1 FROM companies c WHERE c.id = u.company_id)");
  if (orphaned && orphaned.length > 0) {
    log('Fixing ' + orphaned.length + ' orphaned company references...');
    for (const u of orphaned) {
      const bs = get('SELECT business_name, currency, currency_symbol, timezone, fiscal_year_start FROM business_settings WHERE user_id = ?', [u.id]);
      const newId = uuidv4();
      run('INSERT INTO companies (id, name, business_name, currency, currency_symbol, timezone, fiscal_year_start) VALUES (?,?,?,?,?,?,?)',
        [newId, bs ? bs.business_name || u.email : u.email, bs ? bs.business_name || '' : '', bs ? bs.currency || 'ARS' : 'ARS', bs ? bs.currency_symbol || '$' : '$', bs ? bs.timezone || 'America/Argentina/Buenos_Aires' : 'America/Argentina/Buenos_Aires', bs ? bs.fiscal_year_start || '01-01' : '01-01']);
      run('UPDATE users SET company_id = ? WHERE id = ?', [newId, u.id]);
      run('UPDATE business_settings SET company_id = ? WHERE user_id = ?', [newId, u.id]);
      run('UPDATE customers SET company_id = ? WHERE user_id = ?', [newId, u.id]);
      run('UPDATE customer_groups SET company_id = ? WHERE user_id = ?', [newId, u.id]);
      run('UPDATE items SET company_id = ? WHERE user_id = ?', [newId, u.id]);
      run('UPDATE taxes SET company_id = ? WHERE user_id = ?', [newId, u.id]);
      run('UPDATE invoices SET company_id = ? WHERE user_id = ?', [newId, u.id]);
      run('UPDATE quotes SET company_id = ? WHERE user_id = ?', [newId, u.id]);
      run('UPDATE payments SET company_id = ? WHERE user_id = ?', [newId, u.id]);
      run('UPDATE refunds SET company_id = ? WHERE user_id = ?', [newId, u.id]);
      run('UPDATE credit_notes SET company_id = ? WHERE user_id = ?', [newId, u.id]);
      run('UPDATE invoice_templates SET company_id = ? WHERE user_id = ?', [newId, u.id]);
    }
    log('Fixed ' + orphaned.length + ' orphaned references.');
  }

  // Migrate users that still don't have company_id
  const pending = all("SELECT u.*, bs.business_name, bs.currency, bs.currency_symbol, bs.timezone, bs.fiscal_year_start FROM users u LEFT JOIN business_settings bs ON bs.user_id = u.id WHERE u.company_id IS NULL OR u.company_id = ''");
  if (!pending || pending.length === 0) return;
  log('Migrating ' + pending.length + ' users to multi-company...');
  for (const user of pending) {
    try {
      const companyId = uuidv4();
      run('INSERT INTO companies (id, name, business_name, currency, currency_symbol, timezone, fiscal_year_start) VALUES (?,?,?,?,?,?,?)',
        [companyId, user.business_name || user.name || 'Mi Empresa', user.business_name || '', user.currency || 'ARS', user.currency_symbol || '$', user.timezone || 'America/Argentina/Buenos_Aires', user.fiscal_year_start || '01-01']);
      run('UPDATE users SET company_id = ? WHERE id = ?', [companyId, user.id]);
      run('UPDATE business_settings SET company_id = ? WHERE user_id = ?', [companyId, user.id]);
      run('UPDATE customers SET company_id = ? WHERE user_id = ?', [companyId, user.id]);
      run('UPDATE customer_groups SET company_id = ? WHERE user_id = ?', [companyId, user.id]);
      run('UPDATE items SET company_id = ? WHERE user_id = ?', [companyId, user.id]);
      run('UPDATE taxes SET company_id = ? WHERE user_id = ?', [companyId, user.id]);
      run('UPDATE invoices SET company_id = ? WHERE user_id = ?', [companyId, user.id]);
      run('UPDATE quotes SET company_id = ? WHERE user_id = ?', [companyId, user.id]);
      run('UPDATE payments SET company_id = ? WHERE user_id = ?', [companyId, user.id]);
      run('UPDATE refunds SET company_id = ? WHERE user_id = ?', [companyId, user.id]);
      run('UPDATE credit_notes SET company_id = ? WHERE user_id = ?', [companyId, user.id]);
      run('UPDATE invoice_templates SET company_id = ? WHERE user_id = ?', [companyId, user.id]);
      run('UPDATE invoice_items SET company_id = ? WHERE invoice_id IN (SELECT id FROM invoices WHERE user_id = ?)', [companyId, user.id]);
      run('UPDATE quote_items SET company_id = ? WHERE quote_id IN (SELECT id FROM quotes WHERE user_id = ?)', [companyId, user.id]);
      run('UPDATE credit_note_items SET company_id = ? WHERE credit_note_id IN (SELECT id FROM credit_notes WHERE user_id = ?)', [companyId, user.id]);
    } catch (e) { log('Migration error for user ' + user.email + ': ' + e.message); }
  }
  log('Migration to multi-company completed.');
}

function seed() {
  const result = get('SELECT COUNT(*) as c FROM users');
  if (result && result.c > 0) return;

  const saCompanyId = uuidv4();
  run('INSERT INTO companies (id, name, currency, currency_symbol) VALUES (?,?,?,?)',
    [saCompanyId, 'Smatic Admin', 'USD', '$']);
  const saId = uuidv4();
  const saHash = bcrypt.hashSync('SuperAdmin2026!', 10);
  run('INSERT INTO users (id, email, password_hash, name, role, is_active, company_id) VALUES (?,?,?,?,?,?,?)',
    [saId, 'superadmin@smatic.com', saHash, 'Super Admin', 'superadmin', 1, saCompanyId]);
  run('INSERT INTO business_settings (id, user_id, company_id, business_name) VALUES (?, ?, ?, ?)',
    [uuidv4(), saId, saCompanyId, 'Smatic Admin']);
  run('INSERT INTO system_config (id) VALUES (\'global\')');

  const adminCompanyId = uuidv4();
  run('INSERT INTO companies (id, name, currency, currency_symbol) VALUES (?,?,?,?)',
    [adminCompanyId, 'Mi Empresa Demo', 'ARS', '$']);
  const adminId = uuidv4();
  const adminHash = bcrypt.hashSync('admin123', 10);
  run('INSERT INTO users (id, email, password_hash, name, role, is_active, company_id) VALUES (?,?,?,?,?,?,?)',
    [adminId, 'admin@demo.com', adminHash, 'Admin Demo', 'admin', 1, adminCompanyId]);
  run('INSERT INTO business_settings (id, user_id, company_id, business_name) VALUES (?, ?, ?, ?)',
    [uuidv4(), adminId, adminCompanyId, 'Mi Empresa Demo']);
  run('INSERT INTO taxes (id, user_id, company_id, name, rate, is_default) VALUES (?, ?, ?, ?, ?, ?)',
    [uuidv4(), adminId, adminCompanyId, 'IVA 21%', 21, 1]);
  run('INSERT INTO taxes (id, user_id, company_id, name, rate) VALUES (?, ?, ?, ?, ?)',
    [uuidv4(), adminId, adminCompanyId, 'IVA 10%', 10]);
  run('INSERT INTO invoice_templates (id, user_id, company_id, name, is_default) VALUES (?, ?, ?, ?, ?)',
    [uuidv4(), adminId, adminCompanyId, 'Default', 1]);
}

module.exports = { getDb, initDb };
