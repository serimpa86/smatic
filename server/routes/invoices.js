const express = require('express');
const { v4: uuidv4 } = require('uuid');
const { authenticateToken } = require('../middleware/auth');

const router = express.Router();
router.use(authenticateToken);

router.get('/', (req, res) => {
  const { status, search, start, end, page = 1, limit = 50 } = req.query;
  let where = 'WHERE 1=1';
  let params = [];
  if (!req.isSuperadmin) { where += ' AND i.company_id = ?'; params.push(req.companyId); }
  if (status) { where += ' AND i.status = ?'; params.push(status); }
  if (search) { where += ' AND (i.invoice_number LIKE ? OR i.customer_name LIKE ?)'; params.push(`%${search}%`, `%${search}%`); }
  if (start) { where += ' AND i.date >= ?'; params.push(start); }
  if (end) { where += ' AND i.date <= ?'; params.push(end); }
  const offset = (parseInt(page) - 1) * parseInt(limit);
  const invoices = req.db.all('SELECT i.*, u.email as user_email FROM invoices i JOIN users u ON i.user_id = u.id ' + where + ' ORDER BY i.created_at DESC LIMIT ? OFFSET ?', params.concat([parseInt(limit), offset]));
  const total = req.db.get('SELECT COUNT(*) as c FROM invoices i ' + where, params).c;
  res.json({ invoices, total });
});

router.get('/:id', (req, res) => {
  const inv = req.db.get('SELECT * FROM invoices WHERE id = ?' + (req.isSuperadmin ? '' : ' AND company_id = ?'), req.isSuperadmin ? [req.params.id] : [req.params.id, req.companyId]);
  if (!inv) return res.json({ errorcode: 404, errormsg: 'Invoice not found' });
  inv.items = req.db.all('SELECT * FROM invoice_items WHERE invoice_id = ? ORDER BY sort_order', [inv.id]);
  res.json(inv);
});

