const express = require('express');
const { v4: uuidv4 } = require('uuid');
const { authenticateToken } = require('../middleware/auth');

const router = express.Router();
router.use(authenticateToken);

router.get('/movements', (req, res) => {
  const { item_id, warehouse_id, type, from, to, limit, offset } = req.query;
  let where = 'WHERE sm.company_id = ?';
  const params = [req.companyId];
  if (item_id) { where += ' AND sm.item_id = ?'; params.push(item_id); }
  if (warehouse_id) { where += ' AND sm.warehouse_id = ?'; params.push(warehouse_id); }
  if (type) { where += ' AND sm.type = ?'; params.push(type); }
  if (from) { where += ' AND sm.created_at >= ?'; params.push(from); }
  if (to) { where += ' AND sm.created_at <= ?'; params.push(to); }
  const l = parseInt(limit) || 50;
  const o = parseInt(offset) || 0;
  const movements = req.db.all(
    `SELECT sm.*, i.name as item_name, i.code as item_code, w.name as warehouse_name
     FROM stock_movements sm
     LEFT JOIN items i ON i.id = sm.item_id
     LEFT JOIN warehouses w ON w.id = sm.warehouse_id
     ${where} ORDER BY sm.created_at DESC LIMIT ? OFFSET ?`,
    [...params, l, o]
  );
  const total = req.db.get('SELECT COUNT(*) as c FROM stock_movements sm ' + where, params);
  res.json({ movements, total: total ? total.c : 0 });
});

router.post('/in', (req, res) => {
  const { item_id, warehouse_id, quantity, description, reference_type, reference_id, unit_cost } = req.body;
  if (!item_id || !warehouse_id || !quantity || quantity <= 0) return res.json({ errorcode: 400, errormsg: 'Producto, depósito y cantidad positiva son obligatorios' });
  const item = req.db.get('SELECT id FROM items WHERE id = ? AND company_id = ?', [item_id, req.companyId]);
  if (!item) return res.json({ errorcode: 404, errormsg: 'Producto no encontrado' });
  const wh = req.db.get('SELECT id FROM warehouses WHERE id = ? AND company_id = ?', [warehouse_id, req.companyId]);
  if (!wh) return res.json({ errorcode: 404, errormsg: 'Depósito no encontrado' });
  req.db.transaction(() => {
    const id = uuidv4();
    req.db.run('INSERT INTO stock_movements (id, company_id, item_id, warehouse_id, type, quantity, reference_type, reference_id, description, unit_cost, created_by) VALUES (?,?,?,?,?,?,?,?,?,?,?)',
      [id, req.companyId, item_id, warehouse_id, 'in', quantity, reference_type || '', reference_id || '', description || '', unit_cost || 0, req.userId]);
    const existing = req.db.get('SELECT id, quantity FROM stock_levels WHERE item_id = ? AND warehouse_id = ?', [item_id, warehouse_id]);
    if (existing) {
      req.db.run('UPDATE stock_levels SET quantity = quantity + ?, updated_at = datetime(\'now\') WHERE id = ?', [quantity, existing.id]);
    } else {
      req.db.run('INSERT INTO stock_levels (id, company_id, item_id, warehouse_id, quantity) VALUES (?,?,?,?,?)',
        [uuidv4(), req.companyId, item_id, warehouse_id, quantity]);
    }
    req.db.run('UPDATE items SET stock_quantity = COALESCE((SELECT SUM(quantity) FROM stock_levels WHERE item_id = ?), 0), updated_at = datetime(\'now\') WHERE id = ?', [item_id, item_id]);
  });
  res.json({ success: true });
});

