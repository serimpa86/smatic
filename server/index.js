const express = require('express');
const cors = require('cors');
const path = require('path');
const { initDb, getDb } = require('./database');

function log(msg) {
  process.stderr.write(`[SERVER ${new Date().toISOString()}] ${msg}\n`);
}
const authRoutes = require('./routes/auth');
const customerRoutes = require('./routes/customers');
const invoiceRoutes = require('./routes/invoices');
const itemRoutes = require('./routes/items');
const settingsRoutes = require('./routes/settings');
const quoteRoutes = require('./routes/quotes');
const paymentRoutes = require('./routes/payments');
const reportRoutes = require('./routes/reports');
const toolRoutes = require('./routes/tools');
const adminRoutes = require('./routes/admin');
const creditNoteRoutes = require('./routes/credit-notes');
const refundRoutes = require('./routes/refunds');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));
app.use(express.static(path.join(__dirname, '..', 'public')));

app.use((req, res, next) => {
  req.db = getDb();
  next();
});

app.use('/', authRoutes);
app.use('/api/customers', customerRoutes);
app.use('/api/invoices', invoiceRoutes);
app.use('/api/items', itemRoutes);
app.use('/api/settings', settingsRoutes);
app.use('/api/quotes', quoteRoutes);
app.use('/api/payments', paymentRoutes);
app.use('/api/reports', reportRoutes);
app.use('/api/tools', toolRoutes);
app.use('/api/admin', adminRoutes);
app.use('/api/credit-notes', creditNoteRoutes);
app.use('/api/refunds', refundRoutes);

app.get('/api/health', (req, res) => res.json({ status: 'ok' }));

process.on('uncaughtException', (err) => {
  log('UNCAUGHT EXCEPTION: ' + (err && err.stack || err));
  process.exit(1);
});

log('Starting initDb...');
initDb().then(() => {
  log('Database initialized, starting server on port ' + PORT);
  app.listen(PORT, () => {
    log('Server listening on port ' + PORT);
    console.log(`Servidor iniciado en http://localhost:${PORT}`);
  });
}).catch(err => {
  log('FATAL: Failed to initialize database: ' + (err && err.stack || err));
  process.stderr.write('FATAL STARTUP ERROR: ' + (err && err.stack || err) + '\n');
  process.exit(1);
});
