const express = require('express');
const { v4: uuidv4 } = require('uuid');
const { authenticateToken } = require('../middleware/auth');

const router = express.Router();
router.use(authenticateToken);

router.get('/', (req, res) => {
  const { status, search } = req.query;
  let where = 'WHERE 1=1';
  let params = [];
  if (!req.isSuperadmin) { where += ' AND company_id = ?'; params.push(req.companyId); }
  if (status) { where += ' AND status = ?'; params.push(status); }
  if (search) { where += ' AND (quote_number LIKE ? OR customer_name LIKE ?)'; params.push(`%${search}%`, `%${search}%`); }
  const quotes = req.db.all('SELECT * FROM quotes ' + where + ' ORDER BY created_at DESC', params);
  res.json({ quotes });
});

router.get('/:id', (req, res) => {
  const q = req.db.get('SELECT * FROM quotes WHERE id = ?' + (req.isSuperadmin ? '' : ' AND company_id = ?'), req.isSuperadmin ? [req.params.id] : [req.params.id, req.companyId]);
  if (!q) return res.json({ errorcode: 404, errormsg: 'Quote not found' });
  q.items = req.db.all('SELECT * FROM quote_items WHERE quote_id = ? ORDER BY sort_order', [q.id]);
  res.json(q);
});

router.post('/', (req, res) => {
  const { customer_id, customer_name, customer_email, customer_address, customer_shipping, date, expiry_date, payment_terms, po_number, salesperson, currency, currency_symbol, subtotal, discount_amount, discount_type, shipping_cost, tax_total, total, notes, private_notes, footer, items } = req.body;
  const settings = req.db.get('SELECT quote_prefix, next_quote_number FROM business_settings WHERE company_id = ?', [req.companyId]);
  const qNum = settings.quote_prefix + settings.next_quote_number;
  const id = uuidv4();
  req.db.run(`INSERT INTO quotes (id, user_id, company_id, quote_number, customer_id, customer_name, customer_email, customer_address, customer_shipping, date, expiry_date, payment_terms, po_number, salesperson, currency, currency_symbol, subtotal, discount_amount, discount_type, shipping_cost, tax_total, total, notes, private_notes, footer) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    [id, req.userId, req.companyId, qNum, customer_id||null, customer_name||'', customer_email||'', customer_address||'', customer_shipping||'', date||new Date().toISOString().split('T')[0], expiry_date||'', payment_terms||'30', po_number||'', salesperson||'', currency||'USD', currency_symbol||'$', subtotal||0, discount_amount||0, discount_type||'percentage', shipping_cost||0, tax_total||0, total||0, notes||'', private_notes||'', footer||'']);
  if (items && items.length) {
    items.forEach((item, i) => {
      req.db.run('INSERT INTO quote_items (id, quote_id, item_id, item_code, description, quantity, unit_price, discount, discount_type, tax_rate, tax_name, total, sort_order) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)',
        [uuidv4(), id, item.item_id||null, item.item_code||'', item.description||'', item.quantity||1, item.unit_price||0, item.discount||0, item.discount_type||'percentage', item.tax_rate||0, item.tax_name||'', item.total||0, i]);
    });
  }
  req.db.run('UPDATE business_settings SET next_quote_number = next_quote_number + 1 WHERE company_id = ?', [req.companyId]);
  res.json({ id, quote_number: qNum });
});

router.put('/:id', (req, res) => {
  const existing = req.db.get('SELECT id FROM quotes WHERE id = ?' + (req.isSuperadmin ? '' : ' AND company_id = ?'), req.isSuperadmin ? [req.params.id] : [req.params.id, req.companyId]);
  if (!existing) return res.json({ errorcode: 404, errormsg: 'Quote not found' });
  const { customer_id, customer_name, customer_email, customer_address, customer_shipping, date, expiry_date, payment_terms, po_number, salesperson, subtotal, discount_amount, discount_type, shipping_cost, tax_total, total, status, notes, items } = req.body;
  req.db.run("UPDATE quotes SET customer_id=?, customer_name=?, customer_email=?, customer_address=?, customer_shipping=?, date=?, expiry_date=?, payment_terms=?, po_number=?, salesperson=?, subtotal=?, discount_amount=?, discount_type=?, shipping_cost=?, tax_total=?, total=?, status=?, notes=?, updated_at=datetime('now') WHERE id=?" + (req.isSuperadmin ? '' : ' AND company_id=?'),
    req.isSuperadmin
      ? [customer_id||null, customer_name||'', customer_email||'', customer_address||'', customer_shipping||'', date, expiry_date||'', payment_terms||'30', po_number||'', salesperson||'', subtotal||0, discount_amount||0, discount_type||'percentage', shipping_cost||0, tax_total||0, total||0, status||'draft', notes||'', req.params.id]
      : [customer_id||null, customer_name||'', customer_email||'', customer_address||'', customer_shipping||'', date, expiry_date||'', payment_terms||'30', po_number||'', salesperson||'', subtotal||0, discount_amount||0, discount_type||'percentage', shipping_cost||0, tax_total||0, total||0, status||'draft', notes||'', req.params.id, req.companyId]);
  req.db.run('DELETE FROM quote_items WHERE quote_id = ?', [req.params.id]);
  if (items && items.length) {
    items.forEach((item, i) => {
      req.db.run('INSERT INTO quote_items (id, quote_id, item_id, item_code, description, quantity, unit_price, discount, discount_type, tax_rate, tax_name, total, sort_order) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)',
        [uuidv4(), req.params.id, item.item_id||null, item.item_code||'', item.description||'', item.quantity||1, item.unit_price||0, item.discount||0, item.discount_type||'percentage', item.tax_rate||0, item.tax_name||'', item.total||0, i]);
    });
  }
  res.json({ success: true });
});

router.post('/:id/convert', (req, res) => {
  const quote = req.db.get('SELECT * FROM quotes WHERE id = ?' + (req.isSuperadmin ? '' : ' AND company_id = ?'), req.isSuperadmin ? [req.params.id] : [req.params.id, req.companyId]);
  if (!quote) return res.json({ errorcode: 404, errormsg: 'Quote not found' });
  quote.items = req.db.all('SELECT * FROM quote_items WHERE quote_id = ? ORDER BY sort_order', [quote.id]);
  const settings = req.db.get('SELECT invoice_prefix, next_invoice_number FROM business_settings WHERE company_id = ?', [req.companyId]);
  const invNum = settings.invoice_prefix + settings.next_invoice_number;
  const invId = uuidv4();
  req.db.run(`INSERT INTO invoices (id, user_id, company_id, invoice_number, customer_id, customer_name, customer_email, customer_address, customer_shipping, date, due_date, payment_terms, po_number, salesperson, currency, currency_symbol, subtotal, discount_amount, discount_type, shipping_cost, tax_total, total, amount_due, notes, footer, status) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    [invId, req.userId, req.companyId, invNum, quote.customer_id, quote.customer_name, quote.customer_email, quote.customer_address, quote.customer_shipping, new Date().toISOString().split('T')[0], '', quote.payment_terms, quote.po_number, quote.salesperson, quote.currency, quote.currency_symbol, quote.subtotal, quote.discount_amount, quote.discount_type, quote.shipping_cost, quote.tax_total, quote.total, quote.total, quote.notes, quote.footer, 'draft']);
  if (quote.items && quote.items.length) {
    quote.items.forEach((item, i) => {
      req.db.run('INSERT INTO invoice_items (id, invoice_id, item_id, item_code, description, quantity, unit_price, discount, discount_type, tax_rate, tax_name, total, sort_order) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)',
        [uuidv4(), invId, item.item_id, item.item_code, item.description, item.quantity, item.unit_price, item.discount, item.discount_type, item.tax_rate, item.tax_name, item.total, i]);
    });
  }
  req.db.run('UPDATE business_settings SET next_invoice_number = next_invoice_number + 1 WHERE company_id = ?', [req.companyId]);
  req.db.run('UPDATE quotes SET converted_to_invoice_id = ?, status = ? WHERE id = ?', [invId, 'converted', quote.id]);
  res.json({ invoice_id: invId, invoice_number: invNum });
});

router.delete('/:id', (req, res) => {
  req.db.run('DELETE FROM quotes WHERE id = ?' + (req.isSuperadmin ? '' : ' AND company_id = ?'), req.isSuperadmin ? [req.params.id] : [req.params.id, req.companyId]);
  res.json({ success: true });
});

module.exports = router;
