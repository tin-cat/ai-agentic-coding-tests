#!/bin/sh
# Provision an isolated database for the test suite alongside the dev database.
# Runs once on first container start (the postgres image executes everything in
# /docker-entrypoint-initdb.d/ before opening the listener for real workloads).
set -eu

: "${POSTGRES_USER:?POSTGRES_USER must be set}"
: "${POSTGRES_TEST_DB:=app_test}"

psql --username "$POSTGRES_USER" --dbname "$POSTGRES_DB" <<-SQL
	CREATE DATABASE "${POSTGRES_TEST_DB}" OWNER "${POSTGRES_USER}";
SQL
