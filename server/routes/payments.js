const express = require('express');
const { v4: uuidv4 } = require('uuid');
const { authenticateToken } = require('../middleware/auth');

const router = express.Router();
router.use(authenticateToken);

router.get('/', (req, res) => {
  const { start, end, search } = req.query;
  let where = 'WHERE 1=1';
  let params = [];
  if (!req.isSuperadmin) { where += ' AND user_id = ?'; params.push(req.userId); }
  if (start) { where += ' AND date >= ?'; params.push(start); }
  if (end) { where += ' AND date <= ?'; params.push(end); }
  if (search) { where += ' AND (payment_number LIKE ? OR customer_name LIKE ? OR reference LIKE ?)'; params.push(`%${search}%`, `%${search}%`, `%${search}%`); }
  const payments = req.db.all('SELECT * FROM payments ' + where + ' ORDER BY date DESC', params);
  res.json({ payments });
});

router.get('/:id', (req, res) => {
  const p = req.db.get('SELECT * FROM payments WHERE id = ?' + (req.isSuperadmin ? '' : ' AND user_id = ?'), req.isSuperadmin ? [req.params.id] : [req.params.id, req.userId]);
  if (!p) return res.json({ errorcode: 404, errormsg: 'Payment not found' });
  res.json(p);
});

router.get('/unpaid/:customer_id', (req, res) => {
  const invoices = req.db.all("SELECT id, invoice_number, date, due_date, total, amount_paid, amount_due FROM invoices WHERE customer_id = ?" + (req.isSuperadmin ? '' : " AND user_id = ?") + " AND status != 'paid' AND status != 'draft' ORDER BY date DESC", req.isSuperadmin ? [req.params.customer_id] : [req.params.customer_id, req.userId]);
  res.json({ invoices });
});

router.post('/', (req, res) => {
  const { invoice_id, customer_id, customer_name, date, method, reference, amount, notes } = req.body;
  if (!amount || amount <= 0) return res.json({ errorcode: 400, errormsg: 'Invalid payment amount' });
  const pn = 'PAY-' + Date.now();
  const id = uuidv4();
  req.db.run('INSERT INTO payments (id, user_id, invoice_id, customer_id, customer_name, payment_number, date, method, reference, amount, notes) VALUES (?,?,?,?,?,?,?,?,?,?,?)',
    [id, req.userId, invoice_id||null, customer_id||null, customer_name||'', pn, date||new Date().toISOString().split('T')[0], method||'', reference||'', amount, notes||'']);
  if (invoice_id) {
    const inv = req.db.get('SELECT total, amount_paid FROM invoices WHERE id = ? AND user_id = ?', [invoice_id, req.userId]);
    if (inv) {
      const newPaid = (inv.amount_paid || 0) + amount;
      const newDue = inv.total - newPaid;
      const newStatus = newDue <= 0 ? 'paid' : (newPaid > 0 ? 'partial' : 'sent');
      req.db.run('UPDATE invoices SET amount_paid = ?, amount_due = ?, status = ?, updated_at = datetime(\'now\') WHERE id = ?', [newPaid, newDue, newStatus, invoice_id]);
    }
  }
  res.json({ id, payment_number: pn });
});

router.put('/:id', (req, res) => {
  const existing = req.db.get('SELECT * FROM payments WHERE id = ?' + (req.isSuperadmin ? '' : ' AND user_id = ?'), req.isSuperadmin ? [req.params.id] : [req.params.id, req.userId]);
  if (!existing) return res.json({ errorcode: 404, errormsg: 'Payment not found' });
  const { date, method, reference, amount, notes } = req.body;
  req.db.run('UPDATE payments SET date=?, method=?, reference=?, amount=?, notes=? WHERE id=?',
    [date||existing.date, method||existing.method, reference||existing.reference, amount||existing.amount, notes||existing.notes, req.params.id]);
  if (existing.invoice_id) {
    const diff = (amount||existing.amount) - existing.amount;
    if (diff !== 0) {
      const inv = req.db.get('SELECT total, amount_paid FROM invoices WHERE id = ?' + (req.isSuperadmin ? '' : ' AND user_id = ?'), req.isSuperadmin ? [existing.invoice_id] : [existing.invoice_id, req.userId]);
      if (inv) {
        const newPaid = (inv.amount_paid || 0) + diff;
        const newDue = inv.total - newPaid;
        const newStatus = newDue <= 0 ? 'paid' : (newPaid > 0 ? 'partial' : 'sent');
        req.db.run('UPDATE invoices SET amount_paid = ?, amount_due = ?, status = ? WHERE id = ?', [newPaid, newDue, newStatus, existing.invoice_id]);
      }
    }
  }
  res.json({ success: true });
});

router.delete('/:id', (req, res) => {
  const p = req.db.get('SELECT * FROM payments WHERE id = ?' + (req.isSuperadmin ? '' : ' AND user_id = ?'), req.isSuperadmin ? [req.params.id] : [req.params.id, req.userId]);
  if (p && p.invoice_id) {
    const inv = req.db.get('SELECT total, amount_paid FROM invoices WHERE id = ?' + (req.isSuperadmin ? '' : ' AND user_id = ?'), req.isSuperadmin ? [p.invoice_id] : [p.invoice_id, req.userId]);
    if (inv) {
      const newPaid = Math.max(0, (inv.amount_paid || 0) - p.amount);
      const newDue = inv.total - newPaid;
      const newStatus = newPaid <= 0 ? 'sent' : (newDue > 0 ? 'partial' : 'paid');
      req.db.run('UPDATE invoices SET amount_paid = ?, amount_due = ?, status = ? WHERE id = ?', [newPaid, newDue, newStatus, p.invoice_id]);
    }
  }
  req.db.run('DELETE FROM payments WHERE id = ?' + (req.isSuperadmin ? '' : ' AND user_id = ?'), req.isSuperadmin ? [req.params.id] : [req.params.id, req.userId]);
  res.json({ success: true });
});

module.exports = router;
