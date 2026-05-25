const express = require('express');
const { v4: uuidv4 } = require('uuid');
const { authenticateToken } = require('../middleware/auth');

const router = express.Router();
router.use(authenticateToken);

// ══════════════════════════════════════════════
// Custom Fields
// ══════════════════════════════════════════════

router.get('/custom-fields', (req, res) => {
  try {
    const rows = req.db.all('SELECT * FROM custom_fields WHERE company_id=? ORDER BY entity_type, sort_order', [req.companyId]);
    res.json({ fields: rows });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.post('/custom-fields', (req, res) => {
  try {
    const { entity_type, field_name, field_type, options, sort_order } = req.body;
    if (!entity_type || !field_name) return res.status(400).json({ error: 'entity_type and field_name required' });
    const id = uuidv4();
    req.db.run(
      'INSERT INTO custom_fields (id,company_id,entity_type,field_name,field_type,options,sort_order) VALUES (?,?,?,?,?,?,?)',
      [id, req.companyId, entity_type, field_name, field_type || 'text', options || '', sort_order || 0]
    );
    res.json({ field: req.db.get('SELECT * FROM custom_fields WHERE id=?', [id]) });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.put('/custom-fields/:id', (req, res) => {
  try {
    const { field_name, field_type, options, sort_order, active } = req.body;
    req.db.run(
      'UPDATE custom_fields SET field_name=COALESCE(?,field_name), field_type=COALESCE(?,field_type), options=COALESCE(?,options), sort_order=COALESCE(?,sort_order), active=COALESCE(?,active) WHERE id=? AND company_id=?',
      [field_name, field_type, options, sort_order, active, req.params.id, req.companyId]
    );
    res.json({ field: req.db.get('SELECT * FROM custom_fields WHERE id=?', [req.params.id]) });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.delete('/custom-fields/:id', (req, res) => {
  try {
    req.db.run('DELETE FROM custom_fields WHERE id=? AND company_id=?', [req.params.id, req.companyId]);
    req.db.run('DELETE FROM custom_field_values WHERE field_id=? AND company_id=?', [req.params.id, req.companyId]);
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.get('/custom-fields/values/:entity_type/:entity_id', (req, res) => {
  try {
    const rows = req.db.all(
      'SELECT v.*, f.field_name, f.field_type FROM custom_field_values v JOIN custom_fields f ON f.id=v.field_id AND f.company_id=v.company_id WHERE v.entity_id=? AND v.company_id=? AND f.entity_type=?',
      [req.params.entity_id, req.companyId, req.params.entity_type]
    );
    res.json({ values: rows });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.post('/custom-fields/values/:entity_type/:entity_id', (req, res) => {
  try {
    const { field_id, value } = req.body;
    const existing = req.db.get(
      'SELECT id FROM custom_field_values WHERE field_id=? AND entity_id=? AND company_id=?',
      [field_id, req.params.entity_id, req.companyId]
    );
    if (existing) {
      req.db.run('UPDATE custom_field_values SET value=? WHERE id=?', [String(value||''), existing.id]);
    } else {
      req.db.run(
        'INSERT INTO custom_field_values (id,company_id,field_id,entity_id,value) VALUES (?,?,?,?,?)',
        [uuidv4(), req.companyId, field_id, req.params.entity_id, String(value||'')]
      );
    }
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ══════════════════════════════════════════════
// Construcción - Obras
// ══════════════════════════════════════════════

const statusLabels = { planning: 'Planificación', active: 'Activo', on_hold: 'En espera', completed: 'Completado', cancelled: 'Cancelado' };

router.get('/construction/works', (req, res) => {
  try {
    const rows = req.db.all(
      `SELECT w.*, (SELECT COUNT(*) FROM construction_diaries WHERE work_id=w.id) as diary_count,
       (SELECT COALESCE(SUM(contract_amount),0) FROM construction_subcontractors WHERE work_id=w.id) as sub_amt,
       (SELECT COALESCE(SUM(paid_amount),0) FROM construction_subcontractors WHERE work_id=w.id) as sub_paid
       FROM construction_works w WHERE w.company_id=? ORDER BY w.created_at DESC`,
      [req.companyId]
    );
    res.json({ works: rows });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.get('/construction/works/:id', (req, res) => {
  try {
    const row = req.db.get('SELECT * FROM construction_works WHERE id=? AND company_id=?', [req.params.id, req.companyId]);
    if (!row) return res.status(404).json({ error: 'Not found' });
    res.json({ work: row });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.post('/construction/works', (req, res) => {
  try {
    const { name, description, customer_id, customer_name, address, status, start_date, end_date, budget_amount } = req.body;
    if (!name) return res.status(400).json({ error: 'Name required' });
    const id = uuidv4();
    req.db.run(
      'INSERT INTO construction_works (id,company_id,name,description,customer_id,customer_name,address,status,start_date,end_date,budget_amount) VALUES (?,?,?,?,?,?,?,?,?,?,?)',
      [id, req.companyId, name, description||'', customer_id||'', customer_name||'', address||'', status||'planning', start_date||'', end_date||'', budget_amount||0]
    );
    res.json({ work: req.db.get('SELECT * FROM construction_works WHERE id=?', [id]) });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.put('/construction/works/:id', (req, res) => {
  try {
    const { name, description, customer_name, address, status, start_date, end_date, budget_amount } = req.body;
    req.db.run(
      'UPDATE construction_works SET name=COALESCE(?,name), description=COALESCE(?,description), customer_name=COALESCE(?,customer_name), address=COALESCE(?,address), status=COALESCE(?,status), start_date=COALESCE(?,start_date), end_date=COALESCE(?,end_date), budget_amount=COALESCE(?,budget_amount) WHERE id=? AND company_id=?',
      [name, description, customer_name, address, status, start_date, end_date, budget_amount, req.params.id, req.companyId]
    );
    res.json({ work: req.db.get('SELECT * FROM construction_works WHERE id=?', [req.params.id]) });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.delete('/construction/works/:id', (req, res) => {
  try {
    const id = req.params.id;
    req.db.run('DELETE FROM construction_works WHERE id=? AND company_id=?', [id, req.companyId]);
    req.db.run('DELETE FROM construction_diaries WHERE work_id=? AND company_id=?', [id, req.companyId]);
    req.db.run('DELETE FROM construction_subcontractors WHERE work_id=? AND company_id=?', [id, req.companyId]);
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ── Construction: Partes de Obra (Diaries) ──

router.get('/construction/works/:id/diaries', (req, res) => {
  try {
    const rows = req.db.all(
      'SELECT * FROM construction_diaries WHERE work_id=? AND company_id=? ORDER BY date DESC',
      [req.params.id, req.companyId]
    );
    res.json({ diaries: rows });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.post('/construction/works/:id/diaries', (req, res) => {
  try {
    const { date, description, weather, temperature, workers_count, supervisor, hours_worked, notes } = req.body;
    const id = uuidv4();
    req.db.run(
      'INSERT INTO construction_diaries (id,company_id,work_id,date,description,weather,temperature,workers_count,supervisor,hours_worked,notes) VALUES (?,?,?,?,?,?,?,?,?,?,?)',
      [id, req.companyId, req.params.id, date||new Date().toISOString().slice(0,10), description||'', weather||'', temperature||'', workers_count||0, supervisor||'', hours_worked||0, notes||'']
    );
    res.json({ diary: req.db.get('SELECT * FROM construction_diaries WHERE id=?', [id]) });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.delete('/construction/diaries/:id', (req, res) => {
  try {
    req.db.run('DELETE FROM construction_diaries WHERE id=? AND company_id=?', [req.params.id, req.companyId]);
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ── Construction: Subcontractors ──

router.get('/construction/works/:id/subcontractors', (req, res) => {
  try {
    const rows = req.db.all('SELECT * FROM construction_subcontractors WHERE work_id=? AND company_id=? ORDER BY name', [req.params.id, req.companyId]);
    res.json({ subs: rows });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.post('/construction/works/:id/subcontractors', (req, res) => {
  try {
    const { name, contact, service, contract_amount, start_date, end_date, notes } = req.body;
    if (!name) return res.status(400).json({ error: 'Name required' });
    const id = uuidv4();
    req.db.run(
      'INSERT INTO construction_subcontractors (id,company_id,work_id,name,contact,service,contract_amount,start_date,end_date,notes) VALUES (?,?,?,?,?,?,?,?,?,?)',
      [id, req.companyId, req.params.id, name, contact||'', service||'', contract_amount||0, start_date||'', end_date||'', notes||'']
    );
    res.json({ sub: req.db.get('SELECT * FROM construction_subcontractors WHERE id=?', [id]) });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.put('/construction/subcontractors/:id', (req, res) => {
  try {
    const { name, contact, service, contract_amount, paid_amount, start_date, end_date, notes } = req.body;
    req.db.run(
      'UPDATE construction_subcontractors SET name=COALESCE(?,name), contact=COALESCE(?,contact), service=COALESCE(?,service), contract_amount=COALESCE(?,contract_amount), paid_amount=COALESCE(?,paid_amount), start_date=COALESCE(?,start_date), end_date=COALESCE(?,end_date), notes=COALESCE(?,notes) WHERE id=? AND company_id=?',
      [name, contact, service, contract_amount, paid_amount, start_date, end_date, notes, req.params.id, req.companyId]
    );
    res.json({ sub: req.db.get('SELECT * FROM construction_subcontractors WHERE id=?', [req.params.id]) });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.delete('/construction/subcontractors/:id', (req, res) => {
  try {
    req.db.run('DELETE FROM construction_subcontractors WHERE id=? AND company_id=?', [req.params.id, req.companyId]);
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ══════════════════════════════════════════════
// Servicios
// ══════════════════════════════════════════════

// ── Contracts ──

router.get('/services/contracts', (req, res) => {
  try {
    const rows = req.db.all(
      `SELECT c.*, (SELECT COUNT(*) FROM service_visits WHERE contract_id=c.id) as visit_count
       FROM service_contracts c WHERE c.company_id=? ORDER BY c.created_at DESC`,
      [req.companyId]
    );
    res.json({ contracts: rows });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.get('/services/contracts/:id', (req, res) => {
  try {
    const row = req.db.get('SELECT * FROM service_contracts WHERE id=? AND company_id=?', [req.params.id, req.companyId]);
    if (!row) return res.status(404).json({ error: 'Not found' });
    res.json({ contract: row });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.post('/services/contracts', (req, res) => {
  try {
    const { customer_id, customer_name, name, description, frequency, status, start_date, end_date, price, notes } = req.body;
    if (!name) return res.status(400).json({ error: 'Name required' });
    const id = uuidv4();
    req.db.run(
      'INSERT INTO service_contracts (id,company_id,customer_id,customer_name,name,description,frequency,status,start_date,end_date,price,notes) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)',
      [id, req.companyId, customer_id||'', customer_name||'', name, description||'', frequency||'monthly', status||'active', start_date||'', end_date||'', price||0, notes||'']
    );
    res.json({ contract: req.db.get('SELECT * FROM service_contracts WHERE id=?', [id]) });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.put('/services/contracts/:id', (req, res) => {
  try {
    const { name, description, frequency, status, start_date, end_date, price, notes } = req.body;
    req.db.run(
      'UPDATE service_contracts SET name=COALESCE(?,name), description=COALESCE(?,description), frequency=COALESCE(?,frequency), status=COALESCE(?,status), start_date=COALESCE(?,start_date), end_date=COALESCE(?,end_date), price=COALESCE(?,price), notes=COALESCE(?,notes) WHERE id=? AND company_id=?',
      [name, description, frequency, status, start_date, end_date, price, notes, req.params.id, req.companyId]
    );
    res.json({ contract: req.db.get('SELECT * FROM service_contracts WHERE id=?', [req.params.id]) });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.delete('/services/contracts/:id', (req, res) => {
  try {
    req.db.run('DELETE FROM service_contracts WHERE id=? AND company_id=?', [req.params.id, req.companyId]);
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ── Visits / Service Orders ──

router.get('/services/visits', (req, res) => {
  try {
    let q = 'SELECT v.* FROM service_visits v WHERE v.company_id=?';
    const params = [req.companyId];
    if (req.query.contract_id) { q += ' AND v.contract_id=?'; params.push(req.query.contract_id); }
    if (req.query.status) { q += ' AND v.status=?'; params.push(req.query.status); }
    q += ' ORDER BY v.date DESC';
    const rows = req.db.all(q, params);
    res.json({ visits: rows });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.get('/services/visits/:id', (req, res) => {
  try {
    const row = req.db.get('SELECT * FROM service_visits WHERE id=? AND company_id=?', [req.params.id, req.companyId]);
    if (!row) return res.status(404).json({ error: 'Not found' });
    res.json({ visit: row });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.post('/services/visits', (req, res) => {
  try {
    const { contract_id, customer_id, customer_name, date, technician, description, status, duration_hours, materials, notes } = req.body;
    const id = uuidv4();
    req.db.run(
      'INSERT INTO service_visits (id,company_id,contract_id,customer_id,customer_name,date,technician,description,status,duration_hours,materials,notes) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)',
      [id, req.companyId, contract_id||'', customer_id||'', customer_name||'', date||new Date().toISOString().slice(0,10), technician||'', description||'', status||'scheduled', duration_hours||0, materials||'', notes||'']
    );
    res.json({ visit: req.db.get('SELECT * FROM service_visits WHERE id=?', [id]) });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.put('/services/visits/:id', (req, res) => {
  try {
    const { technician, description, status, duration_hours, materials, notes } = req.body;
    req.db.run(
      'UPDATE service_visits SET technician=COALESCE(?,technician), description=COALESCE(?,description), status=COALESCE(?,status), duration_hours=COALESCE(?,duration_hours), materials=COALESCE(?,materials), notes=COALESCE(?,notes) WHERE id=? AND company_id=?',
      [technician, description, status, duration_hours, materials, notes, req.params.id, req.companyId]
    );
    res.json({ visit: req.db.get('SELECT * FROM service_visits WHERE id=?', [req.params.id]) });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.delete('/services/visits/:id', (req, res) => {
  try {
    req.db.run('DELETE FROM service_visits WHERE id=? AND company_id=?', [req.params.id, req.companyId]);
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

module.exports = router;
