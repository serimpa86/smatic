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
const afipRoutes = require('./routes/afip');
const fiscalRoutes = require('./routes/fiscal');
const onboardingRoutes = require('./routes/onboarding');
const accountRoutes = require('./routes/accounts');
const journalRoutes = require('./routes/journal');
const accountingReportRoutes = require('./routes/accounting-reports');
const warehouseRoutes = require('./routes/warehouses');
const stockRoutes = require('./routes/stock');
const supplierRoutes = require('./routes/suppliers');
const purchaseRoutes = require('./routes/purchases');
const employeeRoutes = require('./routes/employees');
const payrollRoutes = require('./routes/payroll');
const crmRoutes = require('./routes/crm');
const posRoutes = require('./routes/pos');
const projectsRoutes = require('./routes/projects');
const modulesRoutes = require('./routes/modules');
const dashboardRoutes = require('./routes/dashboard');
const paymentsGatewayRoutes = require('./routes/payments-gateway');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// Redirect authenticated users from / to the app
const jwt = require('jsonwebtoken');
app.get('/', (req, res, next) => {
  const auth = req.headers['authorization'];
  const token = auth && auth.startsWith('Bearer ') ? auth.slice(7) : null;
  if (token) {
    try {
      if (jwt.verify(token, process.env.JWT_SECRET || 'smatic-dev-secret')) {
        return res.redirect('/dashboard.html');
      }
    } catch(e) {}
  }
  next();
});

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
app.use('/api/afip', afipRoutes);
app.use('/api/fiscal', fiscalRoutes);
app.use('/api/onboarding', onboardingRoutes);
app.use('/api/accounts', accountRoutes);
app.use('/api/journal', journalRoutes);
app.use('/api/accounting-reports', accountingReportRoutes);
app.use('/api/warehouses', warehouseRoutes);
app.use('/api/stock', stockRoutes);
app.use('/api/suppliers', supplierRoutes);
app.use('/api/purchases', purchaseRoutes);
app.use('/api/employees', employeeRoutes);
app.use('/api/payroll', payrollRoutes);
app.use('/api/crm', crmRoutes);
app.use('/api/pos', posRoutes);
app.use('/api/projects', projectsRoutes);
app.use('/api/modules', modulesRoutes);
app.use('/api/dashboard', dashboardRoutes);
app.use('/api/payments/gateway', paymentsGatewayRoutes);

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
