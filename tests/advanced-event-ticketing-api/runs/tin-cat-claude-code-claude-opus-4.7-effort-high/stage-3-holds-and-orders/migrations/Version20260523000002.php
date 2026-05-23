<?php

declare(strict_types=1);

namespace DoctrineMigrations;

use Doctrine\DBAL\Schema\Schema;
use Doctrine\Migrations\AbstractMigration;

/**
 * Ordering schema: orders and their line items.
 */
final class Version20260523000002 extends AbstractMigration
{
	public function getDescription(): string
	{
		return 'Ordering schema (orders, order lines).';
	}

	public function up(Schema $schema): void
	{
		$this->addSql(<<<'SQL'
			CREATE TABLE ordering_orders (
				id VARCHAR(36) NOT NULL,
				event_id VARCHAR(36) NOT NULL,
				hold_id VARCHAR(36) NOT NULL,
				total_amount INT NOT NULL,
				total_currency VARCHAR(3) NOT NULL,
				status VARCHAR(20) NOT NULL,
				placed_at TIMESTAMP(0) WITHOUT TIME ZONE NOT NULL,
				PRIMARY KEY(id)
			)
		SQL);
		$this->addSql('CREATE INDEX idx_ordering_order_event ON ordering_orders (event_id)');
		$this->addSql("COMMENT ON COLUMN ordering_orders.placed_at IS '(DC2Type:datetime_immutable)'");

		$this->addSql(<<<'SQL'
			CREATE TABLE ordering_order_lines (
				id BIGSERIAL NOT NULL,
				order_id VARCHAR(36) NOT NULL,
				section VARCHAR(64) NOT NULL,
				row_label VARCHAR(64) NOT NULL,
				seat_number VARCHAR(32) NOT NULL,
				price_tier_id VARCHAR(63) NOT NULL,
				price_amount INT NOT NULL,
				price_currency VARCHAR(3) NOT NULL,
				PRIMARY KEY(id)
			)
		SQL);
		$this->addSql('CREATE INDEX idx_ordering_line_order ON ordering_order_lines (order_id)');
		$this->addSql('CREATE UNIQUE INDEX uniq_ordering_line_order_seat ON ordering_order_lines (order_id, section, row_label, seat_number)');
		$this->addSql(<<<'SQL'
			ALTER TABLE ordering_order_lines
			ADD CONSTRAINT fk_ordering_line_order
			FOREIGN KEY (order_id) REFERENCES ordering_orders (id)
			ON DELETE CASCADE NOT DEFERRABLE INITIALLY IMMEDIATE
		SQL);
	}

	public function down(Schema $schema): void
	{
		$this->addSql('DROP TABLE IF EXISTS ordering_order_lines');
		$this->addSql('DROP TABLE IF EXISTS ordering_orders');
	}
}
