const express = require('express');
const { v4: uuidv4 } = require('uuid');
const { authenticateToken } = require('../middleware/auth');

const router = express.Router();
router.use(authenticateToken);

router.get('/deals', (req, res) => {
  const { stage, search } = req.query;
  let where = 'WHERE company_id = ?';
  const params = [req.companyId];
  if (stage) { where += ' AND stage = ?'; params.push(stage); }
  if (search) { where += ' AND (title LIKE ? OR customer_name LIKE ?)'; params.push(`%${search}%`, `%${search}%`); }
  const deals = req.db.all('SELECT * FROM crm_deals ' + where + ' ORDER BY updated_at DESC', params);
  res.json({ deals });
});

router.get('/deals/pipeline', (req, res) => {
  const deals = req.db.all('SELECT * FROM crm_deals WHERE company_id = ? AND is_active = 1 ORDER BY updated_at DESC', [req.companyId]);
  const pipeline = { lead: [], qualified: [], proposal: [], negotiation: [], won: [], lost: [] };
  for (const d of deals) {
    if (pipeline[d.stage]) pipeline[d.stage].push(d);
    else pipeline[d.stage] = [d];
  }
  const totals = {};
  for (const stage of Object.keys(pipeline)) {
    totals[stage] = pipeline[stage].reduce((s, d) => s + (d.value || 0), 0);
  }
  res.json({ pipeline, totals });
});

router.get('/deals/:id', (req, res) => {
  const deal = req.db.get('SELECT * FROM crm_deals WHERE id = ? AND company_id = ?', [req.params.id, req.companyId]);
  if (!deal) return res.json({ errorcode: 404, errormsg: 'Oportunidad no encontrada' });
  deal.activities = req.db.all('SELECT * FROM crm_activities WHERE deal_id = ? ORDER BY created_at DESC', [deal.id]);
  res.json(deal);
});

router.post('/deals', (req, res) => {
  const { customer_id, customer_name, title, value, stage, probability, expected_close_date, source, notes, assigned_to } = req.body;
  if (!title) return res.json({ errorcode: 400, errormsg: 'El título es obligatorio' });
  const id = uuidv4();
  req.db.run("INSERT INTO crm_deals (id, company_id, customer_id, customer_name, title, value, stage, probability, expected_close_date, source, notes, assigned_to) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)",
    [id, req.companyId, customer_id || '', customer_name || '', title, value || 0, stage || 'lead', probability || 0, expected_close_date || '', source || '', notes || '', assigned_to || '']);
  res.json({ id });
});

router.put('/deals/:id', (req, res) => {
  const d = req.db.get('SELECT * FROM crm_deals WHERE id = ? AND company_id = ?', [req.params.id, req.companyId]);
  if (!d) return res.json({ errorcode: 404, errormsg: 'Oportunidad no encontrada' });
  const { customer_id, customer_name, title, value, stage, probability, expected_close_date, source, notes, assigned_to, is_active } = req.body;
  req.db.run("UPDATE crm_deals SET customer_id=?, customer_name=?, title=?, value=?, stage=?, probability=?, expected_close_date=?, source=?, notes=?, assigned_to=?, is_active=?, updated_at=datetime('now') WHERE id=? AND company_id=?",
    [customer_id !== undefined ? customer_id : d.customer_id, customer_name !== undefined ? customer_name : d.customer_name, title || d.title, value !== undefined ? value : d.value, stage || d.stage, probability !== undefined ? probability : d.probability, expected_close_date !== undefined ? expected_close_date : d.expected_close_date, source !== undefined ? source : d.source, notes !== undefined ? notes : d.notes, assigned_to !== undefined ? assigned_to : d.assigned_to, is_active !== undefined ? is_active : d.is_active, req.params.id, req.companyId]);
  res.json({ success: true });
});

router.post('/deals/:id/stage', (req, res) => {
  const d = req.db.get('SELECT * FROM crm_deals WHERE id = ? AND company_id = ?', [req.params.id, req.companyId]);
  if (!d) return res.json({ errorcode: 404, errormsg: 'Oportunidad no encontrada' });
  const { stage } = req.body;
  if (!['lead','qualified','proposal','negotiation','won','lost'].includes(stage)) return res.json({ errorcode: 400, errormsg: 'Etapa inválida' });
  req.db.run("UPDATE crm_deals SET stage=?, updated_at=datetime('now') WHERE id=?", [stage, req.params.id]);
  res.json({ success: true });
});

router.delete('/deals/:id', (req, res) => {
  const d = req.db.get('SELECT * FROM crm_deals WHERE id = ? AND company_id = ?', [req.params.id, req.companyId]);
  if (!d) return res.json({ errorcode: 404, errormsg: 'Oportunidad no encontrada' });
  req.db.transaction(() => {
    req.db.run('DELETE FROM crm_activities WHERE deal_id = ?', [req.params.id]);
    req.db.run('DELETE FROM crm_deals WHERE id = ?', [req.params.id]);
  });
  res.json({ success: true });
});

router.get('/activities', (req, res) => {
  const { deal_id, type, completed } = req.query;
  let where = 'WHERE company_id = ?';
  const params = [req.companyId];
  if (deal_id) { where += ' AND deal_id = ?'; params.push(deal_id); }
  if (type) { where += ' AND type = ?'; params.push(type); }
  if (completed !== undefined) { where += ' AND completed = ?'; params.push(completed === '1' ? 1 : 0); }
  const activities = req.db.all('SELECT * FROM crm_activities ' + where + ' ORDER BY due_date ASC, created_at DESC', params);
  res.json({ activities });
});

router.post('/activities', (req, res) => {
  const { deal_id, customer_id, type, subject, description, due_date, assigned_to } = req.body;
  if (!type || !subject) return res.json({ errorcode: 400, errormsg: 'Tipo y asunto son obligatorios' });
  const id = uuidv4();
  req.db.run("INSERT INTO crm_activities (id, company_id, deal_id, customer_id, type, subject, description, due_date, assigned_to) VALUES (?,?,?,?,?,?,?,?,?)",
    [id, req.companyId, deal_id || '', customer_id || '', type, subject, description || '', due_date || '', assigned_to || '']);
  res.json({ id });
});

router.put('/activities/:id', (req, res) => {
  const a = req.db.get('SELECT * FROM crm_activities WHERE id = ? AND company_id = ?', [req.params.id, req.companyId]);
  if (!a) return res.json({ errorcode: 404, errormsg: 'Actividad no encontrada' });
  const { completed, description, due_date } = req.body;
  req.db.run("UPDATE crm_activities SET completed=?, description=?, due_date=? WHERE id=?", [completed !== undefined ? completed : a.completed, description !== undefined ? description : a.description, due_date !== undefined ? due_date : a.due_date, req.params.id]);
  res.json({ success: true });
});

router.delete('/activities/:id', (req, res) => {
  req.db.run('DELETE FROM crm_activities WHERE id = ? AND company_id = ?', [req.params.id, req.companyId]);
  res.json({ success: true });
});

module.exports = router;
