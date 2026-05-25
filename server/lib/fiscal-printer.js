const net = require('net');

class FiscalPrinter {
  constructor(opts = {}) {
    this.type = opts.type || 'hasar';
    this.host = opts.host || '127.0.0.1';
    this.port = opts.port || 9100;
    this.timeout = opts.timeout || 5000;
    this._buffer = null;
  }

  _connect() {
    return new Promise((resolve, reject) => {
      const sock = new net.Socket();
      sock.setTimeout(this.timeout);
      sock.connect(this.port, this.host, () => {
        sock.setTimeout(0);
        resolve(sock);
      });
      sock.on('error', reject);
      sock.on('timeout', () => { sock.destroy(); reject(new Error('Connection timeout')); });
    });
  }

  _send(sock, data) {
    return new Promise((resolve, reject) => {
      sock.write(data);
      let buffer = '';
      sock.on('data', chunk => {
        buffer += chunk.toString();
        if (buffer.includes('\x03') || buffer.length > 10) {
          sock.destroy();
          resolve(buffer);
        }
      });
      sock.on('error', reject);
      setTimeout(() => { sock.destroy(); resolve(buffer); }, this.timeout);
    });
  }

  async _cmdHasar(command) {
    const sock = await this._connect();
    const checksum = command.split('').reduce((s, c) => s + c.charCodeAt(0), 0) % 256;
    const msg = '\x02' + command + '\x03' + String.fromCharCode(checksum);
    const res = await this._send(sock, msg);
    return res;
  }

  async _cmdEpson(command) {
    const sock = await this._connect();
    const res = await this._send(sock, command);
    return res;
  }

  async openReceipt(type) {
    if (this.type === 'hasar') {
      const cmd = type === 'credit' ? 'a' : type === 'debit' ? 'A' : 'a';
      return await this._cmdHasar(cmd);
    }
    if (this.type === 'epson') {
      const cmd = Buffer.from([0x1B, 0x40]);
      return await this._cmdEpson(cmd);
    }
  }

  async printLine(text, opts = {}) {
    const qty = opts.quantity || 1;
    const price = opts.price || 0;
    const iva = opts.iva || 'I';
    if (this.type === 'hasar') {
      const line = `${text.substring(0, 40)}\t${qty}\t${price.toFixed(2)}\t${iva}\r`;
      return await this._cmdHasar(line);
    }
    if (this.type === 'epson') {
      const line = text.substring(0, 40) + '\n';
      const cmd = Buffer.concat([Buffer.from(line), Buffer.from([0x0A])]);
      return await this._cmdEpson(cmd);
    }
  }

  async printSubtotal() {
    if (this.type === 'hasar') return await this._cmdHasar('S\r');
    if (this.type === 'epson') return await this._cmdEpson(Buffer.from([0x1B, 0x76]));
  }

  async closeReceipt(total, paymentType) {
    const payType = paymentType || 'E';
    if (this.type === 'hasar') {
      return await this._cmdHasar(`T${total.toFixed(2)}\t${payType}\r`);
    }
    if (this.type === 'epson') {
      const cmd = Buffer.concat([Buffer.from('TOTAL: $' + total.toFixed(2) + '\n'), Buffer.from([0x1B, 0x69])]);
      return await this._cmdEpson(cmd);
    }
  }

  async dailyClose(type) {
    if (this.type === 'hasar') {
      const cmd = type === 'X' ? '5\x01\r' : '5\x02\r';
      return await this._cmdHasar(cmd);
    }
    if (this.type === 'epson') {
      return await this._cmdEpson(Buffer.from([0x1B, 0x44]));
    }
  }

  async openDrawer() {
    if (this.type === 'hasar') {
      return await this._cmdHasar('h\r');
    }
    if (this.type === 'epson') {
      return await this._cmdEpson(Buffer.from([0x1B, 0x70, 0x00, 0x19, 0xFA]));
    }
  }

  async getStatus() {
    if (this.type === 'hasar') {
      const res = await this._cmdHasar('w\r');
      return { raw: res, online: res.length > 0 };
    }
    if (this.type === 'epson') {
      try { await this._cmdEpson(Buffer.from([0x10, 0x04, 0x01])); return { online: true }; }
      catch (e) { return { online: false, error: e.message }; }
    }
    return { online: false };
  }

  async testConnection() {
    try {
      const status = await this.getStatus();
      return { success: status.online, ...status };
    } catch (e) {
      return { success: false, error: e.message };
    }
  }

  async printInvoice(invoice) {
    const lines = [];

    if (invoice.business_name) lines.push(invoice.business_name);
    if (invoice.cuit) lines.push('CUIT: ' + invoice.cuit);
    if (invoice.address) lines.push(invoice.address);

    lines.push('');
    lines.push('FACTURA ' + invoice.invoice_number);
    lines.push('Fecha: ' + invoice.date);
    lines.push('Cliente: ' + invoice.customer_name);
    if (invoice.customer_doc) lines.push('Doc: ' + invoice.customer_doc);
    lines.push('');

    for (const item of (invoice.items || [])) {
      const desc = item.description || item.item_code || '';
      const qty = item.quantity || 1;
      const price = item.unit_price || 0;
      lines.push({ text: desc, qty, price });
    }

    lines.push('');
    lines.push('Subtotal: $' + (invoice.subtotal || 0).toFixed(2));
    lines.push('IVA: $' + (invoice.tax_total || 0).toFixed(2));
    lines.push('TOTAL: $' + (invoice.total || 0).toFixed(2));

    if (invoice.cae) {
      lines.push('');
      lines.push('CAE: ' + invoice.cae);
      lines.push('Vto CAE: ' + invoice.cae_vencimiento);
    }

    await this.openReceipt('credit');
    for (const line of lines) {
      if (typeof line === 'string') {
        if (line.startsWith('TOTAL:')) await this.printSubtotal();
        await this.printLine(line);
      } else {
        await this.printLine(line.text, { quantity: line.qty, price: line.price, iva: 'I' });
      }
    }
    await this.closeReceipt(invoice.total || 0, 'E');
    await this.openDrawer();
  }
}

module.exports = { FiscalPrinter };
