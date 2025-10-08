# TagSoft API (MVP)

Endpoints:
- `POST /v1/ingest`  (headers: x-api-key)
- `GET  /v1/containers`  (headers: x-api-key)
- `GET  /v1/containers/:id`  (headers: x-api-key)
- `PUT  /v1/containers`  (headers: x-api-key)
- `GET  /v1/analytics/overview`  (headers: x-api-key)
- `POST /v1/analysis/chat`  (headers: x-api-key)

## Local run
```bash
npm install
API_KEY=DEMO_KEY PORT=8787 npm start
```

## Test curl
```bash
curl -X POST $API_URL/v1/ingest \
  -H 'content-type: application/json' \
  -H 'x-api-key: DEMO_KEY' \
  -d '{"event":"page_view","user":{"id":"u1"},"context":{"screen":"dashboard"}}'
```
