# Convenience wrapper around docker compose. The single command that brings
# the whole stack up from a clean clone is `make up`.

COMPOSE ?= docker compose
APP_EXEC ?= $(COMPOSE) exec -T app

HTTP_PORT ?= 8080
RABBITMQ_MANAGEMENT_PORT ?= 15672

.PHONY: help up down restart build rebuild ps logs shell migrate test test-unit test-functional clear-cache install

help: ## Show available targets.
	@awk 'BEGIN {FS = ":.*##"} /^[a-zA-Z_-]+:.*##/ {printf "  \033[36m%-18s\033[0m %s\n", $$1, $$2}' $(MAKEFILE_LIST)

up: ## Build images, start every service, wait for health, run migrations.
	$(COMPOSE) up -d --build --wait
	$(APP_EXEC) php bin/console doctrine:migrations:migrate --no-interaction --allow-no-migration
	@echo
	@echo "  API:           http://localhost:$(HTTP_PORT)"
	@echo "  RabbitMQ UI:   http://localhost:$(RABBITMQ_MANAGEMENT_PORT)  (user: guest / pass: guest)"
	@echo

down: ## Stop and remove containers (keeps named volumes).
	$(COMPOSE) down

restart: ## Restart every service without rebuilding.
	$(COMPOSE) restart

build: ## Build the application image.
	$(COMPOSE) build

rebuild: ## Rebuild the application image with no cache.
	$(COMPOSE) build --no-cache

ps: ## Show the status of every service.
	$(COMPOSE) ps

logs: ## Tail logs for every service.
	$(COMPOSE) logs -f

shell: ## Open an interactive shell inside the app container.
	$(COMPOSE) exec app sh

migrate: ## Run database migrations against the dev database.
	$(APP_EXEC) php bin/console doctrine:migrations:migrate --no-interaction --allow-no-migration

clear-cache: ## Clear the Symfony cache inside the app container.
	$(APP_EXEC) php bin/console cache:clear

install: ## Install Composer dependencies inside the app container.
	$(APP_EXEC) composer install --no-interaction --prefer-dist

test: ## Run the full PHPUnit suite against the isolated test database.
	$(APP_EXEC) -e APP_ENV=test vendor/bin/phpunit

test-unit: ## Run only the unit suite inside the app container.
	$(APP_EXEC) -e APP_ENV=test vendor/bin/phpunit --testsuite=unit

test-functional: ## Run only the functional suite inside the app container.
	$(APP_EXEC) -e APP_ENV=test vendor/bin/phpunit --testsuite=functional
