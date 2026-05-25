const express = require('express');
const { v4: uuidv4 } = require('uuid');
const { authenticateToken } = require('../middleware/auth');

const router = express.Router();
router.use(authenticateToken);

router.get('/', (req, res) => {
  const { status, supplier_id, from, to, limit, offset } = req.query;
  let where = 'WHERE po.company_id = ?';
  const params = [req.companyId];
  if (status) { where += ' AND po.status = ?'; params.push(status); }
  if (supplier_id) { where += ' AND po.supplier_id = ?'; params.push(supplier_id); }
  if (from) { where += ' AND po.date >= ?'; params.push(from); }
  if (to) { where += ' AND po.date <= ?'; params.push(to); }
  const l = parseInt(limit) || 50;
  const o = parseInt(offset) || 0;
  const orders = req.db.all(
    'SELECT po.*, u.name as created_by_name FROM purchase_orders po LEFT JOIN users u ON u.id = po.created_by ' + where + ' ORDER BY po.date DESC, po.created_at DESC LIMIT ? OFFSET ?',
    [...params, l, o]
  );
  for (const o of orders) {
    o.items = req.db.all('SELECT poi.*, i.code as item_code_lookup FROM purchase_order_items poi LEFT JOIN items i ON i.id = poi.item_id WHERE poi.purchase_order_id = ? ORDER BY poi.sort_order ASC', [o.id]);
  }
  const total = req.db.get('SELECT COUNT(*) as c FROM purchase_orders po ' + where, params);
  res.json({ orders, total: total ? total.c : 0 });
});

router.get('/next-number', (req, res) => {
  const max = req.db.get("SELECT COALESCE(MAX(CAST(REPLACE(po_number, 'PO-', '') AS INTEGER)),0) as max FROM purchase_orders WHERE company_id = ?", [req.companyId]);
  res.json({ nextNumber: (max ? max.max : 0) + 1 });
});

router.get('/:id', (req, res) => {
  const po = req.db.get('SELECT po.*, u.name as created_by_name FROM purchase_orders po LEFT JOIN users u ON u.id = po.created_by WHERE po.id = ? AND po.company_id = ?', [req.params.id, req.companyId]);
  if (!po) return res.json({ errorcode: 404, errormsg: 'Orden de compra no encontrada' });
  po.items = req.db.all('SELECT poi.*, i.code as item_code_lookup, i.name as item_name_lookup FROM purchase_order_items poi LEFT JOIN items i ON i.id = poi.item_id WHERE poi.purchase_order_id = ? ORDER BY poi.sort_order ASC', [po.id]);
  res.json(po);
});

router.post('/', (req, res) => {
  const { supplier_id, supplier_name, supplier_cuit, supplier_address, supplier_phone, date, expected_date, currency, currency_symbol, items, notes, warehouse_id } = req.body;
  if (!items || !Array.isArray(items) || items.length === 0) return res.json({ errorcode: 400, errormsg: 'Debe tener al menos un item' });
  const max = req.db.get("SELECT COALESCE(MAX(CAST(REPLACE(po_number, 'PO-', '') AS INTEGER)),0) as max FROM purchase_orders WHERE company_id = ?", [req.companyId]);
  const poNumber = 'PO-' + String((max ? max.max : 0) + 1).padStart(6, '0');
  const id = uuidv4();
  let subtotal = 0, taxTotal = 0;
  for (const item of items) {
    const total = (item.quantity || 1) * (item.unit_price || 0);
    subtotal += total;
    if (item.tax_rate) taxTotal += total * (item.tax_rate / 100);
  }
  req.db.transaction(() => {
    req.db.run("INSERT INTO purchase_orders (id, company_id, po_number, supplier_id, supplier_name, supplier_cuit, supplier_address, supplier_phone, date, expected_date, status, currency, currency_symbol, subtotal, tax_total, total, notes, created_by, warehouse_id) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
      [id, req.companyId, poNumber, supplier_id || '', supplier_name || '', supplier_cuit || '', supplier_address || '', supplier_phone || '', date || new Date().toISOString().slice(0,10), expected_date || '', 'draft', currency || 'ARS', currency_symbol || '$', subtotal, taxTotal, subtotal + taxTotal, notes || '', req.userId, warehouse_id || null]);
    items.forEach((item, idx) => {
      const total = (item.quantity || 1) * (item.unit_price || 0);
      req.db.run("INSERT INTO purchase_order_items (id, company_id, purchase_order_id, item_id, item_code, description, quantity, unit_price, tax_rate, tax_name, total, sort_order) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)",
        [uuidv4(), req.companyId, id, item.item_id || null, item.item_code || '', item.description || '', item.quantity || 1, item.unit_price || 0, item.tax_rate || 0, item.tax_name || '', total, idx]);
    });
  });
  res.json({ id, po_number: poNumber });
});

