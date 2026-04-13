const https = require('https');
const qs    = require('querystring');

const WAY2_HOST = 'pim.way2.com.br';
const USERNAME  = 'leandro.souzagna';
const PASSWORD  = 'Mudar@2026';

let sessionCookies = '';
let lastLogin = 0;
const SESSION_TTL = 25 * 60 * 1000;

function httpsReq(opts, body = null) {
  return new Promise((resolve, reject) => {
    const req = https.request(opts, res => {
      let data = '';
      const chunks = [];
      res.on('data', c => chunks.push(c));
      res.on('end', () => resolve({
        status: res.statusCode,
        headers: res.headers,
        body: Buffer.concat(chunks).toString('utf8')
      }));
    });
    req.on('error', reject);
    req.setTimeout(10000, () => { req.destroy(); reject(new Error('timeout')); });
    if (body) req.write(body);
    req.end();
  });
}

function parseCookies(h) {
  const raw = h['set-cookie'];
  if (!raw) return '';
  const arr = Array.isArray(raw) ? raw : [raw];
  return arr.map(c => c.split(';')[0].trim()).filter(Boolean).join('; ');
}

async function login() {
  console.log('[Way2] Iniciando login...', USERNAME);

  // Primeiro GET para pegar CSRF token se houver
  let csrfToken = '';
  let initCookies = '';
  try {
    const init = await httpsReq({
      hostname: WAY2_HOST, path: '/login', method: 'GET',
      headers: { 'User-Agent': 'Mozilla/5.0', 'Accept': 'text/html,*/*' }
    });
    initCookies = parseCookies(init.headers);
    // Tenta extrair _token ou csrf do HTML
    const match = init.body.match(/name="_token"\s+value="([^"]+)"/);
    if (match) csrfToken = match[1];
    console.log('[Way2] GET /login status:', init.status, '| cookies:', initCookies ? 'sim' : 'não', '| csrf:', csrfToken ? 'sim' : 'não');
  } catch(e) {
    console.log('[Way2] GET /login erro:', e.message);
  }

  // POST login
  const fields = { username: USERNAME, password: PASSWORD };
  if (csrfToken) fields._token = csrfToken;
  const body = qs.stringify(fields);

  const headers = {
    'Content-Type': 'application/x-www-form-urlencoded',
    'Content-Length': Buffer.byteLength(body),
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
    'Accept': 'text/html,application/xhtml+xml,*/*;q=0.9',
    'Accept-Language': 'pt-BR,pt;q=0.9',
    'Referer': `https://${WAY2_HOST}/login`,
    'Origin': `https://${WAY2_HOST}`,
  };
  if (initCookies) headers['Cookie'] = initCookies;

  try {
    const r = await httpsReq({
      hostname: WAY2_HOST, path: '/login', method: 'POST', headers
    }, body);

    console.log('[Way2] POST /login status:', r.status);
    console.log('[Way2] Location:', r.headers['location'] || 'none');

    const cookies = parseCookies(r.headers);
    const allCookies = [initCookies, cookies].filter(Boolean).join('; ');

    if (allCookies && (r.status === 302 || r.status === 301 || r.status === 200)) {
      sessionCookies = allCookies;
      lastLogin = Date.now();
      console.log('[Way2] Login OK! Cookies:', sessionCookies.substring(0, 80));
      return true;
    }

    console.log('[Way2] Login falhou. Body preview:', r.body.substring(0, 200));
  } catch(e) {
    console.error('[Way2] Erro no POST:', e.message);
  }

  return false;
}

async function ensureSession() {
  if (sessionCookies && Date.now() - lastLogin < SESSION_TTL) return true;
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
    res.status(200).json({ ok, user: USERNAME, session: !!sessionCookies, ts: new Date().toISOString() });
    return;
  }

  try {
    await ensureSession();
    const r = await httpsReq({
      hostname: WAY2_HOST, path: '/' + way2path, method: 'GET',
      headers: {
        'Cookie': sessionCookies,
        'User-Agent': 'Mozilla/5.0',
        'Accept': 'application/json, text/html, */*',
        'Referer': `https://${WAY2_HOST}/`,
      }
    });
    const nc = parseCookies(r.headers);
    if (nc) { sessionCookies = nc; lastLogin = Date.now(); }
    if (r.status === 401 || r.status === 403) { sessionCookies = ''; lastLogin = 0; }
    res.status(r.status).setHeader('Content-Type', 'application/json').send(r.body);
  } catch(e) {
    res.status(500).json({ error: e.message });
  }
};
