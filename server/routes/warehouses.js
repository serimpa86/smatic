const express = require('express');
const { v4: uuidv4 } = require('uuid');
const { authenticateToken } = require('../middleware/auth');

const router = express.Router();
router.use(authenticateToken);

router.get('/', (req, res) => {
  const warehouses = req.db.all('SELECT * FROM warehouses WHERE company_id = ? ORDER BY name ASC', [req.companyId]);
  res.json({ warehouses });
});

router.get('/:id', (req, res) => {
  const w = req.db.get('SELECT * FROM warehouses WHERE id = ? AND company_id = ?', [req.params.id, req.companyId]);
  if (!w) return res.json({ errorcode: 404, errormsg: 'Depósito no encontrado' });
  res.json(w);
});

router.post('/', (req, res) => {
  const { name, code, address, phone, is_default } = req.body;
  if (!name) return res.json({ errorcode: 400, errormsg: 'El nombre es obligatorio' });
  if (is_default) {
    req.db.run('UPDATE warehouses SET is_default = 0 WHERE company_id = ?', [req.companyId]);
  }
  const id = uuidv4();
  const firstWarehouse = req.db.get('SELECT COUNT(*) as c FROM warehouses WHERE company_id = ?', [req.companyId]);
  req.db.run('INSERT INTO warehouses (id, company_id, name, code, address, phone, is_default) VALUES (?,?,?,?,?,?,?)',
    [id, req.companyId, name, code || '', address || '', phone || '', is_default ? 1 : (firstWarehouse.c === 0 ? 1 : 0)]);
  res.json({ id });
});

router.put('/:id', (req, res) => {
  const w = req.db.get('SELECT * FROM warehouses WHERE id = ? AND company_id = ?', [req.params.id, req.companyId]);
  if (!w) return res.json({ errorcode: 404, errormsg: 'Depósito no encontrado' });
  const { name, code, address, phone, is_active, is_default } = req.body;
  if (is_default) {
    req.db.run('UPDATE warehouses SET is_default = 0 WHERE company_id = ? AND id != ?', [req.companyId, req.params.id]);
  }
  req.db.run("UPDATE warehouses SET name=?, code=?, address=?, phone=?, is_active=?, is_default=?, updated_at=datetime('now') WHERE id=? AND company_id=?",
    [name || w.name, code !== undefined ? code : w.code, address !== undefined ? address : w.address, phone !== undefined ? phone : w.phone, is_active !== undefined ? is_active : w.is_active, is_default !== undefined ? (is_default ? 1 : 0) : w.is_default, req.params.id, req.companyId]);
  res.json({ success: true });
});

router.delete('/:id', (req, res) => {
  const w = req.db.get('SELECT * FROM warehouses WHERE id = ? AND company_id = ?', [req.params.id, req.companyId]);
  if (!w) return res.json({ errorcode: 404, errormsg: 'Depósito no encontrado' });
  const hasStock = req.db.get('SELECT COUNT(*) as c FROM stock_levels WHERE warehouse_id = ? AND quantity > 0', [req.params.id]);
  if (hasStock && hasStock.c > 0) return res.json({ errorcode: 400, errormsg: 'No se puede eliminar: el depósito tiene stock' });
  req.db.run('DELETE FROM stock_levels WHERE warehouse_id = ?', [req.params.id]);
  req.db.run('DELETE FROM stock_movements WHERE warehouse_id = ?', [req.params.id]);
  req.db.run('DELETE FROM warehouses WHERE id = ? AND company_id = ?', [req.params.id, req.companyId]);
  res.json({ success: true });
});

module.exports = router;
