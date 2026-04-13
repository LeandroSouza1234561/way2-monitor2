const https = require('https');

const WAY2_HOST = 'pim.way2.com.br';

// Cookies de sessão capturados do navegador
// ATENÇÃO: Quando expirar, atualize estes valores com os novos cookies do navegador
const STATIC_COOKIES = '.ASPXAUTH=E5EE983722A89C532295C3018E4C15C86D7E86CA2DEFEF09AB76672385562051012E395D9D4BB82476E38AE80C9F1F125D839F9B4EE5B397C0BE8C70E8A3B3715A1B2F301B73AF70BAF6E5CE0BFB6101599AC033F4EEFD3C674611402FD8DE9A2C5C98EB63ECB35D6D8D416105F3D5F4; ASP.NET_SessionId=gobfllvftiqb4khnzsnikmk5';

const USERNAME = 'leandro.souzagna';

function httpsReq(opts) {
  return new Promise((resolve, reject) => {
    const req = https.request(opts, res => {
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: data }));
    });
    req.on('error', reject);
    req.setTimeout(10000, () => { req.destroy(); reject(new Error('timeout')); });
    req.end();
  });
}

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') { res.status(204).end(); return; }

  const url = new URL(req.url, `https://${req.headers.host}`);
  const way2path = url.searchParams.get('path');

  // Status/ping
  if (!way2path || way2path === 'status') {
    // Testa se a sessão ainda é válida
    try {
      const r = await httpsReq({
        hostname: WAY2_HOST, path: '/api/medicao/realtime', method: 'GET',
        headers: {
          'Cookie': STATIC_COOKIES,
          'User-Agent': 'Mozilla/5.0',
          'Accept': 'application/json, */*',
        }
      });
      const ok = r.status !== 401 && r.status !== 302 && r.status < 500;
      console.log('[Way2] Status check:', r.status, ok ? 'OK' : 'FALHOU');
      res.status(200).json({ ok, user: USERNAME, session: ok, httpStatus: r.status });
    } catch(e) {
      res.status(200).json({ ok: false, user: USERNAME, error: e.message });
    }
    return;
  }

  // Proxy para Way2
  try {
    const r = await httpsReq({
      hostname: WAY2_HOST,
      path: '/' + way2path,
      method: 'GET',
      headers: {
        'Cookie': STATIC_COOKIES,
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        'Accept': 'application/json, text/html, */*',
        'Referer': `https://${WAY2_HOST}/`,
        'X-Requested-With': 'XMLHttpRequest',
      }
    });

    console.log(`[Way2] GET /${way2path} → ${r.status}`);
    res.status(r.status)
       .setHeader('Content-Type', 'application/json')
       .send(r.body);
  } catch(e) {
    console.error('[Way2] Erro:', e.message);
    res.status(500).json({ error: e.message });
  }
};
