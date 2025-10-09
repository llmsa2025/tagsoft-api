// TagSoft API — Fastify (robusta p/ MVP)
// Rotas principais agora incluem Contas e Containers:
// - / (hint), /v1/health
// - /v1/accounts (GET/PUT), /v1/accounts/:id (GET)
// - /v1/containers (GET/PUT), /v1/containers/:id (GET)
// - /v1/ingest (POST)
// - /v1/analytics/overview (GET)
// - /v1/analysis/chat (POST)

const fastify = require('fastify')({ logger: true });
const cors = require('@fastify/cors');
const { randomUUID } = require('crypto');

const API_KEY = process.env.API_KEY || 'DEMO_KEY';

// DB em memória (MVP). Depois trocamos por Supabase/ClickHouse.
const db = {
  events: [],
  accounts: new Map(),     // <— NOVO: armazenamento de contas
  containers: new Map(),
};

// —— CORS (com credentials: true) ——
fastify.register(cors, {
  origin: true,                                 // reflete o Origin do front (Vercel)
  methods: ['GET', 'POST', 'PUT', 'OPTIONS'],
  allowedHeaders: ['content-type', 'x-api-key'],
  credentials: true,                             // necessário para requests com credentials
  // maxAge: 3600, // opcional: cache de preflight por 1h
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

// —— Rotas amigáveis/diagnóstico ——
fastify.all('/', async () => ({
  ok: true,
  hint:
    'Use POST /v1/ingest para enviar eventos. Health em GET /v1/health. ' +
    'Contas em GET/PUT /v1/accounts. Containers em GET/PUT /v1/containers.',
  docs: [
    '/v1/health',
    'GET /v1/accounts',
    'PUT /v1/accounts',
    'GET /v1/accounts/:id',
    'GET /v1/containers',
    'PUT /v1/containers',
    'GET /v1/containers/:id',
    'POST /v1/ingest',
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
    account_get: 'GET /v1/accounts/:id',
    containers_list: 'GET /v1/containers',
    containers_upsert: 'PUT /v1/containers',
    container_get: 'GET /v1/containers/:id',
    ingest: 'POST /v1/ingest',
    analytics: 'GET /v1/analytics/overview',
    analysis_chat: 'POST /v1/analysis/chat',
  },
}));

fastify.get('/v1/health', async () => ({ ok: true }));

// Mensagem educativa se alguém fizer GET em /v1/ingest
fastify.get('/v1/ingest', async () => ({
  ok: false,
  hint: 'Use POST /v1/ingest com JSON e header x-api-key.',
  example: {
    curl:
      "curl -X POST https://SUA-API.../v1/ingest " +
      "-H 'content-type: application/json' -H 'x-api-key: DEMO_KEY' " +
      "-d '{\"event\":\"page_view\",\"user\":{\"id\":\"u1\"}}'",
  },
}));

// ======================================================================
// =                               ACCOUNTS                              =
// ======================================================================

// Listar contas
fastify.get('/v1/accounts', async (req, reply) => {
  try { assertAuth(req); } catch (e) { return reply.code(401).send({ error: e.message }); }
  return Array.from(db.accounts.values());
});

// Ler uma conta específica
fastify.get('/v1/accounts/:id', async (req, reply) => {
  try { assertAuth(req); } catch (e) { return reply.code(401).send({ error: e.message }); }
  const acc = db.accounts.get(req.params.id);
  if (!acc) return reply.code(404).send({ error: 'not_found' });
  return acc;
});

// Criar/atualizar conta
fastify.put('/v1/accounts', async (req, reply) => {
  try { assertAuth(req); } catch (e) { return reply.code(401).send({ error: e.message }); }
  const body = req.body || {};
  if (!body.account_id) return reply.code(400).send({ error: 'account_id required' });
  if (!body.name) return reply.code(400).send({ error: 'name required' });

  const acc = {
    account_id: String(body.account_id),
    name: String(body.name),
    created_at: new Date().toISOString(),
  };
  db.accounts.set(acc.account_id, acc);
  return { ok: true, account_id: acc.account_id };
});

// ======================================================================
// =                              CONTAINERS                             =
// ======================================================================

// Ingest: recebe eventos (mantido)
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

// Listar containers (pode filtrar por account_id)
fastify.get('/v1/containers', async (req, reply) => {
  try { assertAuth(req); } catch (e) { return reply.code(401).send({ error: e.message }); }
  const list = Array.from(db.containers.values());
  const aid = req.query && req.query.account_id ? String(req.query.account_id) : null;
  return aid ? list.filter(c => c.account_id === aid) : list;
});

// Ler um container
fastify.get('/v1/containers/:id', async (req, reply) => {
  try { assertAuth(req); } catch (e) { return reply.code(401).send({ error: e.message }); }
  const c = db.containers.get(req.params.id);
  if (!c) return reply.code(404).send({ error: 'not found' });
  return c;
});

// Criar/atualizar container (agora requer account_id e type web/server)
fastify.put('/v1/containers', async (req, reply) => {
  try { assertAuth(req); } catch (e) { return reply.code(401).send({ error: e.message }); }
  const c = req.body || {};

  if (!c.container_id) return reply.code(400).send({ error: 'container_id required' });
  if (!c.name) return reply.code(400).send({ error: 'name required' });
  if (!c.account_id) return reply.code(400).send({ error: 'account_id required' });
  if (!db.accounts.has(String(c.account_id))) return reply.code(400).send({ error: 'unknown account_id' });

  const type = String(c.type || 'web'); // 'web' | 'server'
  if (!['web','server'].includes(type)) return reply.code(400).send({ error: 'invalid type' });

  // Normalização de campos opcionais
  c.version   = Number(c.version || 1);
  c.type      = type;
  c.variables = Array.isArray(c.variables) ? c.variables : [];
  c.triggers  = Array.isArray(c.triggers)  ? c.triggers  : [];
  c.tags      = Array.isArray(c.tags)      ? c.tags      : [];

  db.containers.set(c.container_id, c);
  return { ok: true, container_id: c.container_id };
});

// ======================================================================
// =                              ANALYTICS                              =
// ======================================================================

fastify.get('/v1/analytics/overview', async (req, reply) => {
  try { assertAuth(req); } catch (e) { return reply.code(401).send({ error: e.message }); }
  const now = Date.now();
  const last24h = db.events.filter(e => now - Date.parse(e.ts) < 24 * 3600 * 1000).length;
  const by_event = db.events.reduce((acc, e) => { acc[e.event] = (acc[e.event] || 0) + 1; return acc; }, {});
  return { total_events: db.events.length, last24h, by_event };
});

// Chat analysis (stub)
fastify.post('/v1/analysis/chat', async (req, reply) => {
  try { assertAuth(req); } catch (e) { return reply.code(401).send({ error: e.message }); }
  const prompt = (req.body && req.body.prompt) || '';
  const top = Object.entries(
    db.events.reduce((a, e) => { a[e.event] = (a[e.event] || 0) + 1; return a; }, {})
  ).sort((a,b) => b[1]-a[1])[0];
  return { answer: `Análise inicial: evento mais frequente é '${top?.[0]||'n/a'}' com ${top?.[1]||0} ocorrências. Pergunta: ${prompt}` };
});

// —— Not Found & Error Handlers ——

// 404 amigável
fastify.setNotFoundHandler((req, reply) => {
  const m = req.method.toUpperCase();
  const p = req.url;
  const hint =
    p === '/v1/ingest' && m !== 'POST'
      ? 'Método incorreto. Use POST /v1/ingest.'
      : 'Veja / ou /v1 para lista de endpoints.';
  reply.code(404).send({ error: 'not_found', method: m, path: p, hint });
});

// Erros padronizados
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
