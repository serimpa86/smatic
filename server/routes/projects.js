const express = require('express');
const router = express.Router();
const { db, genId } = require('../database');

function cid(req) { return (req.user && req.user.company_id) || ''; }

// ── Projects CRUD ──

router.get('/', (req, res) => {
  try {
    const rows = db().prepare(
      `SELECT p.*, (SELECT COALESCE(SUM(hours),0) FROM project_time_entries WHERE project_id=p.id AND company_id=p.company_id) as total_hours,
       (SELECT COUNT(*) FROM project_tasks WHERE project_id=p.id AND company_id=p.company_id) as task_count,
       (SELECT COUNT(*) FROM project_tasks WHERE project_id=p.id AND company_id=p.company_id AND status='done') as done_count
       FROM projects p WHERE p.company_id=? ORDER BY p.created_at DESC`
    ).all(cid(req));
    res.json({ projects: rows });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.get('/:id', (req, res) => {
  try {
    const p = db().prepare(`SELECT * FROM projects WHERE id=? AND company_id=?`).get(req.params.id, cid(req));
    if (!p) return res.status(404).json({ error: 'Not found' });
    res.json({ project: p });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.post('/', (req, res) => {
  try {
    const co = cid(req);
    if (!co) return res.status(401).json({ error: 'No company' });
    const { name, description, customer_id, customer_name, status, start_date, end_date, budget_amount } = req.body;
    if (!name) return res.status(400).json({ error: 'Name required' });
    const id = genId();
    db().prepare(
      `INSERT INTO projects (id,company_id,name,description,customer_id,customer_name,status,start_date,end_date,budget_amount) VALUES (?,?,?,?,?,?,?,?,?,?)`
    ).run(id, co, name, description||'', customer_id||'', customer_name||'', status||'planning', start_date||'', end_date||'', budget_amount||0);
    const row = db().prepare(`SELECT * FROM projects WHERE id=?`).get(id);
    res.json({ project: row });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.put('/:id', (req, res) => {
  try {
    const co = cid(req);
    const { name, description, customer_id, customer_name, status, start_date, end_date, budget_amount } = req.body;
    db().prepare(
      `UPDATE projects SET name=COALESCE(?,name), description=COALESCE(?,description), customer_id=COALESCE(?,customer_id), customer_name=COALESCE(?,customer_name), status=COALESCE(?,status), start_date=COALESCE(?,start_date), end_date=COALESCE(?,end_date), budget_amount=COALESCE(?,budget_amount) WHERE id=? AND company_id=?`
    ).run(name, description, customer_id, customer_name, status, start_date, end_date, budget_amount, req.params.id, co);
    const row = db().prepare(`SELECT * FROM projects WHERE id=?`).get(req.params.id);
    res.json({ project: row });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.delete('/:id', (req, res) => {
  try {
    db().prepare(`DELETE FROM projects WHERE id=? AND company_id=?`).run(req.params.id, cid(req));
    db().prepare(`DELETE FROM project_tasks WHERE project_id=? AND company_id=?`).run(req.params.id, cid(req));
    db().prepare(`DELETE FROM project_time_entries WHERE project_id=? AND company_id=?`).run(req.params.id, cid(req));
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ── Tasks ──

router.get('/:id/tasks', (req, res) => {
  try {
    const rows = db().prepare(
      `SELECT t.* FROM project_tasks t WHERE t.project_id=? AND t.company_id=? ORDER BY t.sort_order, t.created_at`
    ).all(req.params.id, cid(req));
    res.json({ tasks: rows });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.post('/:id/tasks', (req, res) => {
  try {
    const co = cid(req);
    const { name, description, assignee, status, estimated_hours } = req.body;
    if (!name) return res.status(400).json({ error: 'Name required' });
    const tid = genId();
    const maxSort = db().prepare(
      `SELECT COALESCE(MAX(sort_order),0)+1 as n FROM project_tasks WHERE project_id=? AND company_id=?`
    ).get(req.params.id, co);
    db().prepare(
      `INSERT INTO project_tasks (id,company_id,project_id,name,description,assignee,status,estimated_hours,sort_order) VALUES (?,?,?,?,?,?,?,?,?)`
    ).run(tid, co, req.params.id, name, description||'', assignee||'', status||'todo', estimated_hours||0, maxSort.n);
    const row = db().prepare(`SELECT * FROM project_tasks WHERE id=?`).get(tid);
    res.json({ task: row });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.get('/tasks/:taskId', (req, res) => {
  try {
    const row = db().prepare(`SELECT * FROM project_tasks WHERE id=? AND company_id=?`).get(req.params.taskId, cid(req));
    if (!row) return res.status(404).json({ error: 'Not found' });
    res.json({ task: row });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.put('/tasks/:taskId', (req, res) => {
  try {
    const { name, description, assignee, status, estimated_hours, sort_order } = req.body;
    db().prepare(
      `UPDATE project_tasks SET name=COALESCE(?,name), description=COALESCE(?,description), assignee=COALESCE(?,assignee), status=COALESCE(?,status), estimated_hours=COALESCE(?,estimated_hours), sort_order=COALESCE(?,sort_order) WHERE id=? AND company_id=?`
    ).run(name, description, assignee, status, estimated_hours, sort_order, req.params.taskId, cid(req));
    const row = db().prepare(`SELECT * FROM project_tasks WHERE id=?`).get(req.params.taskId);
    res.json({ task: row });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.delete('/tasks/:taskId', (req, res) => {
  try {
    db().prepare(`DELETE FROM project_tasks WHERE id=? AND company_id=?`).run(req.params.taskId, cid(req));
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ── Time Entries ──

router.get('/:id/time', (req, res) => {
  try {
    const rows = db().prepare(
      `SELECT t.* FROM project_time_entries t WHERE t.project_id=? AND t.company_id=? ORDER BY t.date DESC, t.created_at DESC`
    ).all(req.params.id, cid(req));
    res.json({ entries: rows });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.post('/:id/time', (req, res) => {
  try {
    const co = cid(req);
    const { task_id, user_id, user_name, date, hours, description, billable } = req.body;
    if (!hours || hours<=0) return res.status(400).json({ error: 'Hours must be >0' });
    const eid = genId();
    db().prepare(
      `INSERT INTO project_time_entries (id,company_id,project_id,task_id,user_id,user_name,date,hours,description,billable) VALUES (?,?,?,?,?,?,?,?,?,?)`
    ).run(eid, co, req.params.id, task_id||'', user_id||'', user_name||'', date||new Date().toISOString().slice(0,10), hours, description||'', billable!==undefined?billable:1);
    const row = db().prepare(`SELECT * FROM project_time_entries WHERE id=?`).get(eid);
    res.json({ entry: row });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.delete('/time/:entryId', (req, res) => {
  try {
    db().prepare(`DELETE FROM project_time_entries WHERE id=? AND company_id=?`).run(req.params.entryId, cid(req));
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ── Bill unbilled hours → create a draft invoice ──

router.post('/:id/bill', (req, res) => {
  try {
    const co = cid(req);
    const { hourly_rate, description } = req.body;
    const entries = db().prepare(
      `SELECT * FROM project_time_entries WHERE project_id=? AND company_id=? AND billable=1`
    ).all(req.params.id, co);
    const unbilled = entries.filter(e => !e.billed);
    if (!unbilled.length) return res.status(400).json({ error: 'No unbilled hours' });
    const totalHours = unbilled.reduce((s,e)=>s+e.hours,0);
    const rate = hourly_rate || 0;
    const total = totalHours * rate;
    const p = db().prepare(`SELECT * FROM projects WHERE id=? AND company_id=?`).get(req.params.id, co);
    const r = db().prepare(`SELECT * FROM settings WHERE company_id=?`).get(co);
    let cfg = {};
    try { cfg = JSON.parse(r.value || '{}'); } catch (e) {}
    const nextNum = (cfg.lastInvoiceNum || 0) + 1;
    const invoiceNum = 'PY-' + String(nextNum).padStart(6, '0');
    const now = new Date().toISOString().replace('T',' ').slice(0,19);
    const invoiceId = genId();
    db().prepare(
      `INSERT INTO invoices (id,company_id,invoice_number,customer_id,customer_name,invoice_date,due_date,total_amount,status,type,created_at) VALUES (?,?,?,?,?,?,?,?,'draft','project',?)`
    ).run(invoiceId, co, invoiceNum, p.customer_id, p.customer_name, now.slice(0,10), now.slice(0,10), total, now);
    const insItem = db().prepare(
      `INSERT INTO invoice_items (id,invoice_id,company_id,description,quantity,unit_price,total_price) VALUES (?,?,?,?,?,?,?)`
    );
    insItem.run(genId(), invoiceId, co, (description||'Horas proyecto: ')+p.name, totalHours, rate, total);
    if (r) {
      cfg.lastInvoiceNum = nextNum;
      db().prepare(`UPDATE settings SET value=? WHERE company_id=?`).run(JSON.stringify(cfg), co);
    }
    db().prepare(`UPDATE projects SET billed_amount = billed_amount + ? WHERE id=? AND company_id=?`).run(total, req.params.id, co);
    res.json({ invoice_id: invoiceId, invoice_number: invoiceNum, total });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

module.exports = router;
