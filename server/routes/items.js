const express = require('express');
const { v4: uuidv4 } = require('uuid');
const path = require('path');
const fs = require('fs');
const multer = require('multer');
const QRCode = require('qrcode');
const { authenticateToken } = require('../middleware/auth');

const UPLOAD_DIR = path.join(__dirname, '..', '..', 'public', 'uploads', 'items');
if (!fs.existsSync(UPLOAD_DIR)) fs.mkdirSync(UPLOAD_DIR, { recursive: true });

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, UPLOAD_DIR),
  filename: (req, file, cb) => cb(null, Date.now() + '-' + file.originalname)
});
const upload = multer({ storage });

const router = express.Router();
router.use(authenticateToken);

router.get('/', (req, res) => {
  const { search } = req.query;
  let where = 'WHERE 1=1';
  let params = [];
  if (!req.isSuperadmin) { where += ' AND company_id = ?'; params.push(req.companyId); }
  if (search) { where += ' AND (name LIKE ? OR code LIKE ?)'; params.push(`%${search}%`, `%${search}%`); }
  const items = req.db.all('SELECT * FROM items ' + where + ' ORDER BY name ASC', params);
  res.json({ items });
});

router.get('/:id', (req, res) => {
  const item = req.db.get('SELECT * FROM items WHERE id = ?' + (req.isSuperadmin ? '' : ' AND user_id = ?'), req.isSuperadmin ? [req.params.id] : [req.params.id, req.userId]);
  if (!item) return res.json({ errorcode: 404, errormsg: 'Producto no encontrado' });
  res.json(item);
});

router.post('/', (req, res) => {
  const { code, name, description, price, cost_price, tax_rate, tax_name, unit, stock_quantity, stock_warning_level, track_inventory, active } = req.body;
  if (!name) return res.json({ errorcode: 400, errormsg: 'El nombre del producto es obligatorio' });
  const id = uuidv4();
  req.db.run('INSERT INTO items (id, user_id, company_id, code, name, description, price, cost_price, tax_rate, tax_name, unit, stock_quantity, stock_warning_level, track_inventory, active) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)',
    [id, req.userId, req.companyId, code||'', name, description||'', price||0, cost_price||0, tax_rate||0, tax_name||'', unit||'', stock_quantity||0, stock_warning_level||0, track_inventory||0, active!==undefined?active:1]);
  res.json({ id });
  generateQrAsync(req, id, code || name);
});

router.put('/:id', (req, res) => {
  const existing = req.db.get('SELECT id, code, qr_code FROM items WHERE id = ?' + (req.isSuperadmin ? '' : ' AND company_id = ?'), req.isSuperadmin ? [req.params.id] : [req.params.id, req.companyId]);
  if (!existing) return res.json({ errorcode: 404, errormsg: 'Producto no encontrado' });
  const { code, name, description, price, cost_price, tax_rate, tax_name, unit, stock_quantity, stock_warning_level, track_inventory, active } = req.body;
  req.db.run("UPDATE items SET code=?, name=?, description=?, price=?, cost_price=?, tax_rate=?, tax_name=?, unit=?, stock_quantity=?, stock_warning_level=?, track_inventory=?, active=?, updated_at=datetime('now') WHERE id=?" + (req.isSuperadmin ? '' : ' AND company_id=?'),
    req.isSuperadmin
      ? [code||'', name, description||'', price||0, cost_price||0, tax_rate||0, tax_name||'', unit||'', stock_quantity||0, stock_warning_level||0, track_inventory||0, active!==undefined?active:1, req.params.id]
      : [code||'', name, description||'', price||0, cost_price||0, tax_rate||0, tax_name||'', unit||'', stock_quantity||0, stock_warning_level||0, track_inventory||0, active!==undefined?active:1, req.params.id, req.companyId]);
  res.json({ success: true });
  if (code && (!existing.qr_code || code !== existing.code)) {
    generateQrAsync(req, req.params.id, code);
  }
});

