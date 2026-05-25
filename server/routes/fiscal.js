const express = require('express');
const { authenticateToken } = require('../middleware/auth');
const { FiscalPrinter } = require('../lib/fiscal-printer');

const router = express.Router();
router.use(authenticateToken);

function getPrinterConfig(req) {
  const company = req.db.get('SELECT * FROM companies WHERE id = ?', [req.companyId]);
  if (!company) return null;
  if (!company.fiscal_printer_type || company.fiscal_printer_type === 'none') return null;
  return {
    type: company.fiscal_printer_type,
    host: company.printer_connection || '127.0.0.1',
    port: company.printer_port || '9100'
  };
}

router.get('/status', (req, res) => {
  const cfg = getPrinterConfig(req);
  if (!cfg) return res.json({ configured: false });
  res.json({
    configured: true,
    type: cfg.type,
    host: cfg.host,
    port: cfg.port
  });
});

router.post('/test', async (req, res) => {
  const cfg = getPrinterConfig(req);
  if (!cfg) return res.json({ errorcode: 400, errormsg: 'Fiscal printer not configured' });
  try {
    const printer = new FiscalPrinter(cfg);
    const result = await printer.testConnection();
    res.json(result);
  } catch (e) {
    res.json({ success: false, error: e.message });
  }
});

router.post('/print', async (req, res) => {
  const cfg = getPrinterConfig(req);
  if (!cfg) return res.json({ errorcode: 400, errormsg: 'Fiscal printer not configured' });
  const { invoiceId } = req.body;
  if (!invoiceId) return res.json({ errorcode: 400, errormsg: 'Invoice ID required' });
  const invoice = req.db.get('SELECT * FROM invoices WHERE id = ? AND company_id = ?', [invoiceId, req.companyId]);
  if (!invoice) return res.json({ errorcode: 404, errormsg: 'Invoice not found' });
  const company = req.db.get('SELECT * FROM companies WHERE id = ?', [req.companyId]);
  const invoiceItems = req.db.all('SELECT * FROM invoice_items WHERE invoice_id = ? ORDER BY sort_order', [invoiceId]);

  try {
    const printer = new FiscalPrinter(cfg);
    await printer.printInvoice({
      business_name: company.business_name || company.name,
      cuit: company.cuit,
      address: company.address,
      invoice_number: invoice.invoice_number,
      date: invoice.date,
      customer_name: invoice.customer_name,
      customer_doc: req.db.get('SELECT cuit FROM customers WHERE id = ?', [invoice.customer_id])?.cuit,
      subtotal: invoice.subtotal,
      tax_total: invoice.tax_total,
      total: invoice.total,
      cae: invoice.cae,
      cae_vencimiento: invoice.cae_vencimiento,
      items: invoiceItems
    });
    res.json({ success: true });
  } catch (e) {
    res.json({ success: false, error: e.message });
  }
});

router.post('/daily-close', async (req, res) => {
  const cfg = getPrinterConfig(req);
  if (!cfg) return res.json({ errorcode: 400, errormsg: 'Fiscal printer not configured' });
  const type = req.body.type || 'Z';
  try {
    const printer = new FiscalPrinter(cfg);
    const result = await printer.dailyClose(type);
    res.json({ success: true, result: result?.toString() });
  } catch (e) {
    res.json({ success: false, error: e.message });
  }
});

router.post('/open-drawer', async (req, res) => {
  const cfg = getPrinterConfig(req);
  if (!cfg) return res.json({ errorcode: 400, errormsg: 'Fiscal printer not configured' });
  try {
    const printer = new FiscalPrinter(cfg);
    await printer.openDrawer();
    res.json({ success: true });
  } catch (e) {
    res.json({ success: false, error: e.message });
  }
});

module.exports = router;
