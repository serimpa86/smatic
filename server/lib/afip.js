const axios = require('axios');
const crypto = require('crypto');
const https = require('https');

const WSDL = {
  wsaa: {
    homo: 'https://wsaahomo.afip.gov.ar/ws/services/LoginCms?wsdl',
    prod: 'https://wsaa.afip.gov.ar/ws/services/LoginCms?wsdl'
  },
  wsfe: {
    homo: 'https://wswhomo.afip.gov.ar/wsfe/service.asmx',
    prod: 'https://servicios1.afip.gov.ar/wsfe/service.asmx'
  },
  wsmtxca: {
    homo: 'https://wswhomo.afip.gov.ar/wsmtxca/services/MTXCAService',
    prod: 'https://servicios1.afip.gov.ar/wsmtxca/services/MTXCAService'
  }
};

const TAX_CATEGORIES = {
  'responsable_inscripto': { code: 1, name: 'IVA Responsable Inscripto' },
  'responsable_monotributo': { code: 6, name: 'Monotributista' },
  'exento': { code: 4, name: 'IVA Exento' },
  'consumidor_final': { code: 5, name: 'Consumidor Final' },
  'no_responsable': { code: 8, name: 'IVA No Responsable' },
  'sujeto_no_categorizado': { code: 12, name: 'Sujeto No Categorizado' }
};

const VAT_TYPES = {
  '0': 3, '10.5': 4, '21': 5, '27': 6, '5': 8, '2.5': 9
};

function soapEnvelope(body) {
  return `<?xml version="1.0" encoding="UTF-8"?>
<soap:Envelope xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xmlns:xsd="http://www.w3.org/2001/XMLSchema">
<soap:Body>${body}</soap:Body>
</soap:Envelope>`;
}

function parseXML(xml) {
  const obj = {};
  const stack = [obj];
  let current = obj;
  xml.replace(/<(\/?)(\w+)[^>]*>/g, (match, close, tag) => {
    if (close) { stack.pop(); current = stack[stack.length - 1]; }
    else {
      const next = {};
      if (Array.isArray(current[tag])) current[tag].push(next);
      else if (current[tag]) current[tag] = [current[tag], next];
      else current[tag] = next;
      stack.push(next);
      current = next;
    }
    return '';
  });
  xml.replace(/>([^<]+)<\/\w+>/g, (match, val) => { current._text = val; return ''; });
  function tidy(o) {
    if (o && o._text !== undefined) return o._text;
    if (Array.isArray(o)) return o.map(tidy);
    if (o && typeof o === 'object') { const r = {}; for (const k of Object.keys(o)) r[k] = tidy(o[k]); return r; }
    return o;
  }
  return tidy(obj);
}

class AFIPClient {
  constructor(opts = {}) {
    this.env = opts.env || 'testing';
    this.cuit = opts.cuit || '';
    this.cert = opts.cert || '';
    this.key = opts.key || '';
    this.pointOfSale = opts.pointOfSale || '0001';
    this.token = null;
    this.sign = null;
    this.tokenExpiration = null;
    this._agent = new https.Agent({ rejectUnauthorized: false });
  }

  isTesting() { return this.env !== 'production'; }

  _getUrl(service) {
    const env = this.isTesting() ? 'homo' : 'prod';
    return WSDL[service][env];
  }

  _buildLoginCMS() {
    const now = new Date();
    const exp = new Date(now.getTime() + 600 * 1000);
    const xml = `<?xml version="1.0" encoding="UTF-8"?>
<loginTicketRequest version="1.0">
  <header>
    <uniqueId>${now.getTime()}</uniqueId>
    <generationTime>${now.toISOString()}</generationTime>
    <expirationTime>${exp.toISOString()}</expirationTime>
  </header>
  <service>wsfe</service>
</loginTicketRequest>`;
    try {
      const sign = crypto.createSign('SHA1');
      sign.update(xml);
      sign.end();
      const signature = sign.sign(this.key, 'base64');
      const certB64 = this.cert.replace(/-----[^-]+-----/g, '').replace(/\s/g, '');
      const cms = `MII${Buffer.from(xml + signature + certB64).toString('base64')}`;
      return cms;
    } catch (e) {
      throw new Error('Error building login CMS: ' + e.message);
    }
  }

