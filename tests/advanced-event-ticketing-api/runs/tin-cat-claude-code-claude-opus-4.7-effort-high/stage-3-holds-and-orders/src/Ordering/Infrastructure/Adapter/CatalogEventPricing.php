<?php

declare(strict_types=1);

namespace Frontstage\Ordering\Infrastructure\Adapter;

use Doctrine\DBAL\Connection;
use Frontstage\Ordering\Domain\Model\Shared\Currency;
use Frontstage\Ordering\Domain\Model\Shared\Money;
use Frontstage\Ordering\Domain\Service\EventPricing;
use Frontstage\Ordering\Domain\Service\SeatPrice;

/**
 * Ordering→Catalog adapter for the {@see EventPricing} port. Reads catalog
 * tables directly via DBAL to avoid loading the entire Event aggregate just
 * to price a handful of seats.
 */
final class CatalogEventPricing implements EventPricing
{
	public function __construct(private readonly Connection $connection)
	{
	}

	public function priceFor(string $eventId, string $section, string $row, string $number): ?SeatPrice
	{
		$result = $this->connection->fetchAssociative(
			'SELECT t.tier_id, t.price_amount, t.price_currency
			 FROM catalog_seats s
			 INNER JOIN catalog_price_tiers t
			    ON t.event_id = s.event_id AND t.tier_id = s.price_tier_id
			 WHERE s.event_id = :event_id
			   AND s.section = :section
			   AND s.row_label = :row
			   AND s.seat_number = :number',
			[
				'event_id' => $eventId,
				'section' => $section,
				'row' => $row,
				'number' => $number,
			],
		);

		if (false === $result) {
			return null;
		}

		return new SeatPrice(
			priceTierId: (string) $result['tier_id'],
			price: Money::of(
				(int) $result['price_amount'],
				Currency::of((string) $result['price_currency']),
			),
		);
	}
}
