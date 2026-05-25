const express = require('express');
const { v4: uuidv4 } = require('uuid');
const { authenticateToken } = require('../middleware/auth');

const router = express.Router();
router.use(authenticateToken);

router.get('/', (req, res) => {
  const { from, to, account_id, limit, offset } = req.query;
  let where = 'WHERE je.company_id = ?';
  const params = [req.companyId];
  if (from) { where += ' AND je.date >= ?'; params.push(from); }
  if (to) { where += ' AND je.date <= ?'; params.push(to); }
  if (account_id) { where += ' AND jl.account_id = ?'; params.push(account_id); }
  const l = parseInt(limit) || 50;
  const o = parseInt(offset) || 0;
  const entries = req.db.all(
    'SELECT je.*, u.name as created_by_name FROM journal_entries je LEFT JOIN users u ON u.id = je.created_by ' + where + ' ORDER BY je.date DESC, je.entry_number DESC LIMIT ? OFFSET ?',
    [...params, l, o]
  );
  for (const entry of entries) {
    entry.lines = req.db.all('SELECT jl.*, a.code as account_code, a.name as account_name FROM journal_entry_lines jl LEFT JOIN chart_of_accounts a ON a.id = jl.account_id WHERE jl.journal_entry_id = ? ORDER BY jl.created_at ASC', [entry.id]);
  }
  const total = req.db.get('SELECT COUNT(*) as c FROM journal_entries je ' + where.replace(/je\./g, '') + (account_id ? ' AND EXISTS (SELECT 1 FROM journal_entry_lines jl WHERE jl.journal_entry_id = je.id AND jl.account_id = ?)' : ''), account_id ? [...params, account_id] : params);
  res.json({ entries, total: total ? total.c : 0 });
});

router.get('/next-number', (req, res) => {
  const max = req.db.get('SELECT COALESCE(MAX(entry_number),0) as max FROM journal_entries WHERE company_id = ?', [req.companyId]);
  res.json({ nextNumber: (max ? max.max : 0) + 1 });
});

router.get('/:id', (req, res) => {
  const entry = req.db.get('SELECT je.*, u.name as created_by_name FROM journal_entries je LEFT JOIN users u ON u.id = je.created_by WHERE je.id = ? AND je.company_id = ?', [req.params.id, req.companyId]);
  if (!entry) return res.json({ errorcode: 404, errormsg: 'Asiento no encontrado' });
  entry.lines = req.db.all('SELECT jl.*, a.code as account_code, a.name as account_name FROM journal_entry_lines jl LEFT JOIN chart_of_accounts a ON a.id = jl.account_id WHERE jl.journal_entry_id = ? ORDER BY jl.created_at ASC', [entry.id]);
  res.json(entry);
});

router.post('/', (req, res) => {
  const { date, description, reference_type, reference_id, lines } = req.body;
  if (!date || !description) return res.json({ errorcode: 400, errormsg: 'Fecha y descripción son obligatorias' });
  if (!lines || !Array.isArray(lines) || lines.length < 2) return res.json({ errorcode: 400, errormsg: 'Debe haber al menos 2 líneas (partida doble)' });
  const validTypes = ['asset', 'liability', 'equity', 'income', 'expense'];
  let totalDebit = 0, totalCredit = 0;
  for (const line of lines) {
    if (!line.account_id) return res.json({ errorcode: 400, errormsg: 'Toda línea debe tener una cuenta' });
    const account = req.db.get('SELECT id, type, is_active FROM chart_of_accounts WHERE id = ? AND company_id = ?', [line.account_id, req.companyId]);
    if (!account) return res.json({ errorcode: 400, errormsg: 'Cuenta ' + line.account_id + ' no encontrada' });
    if (!account.is_active) return res.json({ errorcode: 400, errormsg: 'La cuenta ' + account.name + ' está inactiva' });
    const d = parseFloat(line.debit) || 0;
    const c = parseFloat(line.credit) || 0;
    if (d < 0 || c < 0) return res.json({ errorcode: 400, errormsg: 'Los valores no pueden ser negativos' });
    if (d > 0 && c > 0) return res.json({ errorcode: 400, errormsg: 'Una línea no puede tener débito y crédito simultáneamente' });
    if (d === 0 && c === 0) return res.json({ errorcode: 400, errormsg: 'Toda línea debe tener un importe' });
    totalDebit += d;
    totalCredit += c;
  }
  if (Math.abs(totalDebit - totalCredit) > 0.01) return res.json({ errorcode: 400, errormsg: 'El total del debe debe igualar al haber. Diferencia: ' + (totalDebit - totalCredit).toFixed(2) });
  const max = req.db.get('SELECT COALESCE(MAX(entry_number),0) as max FROM journal_entries WHERE company_id = ?', [req.companyId]);
  const entryNumber = (max ? max.max : 0) + 1;
  const entryId = uuidv4();
  req.db.transaction(() => {
    req.db.run('INSERT INTO journal_entries (id, company_id, entry_number, date, description, reference_type, reference_id, created_by) VALUES (?,?,?,?,?,?,?,?)',
      [entryId, req.companyId, entryNumber, date, description, reference_type || '', reference_id || '', req.userId]);
    for (const line of lines) {
      const lineId = uuidv4();
      const d = parseFloat(line.debit) || 0;
      const c = parseFloat(line.credit) || 0;
      req.db.run('INSERT INTO journal_entry_lines (id, journal_entry_id, account_id, description, debit, credit) VALUES (?,?,?,?,?,?)',
        [lineId, entryId, line.account_id, line.description || '', d, c]);
    }
  });
  res.json({ id: entryId, entry_number: entryNumber });
});

