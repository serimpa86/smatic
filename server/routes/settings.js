const express = require('express');
const { v4: uuidv4 } = require('uuid');
const { authenticateToken } = require('../middleware/auth');
const multer = require('multer');
const path = require('path');

const router = express.Router();
router.use(authenticateToken);

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, path.join(__dirname, '..', '..', 'public', 'uploads')),
  filename: (req, file, cb) => cb(null, Date.now() + '-' + file.originalname)
});
const upload = multer({ storage });

router.get('/', (req, res) => {
  const s = req.db.get('SELECT * FROM business_settings WHERE user_id = ?', [req.userId]);
  if (!s) return res.json({ errorcode: 404, errormsg: 'Settings not found' });
  res.json(s);
});

router.put('/', (req, res) => {
  const { business_name, business_address, business_phone, business_email, website, currency, currency_symbol, fiscal_year_start, default_tax_rate, language, timezone, payment_terms, invoice_prefix, quote_prefix, credit_note_prefix } = req.body;
  const existing = req.db.get('SELECT id FROM business_settings WHERE user_id = ?', [req.userId]);
  if (!existing) {
    req.db.run('INSERT INTO business_settings (id, user_id, business_name, business_address, business_phone, business_email, website, currency, currency_symbol, language, timezone, payment_terms, invoice_prefix, quote_prefix, credit_note_prefix) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)',
      [uuidv4(), req.userId, business_name||'', business_address||'', business_phone||'', business_email||'', website||'', currency||'USD', currency_symbol||'$', language||'es', timezone||'UTC', payment_terms||'30', invoice_prefix||'INV-', quote_prefix||'QTE-', credit_note_prefix||'CN-']);
  } else {
    req.db.run('UPDATE business_settings SET business_name=?, business_address=?, business_phone=?, business_email=?, website=?, currency=?, currency_symbol=?, fiscal_year_start=?, default_tax_rate=?, language=?, timezone=?, payment_terms=?, invoice_prefix=?, quote_prefix=?, credit_note_prefix=? WHERE user_id=?',
      [business_name||'', business_address||'', business_phone||'', business_email||'', website||'', currency||'USD', currency_symbol||'$', fiscal_year_start||'01-01', default_tax_rate||0, language||'es', timezone||'UTC', payment_terms||'30', invoice_prefix||'INV-', quote_prefix||'QTE-', credit_note_prefix||'CN-', req.userId]);
  }
  res.json({ success: true });
});

router.post('/logo', upload.single('logo'), (req, res) => {
  if (!req.file) return res.json({ errorcode: 400, errormsg: 'No file uploaded' });
  const url = '/uploads/' + req.file.filename;
  req.db.run('UPDATE business_settings SET logo_url = ? WHERE user_id = ?', [url, req.userId]);
  res.json({ url });
});

router.get('/taxes', (req, res) => {
  const taxes = req.db.all('SELECT * FROM taxes WHERE user_id = ? ORDER BY name', [req.userId]);
  res.json({ taxes });
});

router.post('/taxes', (req, res) => {
  const { name, rate, is_compound, rate2, is_default, show_zero } = req.body;
  const id = uuidv4();
  if (is_default) req.db.run('UPDATE taxes SET is_default = 0 WHERE user_id = ?', [req.userId]);
  req.db.run('INSERT INTO taxes (id, user_id, name, rate, is_compound, rate2, is_default, show_zero) VALUES (?,?,?,?,?,?,?,?)',
    [id, req.userId, name, rate||0, is_compound||0, rate2||0, is_default||0, show_zero||0]);
  res.json({ id });
});

router.put('/taxes/:id', (req, res) => {
  const { name, rate, is_compound, rate2, is_default, show_zero } = req.body;
  if (is_default) req.db.run('UPDATE taxes SET is_default = 0 WHERE user_id = ?', [req.userId]);
  req.db.run('UPDATE taxes SET name=?, rate=?, is_compound=?, rate2=?, is_default=?, show_zero=? WHERE id=? AND user_id=?',
    [name, rate||0, is_compound||0, rate2||0, is_default||0, show_zero||0, req.params.id, req.userId]);
  res.json({ success: true });
});

router.delete('/taxes/:id', (req, res) => {
  req.db.run('DELETE FROM taxes WHERE id = ? AND user_id = ?', [req.params.id, req.userId]);
  res.json({ success: true });
});

router.get('/templates', (req, res) => {
  const t = req.db.all('SELECT * FROM invoice_templates WHERE user_id = ?', [req.userId]);
  res.json({ templates: t });
});

module.exports = router;
