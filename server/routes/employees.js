const express = require('express');
const { v4: uuidv4 } = require('uuid');
const { authenticateToken } = require('../middleware/auth');

const router = express.Router();
router.use(authenticateToken);

router.get('/', (req, res) => {
  const { search, active } = req.query;
  let where = 'WHERE company_id = ?';
  const params = [req.companyId];
  if (search) { where += ' AND (first_name LIKE ? OR last_name LIKE ? OR dni LIKE ? OR cuil LIKE ?)'; params.push(`%${search}%`, `%${search}%`, `%${search}%`, `%${search}%`); }
  if (active !== undefined) { where += ' AND is_active = ?'; params.push(active === '1' ? 1 : 0); }
  const employees = req.db.all('SELECT * FROM employees ' + where + ' ORDER BY last_name ASC, first_name ASC', params);
  res.json({ employees });
});

router.get('/:id', (req, res) => {
  const e = req.db.get('SELECT * FROM employees WHERE id = ? AND company_id = ?', [req.params.id, req.companyId]);
  if (!e) return res.json({ errorcode: 404, errormsg: 'Empleado no encontrado' });
  res.json(e);
});

router.post('/', (req, res) => {
  const { code, first_name, last_name, dni, cuil, birth_date, address, phone, email, position, department, hire_date, salary, salary_type, bank_name, bank_account, cbu, health_insurance, pension_fund, union_name } = req.body;
  if (!first_name || !last_name) return res.json({ errorcode: 400, errormsg: 'Nombre y apellido son obligatorios' });
  const id = uuidv4();
  req.db.run(`INSERT INTO employees (id, company_id, code, first_name, last_name, dni, cuil, birth_date, address, phone, email, position, department, hire_date, salary, salary_type, bank_name, bank_account, cbu, health_insurance, pension_fund, union_name)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    [id, req.companyId, code || '', first_name, last_name, dni || '', cuil || '', birth_date || '', address || '', phone || '', email || '', position || '', department || '', hire_date || '', salary || 0, salary_type || 'monthly', bank_name || '', bank_account || '', cbu || '', health_insurance || '', pension_fund || '', union_name || '']);
  res.json({ id });
});

router.put('/:id', (req, res) => {
  const e = req.db.get('SELECT * FROM employees WHERE id = ? AND company_id = ?', [req.params.id, req.companyId]);
  if (!e) return res.json({ errorcode: 404, errormsg: 'Empleado no encontrado' });
  const { code, first_name, last_name, dni, cuil, birth_date, address, phone, email, position, department, hire_date, termination_date, salary, salary_type, bank_name, bank_account, cbu, health_insurance, pension_fund, union_name, is_active } = req.body;
  req.db.run(`UPDATE employees SET code=?, first_name=?, last_name=?, dni=?, cuil=?, birth_date=?, address=?, phone=?, email=?, position=?, department=?, hire_date=?, termination_date=?, salary=?, salary_type=?, bank_name=?, bank_account=?, cbu=?, health_insurance=?, pension_fund=?, union_name=?, is_active=?, updated_at=datetime('now') WHERE id=? AND company_id=?`,
    [code !== undefined ? code : e.code, first_name || e.first_name, last_name || e.last_name, dni !== undefined ? dni : e.dni, cuil !== undefined ? cuil : e.cuil, birth_date !== undefined ? birth_date : e.birth_date, address !== undefined ? address : e.address, phone !== undefined ? phone : e.phone, email !== undefined ? email : e.email, position !== undefined ? position : e.position, department !== undefined ? department : e.department, hire_date !== undefined ? hire_date : e.hire_date, termination_date !== undefined ? termination_date : e.termination_date, salary !== undefined ? salary : e.salary, salary_type !== undefined ? salary_type : e.salary_type, bank_name !== undefined ? bank_name : e.bank_name, bank_account !== undefined ? bank_account : e.bank_account, cbu !== undefined ? cbu : e.cbu, health_insurance !== undefined ? health_insurance : e.health_insurance, pension_fund !== undefined ? pension_fund : e.pension_fund, union_name !== undefined ? union_name : e.union_name, is_active !== undefined ? is_active : e.is_active, req.params.id, req.companyId]);
  res.json({ success: true });
});

router.delete('/:id', (req, res) => {
  const e = req.db.get('SELECT * FROM employees WHERE id = ? AND company_id = ?', [req.params.id, req.companyId]);
  if (!e) return res.json({ errorcode: 404, errormsg: 'Empleado no encontrado' });
  const hasReceipts = req.db.get('SELECT COUNT(*) as c FROM payroll_receipts WHERE employee_id = ?', [req.params.id]);
  if (hasReceipts && hasReceipts.c > 0) return res.json({ errorcode: 400, errormsg: 'No se puede eliminar: tiene recibos de sueldo. Desactivar en su lugar.' });
  req.db.run('DELETE FROM employees WHERE id = ? AND company_id = ?', [req.params.id, req.companyId]);
  res.json({ success: true });
});

module.exports = router;
