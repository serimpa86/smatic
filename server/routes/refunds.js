const express = require('express');
const { v4: uuidv4 } = require('uuid');
const { authenticateToken } = require('../middleware/auth');

const router = express.Router();
router.use(authenticateToken);

router.get('/', (req, res) => {
  const { search } = req.query;
  let where = 'WHERE 1=1';
  let params = [];
  if (!req.isSuperadmin) { where += ' AND r.company_id = ?'; params.push(req.companyId); }
  if (search) { where += ' AND (r.refund_number LIKE ? OR r.customer_name LIKE ?)'; params.push(`%${search}%`, `%${search}%`); }
  const refunds = req.db.all(`
    SELECT r.*, p.amount as payment_amount, p.payment_number
    FROM refunds r LEFT JOIN payments p ON r.payment_id = p.id
    ${where} ORDER BY r.created_at DESC`, params);
  res.json({ refunds });
});

router.get('/:id', (req, res) => {
  const r = req.db.get('SELECT * FROM refunds WHERE id = ?' + (req.isSuperadmin ? '' : ' AND company_id = ?'), req.isSuperadmin ? [req.params.id] : [req.params.id, req.companyId]);
  if (!r) return res.json({ errorcode: 404, errormsg: 'Reembolso no encontrado' });
  res.json(r);
});

router.post('/', (req, res) => {
  const { payment_id, customer_id, customer_name, amount, reason, date } = req.body;
  const count = req.db.get('SELECT COUNT(*) as c FROM refunds WHERE company_id = ?', [req.companyId]);
  const num = 'REF-' + String((count.c || 0) + 1001);
  const id = uuidv4();
  req.db.run(`INSERT INTO refunds (id, user_id, company_id, payment_id, customer_id, customer_name, refund_number, date, amount, reason) VALUES (?,?,?,?,?,?,?,?,?,?)`,
    [id, req.userId, req.companyId, payment_id||null, customer_id||null, customer_name||'', num, date||new Date().toISOString().split('T')[0], amount||0, reason||'']);
  res.json({ id, refund_number: num });
});

router.put('/:id', (req, res) => {
  const existing = req.db.get('SELECT id FROM refunds WHERE id = ?' + (req.isSuperadmin ? '' : ' AND company_id = ?'), req.isSuperadmin ? [req.params.id] : [req.params.id, req.companyId]);
  if (!existing) return res.json({ errorcode: 404, errormsg: 'Reembolso no encontrado' });
  const { amount, reason, date } = req.body;
  if (amount !== undefined) req.db.run('UPDATE refunds SET amount=?, updated_at=datetime(\'now\') WHERE id=?', [amount, req.params.id]);
  if (reason !== undefined) req.db.run('UPDATE refunds SET reason=?, updated_at=datetime(\'now\') WHERE id=?', [reason, req.params.id]);
  if (date !== undefined) req.db.run('UPDATE refunds SET date=?, updated_at=datetime(\'now\') WHERE id=?', [date, req.params.id]);
  res.json({ success: true });
});

router.delete('/:id', (req, res) => {
  req.db.run('DELETE FROM refunds WHERE id = ?' + (req.isSuperadmin ? '' : ' AND company_id = ?'), req.isSuperadmin ? [req.params.id] : [req.params.id, req.companyId]);
  res.json({ success: true });
});

module.exports = router;
