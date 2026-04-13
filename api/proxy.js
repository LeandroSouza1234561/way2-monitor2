const https = require('https');
const qs = require('querystring');

const WAY2_HOST = 'pim.way2.com.br';
const USERNAME  = 'leandro.souzagna';
const PASSWORD  = 'Mudar@2026';
const SESSION_TTL = 20 * 60 * 1000;

let jar = {};
let lastLogin = 0;

function req(opts, body) {
  return new Promise((resolve, reject) => {
    const r = https.request(opts, res => {
      const chunks = [];
      res.on('data', c => chunks.push(c));
      res.on('end', () => resolve({
        status: res.statusCode,
        headers: res.headers,
        body: Buffer.concat(chunks).toString('utf8')
      }));
    });
    r.on('error', reject);
    r.setTimeout(12000, () => { r.destroy(); reject(new Error('timeout')); });
    if (body) r.write(body);
    r.end();
  });
}

function cookieStr() {
  return Object.entries(jar).map(([k,v]) => `${k}=${v}`).join('; ');
}

function parseCookies(h) {
  const raw = h['set-cookie'];
  if (!raw) return;
  (Array.isArray(raw) ? raw : [raw]).forEach(c => {
    const m = c.match(/^([^=]+)=([^;]*)/);
    if (m) jar[m[1].trim()] = m[2].trim();
  });
}

async function login() {
  console.log('[Login] Iniciando...');
  jar = {};

  // 1) GET /login para pegar cookies iniciais e token CSRF
  const g = await req({
    hostname: WAY2_HOST, path: '/login', method: 'GET',
    headers: { 'User-Agent': 'Mozilla/5.0', 'Accept': 'text/html,*/*', 'Accept-Language': 'pt-BR,pt;q=0.9' }
  });
  parseCookies(g.headers);

  // Extrai token CSRF do HTML (vários formatos possíveis)
  let token = '';
  const patterns = [
    /name="__RequestVerificationToken"[^>]*value="([^"]+)"/,
    /name="_token"[^>]*value="([^"]+)"/,
    /"token":"([^"]+)"/,
    /AntiForgery[^"]*"([A-Za-z0-9+/=_-]{20,})"/,
  ];
  for (const p of patterns) {
    const m = g.body.match(p);
    if (m) { token = m[1]; break; }
  }
  console.log('[Login] GET status:', g.status, '| CSRF:', token ? 'sim' : 'não', '| Cookies:', Object.keys(jar));

  // 2) POST /login
  const fields = { username: USERNAME, password: PASSWORD };
  if (token) fields['__RequestVerificationToken'] = token;
  const body = qs.stringify(fields);

  const p = await req({
    hostname: WAY2_HOST, path: '/login', method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      'Content-Length': Buffer.byteLength(body),
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120',
      'Accept': 'text/html,application/xhtml+xml,*/*',
      'Accept-Language': 'pt-BR,pt;q=0.9',
      'Referer': `https://${WAY2_HOST}/login`,
      'Origin': `https://${WAY2_HOST}`,
      'Cookie': cookieStr(),
    }
  }, body);
  parseCookies(p.headers);

  console.log('[Login] POST status:', p.status, '| Location:', p.headers.location || '-', '| Cookies:', Object.keys(jar));

  // Sucesso = redirect para dashboard (302/301) ou tem cookie de auth
  const hasAuth = Object.keys(jar).some(k => k.toLowerCase().includes('auth') || k.toLowerCase().includes('session'));
  const redirectOk = p.headers.location && !p.headers.location.includes('/login');

  if (hasAuth || redirectOk || p.status === 302) {
    // Segue redirect se necessário
    if (p.headers.location) {
      const loc = p.headers.location.startsWith('http') ? new URL(p.headers.location) : null;
      const path = loc ? loc.pathname + (loc.search || '') : p.headers.location;
      const f = await req({
        hostname: WAY2_HOST, path, method: 'GET',
        headers: { 'Cookie': cookieStr(), 'User-Agent': 'Mozilla/5.0', 'Accept': 'text/html,*/*' }
      });
      parseCookies(f.headers);
      console.log('[Login] Follow redirect:', path, f.status);
    }
    lastLogin = Date.now();
    console.log('[Login] OK! Cookies:', Object.keys(jar));
    return true;
  }

  console.error('[Login] Falhou. Body preview:', p.body.substring(0, 300));
  return false;
}

async function ensureSession() {
  if (Object.keys(jar).length > 0 && Date.now() - lastLogin < SESSION_TTL) return true;
  return login();
}

module.exports = async (req2, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req2.method === 'OPTIONS') { res.status(204).end(); return; }

  const url = new URL(req2.url, `https://${req2.headers.host}`);
  const way2path = url.searchParams.get('path');

  if (!way2path || way2path === 'status') {
    const ok = await ensureSession();
    res.status(200).json({ ok, user: USERNAME, cookies: Object.keys(jar), ts: new Date().toISOString() });
    return;
  }

  try {
    await ensureSession();
    const r = await req({
      hostname: WAY2_HOST, path: '/' + way2path, method: 'GET',
      headers: {
        'Cookie': cookieStr(),
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)',
        'Accept': 'application/json, text/html, */*',
        'Referer': `https://${WAY2_HOST}/`,
        'X-Requested-With': 'XMLHttpRequest',
      }
    });
    parseCookies(r.headers);
    if (r.status === 401 || r.status === 302) {
      jar = {}; lastLogin = 0;
      await login();
    }
    res.status(r.status).setHeader('Content-Type', 'application/json').send(r.body);
  } catch(e) {
    res.status(500).json({ error: e.message });
  }
};
