const jwt = require('jsonwebtoken');
const { getDb } = require('../database');

const JWT_SECRET = process.env.JWT_SECRET || 'billing-system-secret-key-change-in-production';

function generateToken(userId, role) {
  return jwt.sign({ userId, role }, JWT_SECRET, { expiresIn: '24h' });
}

function authenticateToken(req, res, next) {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];
  if (!token) return res.status(401).json({ errorcode: 401, errormsg: 'Authentication required' });

  jwt.verify(token, JWT_SECRET, (err, decoded) => {
    if (err) return res.status(401).json({ errorcode: 401, errormsg: 'Invalid or expired token' });
    req.userId = decoded.userId;
    req.userRole = decoded.role || 'user';
    req.isSuperadmin = req.userRole === 'superadmin';
    try { const u = getDb().get('SELECT company_id FROM users WHERE id = ?', [req.userId]); req.companyId = u ? u.company_id : null; } catch(e) { req.companyId = null; }
    next();
  });
}

function requireRole(...roles) {
  return (req, res, next) => {
    if (!req.userRole || !roles.includes(req.userRole)) {
      return res.status(403).json({ errorcode: 403, errormsg: 'Forbidden: insufficient permissions' });
    }
    next();
  };
}

function optionalAuth(req, res, next) {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];
  if (!token) { req.userId = null; req.userRole = null; return next(); }
  jwt.verify(token, JWT_SECRET, (err, decoded) => {
    req.userId = err ? null : decoded.userId;
    req.userRole = err ? null : (decoded.role || 'user');
    if (req.userId) { try { const u = getDb().get('SELECT company_id FROM users WHERE id = ?', [req.userId]); req.companyId = u ? u.company_id : null; } catch(e) { req.companyId = null; } }
    next();
  });
}

module.exports = { generateToken, authenticateToken, optionalAuth, requireRole, JWT_SECRET };
