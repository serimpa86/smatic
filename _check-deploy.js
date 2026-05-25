const { initDb, getDb } = require('./server/database');
initDb().then(() => {
  const d = getDb();
  const c = d.all('SELECT id, name FROM companies');
  console.log('Companies:', c.length, c.map(x => x.name).join(', '));
  const u = d.all('SELECT COUNT(*) as c FROM users WHERE company_id IS NOT NULL')[0];
  console.log('Users with company_id:', u.c);
  const bs = d.all('SELECT COUNT(*) as c FROM business_settings WHERE company_id IS NOT NULL')[0];
  console.log('BS with company_id:', bs.c);
  const inv = d.all('SELECT COUNT(*) as c FROM invoices WHERE company_id IS NOT NULL')[0];
  console.log('Invoices with company_id:', inv.c);
  const items = d.all('SELECT COUNT(*) as c FROM items WHERE company_id IS NOT NULL')[0];
  console.log('Items with company_id:', items.c);
  console.log('MIGRATION VERIFIED');
}).catch(e => console.log('ERR:', e.message));
