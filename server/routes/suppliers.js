const express = require('express');
const { v4: uuidv4 } = require('uuid');
const { authenticateToken } = require('../middleware/auth');

const router = express.Router();
router.use(authenticateToken);

router.get('/', (req, res) => {
  const { search } = req.query;
  let where = 'WHERE company_id = ?';
  const params = [req.companyId];
  if (search) { where += ' AND (name LIKE ? OR code LIKE ? OR cuit LIKE ?)'; params.push(`%${search}%`, `%${search}%`, `%${search}%`); }
  const suppliers = req.db.all('SELECT * FROM suppliers ' + where + ' ORDER BY name ASC', params);
  res.json({ suppliers });
});

router.get('/:id', (req, res) => {
  const s = req.db.get('SELECT * FROM suppliers WHERE id = ? AND company_id = ?', [req.params.id, req.companyId]);
  if (!s) return res.json({ errorcode: 404, errormsg: 'Proveedor no encontrado' });
  res.json(s);
});

router.post('/', (req, res) => {
  const { code, name, cuit, address, phone, email, contact_person, payment_terms, notes } = req.body;
  if (!name) return res.json({ errorcode: 400, errormsg: 'El nombre es obligatorio' });
  const id = uuidv4();
  req.db.run("INSERT INTO suppliers (id, company_id, code, name, cuit, address, phone, email, contact_person, payment_terms, notes) VALUES (?,?,?,?,?,?,?,?,?,?,?)",
    [id, req.companyId, code || '', name, cuit || '', address || '', phone || '', email || '', contact_person || '', payment_terms || '30', notes || '']);
  res.json({ id });
});

router.put('/:id', (req, res) => {
  const s = req.db.get('SELECT * FROM suppliers WHERE id = ? AND company_id = ?', [req.params.id, req.companyId]);
  if (!s) return res.json({ errorcode: 404, errormsg: 'Proveedor no encontrado' });
  const { code, name, cuit, address, phone, email, contact_person, payment_terms, notes, is_active } = req.body;
  req.db.run("UPDATE suppliers SET code=?, name=?, cuit=?, address=?, phone=?, email=?, contact_person=?, payment_terms=?, notes=?, is_active=?, updated_at=datetime('now') WHERE id=? AND company_id=?",
    [code !== undefined ? code : s.code, name || s.name, cuit !== undefined ? cuit : s.cuit, address !== undefined ? address : s.address, phone !== undefined ? phone : s.phone, email !== undefined ? email : s.email, contact_person !== undefined ? contact_person : s.contact_person, payment_terms !== undefined ? payment_terms : s.payment_terms, notes !== undefined ? notes : s.notes, is_active !== undefined ? is_active : s.is_active, req.params.id, req.companyId]);
  res.json({ success: true });
});

router.delete('/:id', (req, res) => {
  const s = req.db.get('SELECT * FROM suppliers WHERE id = ? AND company_id = ?', [req.params.id, req.companyId]);
  if (!s) return res.json({ errorcode: 404, errormsg: 'Proveedor no encontrado' });
  const hasPO = req.db.get('SELECT COUNT(*) as c FROM purchase_orders WHERE supplier_id = ?', [req.params.id]);
  if (hasPO && hasPO.c > 0) return res.json({ errorcode: 400, errormsg: 'No se puede eliminar: tiene órdenes de compra' });
  req.db.run('DELETE FROM suppliers WHERE id = ? AND company_id = ?', [req.params.id, req.companyId]);
  res.json({ success: true });
});

module.exports = router;
