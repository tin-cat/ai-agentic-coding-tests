<?php

declare(strict_types=1);

namespace Frontstage\Ordering\Domain\Service;

/**
 * Port through which Ordering tells Catalog that seats have been sold. The
 * infrastructure adapter invokes Catalog's aggregate methods — the Ordering
 * domain never reaches into Catalog's model itself.
 */
interface SeatSales
{
	/**
	 * Mark every given seat as sold for the given event. The implementation
	 * is responsible for atomicity: either every seat transitions or none do.
	 *
	 * @param list<array{section:string, row:string, number:string}> $seats
	 */
	public function markSold(string $eventId, array $seats): void;
}
