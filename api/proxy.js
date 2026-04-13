const https = require('https');
const qs = require('querystring');

const WAY2_HOST = 'pim.way2.com.br';
const USERNAME  = 'leandro.souzagna';
const PASSWORD  = 'Mudar@2026';
const SESSION_TTL = 18 * 60 * 1000;

let jar = {};
let lastLogin = 0;

function makeReq(opts, body) {
  return new Promise((resolve, reject) => {
    const r = https.request(opts, res => {
      const chunks = [];
      res.on('data', c => chunks.push(c));
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: Buffer.concat(chunks).toString('utf8') }));
    });
    r.on('error', reject);
    r.setTimeout(12000, () => { r.destroy(); reject(new Error('timeout')); });
    if (body) r.write(body);
    r.end();
  });
}

function jarStr() {
  return Object.entries(jar).map(([k,v]) => `${k}=${v}`).join('; ');
}

function eatCookies(headers) {
  const raw = headers['set-cookie'];
  if (!raw) return;
  (Array.isArray(raw) ? raw : [raw]).forEach(c => {
    const m = c.match(/^([^=]+)=([^;]*)/);
    if (m && m[2]) jar[m[1].trim()] = m[2].trim();
  });
}

async function followRedirects(path, maxHops = 5) {
  let cur = path;
  for (let i = 0; i < maxHops; i++) {
    const r = await makeReq({
      hostname: WAY2_HOST, path: cur, method: 'GET',
      headers: { 'Cookie': jarStr(), 'User-Agent': 'Mozilla/5.0', 'Accept': 'text/html,*/*' }
    });
    eatCookies(r.headers);
    if (r.status === 301 || r.status === 302 || r.status === 303) {
      const loc = r.headers.location || '';
      cur = loc.startsWith('http') ? new URL(loc).pathname + (new URL(loc).search || '') : loc;
    } else { return r; }
  }
}

async function login() {
  jar = {};
  const g = await makeReq({
    hostname: WAY2_HOST, path: '/login', method: 'GET',
    headers: { 'User-Agent': 'Mozilla/5.0', 'Accept': 'text/html,*/*', 'Accept-Language': 'pt-BR,pt;q=0.9' }
  });
  eatCookies(g.headers);

  let token = '';
  for (const p of [/name="__RequestVerificationToken"[^>]*value="([^"]+)"/, /name="_token"[^>]*value="([^"]+)"/]) {
    const m = g.body.match(p); if (m) { token = m[1]; break; }
  }

  const fields = { username: USERNAME, password: PASSWORD };
  if (token) fields['__RequestVerificationToken'] = token;
  const body = qs.stringify(fields);

  const p = await makeReq({
    hostname: WAY2_HOST, path: '/login', method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      'Content-Length': Buffer.byteLength(body),
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
      'Accept': 'text/html,application/xhtml+xml,*/*;q=0.9',
      'Accept-Language': 'pt-BR,pt;q=0.9',
      'Referer': `https://${WAY2_HOST}/login`,
      'Origin': `https://${WAY2_HOST}`,
      'Cookie': jarStr(),
    }
  }, body);
  eatCookies(p.headers);

  if (p.headers.location) {
    const loc = p.headers.location;
    const path = loc.startsWith('http') ? new URL(loc).pathname + (new URL(loc).search || '') : loc;
    await followRedirects(path);
  }

  const ok = Object.keys(jar).some(k => k.toLowerCase().includes('auth') || k.toLowerCase().includes('session'));
  if (ok) { lastLogin = Date.now(); console.log('[Login] OK! Cookies:', Object.keys(jar)); return true; }
  console.error('[Login] Falhou. Cookies:', Object.keys(jar));
  return false;
}

async function ensureSession() {
  if (Object.keys(jar).length > 0 && Date.now() - lastLogin < SESSION_TTL) return true;
  return login();
}

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') { res.status(204).end(); return; }

  const url = new URL(req.url, `https://${req.headers.host}`);
  const way2path = url.searchParams.get('path');

  if (!way2path || way2path === 'status') {
    const ok = await ensureSession();
    res.status(200).json({ ok, user: USERNAME, cookies: Object.keys(jar), ts: new Date().toISOString() });
    return;
  }

  try {
    await ensureSession();
    const r = await makeReq({
      hostname: WAY2_HOST, path: '/' + way2path, method: 'GET',
      headers: {
        'Cookie': jarStr(),
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)',
        'Accept': 'application/json, text/html, */*',
        'Referer': `https://${WAY2_HOST}/`,
        'X-Requested-With': 'XMLHttpRequest',
      }
    });
    eatCookies(r.headers);
    if (r.status === 401 || (r.status === 302 && (r.headers.location || '').includes('login'))) {
      jar = {}; lastLogin = 0; await login();
    }
    res.status(r.status).setHeader('Content-Type', 'application/json').send(r.body);
  } catch(e) {
    res.status(500).json({ error: e.message });
  }
};
