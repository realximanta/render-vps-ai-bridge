# 🪄 render-vps-ai-bridge

Bridge between users and VPS-hosted Ollama.

## 🔌 Endpoints
| Method | Path | Purpose | Auth |
|--------|------|---------|------|
| GET | `/` `/health` | Health check | ❌ |
| HEAD | `/` `/health` | UptimeRobot ping | ❌ |
| POST | `/api/ask` | Submit prompt | ✅ |
| GET | `/api/jobs/:jobId` | Poll result | ✅ |
| GET | `/api/jobs/pending` | Worker: get next job | ✅ |
| POST | `/api/jobs/:jobId/result` | Worker: send result | ✅ |

## 🚀 Deploy
1. Push to GitHub
2. Render → New Web Service → connect repo
3. Env var: `API_KEY` = your secret
4. Deploy ✅

## ⏰ Keep-alive
UptimeRobot → HTTP(s) → `https://your-app.onrender.com/health` → **HEAD** → every 5 min

## 👨‍💻 Developer
Tuku (Himanta Bhuyan) — [@tukuexe](https://github.com/tukuexe)
