const https = require('https');
const qs = require('querystring');

const WAY2_HOST = 'pim.way2.com.br';
const USERNAME  = 'leandro.souzagna';
const PASSWORD  = 'Mudar@2026';
const SESSION_TTL = 20 * 60 * 1000;

let sessionCookies = '';
let lastLogin = 0;

function httpsReq(options, body = null) {
  return new Promise((resolve, reject) => {
    const req = https.request(options, res => {
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: data }));
    });
    req.on('error', reject);
    if (body) req.write(body);
    req.end();
  });
}

function parseCookies(setCookie) {
  if (!setCookie) return '';
  const arr = Array.isArray(setCookie) ? setCookie : [setCookie];
  return arr.map(c => c.split(';')[0]).join('; ');
}

async function login() {
  console.log('[Auth] Fazendo login em', WAY2_HOST, 'com usuário', USERNAME);
  const body = qs.stringify({ username: USERNAME, password: PASSWORD });
  try {
    const r = await httpsReq({
      hostname: WAY2_HOST, path: '/login', method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'Content-Length': Buffer.byteLength(body),
        'User-Agent': 'Mozilla/5.0',
        'Accept': 'text/html,*/*',
      }
    }, body);
    const cookies = parseCookies(r.headers['set-cookie']);
    if (cookies) {
      sessionCookies = cookies;
      lastLogin = Date.now();
      console.log('[Auth] Login OK! Status:', r.status);
      return true;
    }
    if (r.status >= 301 && r.status <= 303) {
      const c2 = parseCookies(r.headers['set-cookie']);
      if (c2) { sessionCookies = c2; lastLogin = Date.now(); return true; }
    }
  } catch(e) {
    console.error('[Auth] Erro form login:', e.message);
  }
  try {
    const jbody = JSON.stringify({ username: USERNAME, password: PASSWORD });
    const r2 = await httpsReq({
      hostname: WAY2_HOST, path: '/api/login', method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(jbody),
        'User-Agent': 'Mozilla/5.0',
      }
    }, jbody);
    const c2 = parseCookies(r2.headers['set-cookie']);
    let payload = {};
    try { payload = JSON.parse(r2.body); } catch {}
    const token = payload.token || payload.access_token || '';
    if (c2 || token) {
      sessionCookies = c2 || `token=${token}`;
      lastLogin = Date.now();
      console.log('[Auth] Login OK via JSON!');
      return true;
    }
  } catch(e) {
    console.error('[Auth] Erro JSON login:', e.message);
  }
  console.error('[Auth] Login falhou!');
  return false;
}

async function ensureSession() {
  if (sessionCookies && Date.now() - lastLogin < SESSION_TTL) return true;
  return await login();
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
    res.status(200).json({ ok, user: USERNAME, session: !!sessionCookies });
    return;
  }

  try {
    const ok = await ensureSession();
    if (!ok) { res.status(401).json({ error: 'Login na Way2 falhou' }); return; }

    const r = await httpsReq({
      hostname: WAY2_HOST,
      path: '/' + way2path,
      method: 'GET',
      headers: {
        'Cookie': sessionCookies,
        'User-Agent': 'Mozilla/5.0',
        'Accept': 'application/json, */*',
      }
    });

    const nc = parseCookies(r.headers['set-cookie']);
    if (nc) { sessionCookies = nc; lastLogin = Date.now(); }
    if (r.status === 401 || r.status === 403) { sessionCookies = ''; lastLogin = 0; }

    res.status(r.status).setHeader('Content-Type', 'application/json').send(r.body);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
};
