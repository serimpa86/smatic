const express = require('express');
const bcrypt = require('bcryptjs');
const { v4: uuidv4 } = require('uuid');
const { generateToken, authenticateToken } = require('../middleware/auth');

const router = express.Router();

router.post('/lloginemailvalidate', (req, res) => {
  const { email } = req.body;
  if (!email) return res.json({ errorcode: 400, errormsg: 'Email is required', noaccount: true });
  const user = req.db.get('SELECT id, email, is_active FROM users WHERE email = ?', [email]);
  if (!user) return res.json({ errorcode: 404, errormsg: 'No account found with this email', noaccount: true });
  if (!user.is_active) return res.json({ errorcode: 403, errormsg: 'Account disabled. Contact administrator.' });
  res.json({ accounttype: 'EMAIL', userid: user.id });
});

router.post('/login', (req, res) => {
  const { email, password } = req.body;
  if (!email || !password) return res.json({ errorcode: 400, errormsg: 'Email and password required' });
  const user = req.db.get('SELECT * FROM users WHERE email = ?', [email]);
  if (!user) return res.json({ errorcode: 401, errormsg: 'Invalid credentials' });
  if (!user.is_active) return res.json({ errorcode: 403, errormsg: 'Account disabled' });
  if (!bcrypt.compareSync(password, user.password_hash))
    return res.json({ errorcode: 401, errormsg: 'Invalid credentials' });
  const role = user.role || 'user';
  const token = generateToken(user.id, role);
  req.db.run('INSERT INTO audit_log (id, user_id, action, details) VALUES (?,?,?,?)',
    [uuidv4(), user.id, 'LOGIN', 'Login desde IP: ' + (req.ip || 'unknown')]);
  res.json({ token, user: { id: user.id, email: user.email, name: user.name, role } });
});

router.post('/signup', (req, res) => {
  const { email, password, name } = req.body;
  if (!email || !password) return res.json({ errorcode: 400, errormsg: 'Email and password required' });
  const cfg = req.db.get('SELECT allow_public_signup FROM system_config WHERE id = ?', ['global']);
  if (cfg && !cfg.allow_public_signup)
    return res.json({ errorcode: 403, errormsg: 'Public registration is disabled' });
  const existing = req.db.get('SELECT id FROM users WHERE email = ?', [email]);
  if (existing) return res.json({ errorcode: 409, errormsg: 'Email already registered' });
  const id = uuidv4();
  const hash = bcrypt.hashSync(password, 10);
  req.db.run('INSERT INTO users (id, email, password_hash, name, role) VALUES (?, ?, ?, ?, ?)',
    [id, email, hash, name || '', 'user']);
  req.db.run('INSERT INTO business_settings (id, user_id, business_name) VALUES (?, ?, ?)',
    [uuidv4(), id, name || 'Mi Empresa']);
  req.db.run('INSERT INTO taxes (id, user_id, name, rate, is_default) VALUES (?, ?, ?, ?, ?)',
    [uuidv4(), id, 'IVA 21%', 21, 1]);
  req.db.run('INSERT INTO taxes (id, user_id, name, rate) VALUES (?, ?, ?, ?)',
    [uuidv4(), id, 'IVA 10%', 10]);
  req.db.run('INSERT INTO invoice_templates (id, user_id, name, is_default) VALUES (?, ?, ?, ?)',
    [uuidv4(), id, 'Default', 1]);
  const token = generateToken(id, 'user');
  res.json({ token, user: { id, email, name: name || '', role: 'user' } });
});

router.get('/api/user', authenticateToken, (req, res) => {
  const user = req.db.get('SELECT id, email, name, role, language FROM users WHERE id = ?', [req.userId]);
  if (!user) return res.json({ errorcode: 404, errormsg: 'User not found' });
  res.json(user);
});

router.put('/api/user/preferences', authenticateToken, (req, res) => {
  const { language } = req.body;
  if (language) {
    req.db.run('UPDATE users SET language = ? WHERE id = ?', [language, req.userId]);
  }
  res.json({ success: true });
});

router.post('/llogout', (req, res) => {
  if (req.userId) {
    req.db.run('INSERT INTO audit_log (id, user_id, action, details) VALUES (?,?,?,?)',
      [uuidv4(), req.userId, 'LOGOUT', '']);
  }
  res.json({ success: true });
});

router.get('/issessionvalid', authenticateToken, (req, res) => {
  res.json({ issessionvalid: true });
});

module.exports = router;