router.post('/', (req, res) => {
  const { customer_id, customer_name, customer_email, customer_address, customer_shipping, date, due_date, payment_terms, po_number, salesperson, currency, currency_symbol, subtotal, discount_amount, discount_type, shipping_cost, shipping_tax, tax_total, total, notes, private_notes, footer, is_recurring, recurring_frequency, recurring_next_date, recurring_end_date, recurring_occurrences, items } = req.body;
  const settings = req.db.get('SELECT invoice_prefix, next_invoice_number FROM business_settings WHERE company_id = ?', [req.companyId]);
  const invNum = settings.invoice_prefix + settings.next_invoice_number;
  const id = uuidv4();
  req.db.run(`INSERT INTO invoices (id, user_id, company_id, invoice_number, customer_id, customer_name, customer_email, customer_address, customer_shipping, date, due_date, payment_terms, po_number, salesperson, currency, currency_symbol, subtotal, discount_amount, discount_type, shipping_cost, shipping_tax, tax_total, total, amount_due, notes, private_notes, footer, is_recurring, recurring_frequency, recurring_next_date, recurring_end_date, recurring_occurrences, status) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    [id, req.userId, req.companyId, invNum, customer_id||null, customer_name||'', customer_email||'', customer_address||'', customer_shipping||'', date||new Date().toISOString().split('T')[0], due_date||'', payment_terms||'30', po_number||'', salesperson||'', currency||'USD', currency_symbol||'$', subtotal||0, discount_amount||0, discount_type||'percentage', shipping_cost||0, shipping_tax||0, tax_total||0, total||0, total||0, notes||'', private_notes||'', footer||'', is_recurring||0, recurring_frequency||'', recurring_next_date||'', recurring_end_date||'', recurring_occurrences||0, 'draft']);
  if (items && items.length) {
    items.forEach((item, i) => {
      req.db.run('INSERT INTO invoice_items (id, invoice_id, item_id, item_code, description, quantity, unit_price, discount, discount_type, tax_rate, tax_name, total, sort_order) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)',
        [uuidv4(), id, item.item_id||null, item.item_code||'', item.description||'', item.quantity||1, item.unit_price||0, item.discount||0, item.discount_type||'percentage', item.tax_rate||0, item.tax_name||'', item.total||0, i]);
    });
  }
  req.db.run('UPDATE business_settings SET next_invoice_number = next_invoice_number + 1 WHERE company_id = ?', [req.companyId]);
  res.json({ id, invoice_number: invNum });
});

router.put('/:id', (req, res) => {
  const existing = req.db.get('SELECT id FROM invoices WHERE id = ?' + (req.isSuperadmin ? '' : ' AND company_id = ?'), req.isSuperadmin ? [req.params.id] : [req.params.id, req.companyId]);
  if (!existing) return res.json({ errorcode: 404, errormsg: 'Invoice not found' });
  const { customer_id, customer_name, customer_email, customer_address, customer_shipping, date, due_date, payment_terms, po_number, salesperson, currency, currency_symbol, subtotal, discount_amount, discount_type, shipping_cost, shipping_tax, tax_total, total, amount_paid, status, notes, private_notes, footer, items } = req.body;
  const amount_due = (total||0) - (amount_paid||0);
  req.db.run("UPDATE invoices SET customer_id=?, customer_name=?, customer_email=?, customer_address=?, customer_shipping=?, date=?, due_date=?, payment_terms=?, po_number=?, salesperson=?, currency=?, currency_symbol=?, subtotal=?, discount_amount=?, discount_type=?, shipping_cost=?, shipping_tax=?, tax_total=?, total=?, amount_paid=?, amount_due=?, status=?, notes=?, private_notes=?, footer=?, updated_at=datetime('now') WHERE id=?" + (req.isSuperadmin ? '' : ' AND company_id=?'),
    (req.isSuperadmin
      ? [customer_id||null, customer_name||'', customer_email||'', customer_address||'', customer_shipping||'', date, due_date||'', payment_terms||'30', po_number||'', salesperson||'', currency||'USD', currency_symbol||'$', subtotal||0, discount_amount||0, discount_type||'percentage', shipping_cost||0, shipping_tax||0, tax_total||0, total||0, amount_paid||0, amount_due, status||'draft', notes||'', private_notes||'', footer||'', req.params.id]
      : [customer_id||null, customer_name||'', customer_email||'', customer_address||'', customer_shipping||'', date, due_date||'', payment_terms||'30', po_number||'', salesperson||'', currency||'USD', currency_symbol||'$', subtotal||0, discount_amount||0, discount_type||'percentage', shipping_cost||0, shipping_tax||0, tax_total||0, total||0, amount_paid||0, amount_due, status||'draft', notes||'', private_notes||'', footer||'', req.params.id, req.companyId]));
  req.db.run('DELETE FROM invoice_items WHERE invoice_id = ?', [req.params.id]);
  if (items && items.length) {
    items.forEach((item, i) => {
      req.db.run('INSERT INTO invoice_items (id, invoice_id, item_id, item_code, description, quantity, unit_price, discount, discount_type, tax_rate, tax_name, total, sort_order) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)',
        [uuidv4(), req.params.id, item.item_id||null, item.item_code||'', item.description||'', item.quantity||1, item.unit_price||0, item.discount||0, item.discount_type||'percentage', item.tax_rate||0, item.tax_name||'', item.total||0, i]);
    });
  }
  res.json({ success: true });
});

router.put('/:id/status', (req, res) => {
  const { status } = req.body;
  req.db.run("UPDATE invoices SET status=?, updated_at=datetime('now') WHERE id=?" + (req.isSuperadmin ? '' : ' AND company_id=?'), req.isSuperadmin ? [status, req.params.id] : [status, req.params.id, req.companyId]);
  res.json({ success: true });
});

router.delete('/:id', (req, res) => {
  req.db.run('DELETE FROM invoices WHERE id = ?' + (req.isSuperadmin ? '' : ' AND company_id = ?'), req.isSuperadmin ? [req.params.id] : [req.params.id, req.companyId]);
  res.json({ success: true });
});

router.get('/:id/pdf', (req, res) => {
  const inv = req.db.get('SELECT * FROM invoices WHERE id = ?' + (req.isSuperadmin ? '' : ' AND company_id = ?'), req.isSuperadmin ? [req.params.id] : [req.params.id, req.companyId]);
  if (!inv) return res.status(404).json({ errorcode: 404, errormsg: 'Invoice not found' });
  inv.items = req.db.all('SELECT * FROM invoice_items WHERE invoice_id = ? ORDER BY sort_order', [inv.id]);
  const settings = req.db.get('SELECT * FROM business_settings WHERE company_id = ?', [req.companyId]);
  const PDFDocument = require('pdfkit');
  const doc = new PDFDocument({ size: 'A4', margin: 50 });
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `attachment; filename="${inv.invoice_number}.pdf"`);
  doc.pipe(res);
  const { business_name, business_address, business_phone, business_email } = settings;
  doc.fontSize(20).text(business_name || 'Mi Empresa', 50, 50);
  doc.fontSize(10).text(business_address || '', 50, 75);
  if (business_phone) doc.text('Tel: ' + business_phone);
  if (business_email) doc.text('Email: ' + business_email);
  doc.moveDown(2);
  doc.fontSize(16).text('FACTURA', { align: 'right' });
  doc.fontSize(10).text('N°: ' + inv.invoice_number, { align: 'right' });
  doc.text('Fecha: ' + inv.date, { align: 'right' });
  doc.text('Vencimiento: ' + inv.due_date, { align: 'right' });
  doc.moveDown();
  doc.fontSize(12).text('Cliente: ' + inv.customer_name);
  doc.fontSize(10).text(inv.customer_address || '');
  doc.moveDown(2);
  const tableTop = doc.y;
  doc.fontSize(10).font('Helvetica-Bold');
  const col1 = 50, col2 = 200, col3 = 350, col4 = 420, col5 = 490;
  doc.text('Descripción', col1, tableTop);
  doc.text('Cant', col2, tableTop);
  doc.text('Precio', col3, tableTop);
  doc.text('Desc %', col4, tableTop);
  doc.text('Total', col5, tableTop);
  doc.moveDown(0.5);
  doc.font('Helvetica');
  let y = doc.y;
  (inv.items || []).forEach(item => {
    doc.text(item.description || '', col1, y, { width: 140 });
    doc.text(String(item.quantity || 0), col2, y);
    doc.text('$' + (item.unit_price || 0).toFixed(2), col3, y);
    doc.text(String(item.discount || 0) + '%', col4, y);
    doc.text('$' + (item.total || 0).toFixed(2), col5, y);
    y += 20;
  });
  doc.moveDown();
  y = doc.y + 10;
  doc.text('Subtotal: $' + (inv.subtotal || 0).toFixed(2), { align: 'right' });
  doc.text('Impuestos: $' + (inv.tax_total || 0).toFixed(2), { align: 'right' });
  doc.font('Helvetica-Bold').fontSize(12);
  doc.text('Total: $' + (inv.total || 0).toFixed(2), { align: 'right' });
  if (inv.notes) { doc.font('Helvetica').fontSize(10).moveDown(); doc.text('Notas: ' + inv.notes); }
  doc.end();
});

module.exports = router;
