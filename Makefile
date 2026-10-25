# Meridian DAO / ProofOfIntent dev commands.
COMPOSE := docker compose

.PHONY: up down demo reset

## up: start postgres (pgvector) and redis in the background
up:
	$(COMPOSE) up -d --wait

## down: stop containers, keep data volumes
down:
	$(COMPOSE) down

## demo: bring infra up, then start each service (wired in as services land)
demo: up
	@test -f .env || cp .env.example .env
	@echo "Infra up: postgres :5432, redis :6379. Start services in separate terminals:"
	@echo "  contracts  (cd contracts && npx hardhat node)   :8545"
	@echo "  sim        (cd sim && npm run dev)              :4002"
	@echo "  rag        (cd rag && uvicorn app.main:app --port 8000)"
	@echo "  backend    (cd backend && npm run dev)          :4000"
	@echo "  frontend   (cd frontend && npm run dev)         :3000"

## reset: wipe postgres and redis volumes and start fresh
reset:
	$(COMPOSE) down -v
	$(COMPOSE) up -d --wait
