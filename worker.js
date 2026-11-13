// GCP 비공개 버킷 API. 서비스 계정 JSON은 Worker Secret에만 보관한다.
const BUCKET = 'aurora_asset_manager';
const PW_HASH = '8d129f703b9851ce74cbb41cb84db46fcb6098bea25563526bb700d4a03f8812';
const enc = new TextEncoder();
let source, sa, accessToken, expires = 0, pending;
const b64 = bytes => btoa(String.fromCharCode(...new Uint8Array(bytes))).replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_');
const encoded = x => b64(enc.encode(JSON.stringify(x)));
const json = (x, status = 200, headers = {}) => new Response(JSON.stringify(x), { status, headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', ...headers } });
function fail(status, message) { throw Object.assign(new Error(message), { status }); }
function account(env) {
  if (!env.GCP_SERVICE_ACCOUNT_JSON) fail(503, 'GCP 인증 설정이 필요해요');
  if (source !== env.GCP_SERVICE_ACCOUNT_JSON) {
    try { sa = JSON.parse(env.GCP_SERVICE_ACCOUNT_JSON); } catch { fail(503, 'GCP 인증 JSON 형식을 확인해 주세요'); }
    if (sa.type !== 'service_account' || !sa.client_email || !sa.private_key) fail(503, '서비스 계정 JSON이 필요해요');
    source = env.GCP_SERVICE_ACCOUNT_JSON; accessToken = null; expires = 0;
  }
  return sa;
}
async function token(env) {
  const a = account(env);
  if (accessToken && expires > Date.now() + 60000) return accessToken;
  if (pending) return pending;
  pending = (async () => {
    const now = Math.floor(Date.now() / 1000);
    const input = encoded({ alg: 'RS256', typ: 'JWT' }) + '.' + encoded({ iss: a.client_email, scope: 'https://www.googleapis.com/auth/devstorage.read_write', aud: 'https://oauth2.googleapis.com/token', iat: now, exp: now + 3600 });
    const pem = a.private_key.replace(/-----[^-]+-----|\s/g, '');
    const key = await crypto.subtle.importKey('pkcs8', Uint8Array.from(atob(pem), c => c.charCodeAt(0)), { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['sign']);
    const assertion = input + '.' + b64(await crypto.subtle.sign('RSASSA-PKCS1-v1_5', key, enc.encode(input)));
    const r = await fetch('https://oauth2.googleapis.com/token', { method: 'POST', body: new URLSearchParams({ grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion }) });
    if (!r.ok) fail(502, 'GCP 서비스 계정 인증에 실패했어요 (' + r.status + ')');
    const d = await r.json(); accessToken = d.access_token; expires = Date.now() + d.expires_in * 1000; return accessToken;
  })();
  try { return await pending; } finally { pending = null; }
}
async function gcs(env, path, opts = {}, upload = false) {
  const headers = new Headers(opts.headers); headers.set('Authorization', 'Bearer ' + await token(env));
  return fetch('https://storage.googleapis.com/' + (upload ? 'upload/' : '') + 'storage/v1/b/' + encodeURIComponent(BUCKET) + path, { ...opts, headers });
}
async function checked(r) {
  if (r.ok) return r;
  if (r.status === 412) fail(409, '다른 기기에서 먼저 저장했어요. 다시 시도해 주세요');
  if (r.status === 404) fail(404, '저장된 파일을 찾을 수 없어요');
  fail(502, 'GCP 저장소 요청에 실패했어요 (' + r.status + ')');
}
async function sessionKey(env) { return crypto.subtle.importKey('raw', enc.encode('aurora-session-v1:' + account(env).private_key), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign', 'verify']); }
async function authed(request, env) {
  const value = (request.headers.get('Cookie') || '').match(/(?:^|;\s*)__Host-aurora=([^;]+)/)?.[1];
  if (!value) return false;
  try {
    const [expiry, nonce, signature, extra] = value.split('.');
    if (extra || !signature || !nonce || !/^\d+$/.test(expiry) || Number(expiry) < Date.now()) return false;
    return await crypto.subtle.verify('HMAC', await sessionKey(env), Uint8Array.from(atob(signature.replace(/-/g, '+').replace(/_/g, '/')), c => c.charCodeAt(0)), enc.encode(expiry + '.' + nonce));
  } catch { return false; }
}
const cookie = (value, age) => '__Host-aurora=' + value + '; Path=/; Secure; HttpOnly; SameSite=Strict' + (age === null ? '' : '; Max-Age=' + age);
async function login(request, env) {
  if (!(request.headers.get('Content-Type') || '').startsWith('application/json')) fail(415, 'JSON 요청이 필요해요');
  const { password, remember } = await request.json();
  if (typeof password !== 'string' || password.length > 256) fail(401, '비밀번호가 맞지 않아요');
  const hash = [...new Uint8Array(await crypto.subtle.digest('SHA-256', enc.encode(password)))].map(n => n.toString(16).padStart(2, '0')).join('');
  if (hash !== PW_HASH) fail(401, '비밀번호가 맞지 않아요');
  const age = 30 * 86400, value = (Date.now() + age * 1000) + '.' + crypto.randomUUID();
  return json({ ok: true }, 200, { 'Set-Cookie': cookie(value + '.' + b64(await crypto.subtle.sign('HMAC', await sessionKey(env), enc.encode(value))), remember ? age : null) });
}
async function data(request, env) {
  if (request.method === 'GET') {
    const meta = await (await checked(await gcs(env, '/o/assets.json'))).json();
    const r = await checked(await gcs(env, '/o/assets.json?alt=media&generation=' + meta.generation));
    return new Response(r.body, { headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'X-Generation': meta.generation } });
  }
  if (request.method !== 'PUT') fail(405, '지원하지 않는 요청이에요');
  const generation = request.headers.get('X-Generation');
  if (!generation || !/^\d+$/.test(generation)) fail(428, '저장 버전이 필요해요');
  const body = await request.text();
  if (enc.encode(body).length > 10 * 1024 * 1024) fail(413, '데이터가 너무 커요');
  let doc; try { doc = JSON.parse(body); } catch { fail(400, '데이터 형식을 확인해 주세요'); }
  if (!doc || !Array.isArray(doc.assets) || !Number.isInteger(doc.version)) fail(400, '자산 데이터 형식을 확인해 주세요');
  // 현재 세대를 백업한 뒤 조건부 쓰기: 다른 기기의 변경을 덮어쓰지 않는다.
  if (generation !== '0') {
    const dst = encodeURIComponent('backups/assets-' + generation + '.json');
    const r = await gcs(env, '/o/assets.json/copyTo/b/' + encodeURIComponent(BUCKET) + '/o/' + dst + '?sourceGeneration=' + generation + '&ifSourceGenerationMatch=' + generation + '&ifGenerationMatch=0', { method: 'POST' });
    if (r.status === 404) fail(409, '다른 기기에서 먼저 저장했어요. 다시 시도해 주세요');
    if (r.status !== 412) await checked(r);
  }
  const r = await checked(await gcs(env, '/o?uploadType=media&name=assets.json&ifGenerationMatch=' + generation, { method: 'POST', headers: { 'Content-Type': 'application/json; charset=utf-8' }, body }, true));
  const result = await r.json(); return json({ generation: result.generation, md5Hash: result.md5Hash });
}
async function photo(request, env, pathname) {
  let path; try { path = decodeURIComponent(pathname.slice('/api/files/'.length)); } catch { fail(400, '파일 경로 오류'); }
  if (!/^photos\/(?:[^/]+\/)*[^/]+\.(?:jpe?g|png|webp)$/i.test(path) || path.split('/').some(x => x === '.' || x === '..') || /[\x00-\x1f\\]/.test(path)) fail(400, '사진 경로를 확인해 주세요');
  const type = /\.png$/i.test(path) ? 'image/png' : /\.webp$/i.test(path) ? 'image/webp' : 'image/jpeg';
  if (request.method === 'GET') {
    const r = await checked(await gcs(env, '/o/' + encodeURIComponent(path) + '?alt=media'));
    return new Response(r.body, { headers: { 'Content-Type': type, 'Cache-Control': 'private, no-store', 'X-Content-Type-Options': 'nosniff' } });
  }
  if (request.method !== 'PUT') fail(405, '지원하지 않는 요청이에요');
  const body = await request.arrayBuffer(); if (body.byteLength > 15 * 1024 * 1024) fail(413, '사진이 너무 커요');
  const r = await gcs(env, '/o?uploadType=media&name=' + encodeURIComponent(path) + '&ifGenerationMatch=0', { method: 'POST', body, headers: { 'Content-Type': type } }, true);
  if (r.status === 412) {
    const old = await (await checked(await gcs(env, '/o/' + encodeURIComponent(path) + '?alt=media'))).arrayBuffer();
    if (b64(await crypto.subtle.digest('SHA-256', body)) !== b64(await crypto.subtle.digest('SHA-256', old))) fail(409, '같은 이름의 다른 사진이 있어요');
    return json({ ok: true, existing: true });
  }
  const result = await (await checked(r)).json(); return json({ ok: true, generation: result.generation, md5Hash: result.md5Hash });
}
export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (!url.pathname.startsWith('/api/')) return env.ASSETS.fetch(request);
    try {
      if (!['GET', 'HEAD'].includes(request.method) && request.headers.get('Origin') !== url.origin) fail(403, '이 사이트에서 다시 요청해 주세요');
      if (url.pathname === '/api/login' && request.method === 'POST') return await login(request, env);
      if (url.pathname === '/api/logout' && request.method === 'POST') return json({ ok: true }, 200, { 'Set-Cookie': cookie('', 0) });
      if (!await authed(request, env)) fail(401, '다시 로그인해 주세요');
      if (url.pathname === '/api/session' && request.method === 'GET') return json({ ok: true });
      if (url.pathname === '/api/status' && request.method === 'GET') {
        await checked(await gcs(env, '/o?maxResults=1&fields=kind'));
        return json({ ok: true, bucket: BUCKET, project: 'api-for-anythingllm-1' });
      }
      if (url.pathname === '/api/data') return await data(request, env);
      if (url.pathname.startsWith('/api/files/')) return await photo(request, env, url.pathname);
      fail(404, '요청을 찾을 수 없어요');
    } catch (e) { return json({ error: e.status ? e.message : '서버 요청에 실패했어요' }, e.status || 500); }
  }
};