router.post('/:id/image', upload.single('image'), (req, res) => {
  const existing = req.db.get('SELECT id, image_url FROM items WHERE id = ?' + (req.isSuperadmin ? '' : ' AND company_id = ?'), req.isSuperadmin ? [req.params.id] : [req.params.id, req.companyId]);
  if (!existing) return res.json({ errorcode: 404, errormsg: 'Producto no encontrado' });
  if (!req.file) return res.json({ errorcode: 400, errormsg: 'No se subió ningún archivo' });
  if (existing.image_url) {
    const oldPath = path.join(__dirname, '..', '..', 'public', existing.image_url);
    if (fs.existsSync(oldPath)) fs.unlinkSync(oldPath);
  }
  const url = '/uploads/items/' + req.file.filename;
  req.db.run("UPDATE items SET image_url = ?, updated_at = datetime('now') WHERE id = ?", [url, req.params.id]);
  res.json({ url });
});

router.delete('/:id/image', (req, res) => {
  const existing = req.db.get('SELECT id, image_url FROM items WHERE id = ?' + (req.isSuperadmin ? '' : ' AND company_id = ?'), req.isSuperadmin ? [req.params.id] : [req.params.id, req.companyId]);
  if (!existing) return res.json({ errorcode: 404, errormsg: 'Producto no encontrado' });
  if (existing.image_url) {
    const oldPath = path.join(__dirname, '..', '..', 'public', existing.image_url);
    if (fs.existsSync(oldPath)) fs.unlinkSync(oldPath);
  }
  req.db.run("UPDATE items SET image_url = '', updated_at = datetime('now') WHERE id = ?", [req.params.id]);
  res.json({ success: true });
});

router.post('/:id/qrcode/generate', (req, res) => {
  const item = req.db.get('SELECT * FROM items WHERE id = ?' + (req.isSuperadmin ? '' : ' AND company_id = ?'), req.isSuperadmin ? [req.params.id] : [req.params.id, req.companyId]);
  if (!item) return res.json({ errorcode: 404, errormsg: 'Producto no encontrado' });
  res.json({ success: true });
  generateQrAsync(req, req.params.id, item.code || item.name);
});

router.delete('/:id/qrcode', (req, res) => {
  const existing = req.db.get('SELECT id, qr_code FROM items WHERE id = ?' + (req.isSuperadmin ? '' : ' AND company_id = ?'), req.isSuperadmin ? [req.params.id] : [req.params.id, req.companyId]);
  if (!existing) return res.json({ errorcode: 404, errormsg: 'Producto no encontrado' });
  if (existing.qr_code) {
    const oldPath = path.join(__dirname, '..', '..', 'public', existing.qr_code);
    if (fs.existsSync(oldPath)) fs.unlinkSync(oldPath);
  }
  req.db.run("UPDATE items SET qr_code = '', updated_at = datetime('now') WHERE id = ?", [req.params.id]);
  res.json({ success: true });
});

router.delete('/:id', (req, res) => {
  const item = req.db.get('SELECT id, image_url, qr_code FROM items WHERE id = ?' + (req.isSuperadmin ? '' : ' AND company_id = ?'), req.isSuperadmin ? [req.params.id] : [req.params.id, req.companyId]);
  if (item) {
    if (item.image_url) {
      const imgPath = path.join(__dirname, '..', '..', 'public', item.image_url);
      if (fs.existsSync(imgPath)) fs.unlinkSync(imgPath);
    }
    if (item.qr_code) {
      const qrPath = path.join(__dirname, '..', '..', 'public', item.qr_code);
      if (fs.existsSync(qrPath)) fs.unlinkSync(qrPath);
    }
  }
  req.db.run('DELETE FROM items WHERE id = ?' + (req.isSuperadmin ? '' : ' AND company_id = ?'), req.isSuperadmin ? [req.params.id] : [req.params.id, req.companyId]);
  res.json({ success: true });
});

function generateQrAsync(req, itemId, data) {
  const fileName = 'qr-' + itemId.slice(0, 8) + '.png';
  const filePath = path.join(UPLOAD_DIR, fileName);
  const url = '/uploads/items/' + fileName;
  QRCode.toFile(filePath, data, { width: 200, margin: 1 }, (err) => {
    if (!err) {
      try { req.db.run("UPDATE items SET qr_code = ?, updated_at = datetime('now') WHERE id = ?", [url, itemId]); } catch (e) {}
    }
  });
}

module.exports = router;
