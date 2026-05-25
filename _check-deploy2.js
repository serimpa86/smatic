const { initDb, getDb } = require('./server/database');
initDb().then(() => {
  const d = getDb();
  const users = d.all('SELECT id, email, role, company_id FROM users');
  console.log('Users:', users.length);
  users.forEach(u => console.log(' -', u.email, '(' + u.role + '):', 'company_id=' + (u.company_id || 'NULL')));
  const companies = d.all('SELECT id, name FROM companies');
  console.log('Companies:', companies.length);
  companies.forEach(c => console.log(' -', c.name, '(' + c.id + ')'));
  const inv = d.all('SELECT COUNT(*) as c FROM invoices')[0];
  console.log('Total invoices:', inv.c);
  console.log('DONE');
}).catch(e => console.log('ERR:', e.message));
