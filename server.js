// TagSoft API — Fastify (MVP)
// Rotas: / (hint), /v1/health, /v1/accounts (GET/PUT), /v1/containers (GET/PUT)
//        /v1/analytics/overview (GET), /v1/ingest (POST), /v1/analysis/chat (POST)

const fastify = require('fastify')({ logger: true });
const cors = require('@fastify/cors');
const { randomUUID } = require('crypto');

const API_KEY = process.env.API_KEY || 'DEMO_KEY';

// —— DB em memória (MVP). Depois trocamos por Supabase/ClickHouse. ——
const db = {
  events: [],
  accounts: new Map(),    // { account_id, name, meta, createdAt, updatedAt }
  containers: new Map(),  // { container_id, account_id, type, name, version, meta, createdAt, updatedAt }
};

// —— CORS (com credentials: true) ——
fastify.register(cors, {
  origin: true,
  methods: ['GET', 'POST', 'PUT', 'OPTIONS'],
  allowedHeaders: ['content-type', 'x-api-key'],
  credentials: true,
});

// —— Helpers ——
function assertAuth(req) {
  const key = req.headers['x-api-key'];
  if (!key || key !== API_KEY) {
    const masked = key ? mask(key) : '(vazio)';
    throw new Error(`unauthorized: x-api-key=${masked}`);
  }
}
function mask(k) {
  if (!k) return '';
  return k.length <= 6 ? '*'.repeat(k.length) : `${k.slice(0,3)}…${k.slice(-3)}`;
}
function slugify(s) {
  return String(s || '')
    .toLowerCase()
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)/g, '');
}
function genId(prefix, name, existsFn) {
  const base = slugify(name) || 'item';
  let id;
  do {
    const rand = Math.random().toString(36).slice(2, 6);
    id = `${prefix}_${base}_${rand}`;
  } while (existsFn && existsFn(id));
  return id;
}

// —— Rotas amigáveis/diagnóstico ——
fastify.all('/', async () => ({
  ok: true,
  hint: 'Use POST /v1/ingest para enviar eventos. Health em GET /v1/health.',
  docs: [
    '/v1/health',
    'GET /v1/accounts',
    'PUT /v1/accounts',
    'GET /v1/containers?account_id=...',
    'PUT /v1/containers',
    'GET /v1/analytics/overview',
    'POST /v1/analysis/chat',
  ],
}));

fastify.get('/v1', async () => ({
  ok: true,
  version: 1,
  endpoints: {
    health: 'GET /v1/health',
    accounts_list: 'GET /v1/accounts',
    accounts_upsert: 'PUT /v1/accounts',
    containers_list: 'GET /v1/containers?account_id=...',
    containers_upsert: 'PUT /v1/containers',
    ingest: 'POST /v1/ingest',
    analytics: 'GET /v1/analytics/overview',
    analysis_chat: 'POST /v1/analysis/chat',
  },
}));

fastify.get('/v1/health', async () => ({ ok: true }));

// —— Accounts ——

// Listar contas
fastify.get('/v1/accounts', async (req, reply) => {
  try { assertAuth(req); } catch (e) { return reply.code(401).send({ error: e.message }); }
  return Array.from(db.accounts.values());
});

// Obter conta por id
fastify.get('/v1/accounts/:id', async (req, reply) => {
  try { assertAuth(req); } catch (e) { return reply.code(401).send({ error: e.message }); }
  const acc = db.accounts.get(req.params.id);
  if (!acc) return reply.code(404).send({ error: 'not found' });
  return acc;
});

// Criar/atualizar conta (gera account_id se não vier)
fastify.put('/v1/accounts', async (req, reply) => {
  try { assertAuth(req); } catch (e) { return reply.code(401).send({ error: e.message }); }

  const body = req.body || {};
  let { account_id, name, meta = {} } = body;

  if (!name || !String(name).trim()) {
    return reply.code(400).send({ error: 'name required' });
  }

  if (!account_id) {
    account_id = genId('ac', name, (id) => db.accounts.has(id));
  }

  const now = new Date().toISOString();
  const existing = db.accounts.get(account_id);
  const acc = existing
    ? { ...existing, name, meta, updatedAt: now }
    : { account_id, name, meta, createdAt: now, updatedAt: now };

  db.accounts.set(account_id, acc);
  return { ok: true, account_id, account: acc };
});

// —— Containers ——

// Listar containers (com filtro opcional por account_id)
fastify.get('/v1/containers', async (req, reply) => {
  try { assertAuth(req); } catch (e) { return reply.code(401).send({ error: e.message }); }
  const { account_id } = req.query || {};
  const all = Array.from(db.containers.values());
  const filtered = account_id ? all.filter(c => c.account_id === account_id) : all;
  return filtered;
});

