# Repository Guidelines

## Project Structure

pnpm monorepo with four packages:

```
knowbase-x/
├── apps/server/        # NestJS backend (controllers, services, entities)
├── apps/frontend/      # React 19 + Vite SPA (pages, components, stores, services)
├── packages/rag-engine/ # Shared RAG library (loaders, splitters, embeddings, stores)
├── packages/agents/    # Multi-agent engine (dispatcher, router, db-query/web-search agents)
├── docker/             # Dockerfiles
├── db/init.sql         # PGVector extension setup
├── docs/               # Design documents
└── test-data/          # Sample upload files
```

Server modules follow NestJS conventions — each domain (`knowledge-base`, `document`, `chunk`, `retrieval`, `chat`, `api-service`, `agents`, `dashboard`, `session`, `usage`) has its own `modules/<domain>/` folder with colocated controller, service, entity, and DTO files.

## Quick Start

```bash
cp .env.example .env          # Fill in LLM_API_KEY and LLM_BASE_URL
pnpm infra:up                 # Start PostgreSQL + Redis
pnpm install
pnpm start:dev                # Backend on :3000
pnpm start:frontend           # Frontend on :5173 (proxy /api → :3000)
```

## Commands

| Command                 | Description                                   |
| ----------------------- | --------------------------------------------- |
| `pnpm install`          | Install all workspace deps                    |
| `pnpm start:dev`        | Build RAG engine + start backend (watch mode) |
| `pnpm start:frontend`   | Start frontend dev server                     |
| `pnpm build`            | Build all packages for production             |
| `pnpm test`             | Run unit tests (agents + rag-engine + server) |
| `pnpm test:watch`       | Run tests in watch mode                       |
| `pnpm test:integration` | Run integration tests (requires test infra)   |
| `pnpm format:check`     | Check code formatting with Prettier           |
| `pnpm infra:up`         | Start PostgreSQL + Redis                      |
| `pnpm infra:down`       | Stop infrastructure containers                |
| `pnpm infra:test:up`    | Start test-only PostgreSQL                    |
| `pnpm infra:test:down`  | Stop and remove test PostgreSQL               |

## Coding Style

- **TypeScript strict mode** enabled via `tsconfig.base.json`
- **PascalCase** for classes/entities/components; **camelCase** for functions/variables
- Frontend files use kebab-case (e.g. `ChatPage.tsx`, `kb-store.ts`)
- NestJS: DTOs use `class-validator`; entities use TypeORM decorators
- Frontend state in Zustand stores (`stores/`); API in `services/api.ts`; SSE in `services/sse.ts`

## Testing

Tests are organized by layer:

- **Unit tests**: Co-located with source files (`*.test.ts`), run with `vitest`
  - `packages/agents/src/**/*.test.ts` — agent routing, dispatching, tool execution
  - `packages/rag-engine/src/**/*.test.ts` — loaders, splitters, embeddings, retrievers
  - `apps/server/src/modules/**/service.test.ts` — service logic
- **Integration tests**: Under `apps/server/test/integration/`, use supertest against NestJS TestingModule
- **E2E tests**: Under `tests/e2e/`, Playwright-driven browser tests
- **Test infrastructure**: `docker-compose.test.yml` provides an isolated PostgreSQL instance on port 5434

Run all tests: `pnpm test`. For a specific package: `pnpm --filter <pkg> test`.

## Commits & PRs

- Use **Conventional Commits**: `feat(server): add hybrid retrieval`, `fix(frontend): truncate long previews`
- PRs should describe what changed and why; link issues; include screenshots for UI changes

## Architecture

1. **Frontend** → React SPA; REST + SSE for streaming responses
2. **Backend** → NestJS API; handles auth, uploads, RAG orchestration
3. **RAG Engine** → Loads documents (PDF/Word/CSV/XLSX), chunks them, embeds into pgvector, supports similarity search with optional reranking
4. **Agent Engine** (`packages/agents`) → Intent router dispatches to specialized agents (db-query, web-search); agent results feed into chat responses via `AgentChatService`

## Security

- Never commit `.env` — it's in `.gitignore`. Use `.env.example` as reference.
- API keys are masked (`keyPrefix`) in responses.
- Service-call endpoints use Bearer-token auth via `ApiKeyGuard`.

## For AI Agents

- Read the relevant module's controller/service/entity before editing.
- Keep changes scoped — no refactoring unrelated code.
- Always run commands from the repo root or correct package directory.
