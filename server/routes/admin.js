const express = require('express');
const bcrypt = require('bcryptjs');
const fs = require('fs');
const path = require('path');
const { v4: uuidv4 } = require('uuid');
const { authenticateToken, requireRole } = require('../middleware/auth');

const router = express.Router();
router.use(authenticateToken);
router.use(requireRole('superadmin'));

router.get('/system', (req, res) => {
  const cfg = req.db.get('SELECT * FROM system_config WHERE id = ?', ['global']);
  if (!cfg) return res.json({ errorcode: 404, errormsg: 'System config not found' });
  delete cfg.smtp_pass;
  delete cfg.stripe_secret_key;
  delete cfg.paypal_secret;
  res.json(cfg);
});

router.put('/system', (req, res) => {
  const { app_name, app_tagline, company_name, support_email, smtp_host, smtp_port, smtp_user, smtp_pass, smtp_from_email, smtp_from_name, stripe_public_key, stripe_secret_key, paypal_client_id, paypal_secret, max_users, allow_public_signup, maintenance_mode } = req.body;
  const existing = req.db.get('SELECT id FROM system_config WHERE id = ?', ['global']);
  if (!existing) {
    req.db.run('INSERT INTO system_config (id, app_name, app_tagline, company_name, support_email, smtp_host, smtp_port, smtp_user, smtp_pass, smtp_from_email, smtp_from_name, stripe_public_key, stripe_secret_key, paypal_client_id, paypal_secret, max_users, allow_public_signup, maintenance_mode) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)',
      ['global', app_name||'Smatic', app_tagline||'', company_name||'', support_email||'', smtp_host||'', smtp_port||587, smtp_user||'', smtp_pass||'', smtp_from_email||'', smtp_from_name||'', stripe_public_key||'', stripe_secret_key||'', paypal_client_id||'', paypal_secret||'', max_users||100, allow_public_signup!==undefined?allow_public_signup:1, maintenance_mode||0]);
  } else {
    const updates = [];
    const params = [];
    const fields = { app_name, app_tagline, company_name, support_email, smtp_host, smtp_port, smtp_user, smtp_from_email, smtp_from_name, stripe_public_key, paypal_client_id, max_users, allow_public_signup, maintenance_mode };
    for (const [k, v] of Object.entries(fields)) {
      if (v !== undefined) { updates.push(`${k}=?`); params.push(v); }
    }
    if (smtp_pass) { updates.push('smtp_pass=?'); params.push(smtp_pass); }
    if (stripe_secret_key) { updates.push('stripe_secret_key=?'); params.push(stripe_secret_key); }
    if (paypal_secret) { updates.push('paypal_secret=?'); params.push(paypal_secret); }
    if (updates.length > 0) {
      params.push('global');
      req.db.run(`UPDATE system_config SET ${updates.join(',')}, updated_at=datetime('now') WHERE id=?`, params);
    }
  }
  req.db.run('INSERT INTO audit_log (id, user_id, action, details) VALUES (?,?,?,?)',
    [uuidv4(), req.userId, 'SYSTEM_CONFIG_UPDATE', 'System configuration updated']);
  res.json({ success: true });
});

router.get('/users', (req, res) => {
  const { search, role, page = 1, limit = 50 } = req.query;
  let sql = 'SELECT u.id, u.email, u.name, u.role, u.is_active, u.company_id, u.created_at, u.updated_at, c.name as company_name FROM users u LEFT JOIN companies c ON u.company_id = c.id';
  let params = [];
  const where = [];
  if (search) { where.push('(email LIKE ? OR name LIKE ?)'); params.push(`%${search}%`, `%${search}%`); }
  if (role) { where.push('role = ?'); params.push(role); }
  if (where.length > 0) sql += ' WHERE ' + where.join(' AND ');
  sql += ' ORDER BY created_at DESC LIMIT ? OFFSET ?';
  const offset = (parseInt(page) - 1) * parseInt(limit);
  params.push(parseInt(limit), offset);
  const users = req.db.all(sql, params);
  const total = req.db.get('SELECT COUNT(*) as c FROM users').c;
  const stats = req.db.get(`SELECT
    COALESCE(SUM(CASE WHEN role='superadmin' THEN 1 ELSE 0 END),0) as superadmins,
    COALESCE(SUM(CASE WHEN role='admin' THEN 1 ELSE 0 END),0) as admins,
    COALESCE(SUM(CASE WHEN role='user' THEN 1 ELSE 0 END),0) as users
  FROM users`);
  res.json({ users, total, stats });
});

