<?php

declare(strict_types=1);

namespace Frontstage\Ordering\Domain\Service;

use Frontstage\Ordering\Domain\Model\Shared\Money;

/**
 * Port through which Ordering reads pricing information from Catalog.
 * Returns a price-tier identifier (a stable slug) and the Money it costs for
 * a given seat. Implementations live in the infrastructure layer.
 */
interface EventPricing
{
	/**
	 * @return SeatPrice price for this seat, or null if the seat is not part
	 *                   of the event.
	 */
	public function priceFor(string $eventId, string $section, string $row, string $number): ?SeatPrice;
}
