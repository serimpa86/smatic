const initSqlJs = require('./node_modules/sql.js');
initSqlJs({ locateFile: () => './node_modules/sql.js/dist/sql-wasm.wasm' }).then(SQL => {
  const db = new SQL.Database();
  try { db.exec("CREATE TABLE test1(id TEXT PRIMARY KEY, created_at TEXT DEFAULT CURRENT_TIMESTAMP)"); console.log('CURRENT_TIMESTAMP: OK'); } catch(e) { console.log('CURRENT_TIMESTAMP ERROR:', e.message); }
  try { db.exec("CREATE TABLE test2(id TEXT PRIMARY KEY, created_at TEXT DEFAULT (datetime('now')))"); console.log('datetime now: OK'); } catch(e) { console.log('datetime now ERROR:', e.message); }
});