  async login() {
    const cms = this._buildLoginCMS();
    const body = soapEnvelope(`<loginCms xmlns="http://wsaa.view.sua.dvadac.desein.afip.gov.ar"><in0>${cms}</in0></loginCms>`);
    try {
      const res = await axios.post(this._getUrl('wsaa'), body, {
        headers: { 'Content-Type': 'text/xml; charset=utf-8', 'SOAPAction': '' },
        httpsAgent: this._agent,
        timeout: 30000
      });
      const match = res.data.match(/<credentials>(.*?)<\/credentials>/s);
      if (!match) throw new Error('No credentials in WSAA response');
      const creds = match[1];
      const tokenMatch = creds.match(/<token>(.*?)<\/token>/);
      const signMatch = creds.match(/<sign>(.*?)<\/sign>/);
      const expMatch = creds.match(/<expirationTime>(.*?)<\/expirationTime>/);
      if (!tokenMatch || !signMatch) throw new Error('Failed to parse WSAA response');
      this.token = tokenMatch[1];
      this.sign = signMatch[1];
      this.tokenExpiration = expMatch ? new Date(expMatch[1]) : new Date(Date.now() + 12 * 3600 * 1000);
      return { token: this.token, sign: this.sign };
    } catch (e) {
      throw new Error('WSAA login failed: ' + (e.response?.data || e.message));
    }
  }

  async _ensureToken() {
    if (!this.token || !this.tokenExpiration || new Date() >= this.tokenExpiration) {
      await this.login();
    }
  }

  async _callWSFE(soapAction, xmlBody) {
    await this._ensureToken();
    const body = soapEnvelope(xmlBody);
    const res = await axios.post(this._getUrl('wsfe'), body, {
      headers: {
        'Content-Type': 'text/xml; charset=utf-8',
        'SOAPAction': `http://ar.gov.afip.dif.FEV1/${soapAction}`
      },
      httpsAgent: this._agent,
      timeout: 30000
    });
    return res.data;
  }

  async getLastInvoiceNumber() {
    const xml = `<FEParamGetPtosVentaRequest xmlns="http://ar.gov.afip.dif.FEV1/">
      <Auth><Token>${this.token}</Token><Sign>${this.sign}</Sign><Cuit>${this.cuit}</Cuit></Auth>
      </FEParamGetPtosVentaRequest>`;
    const data = await this._callWSFE('FEParamGetPtosVenta', xml);
    const match = data.match(/<CBteTipo>(\d+)<\/CBteTipo>[\s\S]*?<Nro>(\d+)<\/Nro>/);
    return match ? match[2] : '0001';
  }

  async getLastAutorizedInvoiceNumber(pointOfSale, type) {
    const xml = `<FECompUltimoAutorizadoRequest xmlns="http://ar.gov.afip.dif.FEV1/">
      <Auth><Token>${this.token}</Token><Sign>${this.sign}</Sign><Cuit>${this.cuit}</Cuit></Auth>
      <PtoVta>${parseInt(pointOfSale)}</PtoVta><CbteTipo>${type}</CbteTipo>
      </FECompUltimoAutorizadoRequest>`;
    const data = await this._callWSFE('FECompUltimoAutorizado', xml);
    const match = data.match(/<CbteNro>(\d+)<\/CbteNro>/);
    return match ? parseInt(match[1]) : 0;
  }

