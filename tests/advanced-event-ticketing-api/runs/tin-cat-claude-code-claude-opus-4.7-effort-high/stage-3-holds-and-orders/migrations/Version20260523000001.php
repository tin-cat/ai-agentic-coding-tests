<?php

declare(strict_types=1);

namespace DoctrineMigrations;

use Doctrine\DBAL\Schema\Schema;
use Doctrine\Migrations\AbstractMigration;

/**
 * Initial Catalog schema: events, price tiers, seats.
 */
final class Version20260523000001 extends AbstractMigration
{
	public function getDescription(): string
	{
		return 'Initial Catalog schema (events, price tiers, seats).';
	}

	public function up(Schema $schema): void
	{
		$this->addSql(<<<'SQL'
			CREATE TABLE catalog_events (
				id VARCHAR(36) NOT NULL,
				title VARCHAR(200) NOT NULL,
				description TEXT NOT NULL,
				starts_at TIMESTAMP(0) WITHOUT TIME ZONE NOT NULL,
				status VARCHAR(20) NOT NULL,
				venue_name VARCHAR(200) NOT NULL,
				seating_type VARCHAR(32) NOT NULL,
				ga_capacity INT DEFAULT NULL,
				ga_price_tier_id VARCHAR(63) DEFAULT NULL,
				PRIMARY KEY(id)
			)
		SQL);
		$this->addSql("COMMENT ON COLUMN catalog_events.starts_at IS '(DC2Type:datetime_immutable)'");

		$this->addSql(<<<'SQL'
			CREATE TABLE catalog_price_tiers (
				id SERIAL NOT NULL,
				event_id VARCHAR(36) NOT NULL,
				tier_id VARCHAR(63) NOT NULL,
				name VARCHAR(100) NOT NULL,
				price_amount INT NOT NULL,
				price_currency VARCHAR(3) NOT NULL,
				PRIMARY KEY(id)
			)
		SQL);
		$this->addSql('CREATE INDEX idx_catalog_price_tier_event ON catalog_price_tiers (event_id)');
		$this->addSql('CREATE UNIQUE INDEX uniq_catalog_price_tier_event_tier ON catalog_price_tiers (event_id, tier_id)');
		$this->addSql(<<<'SQL'
			ALTER TABLE catalog_price_tiers
			ADD CONSTRAINT fk_catalog_price_tier_event
			FOREIGN KEY (event_id) REFERENCES catalog_events (id)
			ON DELETE CASCADE NOT DEFERRABLE INITIALLY IMMEDIATE
		SQL);

		$this->addSql(<<<'SQL'
			CREATE TABLE catalog_seats (
				id BIGSERIAL NOT NULL,
				event_id VARCHAR(36) NOT NULL,
				section VARCHAR(64) NOT NULL,
				row_label VARCHAR(64) NOT NULL,
				seat_number VARCHAR(32) NOT NULL,
				price_tier_id VARCHAR(63) NOT NULL,
				status VARCHAR(20) NOT NULL,
				PRIMARY KEY(id)
			)
		SQL);
		$this->addSql('CREATE INDEX idx_catalog_seat_event ON catalog_seats (event_id)');
		$this->addSql('CREATE UNIQUE INDEX uniq_catalog_seat_event_loc ON catalog_seats (event_id, section, row_label, seat_number)');
		$this->addSql(<<<'SQL'
			ALTER TABLE catalog_seats
			ADD CONSTRAINT fk_catalog_seat_event
			FOREIGN KEY (event_id) REFERENCES catalog_events (id)
			ON DELETE CASCADE NOT DEFERRABLE INITIALLY IMMEDIATE
		SQL);
	}

	public function down(Schema $schema): void
	{
		$this->addSql('DROP TABLE IF EXISTS catalog_seats');
		$this->addSql('DROP TABLE IF EXISTS catalog_price_tiers');
		$this->addSql('DROP TABLE IF EXISTS catalog_events');
	}
}
