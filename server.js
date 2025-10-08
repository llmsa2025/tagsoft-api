// TagSoft API — Fastify (robusta p/ MVP)
// Rotas: / (hint), /v1/health, /v1/ingest (POST), /v1/containers (GET/PUT),
//        /v1/analytics/overview (GET), /v1/analysis/chat (POST)

const fastify = require('fastify')({ logger: true });
const cors = require('@fastify/cors');
const { randomUUID } = require('crypto');

const API_KEY = process.env.API_KEY || 'DEMO_KEY';

// DB em memória (MVP). Depois trocamos por Supabase/ClickHouse.
const db = {
  events: [],
  containers: new Map(),
};

// —— CORS (agora com credentials: true) ——
fastify.register(cors, {
  origin: true,                                 // reflete o Origin do front (Vercel)
  methods: ['GET', 'POST', 'PUT', 'OPTIONS'],
  allowedHeaders: ['content-type', 'x-api-key'],
  credentials: true,                             // <—— IMPORTANTE p/ preflight com credentials
  // opcional: cache do preflight por 1h
  // maxAge: 3600,
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
    'Listagem de containers em GET /v1/containers.',
  docs: [
    '/v1/health',
    'POST /v1/ingest',
    'GET /v1/containers',
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
    ingest: 'POST /v1/ingest',
    containers_list: 'GET /v1/containers',
    containers_upsert: 'PUT /v1/containers',
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

// —— API principal ——

// Ingest: recebe eventos
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

// Containers
fastify.get('/v1/containers', async (req, reply) => {
  try { assertAuth(req); } catch (e) { return reply.code(401).send({ error: e.message }); }
  return Array.from(db.containers.values());
});

fastify.get('/v1/containers/:id', async (req, reply) => {
  try { assertAuth(req); } catch (e) { return reply.code(401).send({ error: e.message }); }
  const c = db.containers.get(req.params.id);
  if (!c) return reply.code(404).send({ error: 'not found' });
  return c;
});

fastify.put('/v1/containers', async (req, reply) => {
  try { assertAuth(req); } catch (e) { return reply.code(401).send({ error: e.message }); }
  const c = req.body || {};
  if (!c.container_id) return reply.code(400).send({ error: 'container_id required' });
  if (!c.name) return reply.code(400).send({ error: 'name required' });
  c.version = Number(c.version || 1);
  db.containers.set(c.container_id, c);
  return { ok: true, container_id: c.container_id };
});

// Analytics básico
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