  async requestInvoice(invoiceData) {
    const tipoComp = invoiceData.invoiceType || 1;
    const ptoVta = parseInt(this.pointOfSale);
    const ultimo = await this.getLastAutorizedInvoiceNumber(this.pointOfSale, tipoComp);
    const cbteNro = ultimo + 1;

    const docTipo = TAX_CATEGORIES[invoiceData.buyerCategory]?.code || 80;
    const docNro = invoiceData.buyerDoc || '00000000000';

    const ivaIds = [];
    for (const tax of (invoiceData.taxes || [])) {
      const rate = parseFloat(tax.rate);
      ivaIds.push({ Id: VAT_TYPES[String(rate)] || 5, BaseImp: tax.base || 0, Importe: tax.amount || 0 });
    }

    const itemsXml = (invoiceData.items || []).map((item, i) =>
      `<FECAEDetRequest>
        <Concepto>1</Concepto>
        <DocTipo>${docTipo}</DocTipo>
        <DocNro>${docNro}</DocNro>
        <CbteDesde>${cbteNro}</CbteDesde>
        <CbteHasta>${cbteNro}</CbteHasta>
        <CbteFch>${invoiceData.date.replace(/-/g, '')}</CbteFch>
        <ImpTotal>${item.total.toFixed(2)}</ImpTotal>
        <ImpTotConc>0.00</ImpTotConc>
        <ImpNeto>${(item.subtotal || item.total).toFixed(2)}</ImpNeto>
        <ImpOpEx>0.00</ImpOpEx>
        <ImpTrib>${(item.taxes || 0).toFixed(2)}</ImpTrib>
        <ImpIVA>${(item.iva || 0).toFixed(2)}</ImpIVA>
        <MonId>${invoiceData.currency === 'USD' ? 'DOL' : 'PES'}</MonId>
        <MonCotiz>${invoiceData.currency === 'USD' ? (invoiceData.exchangeRate || 1) : 1}</MonCotiz>
        ${ivaIds.length > 0 ? `<Iva>${ivaIds.map(iv => `<AlicIva><Id>${iv.Id}</Id><BaseImp>${iv.BaseImp.toFixed(2)}</BaseImp><Importe>${iv.Importe.toFixed(2)}</Importe></AlicIva>`).join('')}</Iva>` : ''}
      </FECAEDetRequest>`
    ).join('');

    const xml = `<FECAESolicitarRequest xmlns="http://ar.gov.afip.dif.FEV1/">
      <Auth><Token>${this.token}</Token><Sign>${this.sign}</Sign><Cuit>${this.cuit}</Cuit></Auth>
      <FeCAEReq>
        <FeCabReq><CantReg>${invoiceData.items.length}</CantReg><PtoVta>${ptoVta}</PtoVta><CbteTipo>${tipoComp}</CbteTipo></FeCabReq>
        <FeDetReq>${itemsXml}</FeDetReq>
      </FeCAEReq>
      </FECAESolicitarRequest>`;

    const data = await this._callWSFE('FECAESolicitar', xml);

    const caeMatch = data.match(/<CAE>(\d+)<\/CAE>/);
    const vencMatch = data.match(/<Vencimiento>(\d+)<\/Vencimiento>/);
    const obsMatch = data.match(/<Observaciones>([\s\S]*?)<\/Observaciones>/);
    const errMatch = data.match(/<ErrCode>(\d+)<\/ErrCode>[\s\S]*?<ErrMsg>(.*?)<\/ErrMsg>/);
    const resultMatch = data.match(/<Resultado>(A|R)<\/Resultado>/);

    if (errMatch) throw new Error(`AFIP Error ${errMatch[1]}: ${errMatch[2]}`);

    if (resultMatch && resultMatch[1] === 'R') {
      throw new Error('AFIP rechazó la factura. ' + (obsMatch ? obsMatch[1] : ''));
    }

    return {
      cae: caeMatch ? caeMatch[1] : null,
      vencimiento: vencMatch ? vencMatch[1] : null,
      numero: cbteNro,
      resultado: resultMatch ? resultMatch[1] : null,
      observaciones: obsMatch ? obsMatch[1].trim() : ''
    };
  }

  async consultInvoice(cbteTipo, ptoVta, cbteNro) {
    await this._ensureToken();
    const xml = `<FECompConsultarRequest xmlns="http://ar.gov.afip.dif.FEV1/">
      <Auth><Token>${this.token}</Token><Sign>${this.sign}</Sign><Cuit>${this.cuit}</Cuit></Auth>
      <FeCompConsReq><CbteTipo>${cbteTipo}</CbteTipo><CbteNro>${cbteNro}</CbteNro><PtoVta>${ptoVta}</PtoVta></FeCompConsReq>
      </FECompConsultarRequest>`;
    const data = await this._callWSFE('FECompConsultar', xml);
    const caeMatch = data.match(/<CAE>(\d+)<\/CAE>/);
    const resMatch = data.match(/<Resultado>(.*?)<\/Resultado>/);
    return { cae: caeMatch ? caeMatch[1] : null, resultado: resMatch ? resMatch[1] : null };
  }

  async getTaxCreditCertificates(fechaDesde, fechaHasta) {
    await this._ensureToken();
    const xml = soapEnvelope(`<consultarComprobantesRequest xmlns="http://impl.servicios.mtxca.afip.gov.ar/">
      <authRequest><token>${this.token}</token><sign>${this.sign}</sign><cuitRepresentada>${this.cuit}</cuitRepresentada></authRequest>
      <fechaDesde>${fechaDesde}</fechaDesde><fechaHasta>${fechaHasta}</fechaHasta>
      </consultarComprobantesRequest>`);
    const res = await axios.post(this._getUrl('wsmtxca'), xml, {
      headers: { 'Content-Type': 'text/xml; charset=utf-8', 'SOAPAction': '' },
      httpsAgent: this._agent, timeout: 30000
    });
    return res.data;
  }

  async testConnection() {
    try {
      await this.login();
      const pv = await this.getLastInvoiceNumber();
      return { success: true, pointOfSale: pv, env: this.env };
    } catch (e) {
      return { success: false, error: e.message };
    }
  }
}

module.exports = { AFIPClient, TAX_CATEGORIES, VAT_TYPES, WSDL };
