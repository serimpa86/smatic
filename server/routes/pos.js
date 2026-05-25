const express = require('express');
const router = express.Router();
const { db, genId } = require('../database');

function getCompany(req) {
  return (req.user && req.user.company_id) || '';
}

// ── Sessions ──

router.get('/sessions', (req, res) => {
  try {
    const rows = db().prepare(
      `SELECT * FROM pos_sessions WHERE company_id = ? ORDER BY opened_at DESC`
    ).all(getCompany(req));
    res.json({ sessions: rows });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.post('/sessions/open', (req, res) => {
  const cid = getCompany(req);
  if (!cid) return res.status(401).json({ error: 'No company' });
  const { opening_balance = 0, notes } = req.body;
  const id = genId();
  const s = db().prepare(
    `INSERT INTO pos_sessions (id,company_id,opening_balance,opened_by,notes) VALUES (?,?,?,?,?)`
  );
  s.run(id, cid, opening_balance, req.user.id || 'system', notes || '');
  const row = db().prepare(`SELECT * FROM pos_sessions WHERE id=?`).get(id);
  res.json({ session: row });
});

router.post('/sessions/close', (req, res) => {
  const cid = getCompany(req);
  const { session_id, closing_balance, notes } = req.body;
  if (!session_id) return res.status(400).json({ error: 'session_id required' });
  const s = db().prepare(
    `UPDATE pos_sessions SET status='closed', closed_at=datetime('now'), closed_by=?, closing_balance=?, notes=? WHERE id=? AND company_id=?`
  );
  s.run(req.user.id || 'system', closing_balance || 0, notes || '', session_id, cid);
  const row = db().prepare(`SELECT * FROM pos_sessions WHERE id=?`).get(session_id);
  res.json({ session: row });
});

// ── Quick items (fast product list for POS UI) ──

router.get('/items', (req, res) => {
  try {
    const rows = db().prepare(
      `SELECT id, name, sale_price, stock_quantity, taxable FROM items WHERE company_id = ? AND active = 1 ORDER BY name`
    ).all(getCompany(req));
    res.json({ items: rows });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ── Checkout ──

router.post('/checkout', (req, res) => {
  try {
    const cid = getCompany(req);
    if (!cid) return res.status(401).json({ error: 'No company' });
    const { session_id, customer_id, customer_name, items, payments } = req.body;
    if (!items || !items.length) return res.status(400).json({ error: 'No items' });
    if (!payments || !payments.length) return res.status(400).json({ error: 'No payments' });

    const dbh = db();
    const r = dbh.prepare(`SELECT * FROM settings WHERE company_id = ?`).get(cid);
    let nextNum = 1;
    if (r) {
      let cfg = {};
      try { cfg = JSON.parse(r.value || '{}'); } catch (e) {}
      nextNum = (cfg.lastInvoiceNum || 0) + 1;
    }

    const invoiceId = genId();
    const invoiceNum = 'PV-' + String(nextNum).padStart(6, '0');
    const now = new Date().toISOString().replace('T', ' ').slice(0, 19);

    const totalAmount = items.reduce((sum, it) => sum + (it.price * it.qty), 0);

    // Create invoice
    dbh.prepare(
      `INSERT INTO invoices (id, company_id, invoice_number, customer_id, customer_name, invoice_date, due_date, total_amount, status, type, created_at)
       VALUES (?,?,?,?,?,?,?,?,'paid','pos',?)`
    ).run(invoiceId, cid, invoiceNum, customer_id || '', customer_name || '', now.slice(0,10), now.slice(0,10), totalAmount, now);

    // Create invoice items
    const insItem = dbh.prepare(
      `INSERT INTO invoice_items (id, invoice_id, company_id, item_id, description, quantity, unit_price, total_price) VALUES (?,?,?,?,?,?,?,?)`
    );
    const updStock = dbh.prepare(
      `UPDATE items SET stock_quantity = stock_quantity - ? WHERE id = ? AND company_id = ?`
    );
    const insMovement = dbh.prepare(
      `INSERT INTO stock_movements (id, company_id, item_id, warehouse_id, type, quantity, reference, notes)
       VALUES (?,?,?,?,?,?,?,?)`
    );

    // Determine default warehouse
    const wh = dbh.prepare(`SELECT id FROM warehouses WHERE company_id = ? ORDER BY name LIMIT 1`).get(cid);
    const whId = wh ? wh.id : '';

    const updateInvoiceTotal = dbh.prepare(
      `UPDATE invoices SET total_amount = ? WHERE id = ?`
    );
    let finalTotal = 0;

    for (const it of items) {
      const lineTotal = it.price * it.qty;
      finalTotal += lineTotal;
      insItem.run(genId(), invoiceId, cid, it.id || '', it.name, it.qty, it.price, lineTotal);
      if (it.id) {
        updStock.run(it.qty, it.id, cid);
        insMovement.run(genId(), cid, it.id, whId, 'out', it.qty, invoiceNum, 'POS venta');
      }
    }

    updateInvoiceTotal.run(finalTotal, invoiceId);

    // Record payments
    const insPay = dbh.prepare(
      `INSERT INTO payments (id, company_id, invoice_id, payment_date, amount, method, notes)
       VALUES (?,?,?,?,?,?,?)`
    );
    let cashTotal = 0, cardTotal = 0, transferTotal = 0, otherTotal = 0;
    for (const p of payments) {
      insPay.run(genId(), cid, invoiceId, now, p.amount, p.method, p.notes || 'POS');
      if (p.method === 'cash') cashTotal += p.amount;
      else if (p.method === 'card') cardTotal += p.amount;
      else if (p.method === 'transfer') transferTotal += p.amount;
      else otherTotal += p.amount;
    }

    // Update session totals if session_id provided
    if (session_id) {
      dbh.prepare(
        `UPDATE pos_sessions SET cash_sales = cash_sales + ?, card_sales = card_sales + ?,
         transfer_sales = transfer_sales + ?, other_sales = other_sales + ? WHERE id = ? AND company_id = ?`
      ).run(cashTotal, cardTotal, transferTotal, otherTotal, session_id, cid);
    }

    // Update next invoice number
    if (r) {
      let cfg = {};
      try { cfg = JSON.parse(r.value || '{}'); } catch (e) {}
      cfg.lastInvoiceNum = nextNum;
      dbh.prepare(`UPDATE settings SET value = ? WHERE company_id = ?`).run(JSON.stringify(cfg), cid);
    }

    res.json({ invoice_id: invoiceId, invoice_number: invoiceNum, total: finalTotal });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

module.exports = router;
