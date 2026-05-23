const express = require('express');
const { v4: uuidv4 } = require('uuid');
const { authenticateToken } = require('../middleware/auth');

const router = express.Router();
router.use(authenticateToken);

router.get('/', (req, res) => {
  const { status, search } = req.query;
  let where = 'WHERE 1=1';
  let params = [];
  if (!req.isSuperadmin) { where += ' AND user_id = ?'; params.push(req.userId); }
  if (status) { where += ' AND status = ?'; params.push(status); }
  if (search) { where += ' AND (credit_note_number LIKE ? OR customer_name LIKE ?)'; params.push(`%${search}%`, `%${search}%`); }
  const notes = req.db.all('SELECT * FROM credit_notes ' + where + ' ORDER BY created_at DESC', params);
  res.json({ notes });
});

router.get('/:id', (req, res) => {
  const note = req.db.get('SELECT * FROM credit_notes WHERE id = ?' + (req.isSuperadmin ? '' : ' AND user_id = ?'), req.isSuperadmin ? [req.params.id] : [req.params.id, req.userId]);
  if (!note) return res.json({ errorcode: 404, errormsg: 'Nota de crédito no encontrada' });
  note.items = req.db.all('SELECT * FROM credit_note_items WHERE credit_note_id = ? ORDER BY row_id', [note.id]);
  res.json(note);
});

router.post('/', (req, res) => {
  const { invoice_id, customer_id, customer_name, customer_email, date, reason, items, currency, currency_symbol } = req.body;
  const settings = req.db.get('SELECT credit_note_prefix, next_credit_note_number FROM business_settings WHERE user_id = ?', [req.userId]);
  const num = settings.credit_note_prefix + settings.next_credit_note_number;
  const id = uuidv4();
  let subtotal = 0, total = 0;
  if (items && items.length) {
    items.forEach(item => {
      subtotal += (item.quantity || 1) * (item.unit_price || 0);
    });
  }
  total = subtotal;
  req.db.run(`INSERT INTO credit_notes (id, user_id, credit_note_number, invoice_id, customer_id, customer_name, customer_email, date, status, currency, currency_symbol, subtotal, tax_total, total, reason) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    [id, req.userId, num, invoice_id||null, customer_id||null, customer_name||'', customer_email||'', date||new Date().toISOString().split('T')[0], 'open', currency||'USD', currency_symbol||'$', subtotal, 0, total, reason||'']);
  if (items && items.length) {
    items.forEach((item, i) => {
      const lineTotal = (item.quantity || 1) * (item.unit_price || 0);
      req.db.run('INSERT INTO credit_note_items (id, credit_note_id, item_id, description, quantity, unit_price, tax_rate, tax_name, total) VALUES (?,?,?,?,?,?,?,?,?)',
        [uuidv4(), id, item.item_id||null, item.description||'', item.quantity||1, item.unit_price||0, item.tax_rate||0, item.tax_name||'', lineTotal]);
    });
  }
  req.db.run('UPDATE business_settings SET next_credit_note_number = next_credit_note_number + 1 WHERE user_id = ?', [req.userId]);
  res.json({ id, credit_note_number: num });
});

router.put('/:id', (req, res) => {
  const existing = req.db.get('SELECT id FROM credit_notes WHERE id = ?' + (req.isSuperadmin ? '' : ' AND user_id = ?'), req.isSuperadmin ? [req.params.id] : [req.params.id, req.userId]);
  if (!existing) return res.json({ errorcode: 404, errormsg: 'Nota de crédito no encontrada' });
  const { status, reason } = req.body;
  if (status) req.db.run('UPDATE credit_notes SET status=?, updated_at=datetime(\'now\') WHERE id=?', [status, req.params.id]);
  if (reason !== undefined) req.db.run('UPDATE credit_notes SET reason=?, updated_at=datetime(\'now\') WHERE id=?', [reason, req.params.id]);
  res.json({ success: true });
});

router.delete('/:id', (req, res) => {
  req.db.run('DELETE FROM credit_note_items WHERE credit_note_id = ?', [req.params.id]);
  req.db.run('DELETE FROM credit_notes WHERE id = ?' + (req.isSuperadmin ? '' : ' AND user_id = ?'), req.isSuperadmin ? [req.params.id] : [req.params.id, req.userId]);
  res.json({ success: true });
});

router.post('/:id/apply', (req, res) => {
  const note = req.db.get('SELECT * FROM credit_notes WHERE id = ?' + (req.isSuperadmin ? '' : ' AND user_id = ?'), req.isSuperadmin ? [req.params.id] : [req.params.id, req.userId]);
  if (!note) return res.json({ errorcode: 404, errormsg: 'Nota de crédito no encontrada' });
  const { invoice_id, amount } = req.body;
  if (!invoice_id || !amount) return res.json({ errorcode: 400, errormsg: 'Factura y monto requeridos' });
  const inv = req.db.get('SELECT total, amount_paid, amount_due FROM invoices WHERE id = ?' + (req.isSuperadmin ? '' : ' AND user_id = ?'), req.isSuperadmin ? [invoice_id] : [invoice_id, req.userId]);
  if (!inv) return res.json({ errorcode: 404, errormsg: 'Factura no encontrada' });
  const newPaid = (inv.amount_paid || 0) - amount;
  const newDue = inv.total - newPaid;
  const newStatus = newDue <= 0 ? 'paid' : (newPaid > 0 ? 'partial' : 'sent');
  req.db.run('UPDATE invoices SET amount_paid = ?, amount_due = ?, status = ?, updated_at = datetime(\'now\') WHERE id = ?', [newPaid, newDue, newStatus, invoice_id]);
  req.db.run('UPDATE credit_notes SET amount_applied = amount_applied + ?, status = ?, updated_at = datetime(\'now\') WHERE id = ?', [amount, newDue <= 0 ? 'closed' : 'partial', req.params.id]);
  res.json({ success: true });
});

module.exports = router;
