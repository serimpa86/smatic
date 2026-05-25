const express = require('express');
const axios = require('axios');
const { v4: uuidv4 } = require('uuid');
const { authenticateToken } = require('../middleware/auth');

const router = express.Router();
router.use(authenticateToken);

router.get('/config', (req, res) => {
  const company = req.db.get('SELECT mp_access_token, mp_public_key, mp_sandbox, mp_enabled FROM companies WHERE id = ?', [req.companyId]);
  if (!company) return res.json({ errorcode: 404, errormsg: 'Company not found' });
  res.json({
    mp_enabled: !!company.mp_enabled,
    mp_public_key: company.mp_public_key || '',
    mp_sandbox: !!company.mp_sandbox,
    mp_has_token: !!company.mp_access_token
  });
});

router.put('/config', (req, res) => {
  const { mp_access_token, mp_public_key, mp_sandbox, mp_enabled } = req.body;
  req.db.run(`UPDATE companies SET mp_access_token=?, mp_public_key=?, mp_sandbox=?, mp_enabled=?, updated_at=CURRENT_TIMESTAMP WHERE id=?`,
    [mp_access_token || '', mp_public_key || '', mp_sandbox ? 1 : 0, mp_enabled ? 1 : 0, req.companyId]);
  res.json({ success: true });
});

router.post('/mp/create-preference', async (req, res) => {
  const { invoice_id, success_url } = req.body;
  if (!invoice_id) return res.json({ errorcode: 400, errormsg: 'invoice_id required' });

  const company = req.db.get('SELECT mp_access_token, mp_public_key, mp_sandbox, name, email FROM companies WHERE id = ?', [req.companyId]);
  if (!company || !company.mp_access_token) return res.json({ errorcode: 400, errormsg: 'Mercado Pago not configured' });

  const invoice = req.db.get('SELECT * FROM invoices WHERE id = ? AND company_id = ?', [invoice_id, req.companyId]);
  if (!invoice) return res.json({ errorcode: 404, errormsg: 'Invoice not found' });
  if (invoice.amount_due <= 0) return res.json({ errorcode: 400, errormsg: 'Invoice already paid' });

  const apiUrl = company.mp_sandbox
    ? 'https://api.mercadopago.com/sandbox/checkout/preferences'
    : 'https://api.mercadopago.com/checkout/preferences';
  const domain = req.headers.origin || 'https://smatic.alwaysdata.net';

  try {
    const body = {
      items: [{
        id: invoice.invoice_number,
        title: 'Factura ' + invoice.invoice_number + ' - ' + (invoice.customer_name || ''),
        description: 'Pago factura ' + invoice.invoice_number,
        quantity: 1,
        currency_id: invoice.currency === 'ARS' ? 'ARS' : 'USD',
        unit_price: Number(invoice.amount_due)
      }],
      payer: { name: invoice.customer_name || 'Cliente', email: invoice.customer_email || '' },
      back_urls: {
        success: domain + '/api/payments/gateway/mp/success?invoice_id=' + invoice_id,
        failure: domain + '/api/payments/gateway/mp/failure?invoice_id=' + invoice_id,
        pending: domain + '/api/payments/gateway/mp/pending?invoice_id=' + invoice_id
      },
      auto_return: 'approved',
      notification_url: domain + '/api/payments/gateway/mp/webhook?invoice_id=' + invoice_id + '&company_id=' + req.companyId,
      external_reference: invoice_id,
      statement_descriptor: (company.name || 'Smatic').substring(0, 15)
    };

    const mpRes = await axios.post(apiUrl, body, {
      headers: { 'Authorization': 'Bearer ' + company.mp_access_token, 'Content-Type': 'application/json' }
    });

    const pref = mpRes.data;
    req.db.run("UPDATE invoices SET payment_link=?, gateway_pref_id=?, updated_at=CURRENT_TIMESTAMP WHERE id=?",
      [pref.init_point || pref.sandbox_init_point, pref.id, invoice_id]);

    res.json({ success: true, preference_id: pref.id, init_point: pref.init_point || pref.sandbox_init_point });
  } catch (e) {
    const errMsg = e.response && e.response.data ? JSON.stringify(e.response.data) : e.message;
    res.json({ errorcode: 500, errormsg: 'Mercado Pago error: ' + errMsg });
  }
});

