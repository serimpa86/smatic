const express = require('express');
const router = express.Router();
const { db } = require('../database');

function cid(req) { return (req.user && req.user.company_id) || ''; }

router.get('/stats', (req, res) => {
  try {
    const co = cid(req);
    if (!co) return res.status(401).json({ error: 'No company' });

    // Total invoiced (paid invoices)
    const paidRow = db().prepare(
      `SELECT COALESCE(SUM(total_amount),0) as total FROM invoices WHERE company_id=? AND status='paid'`
    ).get(co);

    // Total collected (sum of all payments)
    const payRow = db().prepare(
      `SELECT COALESCE(SUM(amount),0) as total FROM payments WHERE company_id=?`
    ).get(co);

    // Pending (unpaid invoices - draft + sent/overdue)
    const pendingRow = db().prepare(
      `SELECT COALESCE(SUM(total_amount),0) as total, COUNT(*) as count FROM invoices WHERE company_id=? AND status IN ('draft','sent','overdue')`
    ).get(co);

    // Overdue
    const overdueRow = db().prepare(
      `SELECT COUNT(*) as count FROM invoices WHERE company_id=? AND status='overdue'`
    ).get(co);

    // Customers count
    const custRow = db().prepare(
      `SELECT COUNT(*) as count FROM customers WHERE company_id=?`
    ).get(co);

    // Low stock items
    const lowStock = db().prepare(
      `SELECT COUNT(*) as count FROM items WHERE company_id=? AND active=1 AND stock_quantity <= stock_minimum`
    ).get(co);

    // Monthly sales (last 6 months)
    const monthlySales = db().prepare(
      `SELECT strftime('%Y-%m', invoice_date) as month, COALESCE(SUM(total_amount),0) as total
       FROM invoices WHERE company_id=? AND status='paid'
       AND invoice_date >= date('now','-6 months')
       GROUP BY month ORDER BY month`
    ).all(co);

    // Recent invoices
    const recentInvoices = db().prepare(
      `SELECT id, invoice_number, customer_name, total_amount, status, invoice_date
       FROM invoices WHERE company_id=? ORDER BY created_at DESC LIMIT 5`
    ).all(co);

    // Recent payments
    const recentPayments = db().prepare(
      `SELECT p.id, p.amount, p.method, p.payment_date, i.invoice_number
       FROM payments p LEFT JOIN invoices i ON i.id=p.invoice_id
       WHERE p.company_id=? ORDER BY p.payment_date DESC LIMIT 5`
    ).all(co);

    res.json({
      total_invoiced: paidRow.total,
      total_collected: payRow.total,
      pending_amount: pendingRow.total,
      pending_count: pendingRow.count,
      overdue_count: overdueRow.count,
      customer_count: custRow.count,
      low_stock_count: lowStock.count,
      monthly_sales: monthlySales,
      recent_invoices: recentInvoices,
      recent_payments: recentPayments
    });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

module.exports = router;