router.post('/out', (req, res) => {
  const { item_id, warehouse_id, quantity, description, reference_type, reference_id, unit_cost } = req.body;
  if (!item_id || !warehouse_id || !quantity || quantity <= 0) return res.json({ errorcode: 400, errormsg: 'Producto, depósito y cantidad positiva son obligatorios' });
  const level = req.db.get('SELECT id, quantity FROM stock_levels WHERE item_id = ? AND warehouse_id = ?', [item_id, warehouse_id]);
  if (!level || level.quantity < quantity) return res.json({ errorcode: 400, errormsg: 'Stock insuficiente en el depósito seleccionado. Disponible: ' + (level ? level.quantity : 0) });
  req.db.transaction(() => {
    const id = uuidv4();
    req.db.run('INSERT INTO stock_movements (id, company_id, item_id, warehouse_id, type, quantity, reference_type, reference_id, description, unit_cost, created_by) VALUES (?,?,?,?,?,?,?,?,?,?,?)',
      [id, req.companyId, item_id, warehouse_id, 'out', -quantity, reference_type || '', reference_id || '', description || '', unit_cost || 0, req.userId]);
    req.db.run('UPDATE stock_levels SET quantity = quantity - ?, updated_at = datetime(\'now\') WHERE id = ?', [quantity, level.id]);
    req.db.run('UPDATE items SET stock_quantity = COALESCE((SELECT SUM(quantity) FROM stock_levels WHERE item_id = ?), 0), updated_at = datetime(\'now\') WHERE id = ?', [item_id, item_id]);
  });
  res.json({ success: true });
});

router.post('/transfer', (req, res) => {
  const { item_id, from_warehouse_id, to_warehouse_id, quantity, description } = req.body;
  if (!item_id || !from_warehouse_id || !to_warehouse_id || !quantity || quantity <= 0) return res.json({ errorcode: 400, errormsg: 'Todos los campos son obligatorios' });
  if (from_warehouse_id === to_warehouse_id) return res.json({ errorcode: 400, errormsg: 'Los depósitos deben ser distintos' });
  const fromLevel = req.db.get('SELECT id, quantity FROM stock_levels WHERE item_id = ? AND warehouse_id = ?', [item_id, from_warehouse_id]);
  if (!fromLevel || fromLevel.quantity < quantity) return res.json({ errorcode: 400, errormsg: 'Stock insuficiente' });
  req.db.transaction(() => {
    const ts = new Date().toISOString();
    req.db.run('INSERT INTO stock_movements (id, company_id, item_id, warehouse_id, type, quantity, description, created_by) VALUES (?,?,?,?,?,?,?,?)',
      [uuidv4(), req.companyId, item_id, from_warehouse_id, 'transfer_out', -quantity, description || '', req.userId]);
    req.db.run('INSERT INTO stock_movements (id, company_id, item_id, warehouse_id, type, quantity, description, created_by) VALUES (?,?,?,?,?,?,?,?)',
      [uuidv4(), req.companyId, item_id, to_warehouse_id, 'transfer_in', quantity, description || '', req.userId]);
    req.db.run('UPDATE stock_levels SET quantity = quantity - ?, updated_at = datetime(\'now\') WHERE id = ?', [quantity, fromLevel.id]);
    const toLevel = req.db.get('SELECT id FROM stock_levels WHERE item_id = ? AND warehouse_id = ?', [item_id, to_warehouse_id]);
    if (toLevel) {
      req.db.run('UPDATE stock_levels SET quantity = quantity + ?, updated_at = datetime(\'now\') WHERE id = ?', [quantity, toLevel.id]);
    } else {
      req.db.run('INSERT INTO stock_levels (id, company_id, item_id, warehouse_id, quantity) VALUES (?,?,?,?,?)',
        [uuidv4(), req.companyId, item_id, to_warehouse_id, quantity]);
    }
    req.db.run('UPDATE items SET stock_quantity = COALESCE((SELECT SUM(quantity) FROM stock_levels WHERE item_id = ?), 0), updated_at = datetime(\'now\') WHERE id = ?', [item_id, item_id]);
  });
  res.json({ success: true });
});

