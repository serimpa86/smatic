const express = require('express');
const { v4: uuidv4 } = require('uuid');
const { authenticateToken } = require('../middleware/auth');

const router = express.Router();
router.use(authenticateToken);

router.get('/', (req, res) => {
  const { search, group, page = 1, limit = 50 } = req.query;
  let where = 'WHERE 1=1';
  let params = [];
  if (!req.isSuperadmin) { where += ' AND company_id = ?'; params.push(req.companyId); }
  if (search) { where += ' AND (name LIKE ? OR email LIKE ? OR phone LIKE ?)'; params.push(`%${search}%`, `%${search}%`, `%${search}%`); }
  if (group) { where += ' AND group_name = ?'; params.push(group); }
  const customers = req.db.all('SELECT * FROM customers ' + where + ' ORDER BY name ASC', params);
  const groups = req.db.all('SELECT DISTINCT group_name FROM customers ' + where + ' AND group_name != "" ORDER BY group_name', params);
  res.json({ customers, groups });
});

router.get('/:id', (req, res) => {
  const c = req.db.get('SELECT * FROM customers WHERE id = ?' + (req.isSuperadmin ? '' : ' AND company_id = ?'), req.isSuperadmin ? [req.params.id] : [req.params.id, req.companyId]);
  if (!c) return res.json({ errorcode: 404, errormsg: 'Customer not found' });
  res.json(c);
});

router.post('/', (req, res) => {
  const { name, email, phone, contact_person, salesperson, group_name, billing_address, shipping_address, payment_terms, payment_method, tax_exempt, notes, printed_info, active } = req.body;
  if (!name) return res.json({ errorcode: 400, errormsg: 'Customer name is required' });
  const id = uuidv4();
  req.db.run('INSERT INTO customers (id, user_id, company_id, name, email, phone, contact_person, salesperson, group_name, billing_address, shipping_address, payment_terms, payment_method, tax_exempt, notes, printed_info, active) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)',
    [id, req.userId, req.companyId, name, email||'', phone||'', contact_person||'', salesperson||'', group_name||'', billing_address||'', shipping_address||'', payment_terms||'30', payment_method||'', tax_exempt||0, notes||'', printed_info||'', active!==undefined?active:1]);
  res.json({ id });
});

router.put('/:id', (req, res) => {
  const { name, email, phone, contact_person, salesperson, group_name, billing_address, shipping_address, payment_terms, payment_method, tax_exempt, notes, printed_info, active } = req.body;
  const existing = req.db.get('SELECT id FROM customers WHERE id = ?' + (req.isSuperadmin ? '' : ' AND company_id = ?'), req.isSuperadmin ? [req.params.id] : [req.params.id, req.companyId]);
  if (!existing) return res.json({ errorcode: 404, errormsg: 'Customer not found' });
  req.db.run("UPDATE customers SET name=?, email=?, phone=?, contact_person=?, salesperson=?, group_name=?, billing_address=?, shipping_address=?, payment_terms=?, payment_method=?, tax_exempt=?, notes=?, printed_info=?, active=?, updated_at=datetime('now') WHERE id=?" + (req.isSuperadmin ? '' : ' AND company_id=?'),
    req.isSuperadmin
      ? [name, email||'', phone||'', contact_person||'', salesperson||'', group_name||'', billing_address||'', shipping_address||'', payment_terms||'30', payment_method||'', tax_exempt||0, notes||'', printed_info||'', active!==undefined?active:1, req.params.id]
      : [name, email||'', phone||'', contact_person||'', salesperson||'', group_name||'', billing_address||'', shipping_address||'', payment_terms||'30', payment_method||'', tax_exempt||0, notes||'', printed_info||'', active!==undefined?active:1, req.params.id, req.companyId]);
  res.json({ success: true });
});

router.delete('/:id', (req, res) => {
  req.db.run('DELETE FROM customers WHERE id = ?' + (req.isSuperadmin ? '' : ' AND company_id = ?'), req.isSuperadmin ? [req.params.id] : [req.params.id, req.companyId]);
  res.json({ success: true });
});

router.post('/groups', (req, res) => {
  const { name } = req.body;
  if (!name) return res.json({ errorcode: 400, errormsg: 'Group name required' });
  const id = uuidv4();
  req.db.run('INSERT INTO customer_groups (id, user_id, company_id, name) VALUES (?, ?, ?, ?)', [id, req.userId, req.companyId, name]);
  res.json({ id, name });
});

module.exports = router;
