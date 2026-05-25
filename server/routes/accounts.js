const express = require('express');
const { v4: uuidv4 } = require('uuid');
const { authenticateToken } = require('../middleware/auth');

const router = express.Router();
router.use(authenticateToken);

router.get('/', (req, res) => {
  const { type, search, active } = req.query;
  let where = 'WHERE company_id = ?';
  const params = [req.companyId];
  if (type) { where += ' AND type = ?'; params.push(type); }
  if (search) { where += ' AND (name LIKE ? OR code LIKE ?)'; params.push(`%${search}%`, `%${search}%`); }
  if (active !== undefined) { where += ' AND is_active = ?'; params.push(active === '1' ? 1 : 0); }
  const accounts = req.db.all('SELECT * FROM chart_of_accounts ' + where + ' ORDER BY code ASC', params);
  const tree = buildTree(accounts);
  res.json({ accounts, tree });
});

router.get('/:id', (req, res) => {
  const account = req.db.get('SELECT * FROM chart_of_accounts WHERE id = ? AND company_id = ?', [req.params.id, req.companyId]);
  if (!account) return res.json({ errorcode: 404, errormsg: 'Cuenta no encontrada' });
  const children = req.db.all('SELECT * FROM chart_of_accounts WHERE parent_id = ? AND company_id = ? ORDER BY code ASC', [req.params.id, req.companyId]);
  const balance = req.db.get("SELECT COALESCE(SUM(debit),0) - COALESCE(SUM(credit),0) as balance FROM journal_entry_lines WHERE account_id = ?", [req.params.id]);
  res.json({ ...account, children, balance: balance ? balance.balance : 0 });
});

router.post('/', (req, res) => {
  const { code, name, type, parent_id } = req.body;
  if (!code || !name || !type) return res.json({ errorcode: 400, errormsg: 'Código, nombre y tipo son obligatorios' });
  if (!['asset','liability','equity','income','expense'].includes(type)) return res.json({ errorcode: 400, errormsg: 'Tipo inválido' });
  const existing = req.db.get('SELECT id FROM chart_of_accounts WHERE code = ? AND company_id = ?', [code, req.companyId]);
  if (existing) return res.json({ errorcode: 409, errormsg: 'Ya existe una cuenta con ese código' });
  if (parent_id) {
    const parent = req.db.get('SELECT id, type FROM chart_of_accounts WHERE id = ? AND company_id = ?', [parent_id, req.companyId]);
    if (!parent) return res.json({ errorcode: 400, errormsg: 'Cuenta padre no encontrada' });
    if (parent.type !== type) return res.json({ errorcode: 400, errormsg: 'La cuenta padre debe ser del mismo tipo' });
  }
  const id = uuidv4();
  req.db.run('INSERT INTO chart_of_accounts (id, company_id, code, name, type, parent_id) VALUES (?,?,?,?,?,?)',
    [id, req.companyId, code, name, type, parent_id || null]);
  res.json({ id });
});

router.put('/:id', (req, res) => {
  const account = req.db.get('SELECT * FROM chart_of_accounts WHERE id = ? AND company_id = ?', [req.params.id, req.companyId]);
  if (!account) return res.json({ errorcode: 404, errormsg: 'Cuenta no encontrada' });
  const { code, name, type, parent_id, is_active } = req.body;
  if (code && code !== account.code) {
    const dup = req.db.get('SELECT id FROM chart_of_accounts WHERE code = ? AND company_id = ? AND id != ?', [code, req.companyId, req.params.id]);
    if (dup) return res.json({ errorcode: 409, errormsg: 'Ya existe otra cuenta con ese código' });
  }
  if (parent_id && parent_id !== account.parent_id) {
    const parent = req.db.get('SELECT id, type FROM chart_of_accounts WHERE id = ? AND company_id = ?', [parent_id, req.companyId]);
    if (!parent) return res.json({ errorcode: 400, errormsg: 'Cuenta padre no encontrada' });
    if (parent.type !== (type || account.type)) return res.json({ errorcode: 400, errormsg: 'La cuenta padre debe ser del mismo tipo' });
  }
  req.db.run("UPDATE chart_of_accounts SET code=?, name=?, type=?, parent_id=?, is_active=?, updated_at=datetime('now') WHERE id=? AND company_id=?",
    [code || account.code, name || account.name, type || account.type, parent_id !== undefined ? parent_id : account.parent_id, is_active !== undefined ? is_active : account.is_active, req.params.id, req.companyId]);
  res.json({ success: true });
});

router.delete('/:id', (req, res) => {
  const account = req.db.get('SELECT * FROM chart_of_accounts WHERE id = ? AND company_id = ?', [req.params.id, req.companyId]);
  if (!account) return res.json({ errorcode: 404, errormsg: 'Cuenta no encontrada' });
  const children = req.db.all('SELECT id FROM chart_of_accounts WHERE parent_id = ? AND company_id = ?', [req.params.id, req.companyId]);
  if (children.length > 0) return res.json({ errorcode: 400, errormsg: 'No se puede eliminar: tiene cuentas hijas' });
  const used = req.db.get('SELECT id FROM journal_entry_lines WHERE account_id = ? LIMIT 1', [req.params.id]);
  if (used) return res.json({ errorcode: 400, errormsg: 'No se puede eliminar: la cuenta tiene movimientos' });
  req.db.run('DELETE FROM chart_of_accounts WHERE id = ? AND company_id = ?', [req.params.id, req.companyId]);
  res.json({ success: true });
});

function buildTree(accounts) {
  const map = {};
  const roots = [];
  for (const a of accounts) {
    map[a.id] = { ...a, children: [] };
  }
  for (const a of accounts) {
    if (a.parent_id && map[a.parent_id]) {
      map[a.parent_id].children.push(map[a.id]);
    } else if (!a.parent_id) {
      roots.push(map[a.id]);
    }
  }
  return roots;
}

module.exports = router;
