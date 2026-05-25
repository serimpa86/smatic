const express = require('express');
const { v4: uuidv4 } = require('uuid');
const { authenticateToken } = require('../middleware/auth');

const router = express.Router();
router.use(authenticateToken);
router.use(authenticateToken);

router.get('/status', (req, res) => {
  const company = req.db.get('SELECT id, name, setup_completed, modules_active FROM companies WHERE id = ?', [req.companyId]);
  if (!company) return res.json({ errorcode: 404, errormsg: 'Company not found' });
  const modules = company.modules_active ? JSON.parse(company.modules_active) : [];
  res.json({
    companyId: company.id,
    companyName: company.name,
    setupCompleted: !!company.setup_completed,
    modulesActive: modules,
    currentStep: getCurrentStep(company)
  });
});

function getCurrentStep(company) {
  if (!company) return 0;
  const c = company;
  if (!c.name || c.name === 'Mi Empresa') return 1;
  if (!c.cuit) return 2;
  if (!c.business_name && !c.address) return 3;
  if (c.setup_completed) return -1;
  return 4;
}

router.post('/step1', (req, res) => {
  const { name, address, phone, email, website } = req.body;
  req.db.run("UPDATE companies SET name=?, business_name=?, address=?, phone=?, email=?, website=?, updated_at=CURRENT_TIMESTAMP WHERE id=?",
    [name || 'Mi Empresa', name || '', address || '', phone || '', email || '', website || '', req.companyId]);
  const bs = req.db.get('SELECT id FROM business_settings WHERE company_id = ?', [req.companyId]);
  if (bs) req.db.run('UPDATE business_settings SET business_name=?, business_address=?, business_phone=?, business_email=? WHERE company_id=?',
    [name || '', address || '', phone || '', email || '', req.companyId]);
  res.json({ success: true, nextStep: 2 });
});

router.post('/step2', (req, res) => {
  const { cuit, taxCategory, industry } = req.body;
  req.db.run("UPDATE companies SET cuit=?, tax_category=?, industry=?, updated_at=CURRENT_TIMESTAMP WHERE id=?",
    [cuit || '', taxCategory || 'responsable_inscripto', industry || '', req.companyId]);
  res.json({ success: true, nextStep: 3 });
});

router.post('/step3', (req, res) => {
  const { env, pointOfSale, currency, currencySymbol, timezone } = req.body;
  req.db.run("UPDATE companies SET afip_env=?, afip_point_of_sale=?, currency=?, currency_symbol=?, timezone=?, updated_at=CURRENT_TIMESTAMP WHERE id=?",
    [env || 'testing', pointOfSale || '0001', currency || 'ARS', currencySymbol || '$', timezone || 'America/Argentina/Buenos_Aires', req.companyId]);
  res.json({ success: true, nextStep: 4 });
});

router.post('/step4', (req, res) => {
  const { modules } = req.body;
  const activeModules = Array.isArray(modules) ? modules : [];
  req.db.run("UPDATE companies SET modules_active=?, updated_at=CURRENT_TIMESTAMP WHERE id=?",
    [JSON.stringify(activeModules), req.companyId]);
  res.json({ success: true, nextStep: 5 });
});

router.post('/complete', (req, res) => {
  req.db.run("UPDATE companies SET setup_completed=1, updated_at=CURRENT_TIMESTAMP WHERE id=?",
    [req.companyId]);
  const defaultTaxes = req.db.all('SELECT COUNT(*) as c FROM taxes WHERE company_id = ?', [req.companyId]);
  if (defaultTaxes[0].c === 0) {
    req.db.run('INSERT INTO taxes (id, user_id, company_id, name, rate, is_default) VALUES (?,?,?,?,?,?)',
      [uuidv4(), req.userId, req.companyId, 'IVA 21%', 21, 1]);
    req.db.run('INSERT INTO taxes (id, user_id, company_id, name, rate) VALUES (?,?,?,?,?)',
      [uuidv4(), req.userId, req.companyId, 'IVA 10%', 10]);
  }
  const defaultTemplate = req.db.get('SELECT id FROM invoice_templates WHERE company_id = ?', [req.companyId]);
  if (!defaultTemplate) {
    req.db.run('INSERT INTO invoice_templates (id, user_id, company_id, name, is_default) VALUES (?,?,?,?,?)',
      [uuidv4(), req.userId, req.companyId, 'Default', 1]);
  }
  req.db.seedAccounts(req.companyId);
  res.json({ success: true });
});

router.post('/upload-cert', (req, res) => {
  const { cert, key } = req.body;
  if (!cert || !key) return res.json({ errorcode: 400, errormsg: 'Certificate and key are required' });
  req.db.run("UPDATE companies SET afip_cert=?, afip_key=?, updated_at=CURRENT_TIMESTAMP WHERE id=?",
    [cert, key, req.companyId]);
  res.json({ success: true });
});

router.post('/save-printer', (req, res) => {
  const { type, connection, port } = req.body;
  req.db.run("UPDATE companies SET fiscal_printer_type=?, printer_connection=?, printer_port=?, updated_at=CURRENT_TIMESTAMP WHERE id=?",
    [type || 'none', connection || '', port || '', req.companyId]);
  res.json({ success: true });
});

module.exports = router;
