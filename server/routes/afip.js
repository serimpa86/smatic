const express = require('express');
const { authenticateToken } = require('../middleware/auth');
const { AFIPClient } = require('../lib/afip');

const router = express.Router();
router.use(authenticateToken);

function getCompany(req) {
  return req.db.get('SELECT * FROM companies WHERE id = ?', [req.companyId]);
}

router.get('/status', async (req, res) => {
  const company = getCompany(req);
  if (!company) return res.json({ errorcode: 404, errormsg: 'Company not found' });
  res.json({
    configured: !!(company.afip_cert && company.afip_key),
    env: company.afip_env || 'testing',
    pointOfSale: company.afip_point_of_sale || '0001',
    cuit: company.cuit || ''
  });
});

router.post('/test-connection', async (req, res) => {
  const company = getCompany(req);
  if (!company) return res.json({ errorcode: 404, errormsg: 'Company not found' });
  if (!company.cuit || !company.afip_cert || !company.afip_key)
    return res.json({ errorcode: 400, errormsg: 'AFIP not configured. Set CUIT, certificate and key first.' });
  try {
    const client = new AFIPClient({
      env: company.afip_env || 'testing',
      cuit: company.cuit,
      cert: company.afip_cert,
      key: company.afip_key,
      pointOfSale: company.afip_point_of_sale || '0001'
    });
    const result = await client.testConnection();
    res.json(result);
  } catch (e) {
    res.json({ success: false, error: e.message });
  }
});

router.post('/invoice', async (req, res) => {
  const company = getCompany(req);
  if (!company) return res.json({ errorcode: 404, errormsg: 'Company not found' });
  const { invoiceId } = req.body;
  if (!invoiceId) return res.json({ errorcode: 400, errormsg: 'Invoice ID required' });
  const invoice = req.db.get('SELECT * FROM invoices WHERE id = ? AND company_id = ?', [invoiceId, req.companyId]);
  if (!invoice) return res.json({ errorcode: 404, errormsg: 'Invoice not found' });
  if (invoice.cae) return res.json({ errorcode: 400, errormsg: 'Invoice already has CAE: ' + invoice.cae });

  try {
    const client = new AFIPClient({
      env: company.afip_env || 'testing',
      cuit: company.cuit,
      cert: company.afip_cert,
      key: company.afip_key,
      pointOfSale: company.afip_point_of_sale || '0001'
    });

    const customer = req.db.get('SELECT * FROM customers WHERE id = ?', [invoice.customer_id]);
    const invoiceItems = req.db.all('SELECT * FROM invoice_items WHERE invoice_id = ? ORDER BY sort_order', [invoiceId]);
    const taxes = req.db.all('SELECT * FROM taxes WHERE company_id = ?', [req.companyId]);

    const result = await client.requestInvoice({
      invoiceType: 1,
      date: invoice.date,
      currency: invoice.currency || 'ARS',
      buyerCategory: customer?.tax_category || 'consumidor_final',
      buyerDoc: customer?.cuit || customer?.dni || '00000000000',
      items: invoiceItems.map(item => ({
        total: item.total || 0,
        subtotal: (item.unit_price || 0) * (item.quantity || 1),
        taxes: 0,
        iva: (item.total || 0) * (item.tax_rate || 0) / 100
      })),
      taxes: taxes.filter(t => t.rate > 0).map(t => ({
        rate: t.rate,
        base: invoice.subtotal || 0,
        amount: invoice.tax_total || 0
      }))
    });

    req.db.run("UPDATE invoices SET cae=?, cae_vencimiento=?, afip_resultado=?, updated_at=datetime('now'), status=? WHERE id=?",
      [result.cae, result.vencimiento, result.resultado, result.cae ? 'sent' : 'draft', invoiceId]);
    res.json({ success: true, ...result });
  } catch (e) {
    res.json({ success: false, error: e.message });
  }
});

router.post('/consult', async (req, res) => {
  const company = getCompany(req);
  if (!company) return res.json({ errorcode: 404, errormsg: 'Company not found' });
  const { invoiceId } = req.body;
  if (!invoiceId) return res.json({ errorcode: 400, errormsg: 'Invoice ID required' });
  const invoice = req.db.get('SELECT * FROM invoices WHERE id = ? AND company_id = ?', [invoiceId, req.companyId]);
  if (!invoice) return res.json({ errorcode: 404, errormsg: 'Invoice not found' });
  if (!invoice.cae) return res.json({ errorcode: 400, errormsg: 'Invoice has no CAE' });

  try {
    const client = new AFIPClient({
      env: company.afip_env || 'testing',
      cuit: company.cuit,
      cert: company.afip_cert,
      key: company.afip_key,
      pointOfSale: company.afip_point_of_sale || '0001'
    });
    const result = await client.consultInvoice(1, parseInt(company.afip_point_of_sale), invoice.invoice_number);
    res.json({ success: true, ...result });
  } catch (e) {
    res.json({ success: false, error: e.message });
  }
});

module.exports = router;
