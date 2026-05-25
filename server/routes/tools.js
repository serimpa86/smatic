const express = require('express');
const { v4: uuidv4 } = require('uuid');
const { authenticateToken } = require('../middleware/auth');

const router = express.Router();
router.use(authenticateToken);

router.post('/import/customers', (req, res) => {
  const { data } = req.body;
  if (!Array.isArray(data) || data.length === 0) return res.json({ errorcode: 400, errormsg: 'No data provided' });
  let imported = 0;
  try {
    req.db.transaction(() => {
      for (const row of data) {
        if (!row.name) continue;
        req.db.run('INSERT INTO customers (id, user_id, company_id, name, email, phone, billing_address, active) VALUES (?,?,?,?,?,?,?,1)',
          [uuidv4(), req.userId, req.companyId, row.name, row.email||'', row.phone||'', row.address||'']);
        imported++;
      }
    });
  } catch (e) {
    return res.json({ errorcode: 500, errormsg: 'Import error: ' + e.message });
  }
  res.json({ imported });
});

router.post('/import/items', (req, res) => {
  const { data } = req.body;
  if (!Array.isArray(data) || data.length === 0) return res.json({ errorcode: 400, errormsg: 'No data provided' });
  let imported = 0;
  try {
    req.db.transaction(() => {
      for (const row of data) {
        if (!row.name) continue;
        req.db.run('INSERT INTO items (id, user_id, company_id, code, name, price, active) VALUES (?,?,?,?,?,?,1)',
          [uuidv4(), req.userId, req.companyId, row.code||'', row.name, row.price||0]);
        imported++;
      }
    });
  } catch (e) {
    return res.json({ errorcode: 500, errormsg: 'Import error: ' + e.message });
  }
  res.json({ imported });
});

router.post('/import/invoices', (req, res) => {
  const { data } = req.body;
  if (!Array.isArray(data) || data.length === 0) return res.json({ errorcode: 400, errormsg: 'No data provided' });
  const settings = req.db.get('SELECT invoice_prefix, next_invoice_number FROM business_settings WHERE company_id = ?', [req.companyId]);
  let nextNum = settings.next_invoice_number;
  let imported = 0;
  try {
    req.db.transaction(() => {
      for (const row of data) {
        if (!row.customer_name) continue;
        const id = uuidv4();
        const invNum = settings.invoice_prefix + nextNum;
        req.db.run("INSERT INTO invoices (id, user_id, company_id, invoice_number, customer_name, date, total, amount_due, status, currency) VALUES (?,?,?,?,?,?,?,?,?,?)",
          [id, req.userId, req.companyId, invNum, row.customer_name, row.date||new Date().toISOString().split('T')[0], row.total||0, row.total||0, row.status||'sent', row.currency||'USD']);
        nextNum++;
        imported++;
      }
    });
  } catch (e) {
    return res.json({ errorcode: 500, errormsg: 'Import error: ' + e.message });
  }
  req.db.run('UPDATE business_settings SET next_invoice_number = ? WHERE company_id = ?', [nextNum, req.companyId]);
  res.json({ imported });
});

router.get('/export/invoices', (req, res) => {
  const invoices = req.db.all("SELECT invoice_number, customer_name, date, due_date, total, amount_paid, amount_due, status FROM invoices WHERE " + (req.isSuperadmin ? "1=1" : "company_id = ?") + " ORDER BY date DESC", req.isSuperadmin ? [] : [req.companyId]);
  res.json(invoices);
});

router.get('/export/customers', (req, res) => {
  const customers = req.db.all("SELECT name, email, phone, billing_address, group_name FROM customers WHERE " + (req.isSuperadmin ? "1=1" : "company_id = ?") + " ORDER BY name", req.isSuperadmin ? [] : [req.companyId]);
  res.json(customers);
});

module.exports = router;