router.get('/users/:id', (req, res) => {
  const user = req.db.get('SELECT id, email, name, role, is_active, company_id, created_at, updated_at FROM users WHERE id = ?', [req.params.id]);
  if (!user) return res.json({ errorcode: 404, errormsg: 'User not found' });
  const company = req.db.get('SELECT id, name, business_name, cuit, currency FROM companies WHERE id = ?', [user.company_id]);
  const stats = req.db.get(`SELECT
    (SELECT COUNT(*) FROM invoices WHERE user_id=?) as total_invoices,
    (SELECT COUNT(*) FROM customers WHERE user_id=?) as total_customers,
    (SELECT COUNT(*) FROM items WHERE user_id=?) as total_items,
    (SELECT COALESCE(SUM(total),0) FROM invoices WHERE user_id=? AND status!='draft') as total_invoiced
  `, [user.id, user.id, user.id, user.id]);
  res.json({ ...user, company: company || null, stats });
});

router.post('/users', (req, res) => {
  const { email, password, name, role } = req.body;
  if (!email || !password) return res.json({ errorcode: 400, errormsg: 'Email and password required' });
  const existing = req.db.get('SELECT id FROM users WHERE email = ?', [email]);
  if (existing) return res.json({ errorcode: 409, errormsg: 'Email already registered' });
  const id = uuidv4();
  const companyId = uuidv4();
  const hash = bcrypt.hashSync(password, 10);
  const userRole = role || 'user';
  req.db.run('INSERT INTO companies (id, name, currency, currency_symbol) VALUES (?, ?, ?, ?)',
    [companyId, name || 'Mi Empresa', 'ARS', '$']);
  req.db.run('INSERT INTO users (id, email, password_hash, name, role, company_id) VALUES (?,?,?,?,?,?)',
    [id, email, hash, name||'', userRole, companyId]);
  req.db.run('INSERT INTO business_settings (id, user_id, company_id, business_name) VALUES (?, ?, ?, ?)',
    [uuidv4(), id, companyId, name||'Mi Empresa']);
  req.db.run('INSERT INTO taxes (id, user_id, company_id, name, rate, is_default) VALUES (?, ?, ?, ?, ?, ?)',
    [uuidv4(), id, companyId, 'IVA 21%', 21, 1]);
  req.db.run('INSERT INTO invoice_templates (id, user_id, company_id, name, is_default) VALUES (?, ?, ?, ?, ?)',
    [uuidv4(), id, companyId, 'Default', 1]);
  req.db.run('INSERT INTO audit_log (id, user_id, action, details) VALUES (?,?,?,?)',
    [uuidv4(), req.userId, 'USER_CREATE', 'Created user: ' + email + ' role: ' + userRole]);
  res.json({ id, email, name: name||'', role: userRole });
});

router.put('/users/:id', (req, res) => {
  const user = req.db.get('SELECT id, role FROM users WHERE id = ?', [req.params.id]);
  if (!user) return res.json({ errorcode: 404, errormsg: 'User not found' });
  const { email, name, role, is_active, password } = req.body;
  if (email) req.db.run('UPDATE users SET email=? WHERE id=?', [email, req.params.id]);
  if (name !== undefined) req.db.run('UPDATE users SET name=? WHERE id=?', [name, req.params.id]);
  if (role) req.db.run('UPDATE users SET role=? WHERE id=?', [role, req.params.id]);
  if (is_active !== undefined) req.db.run('UPDATE users SET is_active=? WHERE id=?', [is_active, req.params.id]);
  if (password) {
    const hash = bcrypt.hashSync(password, 10);
    req.db.run('UPDATE users SET password_hash=? WHERE id=?', [hash, req.params.id]);
  }
  req.db.run("UPDATE users SET updated_at=datetime('now') WHERE id=?", [req.params.id]);
  req.db.run('INSERT INTO audit_log (id, user_id, action, details) VALUES (?,?,?,?)',
    [uuidv4(), req.userId, 'USER_UPDATE', 'Updated user: ' + (email || req.params.id)]);
  res.json({ success: true });
});

