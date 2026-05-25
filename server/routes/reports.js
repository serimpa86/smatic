const express = require('express');
const { authenticateToken } = require('../middleware/auth');

const router = express.Router();
router.use(authenticateToken);

router.get('/dashboard', (req, res) => {
  const { start, end } = req.query;
  const userFilter = req.isSuperadmin ? '' : 'company_id = ? AND';
  const params = req.isSuperadmin ? [] : [req.companyId];
  const dateFilter = start && end ? ' AND date >= ? AND date <= ?' : '';
  if (start && end) { params.push(start, end); }

  const totalInvoiced = req.db.get(`SELECT COALESCE(SUM(total),0) as total FROM invoices WHERE ${userFilter} status != 'draft' AND status != 'cancelled'${dateFilter}`, params);
  const totalPaid = req.db.get(`SELECT COALESCE(SUM(amount_paid),0) as total FROM invoices WHERE ${userFilter} status != 'draft' AND status != 'cancelled'${dateFilter}`, params);
  const totalDue = req.db.get(`SELECT COALESCE(SUM(amount_due),0) as total FROM invoices WHERE ${userFilter} status != 'draft' AND status != 'cancelled' AND status != 'paid'${dateFilter}`, params);
  const paidInvoices = req.db.get(`SELECT COUNT(*) as c FROM invoices WHERE ${userFilter} status = 'paid'${dateFilter}`, params);
  const unpaidInvoices = req.db.get(`SELECT COUNT(*) as c FROM invoices WHERE ${userFilter} status != 'paid' AND status != 'draft' AND status != 'cancelled'${dateFilter}`, params);
  const overdueInvoices = req.db.get(`SELECT COUNT(*) as c FROM invoices WHERE ${userFilter} status != 'paid' AND status != 'draft' AND status != 'cancelled' AND due_date < date('now')${dateFilter}`, params);
  const totalCustomers = req.db.get('SELECT COUNT(*) as c FROM customers' + (req.isSuperadmin ? '' : ' WHERE company_id = ?'), req.isSuperadmin ? [] : [req.companyId]);
  const recentInvoices = req.db.all("SELECT invoice_number, customer_name, total, status, date, id FROM invoices WHERE " + (req.isSuperadmin ? "1=1" : "company_id = ?") + " ORDER BY created_at DESC LIMIT 10", req.isSuperadmin ? [] : [req.companyId]);
  const monthlyStats = req.db.all("SELECT strftime('%Y-%m', date) as month, COUNT(*) as count, COALESCE(SUM(total),0) as total FROM invoices WHERE " + (req.isSuperadmin ? "" : "company_id = ? AND ") + "status != 'draft' AND status != 'cancelled' GROUP BY month ORDER BY month DESC LIMIT 12", req.isSuperadmin ? [] : [req.companyId]);
  const pendingFilter = req.isSuperadmin ? '' : 'company_id = ? AND';
  const pendingParams = req.isSuperadmin ? [] : [req.companyId];
  const pendingInvoices = req.db.all(
    `SELECT invoice_number, customer_name, total, status, date, id, due_date FROM invoices WHERE ${pendingFilter} status IN ('sent','overdue','partial') ORDER BY date DESC LIMIT 20`,
    pendingParams
  );

  res.json({
    totalInvoiced: totalInvoiced.total,
    totalPaid: totalPaid.total,
    totalDue: totalDue.total,
    paidInvoices: paidInvoices.c,
    unpaidInvoices: unpaidInvoices.c,
    overdueInvoices: overdueInvoices.c,
    totalCustomers: totalCustomers.c,
    recentInvoices,
    monthlyStats,
    pendingInvoices
  });
});

router.get('/sales', (req, res) => {
  const { start, end } = req.query;
  let sql = "SELECT i.*, c.name as customer_name FROM invoices i LEFT JOIN customers c ON i.customer_id = c.id WHERE " + (req.isSuperadmin ? "1=1" : "i.company_id = ?") + " AND i.status != 'draft' AND i.status != 'cancelled'";
  let params = req.isSuperadmin ? [] : [req.companyId];
  if (start && end) { sql += ' AND i.date >= ? AND i.date <= ?'; params.push(start, end); }
  sql += ' ORDER BY i.date DESC';
  const invoices = req.db.all(sql, params);
  const total = invoices.reduce((s, i) => s + (i.total || 0), 0);
  res.json({ invoices, total });
});

router.get('/taxes', (req, res) => {
  const { start, end } = req.query;
  let sql = "SELECT ii.tax_name, ii.tax_rate, SUM(ii.total) as taxable_amount FROM invoice_items ii JOIN invoices i ON ii.invoice_id = i.id WHERE " + (req.isSuperadmin ? "1=1" : "i.company_id = ?");
  let params = req.isSuperadmin ? [] : [req.userId];
  if (start && end) { sql += ' AND i.date >= ? AND i.date <= ?'; params.push(start, end); }
  sql += ' GROUP BY ii.tax_name, ii.tax_rate ORDER BY taxable_amount DESC';
  const taxSummary = req.db.all(sql, params);
  res.json({ taxes: taxSummary });
});

router.get('/customers', (req, res) => {
  const customers = req.db.all("SELECT c.id, c.name, c.email, c.phone, COUNT(i.id) as invoice_count, COALESCE(SUM(i.total),0) as total_purchased, COALESCE(SUM(i.amount_due),0) as balance FROM customers c LEFT JOIN invoices i ON c.id = i.customer_id AND i.status != 'draft' AND i.status != 'cancelled' WHERE " + (req.isSuperadmin ? "1=1" : "c.company_id = ?") + " GROUP BY c.id ORDER BY total_purchased DESC", req.isSuperadmin ? [] : [req.companyId]);
  res.json({ customers });
});

module.exports = router;