router.post('/adjust', (req, res) => {
  const { item_id, warehouse_id, new_quantity, description } = req.body;
  if (!item_id || !warehouse_id || new_quantity === undefined || new_quantity < 0) return res.json({ errorcode: 400, errormsg: 'Producto, depósito y cantidad son obligatorios' });
  const level = req.db.get('SELECT id, quantity FROM stock_levels WHERE item_id = ? AND warehouse_id = ?', [item_id, warehouse_id]);
  const currentQty = level ? level.quantity : 0;
  const diff = new_quantity - currentQty;
  req.db.transaction(() => {
    const id = uuidv4();
    req.db.run('INSERT INTO stock_movements (id, company_id, item_id, warehouse_id, type, quantity, description, created_by) VALUES (?,?,?,?,?,?,?,?)',
      [id, req.companyId, item_id, warehouse_id, 'adjustment', diff, (description || 'Ajuste de inventario') + ' (anterior: ' + currentQty + ', nuevo: ' + new_quantity + ')', req.userId]);
    if (level) {
      req.db.run('UPDATE stock_levels SET quantity = ?, updated_at = datetime(\'now\') WHERE id = ?', [new_quantity, level.id]);
    } else {
      req.db.run('INSERT INTO stock_levels (id, company_id, item_id, warehouse_id, quantity) VALUES (?,?,?,?,?)',
        [uuidv4(), req.companyId, item_id, warehouse_id, new_quantity]);
    }
    req.db.run('UPDATE items SET stock_quantity = COALESCE((SELECT SUM(quantity) FROM stock_levels WHERE item_id = ?), 0), updated_at = datetime(\'now\') WHERE id = ?', [item_id, item_id]);
  });
  res.json({ success: true });
});

router.get('/levels', (req, res) => {
  const { item_id, warehouse_id, low_stock } = req.query;
  let where = 'WHERE sl.company_id = ?';
  const params = [req.companyId];
  if (item_id) { where += ' AND sl.item_id = ?'; params.push(item_id); }
  if (warehouse_id) { where += ' AND sl.warehouse_id = ?'; params.push(warehouse_id); }
  let levels;
  if (low_stock) {
    levels = req.db.all(
      `SELECT sl.*, i.name as item_name, i.code as item_code, i.stock_warning_level, i.track_inventory,
              w.name as warehouse_name
       FROM stock_levels sl
       JOIN items i ON i.id = sl.item_id AND i.company_id = ?
       JOIN warehouses w ON w.id = sl.warehouse_id
       ${where} AND i.track_inventory = 1 AND sl.quantity <= i.stock_warning_level
       ORDER BY (sl.quantity - i.stock_warning_level) ASC`,
      [req.companyId, ...params]
    );
  } else {
    levels = req.db.all(
      `SELECT sl.*, i.name as item_name, i.code as item_code, i.stock_warning_level, i.track_inventory,
              w.name as warehouse_name
       FROM stock_levels sl
       JOIN items i ON i.id = sl.item_id AND i.company_id = ?
       JOIN warehouses w ON w.id = sl.warehouse_id
       ${where} ORDER BY i.name ASC, w.name ASC`,
      [req.companyId, ...params]
    );
  }
  res.json({ levels });
});

router.get('/summary', (req, res) => {
  const items = req.db.all(
    `SELECT i.id, i.code, i.name, i.stock_quantity, i.stock_warning_level, i.track_inventory,
            i.unit, i.cost_price, i.price
     FROM items i WHERE i.company_id = ? AND i.track_inventory = 1
     ORDER BY i.name ASC`,
    [req.companyId]
  );
  for (const item of items) {
    item.warehouses = req.db.all(
      `SELECT sl.quantity, w.id as warehouse_id, w.name as warehouse_name
       FROM stock_levels sl JOIN warehouses w ON w.id = sl.warehouse_id
       WHERE sl.item_id = ? AND w.company_id = ?
       ORDER BY w.name ASC`,
      [item.id, req.companyId]
    );
  }
  res.json({ items });
});

module.exports = router;