router.delete('/users/:id', (req, res) => {
  const user = req.db.get('SELECT id, role, company_id FROM users WHERE id = ?', [req.params.id]);
  if (!user) return res.json({ errorcode: 404, errormsg: 'User not found' });
  if (req.params.id === req.userId) return res.json({ errorcode: 403, errormsg: 'Cannot delete yourself' });
  const uid = req.params.id;
  req.db.transaction(() => {
    req.db.run('DELETE FROM invoice_items WHERE invoice_id IN (SELECT id FROM invoices WHERE user_id=?)', [uid]);
    req.db.run('DELETE FROM quote_items WHERE quote_id IN (SELECT id FROM quotes WHERE user_id=?)', [uid]);
    req.db.run('DELETE FROM invoices WHERE user_id=?', [uid]);
    req.db.run('DELETE FROM quotes WHERE user_id=?', [uid]);
    req.db.run('DELETE FROM payments WHERE user_id=?', [uid]);
    req.db.run('DELETE FROM refunds WHERE user_id=?', [uid]);
    req.db.run('DELETE FROM credit_notes WHERE user_id=?', [uid]);
    req.db.run('DELETE FROM credit_note_items WHERE credit_note_id IN (SELECT id FROM credit_notes WHERE user_id=?)', [uid]);
    req.db.run('DELETE FROM customers WHERE user_id=?', [uid]);
    req.db.run('DELETE FROM items WHERE user_id=?', [uid]);
    req.db.run('DELETE FROM taxes WHERE user_id=?', [uid]);
    req.db.run('DELETE FROM invoice_templates WHERE user_id=?', [uid]);
    req.db.run('DELETE FROM business_settings WHERE user_id=?', [uid]);
    req.db.run('DELETE FROM sessions WHERE user_id=?', [uid]);
    req.db.run('DELETE FROM users WHERE id=?', [uid]);
    const remaining = req.db.get('SELECT COUNT(*) as c FROM users WHERE company_id = ?', [user.company_id]);
    if (remaining && remaining.c === 0 && user.company_id) {
      req.db.run('DELETE FROM companies WHERE id = ?', [user.company_id]);
    }
  });
  req.db.run('INSERT INTO audit_log (id, user_id, action, details) VALUES (?,?,?,?)',
    [uuidv4(), req.userId, 'USER_DELETE', 'Deleted user: ' + uid]);
  res.json({ success: true });
});

router.get('/audit-log', (req, res) => {
  const { page = 1, limit = 100 } = req.query;
  const offset = (parseInt(page) - 1) * parseInt(limit);
  const logs = req.db.all('SELECT * FROM audit_log ORDER BY created_at DESC LIMIT ? OFFSET ?', [parseInt(limit), offset]);
  const total = req.db.get('SELECT COUNT(*) as c FROM audit_log').c;
  res.json({ logs, total });
});

router.get('/audit-log/clear', (req, res) => {
  req.db.run('DELETE FROM audit_log');
  req.db.run('INSERT INTO audit_log (id, user_id, action, details) VALUES (?,?,?,?)',
    [uuidv4(), req.userId, 'AUDIT_CLEAR', 'Audit log cleared']);
  res.json({ success: true });
});

router.get('/stats', (req, res) => {
  const users = req.db.get('SELECT COUNT(*) as c FROM users').c;
  const activeUsers = req.db.get("SELECT COUNT(*) as c FROM users WHERE is_active=1 AND role!='superadmin'").c;
  const totalInvoices = req.db.get("SELECT COUNT(*) as c FROM invoices WHERE status!='draft'").c;
  const totalRevenue = req.db.get("SELECT COALESCE(SUM(total),0) as t FROM invoices WHERE status='paid'").t;
  const totalDue = req.db.get("SELECT COALESCE(SUM(amount_due),0) as t FROM invoices WHERE status!='paid' AND status!='draft' AND status!='cancelled'").t;
  const totalCustomers = req.db.get('SELECT COUNT(*) as c FROM customers').c;
  const totalItems = req.db.get('SELECT COUNT(*) as c FROM items').c;
  const dbPath = path.join(__dirname, '..', '..', 'data', 'billing.db');
  const dbSize = fs.existsSync(dbPath) ? fs.statSync(dbPath).size : 0;
  res.json({ users, activeUsers, totalInvoices, totalRevenue, totalDue, totalCustomers, totalItems, dbSize });
});

router.get('/db/backup', (req, res) => {
  const dbPath = path.join(__dirname, '..', '..', 'data', 'billing.db');
  if (!fs.existsSync(dbPath)) return res.status(404).json({ errorcode: 404, errormsg: 'DB file not found' });
  res.download(dbPath, 'smatic-backup-' + new Date().toISOString().split('T')[0] + '.db');
});

router.get('/all-customers', (req, res) => {
  const { search } = req.query;
  let sql = 'SELECT c.*, u.email as user_email, u.name as user_name, co.name as company_name FROM customers c JOIN users u ON c.user_id = u.id LEFT JOIN companies co ON c.company_id = co.id';
  let params = [];
  if (search) { sql += ' WHERE (c.name LIKE ? OR c.email LIKE ? OR u.email LIKE ?)'; params.push(`%${search}%`, `%${search}%`, `%${search}%`); }
  sql += ' ORDER BY u.email, c.name';
  res.json({ customers: req.db.all(sql, params) });
});

router.get('/all-invoices', (req, res) => {
  const { status, start, end } = req.query;
  let sql = 'SELECT i.*, u.email as user_email, co.name as company_name FROM invoices i JOIN users u ON i.user_id = u.id LEFT JOIN companies co ON i.company_id = co.id WHERE 1=1';
  let params = [];
  if (status) { sql += ' AND i.status=?'; params.push(status); }
  if (start) { sql += ' AND i.date>=?'; params.push(start); }
  if (end) { sql += ' AND i.date<=?'; params.push(end); }
  sql += ' ORDER BY i.created_at DESC LIMIT 500';
  res.json({ invoices: req.db.all(sql, params) });
});

module.exports = router;