router.all('/mp/webhook', async (req, res) => {
  const invoiceId = req.query.invoice_id;
  const companyId = req.query.company_id;
  if (!invoiceId || !companyId) return res.sendStatus(200);

  const company = req.db.get('SELECT mp_access_token FROM companies WHERE id = ?', [companyId]);
  if (!company || !company.mp_access_token) return res.sendStatus(200);

  let paymentId = null;
  if (req.body && req.body.action === 'payment.created') {
    paymentId = req.body.data && req.body.data.id;
  } else if (req.query['topic'] === 'payment' || req.query['topic'] === 'merchant_order') {
    paymentId = req.query.id;
  } else if (req.body && req.body.type === 'payment' && req.body.data) {
    paymentId = req.body.data.id;
  }

  if (paymentId) {
    try {
      const mpRes = await axios.get('https://api.mercadopago.com/v1/payments/' + paymentId, {
        headers: { 'Authorization': 'Bearer ' + company.mp_access_token }
      });
      const payment = mpRes.data;
      if (payment.status === 'approved') {
        const existing = req.db.get('SELECT id FROM payments WHERE gateway_payment_id = ?', [String(paymentId)]);
        if (!existing) {
          const payId = uuidv4();
          req.db.run("INSERT INTO payments (id, user_id, company_id, invoice_id, customer_id, customer_name, payment_number, date, method, reference, amount, gateway, gateway_payment_id) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)",
            [payId, '', companyId, invoiceId, '', '', 'MP-' + Date.now(), payment.date_created || new Date().toISOString(), 'credit_card', 'Mercado Pago - ' + paymentId, payment.transaction_amount || 0, 'mercadopago', String(paymentId)]);
          const totalPaid = (req.db.get('SELECT COALESCE(SUM(amount),0) as t FROM payments WHERE invoice_id=? AND company_id=?', [invoiceId, companyId])).t;
          const inv = req.db.get('SELECT total FROM invoices WHERE id=?', [invoiceId]);
          if (inv) {
            const newDue = Math.max(0, inv.total - totalPaid);
            const newStatus = newDue <= 0 ? 'paid' : 'partial';
            req.db.run("UPDATE invoices SET amount_paid=?, amount_due=?, status=?, updated_at=CURRENT_TIMESTAMP WHERE id=?", [totalPaid, newDue, newStatus, invoiceId]);
          }
        }
      }
    } catch (e) {}
  }
  res.sendStatus(200);
});

function processMpPayment(req, res, statusType) {
  const invoiceId = req.query.invoice_id;
  const mpPaymentId = req.query.payment_id;

  if (statusType === 'success' && invoiceId && mpPaymentId) {
    const company = req.db.get('SELECT mp_access_token FROM companies WHERE id = ?', [req.companyId]);
    if (company && company.mp_access_token) {
      axios.get('https://api.mercadopago.com/v1/payments/' + mpPaymentId, {
        headers: { 'Authorization': 'Bearer ' + company.mp_access_token }
      }).then(mpRes => {
        const payment = mpRes.data;
        if (payment.status === 'approved') {
          const existing = req.db.get('SELECT id FROM payments WHERE gateway_payment_id = ?', [String(mpPaymentId)]);
          if (!existing) {
            const payId = uuidv4();
            req.db.run("INSERT INTO payments (id, user_id, company_id, invoice_id, customer_id, customer_name, payment_number, date, method, reference, amount, gateway, gateway_payment_id) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)",
              [payId, '', req.companyId, invoiceId, '', '', 'MP-' + Date.now(), payment.date_created || new Date().toISOString(), 'credit_card', 'Mercado Pago - ' + mpPaymentId, payment.transaction_amount || 0, 'mercadopago', String(mpPaymentId)]);
            const totalPaid = (req.db.get('SELECT COALESCE(SUM(amount),0) as t FROM payments WHERE invoice_id=? AND company_id=?', [invoiceId, req.companyId])).t;
            const inv = req.db.get('SELECT total FROM invoices WHERE id=?', [invoiceId]);
            if (inv) {
              const newDue = Math.max(0, inv.total - totalPaid);
              const newStatus = newDue <= 0 ? 'paid' : 'partial';
              req.db.run("UPDATE invoices SET amount_paid=?, amount_due=?, status=?, updated_at=CURRENT_TIMESTAMP WHERE id=?", [totalPaid, newDue, newStatus, invoiceId]);
            }
          }
        }
      }).catch(() => {});
    }
  }
  res.redirect('/invoices.html?highlight=' + invoiceId + '&mp_' + statusType + '=1');
}

router.get('/mp/success', (req, res) => processMpPayment(req, res, 'success'));
router.get('/mp/failure', (req, res) => res.redirect('/invoices.html?highlight=' + req.query.invoice_id + '&mp_failure=1'));
router.get('/mp/pending', (req, res) => res.redirect('/invoices.html?highlight=' + req.query.invoice_id + '&mp_pending=1'));

module.exports = router;
