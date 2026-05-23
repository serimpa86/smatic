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
  _db.run('BEGIN TRANSACTION');
  try { fn(); _db.run('COMMIT'); save(); }
  catch (e) { _db.run('ROLLBACK'); throw e; }
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

  seed();
  save();
  log('initDb completed in ' + (Date.now() - ts) + 'ms');
  } catch (e) {
    log('FATAL initDb error: ' + (e && e.stack || e));
    throw e;
  }
}

function seed() {
  const result = get('SELECT COUNT(*) as c FROM users');
  if (result && result.c > 0) return;

  const saId = uuidv4();
  const saHash = bcrypt.hashSync('SuperAdmin2026!', 10);
  run('INSERT INTO users (id, email, password_hash, name, role, is_active) VALUES (?,?,?,?,?,?)',
    [saId, 'superadmin@smatic.com', saHash, 'Super Admin', 'superadmin', 1]);
  run('INSERT INTO business_settings (id, user_id, business_name) VALUES (?, ?, ?)',
    [uuidv4(), saId, 'Smatic Admin']);
  run('INSERT INTO system_config (id) VALUES (\'global\')');

  const adminId = uuidv4();
  const adminHash = bcrypt.hashSync('admin123', 10);
  run('INSERT INTO users (id, email, password_hash, name, role, is_active) VALUES (?,?,?,?,?,?)',
    [adminId, 'admin@demo.com', adminHash, 'Admin Demo', 'admin', 1]);
  run('INSERT INTO business_settings (id, user_id, business_name) VALUES (?, ?, ?)',
    [uuidv4(), adminId, 'Mi Empresa Demo']);
  run('INSERT INTO taxes (id, user_id, name, rate, is_default) VALUES (?, ?, ?, ?, ?)',
    [uuidv4(), adminId, 'IVA 21%', 21, 1]);
  run('INSERT INTO taxes (id, user_id, name, rate) VALUES (?, ?, ?, ?)',
    [uuidv4(), adminId, 'IVA 10%', 10]);
  run('INSERT INTO invoice_templates (id, user_id, name, is_default) VALUES (?, ?, ?, ?)',
    [uuidv4(), adminId, 'Default', 1]);
}

module.exports = { getDb, initDb };
