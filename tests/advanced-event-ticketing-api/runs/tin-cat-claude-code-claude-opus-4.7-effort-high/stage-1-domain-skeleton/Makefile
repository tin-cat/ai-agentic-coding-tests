.PHONY: install test test-unit test-functional clear-cache migrate

install:
	composer install

test:
	composer test

test-unit:
	vendor/bin/phpunit --testsuite=unit

test-functional:
	vendor/bin/phpunit --testsuite=functional

clear-cache:
	php bin/console cache:clear

migrate:
	php bin/console doctrine:migrations:migrate --no-interaction
