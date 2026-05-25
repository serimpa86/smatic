const express = require('express');
const router = express.Router();
const { v4: uuidv4 } = require('uuid');
const { authenticateToken } = require('../middleware/auth');
const axios = require('axios');

router.use(authenticateToken);

router.get('/sessions', (req, res) => {
  try {
    const rows = req.db.all(
      `SELECT * FROM pos_sessions WHERE company_id = ? ORDER BY opened_at DESC`,
      [req.companyId]
    );
    res.json({ sessions: rows });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.post('/sessions/open', (req, res) => {
  const cid = req.companyId;
  if (!cid) return res.status(401).json({ error: 'No company' });
  const { opening_balance = 0, notes } = req.body;
  const id = uuidv4();
  req.db.run(
    `INSERT INTO pos_sessions (id,company_id,opening_balance,opened_by,notes) VALUES (?,?,?,?,?)`,
    [id, cid, opening_balance, req.userId || 'system', notes || '']
  );
  const row = req.db.get(`SELECT * FROM pos_sessions WHERE id=?`, [id]);
  res.json({ session: row });
});

router.post('/sessions/close', (req, res) => {
  const cid = req.companyId;
  const { session_id, closing_balance, notes } = req.body;
  if (!session_id) return res.status(400).json({ error: 'session_id required' });
  req.db.run(
    `UPDATE pos_sessions SET status='closed', closed_at=datetime('now'), closed_by=?, closing_balance=?, notes=? WHERE id=? AND company_id=?`,
    [req.userId || 'system', closing_balance || 0, notes || '', session_id, cid]
  );
  const row = req.db.get(`SELECT * FROM pos_sessions WHERE id=?`, [session_id]);
  res.json({ session: row });
});

router.get('/items', (req, res) => {
  try {
    const rows = req.db.all(
      `SELECT id, name, sale_price, stock_quantity, taxable FROM items WHERE company_id = ? AND active = 1 ORDER BY name`,
      [req.companyId]
    );
    res.json({ items: rows });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.post('/checkout', async (req, res) => {
  try {
    const cid = req.companyId;
    if (!cid) return res.status(401).json({ error: 'No company' });
    const { session_id, customer_id, customer_name, items, payments } = req.body;
    if (!items || !items.length) return res.status(400).json({ error: 'No items' });
    if (!payments || !payments.length) return res.status(400).json({ error: 'No payments' });

    const r = req.db.get(`SELECT * FROM settings WHERE company_id = ?`, [cid]);
    let nextNum = 1;
    if (r) {
      let cfg = {};
      try { cfg = JSON.parse(r.value || '{}'); } catch (e) {}
      nextNum = (cfg.lastInvoiceNum || 0) + 1;
    }

    const invoiceId = uuidv4();
    const invoiceNum = 'PV-' + String(nextNum).padStart(6, '0');
    const now = new Date().toISOString().replace('T', ' ').slice(0, 19);

    const totalAmount = items.reduce((sum, it) => sum + (it.price * it.qty), 0);

    req.db.run(
      `INSERT INTO invoices (id, company_id, invoice_number, customer_id, customer_name, invoice_date, due_date, total_amount, status, type, created_at)
       VALUES (?,?,?,?,?,?,?,?,'paid','pos',?)`,
      [invoiceId, cid, invoiceNum, customer_id || '', customer_name || '', now.slice(0,10), now.slice(0,10), totalAmount, now]
    );

    const wh = req.db.get(`SELECT id FROM warehouses WHERE company_id = ? ORDER BY name LIMIT 1`, [cid]);
    const whId = wh ? wh.id : '';

    let finalTotal = 0;

    for (const it of items) {
      const lineTotal = it.price * it.qty;
      finalTotal += lineTotal;
      req.db.run(
        `INSERT INTO invoice_items (id, invoice_id, company_id, item_id, description, quantity, unit_price, total_price) VALUES (?,?,?,?,?,?,?,?)`,
        [uuidv4(), invoiceId, cid, it.id || '', it.name, it.qty, it.price, lineTotal]
      );
      if (it.id) {
        req.db.run(`UPDATE items SET stock_quantity = stock_quantity - ? WHERE id = ? AND company_id = ?`, [it.qty, it.id, cid]);
        req.db.run(
          `INSERT INTO stock_movements (id, company_id, item_id, warehouse_id, type, quantity, reference, notes) VALUES (?,?,?,?,?,?,?,?)`,
          [uuidv4(), cid, it.id, whId, 'out', it.qty, invoiceNum, 'POS venta']
        );
      }
    }

    req.db.run(`UPDATE invoices SET total_amount = ? WHERE id = ?`, [finalTotal, invoiceId]);

    let cashTotal = 0, creditCardTotal = 0, debitCardTotal = 0, transferTotal = 0, virtualWalletTotal = 0, otherTotal = 0;
    let paymentLink = '', gatewayPrefId = '';

    for (const p of payments) {
      req.db.run(
        `INSERT INTO payments (id, company_id, invoice_id, payment_date, amount, method, notes) VALUES (?,?,?,?,?,?,?)`,
        [uuidv4(), cid, invoiceId, now, p.amount, p.method, p.notes || 'POS']
      );
      if (p.method === 'cash') cashTotal += p.amount;
      else if (p.method === 'credit_card') creditCardTotal += p.amount;
      else if (p.method === 'debit_card') debitCardTotal += p.amount;
      else if (p.method === 'transfer') transferTotal += p.amount;
      else if (p.method === 'virtual_wallet') {
        virtualWalletTotal += p.amount;
        if (p.gateway === 'mercadopago' && !paymentLink) {
          paymentLink = p.gateway_link || '';
        }
      }
      else otherTotal += p.amount;
    }

    if (session_id) {
      req.db.run(
        `UPDATE pos_sessions SET cash_sales = cash_sales + ?, credit_card_sales = credit_card_sales + ?,
         debit_card_sales = debit_card_sales + ?, transfer_sales = transfer_sales + ?,
         virtual_wallet_sales = virtual_wallet_sales + ?, other_sales = other_sales + ?
         WHERE id = ? AND company_id = ?`,
        [cashTotal, creditCardTotal, debitCardTotal, transferTotal, virtualWalletTotal, otherTotal, session_id, cid]
      );
    }

    if (r) {
      let cfg = {};
      try { cfg = JSON.parse(r.value || '{}'); } catch (e) {}
      cfg.lastInvoiceNum = nextNum;
      req.db.run(`UPDATE settings SET value = ? WHERE company_id = ?`, [JSON.stringify(cfg), cid]);
    }

    let mpInitPoint = '';
    if (virtualWalletTotal > 0 && !paymentLink) {
      try {
        const company = req.db.get('SELECT mp_access_token, mp_public_key, mp_sandbox, name FROM companies WHERE id = ?', [cid]);
        if (company && company.mp_access_token) {
          const apiUrl = company.mp_sandbox
            ? 'https://api.mercadopago.com/sandbox/checkout/preferences'
            : 'https://api.mercadopago.com/checkout/preferences';
          const domain = req.headers.origin || 'https://smatic.alwaysdata.net';
          const mpBody = {
            items: [{
              id: invoiceNum,
              title: 'POS Venta ' + invoiceNum,
              description: 'Venta POS ' + invoiceNum,
              quantity: 1,
              currency_id: 'ARS',
              unit_price: Number(virtualWalletTotal)
            }],
            payer: { name: customer_name || 'Cliente' },
            back_urls: {
              success: domain + '/pos.html?payment=ok&invoice=' + invoiceId,
              failure: domain + '/pos.html?payment=fail&invoice=' + invoiceId,
              pending: domain + '/pos.html?payment=pending&invoice=' + invoiceId
            },
            auto_return: 'approved',
            external_reference: invoiceId,
            statement_descriptor: (company.name || 'Smatic POS').substring(0, 15)
          };
          const mpRes = await axios.post(apiUrl, mpBody, {
            headers: { 'Authorization': 'Bearer ' + company.mp_access_token, 'Content-Type': 'application/json' }
          });
          const pref = mpRes.data;
          mpInitPoint = pref.init_point || pref.sandbox_init_point || '';
          req.db.run("UPDATE invoices SET payment_link=?, gateway_pref_id=?, updated_at=CURRENT_TIMESTAMP WHERE id=?",
            [mpInitPoint, pref.id, invoiceId]);
        }
      } catch (mpErr) {
        console.error('MP create-preference error:', mpErr.message);
      }
    }

    res.json({
      invoice_id: invoiceId,
      invoice_number: invoiceNum,
      total: finalTotal,
      mp_init_point: mpInitPoint || paymentLink
    });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

module.exports = router;
