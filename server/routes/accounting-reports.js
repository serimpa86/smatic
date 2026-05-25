const express = require('express');
const { authenticateToken } = require('../middleware/auth');

const router = express.Router();
router.use(authenticateToken);

router.get('/trial-balance', (req, res) => {
  const { from, to } = req.query;
  let dateFilter = '';
  const params = [req.companyId];
  if (from) { dateFilter += ' AND je.date >= ?'; params.push(from); }
  if (to) { dateFilter += ' AND je.date <= ?'; params.push(to); }
  const rows = req.db.all(`
    SELECT a.id, a.code, a.name, a.type,
      COALESCE(SUM(jl.debit),0) as total_debit,
      COALESCE(SUM(jl.credit),0) as total_credit
    FROM chart_of_accounts a
    LEFT JOIN journal_entry_lines jl ON jl.account_id = a.id
    LEFT JOIN journal_entries je ON je.id = jl.journal_entry_id AND je.company_id = ?
    WHERE a.company_id = ? AND a.is_active = 1
    ${dateFilter}
    GROUP BY a.id, a.code, a.name, a.type
    HAVING total_debit > 0 OR total_credit > 0
    ORDER BY a.code ASC
  `, [req.companyId, req.companyId, ...(from || to ? params.slice(1) : [])]);
  let totalDebit = 0, totalCredit = 0;
  for (const r of rows) {
    totalDebit += r.total_debit;
    totalCredit += r.total_credit;
  }
  res.json({ rows, totals: { debit: totalDebit, credit: totalCredit } });
});

router.get('/ledger', (req, res) => {
  const { account_id, from, to } = req.query;
  if (!account_id) return res.json({ errorcode: 400, errormsg: 'account_id es requerido' });
  const account = req.db.get('SELECT * FROM chart_of_accounts WHERE id = ? AND company_id = ?', [account_id, req.companyId]);
  if (!account) return res.json({ errorcode: 404, errormsg: 'Cuenta no encontrada' });
  let dateFilter = '';
  const params = [req.companyId, account_id];
  if (from) { dateFilter += ' AND je.date >= ?'; params.push(from); }
  if (to) { dateFilter += ' AND je.date <= ?'; params.push(to); }
  const lines = req.db.all(`
    SELECT je.date, je.entry_number, je.description as entry_description,
      jl.description as line_description, jl.debit, jl.credit
    FROM journal_entry_lines jl
    JOIN journal_entries je ON je.id = jl.journal_entry_id AND je.company_id = ?
    WHERE jl.account_id = ? ${dateFilter}
    ORDER BY je.date ASC, je.entry_number ASC
  `, params);
  let balance = 0;
  for (const l of lines) {
    if (account.type === 'asset' || account.type === 'expense') {
      balance += l.debit - l.credit;
    } else {
      balance += l.credit - l.debit;
    }
    l.running_balance = balance;
  }
  const opening = req.db.get(`
    SELECT COALESCE(SUM(jl.debit),0) - COALESCE(SUM(jl.credit),0) as balance
    FROM journal_entry_lines jl
    JOIN journal_entries je ON je.id = jl.journal_entry_id AND je.company_id = ?
    WHERE jl.account_id = ? AND je.date < ?
  `, [req.companyId, account_id, from || '1900-01-01']);
  res.json({ account, lines, openingBalance: opening ? opening.balance : 0 });
});

router.get('/income-statement', (req, res) => {
  const { from, to } = req.query;
  let dateFilter = '';
  const params = [req.companyId];
  if (from) { dateFilter += ' AND je.date >= ?'; params.push(from); }
  if (to) { dateFilter += ' AND je.date <= ?'; params.push(to); }
  const income = req.db.all(`
    SELECT a.code, a.name, COALESCE(SUM(jl.credit - jl.debit),0) as balance
    FROM chart_of_accounts a
    JOIN journal_entry_lines jl ON jl.account_id = a.id
    JOIN journal_entries je ON je.id = jl.journal_entry_id AND je.company_id = ?
    WHERE a.company_id = ? AND a.type = 'income' ${dateFilter}
    GROUP BY a.id, a.code, a.name HAVING balance != 0
    ORDER BY a.code ASC
  `, params.concat(params.slice(1)));
  const expense = req.db.all(`
    SELECT a.code, a.name, COALESCE(SUM(jl.debit - jl.credit),0) as balance
    FROM chart_of_accounts a
    JOIN journal_entry_lines jl ON jl.account_id = a.id
    JOIN journal_entries je ON je.id = jl.journal_entry_id AND je.company_id = ?
    WHERE a.company_id = ? AND a.type = 'expense' ${dateFilter}
    GROUP BY a.id, a.code, a.name HAVING balance != 0
    ORDER BY a.code ASC
  `, params.concat(params.slice(1)));
  const totalIncome = income.reduce((s, r) => s + r.balance, 0);
  const totalExpense = expense.reduce((s, r) => s + r.balance, 0);
  res.json({ income, expense, totalIncome, totalExpense, netIncome: totalIncome - totalExpense });
});

router.get('/balance-sheet', (req, res) => {
  const { as_of } = req.query;
  const dateFilter = as_of ? 'AND je.date <= ?' : '';
  const params = [req.companyId];
  if (as_of) params.push(as_of);
  const assets = req.db.all(`
    SELECT a.code, a.name, COALESCE(SUM(jl.debit - jl.credit),0) as balance
    FROM chart_of_accounts a
    JOIN journal_entry_lines jl ON jl.account_id = a.id
    JOIN journal_entries je ON je.id = jl.journal_entry_id AND je.company_id = ?
    WHERE a.company_id = ? AND a.type = 'asset' ${dateFilter}
    GROUP BY a.id, a.code, a.name HAVING balance != 0
    ORDER BY a.code ASC
  `, params.concat(as_of ? [as_of] : []));
  const liabilities = req.db.all(`
    SELECT a.code, a.name, COALESCE(SUM(jl.credit - jl.debit),0) as balance
    FROM chart_of_accounts a
    JOIN journal_entry_lines jl ON jl.account_id = a.id
    JOIN journal_entries je ON je.id = jl.journal_entry_id AND je.company_id = ?
    WHERE a.company_id = ? AND a.type = 'liability' ${dateFilter}
    GROUP BY a.id, a.code, a.name HAVING balance != 0
    ORDER BY a.code ASC
  `, params.concat(as_of ? [as_of] : []));
  const equity = req.db.all(`
    SELECT a.code, a.name, COALESCE(SUM(jl.credit - jl.debit),0) as balance
    FROM chart_of_accounts a
    JOIN journal_entry_lines jl ON jl.account_id = a.id
    JOIN journal_entries je ON je.id = jl.journal_entry_id AND je.company_id = ?
    WHERE a.company_id = ? AND a.type = 'equity' ${dateFilter}
    GROUP BY a.id, a.code, a.name HAVING balance != 0
    ORDER BY a.code ASC
  `, params.concat(as_of ? [as_of] : []));
  const totalAssets = assets.reduce((s, r) => s + r.balance, 0);
  const totalLiabilities = liabilities.reduce((s, r) => s + r.balance, 0);
  const totalEquity = equity.reduce((s, r) => s + r.balance, 0);
  res.json({ assets, liabilities, equity, totalAssets, totalLiabilities, totalEquity });
});

module.exports = router;