router.put('/:id', (req, res) => {
  const po = req.db.get('SELECT * FROM purchase_orders WHERE id = ? AND company_id = ?', [req.params.id, req.companyId]);
  if (!po) return res.json({ errorcode: 404, errormsg: 'Orden no encontrada' });
  if (po.status !== 'draft') return res.json({ errorcode: 400, errormsg: 'Solo se pueden editar órdenes en borrador' });
  const { supplier_id, supplier_name, supplier_cuit, date, expected_date, items, notes, warehouse_id } = req.body;
  if (!items || !Array.isArray(items) || items.length === 0) return res.json({ errorcode: 400, errormsg: 'Debe tener al menos un item' });
  let subtotal = 0, taxTotal = 0;
  for (const item of items) {
    const total = (item.quantity || 1) * (item.unit_price || 0);
    subtotal += total;
    if (item.tax_rate) taxTotal += total * (item.tax_rate / 100);
  }
  req.db.transaction(() => {
    req.db.run("UPDATE purchase_orders SET supplier_id=?, supplier_name=?, supplier_cuit=?, date=?, expected_date=?, subtotal=?, tax_total=?, total=?, notes=?, warehouse_id=?, updated_at=datetime('now') WHERE id=?",
      [supplier_id || po.supplier_id, supplier_name || po.supplier_name, supplier_cuit || po.supplier_cuit, date || po.date, expected_date || po.expected_date, subtotal, taxTotal, subtotal + taxTotal, notes !== undefined ? notes : po.notes, warehouse_id !== undefined ? warehouse_id : po.warehouse_id, req.params.id]);
    req.db.run('DELETE FROM purchase_order_items WHERE purchase_order_id = ?', [req.params.id]);
    items.forEach((item, idx) => {
      const total = (item.quantity || 1) * (item.unit_price || 0);
      req.db.run("INSERT INTO purchase_order_items (id, company_id, purchase_order_id, item_id, item_code, description, quantity, unit_price, tax_rate, tax_name, total, sort_order) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)",
        [uuidv4(), req.companyId, req.params.id, item.item_id || null, item.item_code || '', item.description || '', item.quantity || 1, item.unit_price || 0, item.tax_rate || 0, item.tax_name || '', total, idx]);
    });
  });
  res.json({ success: true });
});

router.post('/:id/receive', (req, res) => {
  const po = req.db.get('SELECT * FROM purchase_orders WHERE id = ? AND company_id = ?', [req.params.id, req.companyId]);
  if (!po) return res.json({ errorcode: 404, errormsg: 'Orden no encontrada' });
  if (po.status === 'cancelled') return res.json({ errorcode: 400, errormsg: 'No se puede recibir una orden cancelada' });
  const items = req.db.all('SELECT * FROM purchase_order_items WHERE purchase_order_id = ?', [req.params.id]);
  const { received_items } = req.body;
  req.db.transaction(() => {
    for (const ri of (received_items || items)) {
      const item = items.find(i => i.id === ri.id || (i.item_id && i.item_id === ri.item_id));
      if (!item) continue;
      const qtyToReceive = ri.quantity !== undefined ? ri.quantity : item.quantity;
      const alreadyReceived = item.received_quantity || 0;
      const newReceived = qtyToReceive;
      const diff = newReceived - alreadyReceived;
      req.db.run('UPDATE purchase_order_items SET received_quantity = ? WHERE id = ?', [newReceived, item.id]);
      if (diff > 0 && item.item_id && po.warehouse_id) {
        const movId = uuidv4();
        req.db.run("INSERT INTO stock_movements (id, company_id, item_id, warehouse_id, type, quantity, reference_type, reference_id, description, unit_cost, created_by) VALUES (?,?,?,?,?,?,?,?,?,?,?)",
          [movId, req.companyId, item.item_id, po.warehouse_id, 'in', diff, 'purchase_order', req.params.id, 'Recepción OC ' + po.po_number, item.unit_price || 0, req.userId]);
        const existing = req.db.get('SELECT id, quantity FROM stock_levels WHERE item_id = ? AND warehouse_id = ?', [item.item_id, po.warehouse_id]);
        if (existing) {
          req.db.run('UPDATE stock_levels SET quantity = quantity + ?, updated_at = datetime(\'now\') WHERE id = ?', [diff, existing.id]);
        } else {
          req.db.run('INSERT INTO stock_levels (id, company_id, item_id, warehouse_id, quantity) VALUES (?,?,?,?,?)',
            [uuidv4(), req.companyId, item.item_id, po.warehouse_id, diff]);
        }
        req.db.run("UPDATE items SET stock_quantity = COALESCE((SELECT SUM(quantity) FROM stock_levels WHERE item_id = ?), 0), updated_at = datetime('now') WHERE id = ?", [item.item_id, item.item_id]);
      }
    }
    const allReceived = items.every(i => (i.received_quantity || 0) >= i.quantity);
    req.db.run("UPDATE purchase_orders SET status=?, updated_at=datetime('now') WHERE id=?", [allReceived ? 'received' : 'confirmed', req.params.id]);
  });
  res.json({ success: true });
});

router.post('/:id/status', (req, res) => {
  const po = req.db.get('SELECT * FROM purchase_orders WHERE id = ? AND company_id = ?', [req.params.id, req.companyId]);
  if (!po) return res.json({ errorcode: 404, errormsg: 'Orden no encontrada' });
  const { status } = req.body;
  if (!['draft','sent','confirmed','cancelled'].includes(status)) return res.json({ errorcode: 400, errormsg: 'Estado inválido' });
  if (po.status === 'received' && status !== 'cancelled') return res.json({ errorcode: 400, errormsg: 'No se puede cambiar estado de una orden recibida' });
  req.db.run("UPDATE purchase_orders SET status=?, updated_at=datetime('now') WHERE id=?", [status, req.params.id]);
  res.json({ success: true });
});

router.delete('/:id', (req, res) => {
  const po = req.db.get('SELECT * FROM purchase_orders WHERE id = ? AND company_id = ?', [req.params.id, req.companyId]);
  if (!po) return res.json({ errorcode: 404, errormsg: 'Orden no encontrada' });
  if (po.status !== 'draft') return res.json({ errorcode: 400, errormsg: 'Solo se pueden eliminar órdenes en borrador' });
  req.db.transaction(() => {
    req.db.run('DELETE FROM purchase_order_items WHERE purchase_order_id = ?', [req.params.id]);
    req.db.run('DELETE FROM purchase_orders WHERE id = ?', [req.params.id]);
  });
  res.json({ success: true });
});

module.exports = router;
