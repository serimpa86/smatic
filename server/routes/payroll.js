const express = require('express');
const { v4: uuidv4 } = require('uuid');
const { authenticateToken } = require('../middleware/auth');

const router = express.Router();
router.use(authenticateToken);

router.get('/', (req, res) => {
  const { employee_id, period, from, to } = req.query;
  let where = 'WHERE pr.company_id = ?';
  const params = [req.companyId];
  if (employee_id) { where += ' AND pr.employee_id = ?'; params.push(employee_id); }
  if (period) { where += ' AND pr.period = ?'; params.push(period); }
  if (from) { where += ' AND pr.date >= ?'; params.push(from); }
  if (to) { where += ' AND pr.date <= ?'; params.push(to); }
  const receipts = req.db.all(
    `SELECT pr.*, e.first_name, e.last_name, e.dni, e.cuil, e.position, e.department
     FROM payroll_receipts pr LEFT JOIN employees e ON e.id = pr.employee_id
     ${where} ORDER BY pr.period DESC, e.last_name ASC`, params);
  for (const r of receipts) {
    r.items = req.db.all('SELECT * FROM payroll_items WHERE payroll_receipt_id = ? ORDER BY sort_order ASC', [r.id]);
  }
  res.json({ receipts });
});

router.get('/periods', (req, res) => {
  const periods = req.db.all('SELECT DISTINCT period FROM payroll_receipts WHERE company_id = ? ORDER BY period DESC', [req.companyId]);
  res.json({ periods: periods.map(p => p.period) });
});

router.get('/next-number', (req, res) => {
  const max = req.db.get("SELECT COALESCE(MAX(CAST(REPLACE(receipt_number, 'R-', '') AS INTEGER)),0) as max FROM payroll_receipts WHERE company_id = ?", [req.companyId]);
  res.json({ nextNumber: (max ? max.max : 0) + 1 });
});

router.post('/generate', (req, res) => {
  const { employee_id, period, days_worked, absences, overtime, extra_items } = req.body;
  if (!employee_id || !period) return res.json({ errorcode: 400, errormsg: 'Empleado y período son obligatorios' });
  const emp = req.db.get('SELECT * FROM employees WHERE id = ? AND company_id = ?', [employee_id, req.companyId]);
  if (!emp) return res.json({ errorcode: 404, errormsg: 'Empleado no encontrado' });
  const existing = req.db.get('SELECT id FROM payroll_receipts WHERE employee_id = ? AND period = ? AND company_id = ?', [employee_id, period, req.companyId]);
  if (existing) return res.json({ errorcode: 409, errormsg: 'Ya existe un recibo para este empleado y período' });
  const max = req.db.get("SELECT COALESCE(MAX(CAST(REPLACE(receipt_number, 'R-', '') AS INTEGER)),0) as max FROM payroll_receipts WHERE company_id = ?", [req.companyId]);
  const receiptNumber = 'R-' + String((max ? max.max : 0) + 1).padStart(6, '0');
  const monthlySalary = emp.salary || 0;
  const dailySalary = monthlySalary / 30;
  const basePay = dailySalary * (days_worked || 30);
  const overtimePay = (overtime || 0) * (monthlySalary / 240 * 1.5);
  const items = [
    { concept: 'Sueldo Básico', type: 'earning', amount: basePay },
    { concept: 'Horas Extras', type: 'earning', amount: overtimePay },
  ];
  if (extra_items && Array.isArray(extra_items)) {
    for (const ei of extra_items) {
      items.push({ concept: ei.concept || 'Otros', type: ei.type || 'earning', amount: parseFloat(ei.amount) || 0 });
    }
  }
  items.push({ concept: 'Aportes Jubilatorios (11%)', type: 'deduction', amount: -monthlySalary * 0.11 });
  items.push({ concept: 'Obra Social (3%)', type: 'deduction', amount: -monthlySalary * 0.03 });
  items.push({ concept: 'INSSSEP (2%)', type: 'deduction', amount: -monthlySalary * 0.02 });
  let gross = 0, deductions = 0;
  for (const item of items) {
    if (item.type === 'earning') gross += item.amount;
    else deductions += Math.abs(item.amount);
  }
  const net = gross - deductions;
  const receiptId = uuidv4();
  req.db.transaction(() => {
    req.db.run('INSERT INTO payroll_receipts (id, company_id, employee_id, period, receipt_number, gross_salary, deductions, net_salary, days_worked, absences, overtime) VALUES (?,?,?,?,?,?,?,?,?,?,?)',
      [receiptId, req.companyId, employee_id, period, receiptNumber, gross, deductions, net, days_worked || 30, absences || 0, overtime || 0]);
    items.forEach((item, idx) => {
      req.db.run('INSERT INTO payroll_items (id, company_id, payroll_receipt_id, concept, type, amount, sort_order) VALUES (?,?,?,?,?,?,?)',
        [uuidv4(), req.companyId, receiptId, item.concept, item.type, item.amount, idx]);
    });
  });
  res.json({ id: receiptId, receipt_number: receiptNumber, net_salary: net });
});

router.delete('/:id', (req, res) => {
  const r = req.db.get('SELECT * FROM payroll_receipts WHERE id = ? AND company_id = ?', [req.params.id, req.companyId]);
  if (!r) return res.json({ errorcode: 404, errormsg: 'Recibo no encontrado' });
  req.db.transaction(() => {
    req.db.run('DELETE FROM payroll_items WHERE payroll_receipt_id = ?', [req.params.id]);
    req.db.run('DELETE FROM payroll_receipts WHERE id = ?', [req.params.id]);
  });
  res.json({ success: true });
});

module.exports = router;