router.put('/:id', (req, res) => {
  const entry = req.db.get('SELECT * FROM journal_entries WHERE id = ? AND company_id = ?', [req.params.id, req.companyId]);
  if (!entry) return res.json({ errorcode: 404, errormsg: 'Asiento no encontrado' });
  const { date, description, reference_type, reference_id, lines } = req.body;
  if (!date || !description) return res.json({ errorcode: 400, errormsg: 'Fecha y descripción son obligatorias' });
  if (!lines || !Array.isArray(lines) || lines.length < 2) return res.json({ errorcode: 400, errormsg: 'Debe haber al menos 2 líneas' });
  let totalDebit = 0, totalCredit = 0;
  for (const line of lines) {
    if (!line.account_id) return res.json({ errorcode: 400, errormsg: 'Toda línea debe tener una cuenta' });
    const account = req.db.get('SELECT id, type, is_active FROM chart_of_accounts WHERE id = ? AND company_id = ?', [line.account_id, req.companyId]);
    if (!account) return res.json({ errorcode: 400, errormsg: 'Cuenta no encontrada' });
    const d = parseFloat(line.debit) || 0;
    const c = parseFloat(line.credit) || 0;
    if (d > 0 && c > 0) return res.json({ errorcode: 400, errormsg: 'Línea con débito y crédito simultáneo' });
    totalDebit += d;
    totalCredit += c;
  }
  if (Math.abs(totalDebit - totalCredit) > 0.01) return res.json({ errorcode: 400, errormsg: 'Debe debe igualar al haber' });
  req.db.transaction(() => {
    req.db.run("UPDATE journal_entries SET date=?, description=?, reference_type=?, reference_id=?, updated_at=datetime('now') WHERE id=?",
      [date, description, reference_type || '', reference_id || '', req.params.id]);
    req.db.run('DELETE FROM journal_entry_lines WHERE journal_entry_id = ?', [req.params.id]);
    for (const line of lines) {
      req.db.run('INSERT INTO journal_entry_lines (id, journal_entry_id, account_id, description, debit, credit) VALUES (?,?,?,?,?,?)',
        [uuidv4(), req.params.id, line.account_id, line.description || '', parseFloat(line.debit) || 0, parseFloat(line.credit) || 0]);
    }
  });
  res.json({ success: true });
});

router.delete('/:id', (req, res) => {
  const entry = req.db.get('SELECT * FROM journal_entries WHERE id = ? AND company_id = ?', [req.params.id, req.companyId]);
  if (!entry) return res.json({ errorcode: 404, errormsg: 'Asiento no encontrado' });
  req.db.transaction(() => {
    req.db.run('DELETE FROM journal_entry_lines WHERE journal_entry_id = ?', [req.params.id]);
    req.db.run('DELETE FROM journal_entries WHERE id = ?', [req.params.id]);
  });
  res.json({ success: true });
});

module.exports = router;
