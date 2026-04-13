const https = require('https');
const qs    = require('querystring');

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
  const body = qs.stringify({ username: USERNAME, password: PASSWORD });
  const r = await httpsReq({
    hostname: WAY2_HOST, path: '/login', method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      'Content-Length': Buffer.byteLength(body),
      'User-Agent': 'Mozilla/5.0 Way2Monitor/2.0',
      'Accept': 'text/html,*/*',
    }
  }, body);
  const cookies = parseCookies(r.headers['set-cookie']);
  if (cookies) { sessionCookies = cookies; lastLogin = Date.now(); return true; }
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

  const { path: way2path } = req.query;

  if (!way2path || way2path === 'status') {
    const ok = await ensureSession();
    res.json({ ok, user: USERNAME });
    return;
  }

  try {
    await ensureSession();
    const r = await httpsReq({
      hostname: WAY2_HOST, path: '/' + way2path, method: 'GET',
      headers: { 'Cookie': sessionCookies, 'User-Agent': 'Mozilla/5.0', 'Accept': 'application/json,*/*' }
    });
    const nc = parseCookies(r.headers['set-cookie']);
    if (nc) sessionCookies = nc;
    res.status(r.status).setHeader('Content-Type', 'application/json').send(r.body);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
};
