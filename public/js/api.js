const API = {
  _token: localStorage.getItem('token'),

  setToken(token) {
    this._token = token;
    if (token) localStorage.setItem('token', token);
    else localStorage.removeItem('token');
  },

  _headers() {
    const h = { 'Content-Type': 'application/json' };
    if (this._token) h['Authorization'] = 'Bearer ' + this._token;
    return h;
  },

  async get(url) {
    const r = await fetch(url, { headers: this._headers() });
    return r.json();
  },

  async post(url, data) {
    const r = await fetch(url, {
      method: 'POST',
      headers: this._headers(),
      body: JSON.stringify(data)
    });
    return r.json();
  },

  async put(url, data) {
    const r = await fetch(url, {
      method: 'PUT',
      headers: this._headers(),
      body: JSON.stringify(data)
    });
    return r.json();
  },

  async upload(url, formData) {
    const headers = {};
    if (this._token) headers['Authorization'] = 'Bearer ' + this._token;
    const r = await fetch(url, { method: 'POST', headers, body: formData });
    return r.json();
  },

  async del(url) {
    const r = await fetch(url, {
      method: 'DELETE',
      headers: this._headers()
    });
    return r.json();
  },

  async login(email, password) {
    const r = await this.post('/login', { email, password });
    if (r.token) { this.setToken(r.token); }
    return r;
  },

  async signup(email, password, name) {
    const r = await this.post('/signup', { email, password, name });
    if (r.token) { this.setToken(r.token); }
    return r;
  },

  logout() {
    this.setToken(null);
    window.location.href = '/login.html';
  },

  async validateEmail(email) {
    return this.post('/lloginemailvalidate', { email });
  },

  isAuthenticated() {
    return !!this._token;
  }
};