// Obter container por id
fastify.get('/v1/containers/:id', async (req, reply) => {
  try { assertAuth(req); } catch (e) { return reply.code(401).send({ error: e.message }); }
  const c = db.containers.get(req.params.id);
  if (!c) return reply.code(404).send({ error: 'not found' });
  return c;
});

// Criar/atualizar container (gera container_id se não vier)
fastify.put('/v1/containers', async (req, reply) => {
  try { assertAuth(req); } catch (e) { return reply.code(401).send({ error: e.message }); }

  const c = req.body || {};
  // Regras mínimas
  if (!c.name) return reply.code(400).send({ error: 'name required' });
  if (!c.account_id) return reply.code(400).send({ error: 'account_id required' });
  if (!db.accounts.has(c.account_id)) return reply.code(400).send({ error: 'account not found' });

  // Tipo do container (ex.: 'web' | 'server')
  const type = String(c.type || '').toLowerCase();
  if (!type || !['web', 'server'].includes(type)) {
    return reply.code(400).send({ error: "type required ('web' or 'server')" });
  }

  // Gera ID, se necessário
  if (!c.container_id) {
    c.container_id = genId('ct', c.name, (id) => db.containers.has(id));
  }

  c.version = Number(c.version || 1);
  const now = new Date().toISOString();
  const existing = db.containers.get(c.container_id);
  const merged = existing
    ? { ...existing, ...c, type, updatedAt: now }
    : { ...c, type, createdAt: now, updatedAt: now };

  db.containers.set(c.container_id, merged);
  return { ok: true, container_id: c.container_id, container: merged };
});

// —— Ingest: recebe eventos ——
fastify.post('/v1/ingest', async (req, reply) => {
  try {
    assertAuth(req);
    const body = req.body || {};
    const eventName = String(body.event || '').trim();
    if (!eventName) return reply.code(400).send({ error: 'campo obrigatório: event' });

    const evt = {
      id: randomUUID(),
      event: eventName,
      ts: body.ts || new Date().toISOString(),
      user: body.user || {},
      context: body.context || {},
      biz: body.biz || {},
    };
    db.events.push(evt);
    return { ok: true, id: evt.id };
  } catch (e) {
    return reply.code(e.message?.startsWith('unauthorized') ? 401 : 500).send({ error: e.message || 'erro' });
  }
});

// —— Analytics básico ——
fastify.get('/v1/analytics/overview', async (req, reply) => {
  try { assertAuth(req); } catch (e) { return reply.code(401).send({ error: e.message }); }
  const now = Date.now();
  const last24h = db.events.filter(e => now - Date.parse(e.ts) < 24 * 3600 * 1000).length;
  const by_event = db.events.reduce((acc, e) => { acc[e.event] = (acc[e.event] || 0) + 1; return acc; }, {});
  return { total_events: db.events.length, last24h, by_event };
});

// —— Chat analysis (stub) ——
fastify.post('/v1/analysis/chat', async (req, reply) => {
  try { assertAuth(req); } catch (e) { return reply.code(401).send({ error: e.message }); }
  const prompt = (req.body && req.body.prompt) || '';
  const top = Object.entries(
    db.events.reduce((a, e) => { a[e.event] = (a[e.event] || 0) + 1; return a; }, {})
  ).sort((a,b) => b[1] - a[1])[0];
  return { answer: `Análise inicial: evento mais frequente é '${top?.[0] || 'n/a'}' com ${top?.[1] || 0} ocorrências. Pergunta: ${prompt}` };
});

// —— Not Found & Error Handlers ——
fastify.setNotFoundHandler((req, reply) => {
  const m = req.method.toUpperCase();
  const p = req.url;
  const hint =
    p === '/v1/ingest' && m !== 'POST'
      ? 'Método incorreto. Use POST /v1/ingest.'
      : 'Veja / ou /v1 para lista de endpoints.';
  reply.code(404).send({ error: 'not_found', method: m, path: p, hint });
});

fastify.setErrorHandler((err, req, reply) => {
  const code = err.statusCode && Number.isInteger(err.statusCode) ? err.statusCode : 500;
  reply.code(code).send({ error: err.message || 'internal_error' });
});

// —— Start ——
const port = Number(process.env.PORT) || 8787;
fastify
  .listen({ port, host: '0.0.0.0' })
  .then(() => {
    fastify.log.info(`TagSoft API on :${port} — API_KEY=${mask(API_KEY)}`);
  })
  .catch((err) => {
    fastify.log.error(err);
    process.exit(1);
  });
