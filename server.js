// TagSoft API — Fastify (JavaScript, zero build)
// Endpoints: /v1/ingest, /v1/containers, /v1/analytics/overview, /v1/analysis/chat
// Auth: simple x-api-key (default DEMO_KEY). Replace in Railway env var API_KEY.

const fastify = require('fastify')({ logger: true });
const cors = require('@fastify/cors');

const API_KEY = process.env.API_KEY || 'DEMO_KEY';

const db = {
  events: [],
  containers: new Map(),
};

// CORS (allow all for MVP)
fastify.register(cors, { origin: true });

// Health
fastify.get('/v1/health', async () => ({ ok: true }));

// Auth helper
function assertAuth(req, reply) {
  const key = req.headers['x-api-key'];
  if (!key || key !== API_KEY) {
    reply.code(401);
    throw new Error('unauthorized');
  }
}

// Ingest events
fastify.post('/v1/ingest', async (req, reply) => {
  try {
    assertAuth(req, reply);
    const body = req.body || {};
    const evt = {
      id: crypto.randomUUID(),
      event: String(body.event || 'unknown'),
      ts: body.ts || new Date().toISOString(),
      user: body.user || {},
      context: body.context || {},
      biz: body.biz || {},
    };
    db.events.push(evt);
    return { ok: true, id: evt.id };
  } catch (e) {
    return { error: e.message };
  }
});

// List containers
fastify.get('/v1/containers', async (req, reply) => {
  try { assertAuth(req, reply); } catch(e){ return { error: e.message }; }
  return Array.from(db.containers.values());
});

// Get one container
fastify.get('/v1/containers/:id', async (req, reply) => {
  try { assertAuth(req, reply); } catch(e){ return { error: e.message }; }
  const c = db.containers.get(req.params.id);
  if (!c) { reply.code(404); return { error: 'not found' }; }
  return c;
});

// Upsert container
fastify.put('/v1/containers', async (req, reply) => {
  try { assertAuth(req, reply); } catch(e){ return { error: e.message }; }
  const c = req.body || {};
  if (!c.container_id) { reply.code(400); return { error: 'container_id required' }; }
  if (!c.name) { reply.code(400); return { error: 'name required' }; }
  c.version = Number(c.version || 1);
  db.containers.set(c.container_id, c);
  return { ok: true, container_id: c.container_id };
});

// Simple analytics
fastify.get('/v1/analytics/overview', async (req, reply) => {
  try { assertAuth(req, reply); } catch(e){ return { error: e.message }; }
  const last24h = db.events.filter(e => Date.now() - Date.parse(e.ts) < 24*3600*1000).length;
  const by_event = db.events.reduce((acc, e) => { acc[e.event] = (acc[e.event]||0)+1; return acc; }, {});
  return { total_events: db.events.length, last24h, by_event };
});

// Chat analysis stub
fastify.post('/v1/analysis/chat', async (req, reply) => {
  try { assertAuth(req, reply); } catch(e){ return { error: e.message }; }
  const prompt = (req.body && req.body.prompt) || '';
  const top = Object.entries(
    db.events.reduce((a, e)=>{ a[e.event]=(a[e.event]||0)+1; return a; }, {})
  ).sort((a,b)=>b[1]-a[1])[0];
  return { answer: `Análise inicial: evento mais frequente é '${top?.[0]||'n/a'}' com ${top?.[1]||0} ocorrências. Pergunta: ${prompt}` };
});

const port = Number(process.env.PORT) || 8787;
fastify.listen({ port: port, host: '0.0.0.0' })
  .then(() => console.log(`TagSoft API on :${port}`))
  .catch(err => { console.error(err); process.exit(1); });
