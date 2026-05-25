const APP = {
  currentUser: null,
  settings: null,
  lang: {},

  async init() {
    if (!API.isAuthenticated()) return;
    try {
      const user = await API.get('/api/user');
      this.currentUser = user;
      if (user.language) {
        localStorage.setItem('lang', user.language);
      }
      if (user.company && user.company.setup_completed === 0 && !window.location.pathname.includes('onboarding')) {
        window.location.href = '/onboarding.html';
        return;
      }
    } catch (e) { return; }
    try {
      const s = await API.get('/api/settings');
      this.settings = s;
    } catch (e) {}
    await this.loadLang();
    this.initNavigation();
    this.mobileSidebar();
    this.renderNav();
    this.renderCompanyInfo();
  },

  renderCompanyInfo() {
    if (!this.currentUser || !this.currentUser.company) return;
    let el = document.getElementById('company-name');
    if (!el) {
      const brand = document.querySelector('.sidebar-brand');
      if (!brand) return;
      el = document.createElement('span');
      el.className = 'company-name';
      el.id = 'company-name';
      brand.appendChild(el);
    }
    el.textContent = this.currentUser.company.name;
  },

  renderNav() {
    const nav = document.querySelector('#app-nav');
    if (!nav) return;

    const groups = [
      {
        label: null, module: null,
        items: [
          ['dashboard.html', '📊', 'nav_dashboard', 'Panel Principal'],
          ['reports.html', '📈', 'nav_reports', 'Reportes'],
          ['tools.html', '🔧', 'nav_tools', 'Herramientas'],
          ['settings.html', '⚙️', 'nav_settings', 'Configuración'],
          ['admin.html', '⚡', 'nav_admin', 'Administración', 'admin'],
        ]
      },
      {
        label: 'nav_sales', module: 'invoices',
        items: [
          ['customers.html', '👥', 'nav_customers', 'Clientes'],
          ['invoices.html', '📄', 'nav_invoices', 'Facturas'],
          ['quotes.html', '📝', 'nav_quotes', 'Cotizaciones'],
          ['credit-notes.html', '📒', 'nav_credit_notes', 'Notas de Crédito'],
          ['payments.html', '💳', 'nav_payments', 'Pagos'],
          ['refunds.html', '💸', 'nav_refunds', 'Reembolsos'],
          ['items.html', '📦', 'nav_items', 'Productos'],
        ]
      },
      {
        label: 'nav_accounting', module: 'accounting',
        items: [
          ['chart-of-accounts.html', '📋', 'nav_chart_of_accounts', 'Plan de Cuentas'],
          ['journal.html', '📓', 'nav_journal', 'Libro Diario'],
          ['accounting-reports.html', '📊', 'nav_accounting_reports', 'Informes Contables'],
        ]
      },
      {
        label: 'nav_stock', module: 'stock',
        items: [
          ['warehouses.html', '🏭', 'nav_warehouses', 'Depósitos'],
          ['stock-movements.html', '📦', 'nav_stock_movements', 'Movimientos'],
          ['stock-report.html', '📊', 'nav_stock_report', 'Informe de Stock'],
        ]
      },
      {
        label: 'nav_purchases', module: 'purchases',
        items: [
          ['suppliers.html', '🏢', 'nav_suppliers', 'Proveedores'],
          ['purchases.html', '🛒', 'nav_purchases', 'Órdenes de Compra'],
        ]
      },
      {
        label: 'nav_hr', module: 'hr',
        items: [
          ['employees.html', '👔', 'nav_employees', 'Empleados'],
          ['payroll.html', '💰', 'nav_payroll', 'Recibos de Sueldo'],
        ]
      },
      {
        label: 'nav_crm', module: 'crm',
        items: [
          ['crm.html', '👥', 'nav_crm', 'CRM'],
        ]
      },
      {
        label: 'nav_pos', module: 'pos',
        items: [
          ['pos.html', '🛒', 'nav_pos', 'Punto de Venta'],
        ]
      },
      {
        label: 'nav_projects', module: 'projects',
        items: [
          ['projects.html', '📋', 'nav_projects', 'Proyectos'],
        ]
      },
      {
        label: 'nav_modules', module: 'vertical',
        items: [
          ['modules.html', '🧩', 'nav_modules', 'Módulos'],
        ]
      }
    ];

    const path = window.location.pathname;
    let html = '<div class="sidebar-brand"><img src="images/logo.png" alt="Smatic" onerror="this.style.display=\'none\'"><span>Smatic</span></div><ul>';

    for (const group of groups) {
      if (group.label) {
        html += '<li class="nav-header" data-i18n="' + group.label + '">' + group.label + '</li>';
      }
      for (const item of group.items) {
        const href = item[0], icon = item[1], i18n = item[2], text = item[3], role = item[4];
        const isActive = path.includes('/' + href.replace('.html', '')) || path.endsWith('/' + href);
        const mod = group.module || '';
        const cls = 'nav-item' + (isActive ? ' active' : '') + (role ? ' hidden' : '');
        html += '<li class="' + cls + '" data-module="' + mod + '"' + (role ? ' data-role="' + role + '"' : '') + '>';
        html += '<a href="' + href + '"><span class="nav-icon">' + icon + '</span> <span data-i18n="' + i18n + '">' + text + '</span></a>';
        html += '</li>';
      }
    }

    html += '</ul><div class="sidebar-bottom"><a href="#" onclick="API.logout()">🚪 <span data-i18n="nav_logout">Cerrar Sesión</span></a></div>';
    nav.innerHTML = html;
    this.applyModuleVisibility();
    if (this.lang && Object.keys(this.lang).length > 0) this.applyLanguage();
  },

  mobileSidebar() {
    const sidebar = document.querySelector('.navigation-wrapper');
    const hamburger = document.querySelector('.hamburger');
    if (!sidebar || !hamburger) return;
    hamburger.onclick = (e) => {
      e.stopPropagation();
      sidebar.style.display = '';
      sidebar.classList.toggle('open');
    };
    document.addEventListener('click', (e) => {
      if (!sidebar.contains(e.target) && !hamburger.contains(e.target)) {
        sidebar.style.display = '';
        sidebar.classList.remove('open');
      }
    });
  },

  async loadLang() {
    const lang = localStorage.getItem('lang') || CONFIG.defaultLang;
    try {
      const r = await fetch('/locales/' + lang + '.json');
      this.lang = await r.json();
    } catch (e) {
      this.lang = {};
    }
    this.applyLanguage();
  },

  applyLanguage() {
    document.querySelectorAll('[data-i18n]').forEach(el => {
      const key = el.getAttribute('data-i18n');
      const translation = this.t(key, el.innerText || el.textContent);
      if (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA') {
        el.setAttribute('placeholder', translation);
      } else if (el.tagName === 'IMG') {
        el.setAttribute('alt', translation);
      } else {
        el.innerHTML = el.innerHTML.replace(el.innerText, translation);
      }
    });
    document.querySelectorAll('[data-i18n-placeholder]').forEach(el => {
      el.placeholder = this.t(el.getAttribute('data-i18n-placeholder'), el.placeholder);
    });
    document.querySelectorAll('[data-i18n-title]').forEach(el => {
      el.title = this.t(el.getAttribute('data-i18n-title'), el.title);
    });
    document.title = this.t('page_title_' + document.title.toLowerCase().replace(/[^a-z0-9]/g, '_'), document.title);
  },

  t(key, def) {
    return this.lang[key] || def || key;
  },

  initNavigation() {
    document.querySelectorAll('.nav-link').forEach(el => {
      el.addEventListener('click', (e) => {
        e.preventDefault();
        const href = el.getAttribute('href');
        if (href) window.location.href = href;
      });
    });
    this.applyModuleVisibility();
  },

  applyModuleVisibility() {
    const company = this.currentUser && this.currentUser.company;
    if (!company) return;
    let modules;
    try { modules = company.modules_active ? JSON.parse(company.modules_active) : []; } catch(e) { modules = []; }
    document.querySelectorAll('[data-module]').forEach(el => {
      const mod = el.getAttribute('data-module');
      if (el.tagName === 'LI' || el.classList.contains('nav-item')) {
        el.classList.toggle('hidden', modules.length > 0 && mod && !modules.includes(mod));
      }
    });
  },

  showMessage(msg, type) {
    type = type || 'info';
    const bar = document.getElementById('infobar');
    if (!bar) return;
    bar.innerHTML = '<div style="width:80%;margin:0 auto;padding:.2rem 0"><span>' + this.esc(msg) + '</span><span onclick="this.parentElement.parentElement.style.display=\'none\'" style="float:right;cursor:pointer">&times;</span></div>';
    bar.style.display = 'block';
    bar.style.background = type === 'error' ? '#f8d7da' : type === 'success' ? '#d4edda' : '#fff3cd';
    setTimeout(() => { bar.style.display = 'none'; }, 5000);
  },

  esc(str) {
    if (!str) return '';
    return String(str).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
  },
  escAttr(str) {
    if (!str) return '';
    return String(str).replace(/&/g,'&amp;').replace(/"/g,'&quot;').replace(/'/g,'&#39;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
  },

  formatMoney(amount, symbol) {
    symbol = symbol || (this.settings && this.settings.currency_symbol) || CONFIG.currencySymbol;
    return symbol + ' ' + Number(amount || 0).toFixed(2);
  },

  formatDate(dateStr) {
    if (!dateStr) return '';
    const d = new Date(dateStr);
    return d.toLocaleDateString();
  },

  getStatusClass(status) {
    const map = {
      'draft': 'status-draft',
      'sent': 'status-sent',
      'paid': 'status-paid',
      'partial': 'status-partial',
      'overdue': 'status-overdue',
      'cancelled': 'status-cancelled',
      'open': 'status-open',
      'converted': 'status-converted'
    };
    return map[status] || 'status-default';
  },

  getStatusLabel(status) {
    return this.t('status_' + status, status);
  },

  async confirm(title, text, cbYes) {
    const div = document.createElement('div');
    div.style.cssText = 'position:fixed;top:0;left:0;right:0;bottom:0;background:rgba(0,0,0,0.4);z-index:100;display:flex;align-items:center;justify-content:center';
    div.innerHTML = `<div style="background:#fff;padding:2em;border-radius:8px;max-width:400px;box-shadow:0 4px 20px rgba(0,0,0,0.2)">
      <h3 style="margin:0 0 .5em">${this.esc(title)}</h3>
      <p>${this.esc(text)}</p>
      <div style="text-align:right;margin-top:1em">
        <button class="btn btn-secondary" onclick="this.closest('.modal-ov').remove()">${this.t('btn_cancel', 'Cancelar')}</button>
        <button class="btn" onclick="this.closest('.modal-ov').remove();(${cbYes.toString()})()">${this.t('btn_confirm', 'Aceptar')}</button>
      </div>
    </div>`;
    document.body.appendChild(div);
  },

  modal(html, title) {
    const div = document.createElement('div');
    div.className = 'modal-ov';
    div.style.cssText = 'position:fixed;top:0;left:0;right:0;bottom:0;background:rgba(0,0,0,0.4);z-index:100;display:flex;align-items:center;justify-content:center;overflow-y:auto';
    div.innerHTML = `<div style="background:#fff;margin:2em;padding:2em;border-radius:8px;max-width:600px;width:90%;box-shadow:0 4px 20px rgba(0,0,0,0.2);position:relative">
      ${title ? '<h2 style="margin:0 0 1em;color:' + CONFIG.secondaryColor + '">' + this.esc(title) + '</h2>' : ''}
      <span onclick="this.closest('.modal-ov').remove()" style="position:absolute;top:1em;right:1em;font-size:1.5em;cursor:pointer;color:#999">&times;</span>
      ${html}
    </div>`;
    document.body.appendChild(div);
    return div.querySelector('.modal-content') || div;
  }
};

document.addEventListener('DOMContentLoaded', () => APP.init());
