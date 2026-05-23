<?php

declare(strict_types=1);

namespace Frontstage\Reservations\Domain\Service;

use Frontstage\Reservations\Domain\Model\Hold\HoldSeat;

/**
 * Read-only view of an event's seat inventory, as far as the Reservations
 * context needs to know it. Implemented in the infrastructure layer by an
 * adapter over the Catalog context's published surface; the Reservations
 * domain never imports Catalog types directly.
 */
interface EventSeats
{
	public function eventExists(string $eventId): bool;

	/**
	 * @param list<HoldSeat> $seats
	 *
	 * @return list<HoldSeat> the subset of $seats that the event does not
	 *                        actually contain — empty if every seat exists.
	 */
	public function unknownSeats(string $eventId, array $seats): array;

	/**
	 * Seats already marked sold in the source-of-truth inventory. Held seats
	 * (which live only in Redis) are not reported here.
	 *
	 * @return list<HoldSeat>
	 */
	public function soldSeats(string $eventId): array;

	/**
	 * Pick up to $quantity general-admission seats that the event has not yet
	 * sold. Used when a customer asks for "any N tickets" rather than naming
	 * specific seats. The set of returned seats is deterministic but the
	 * caller is still responsible for racing other holders for them under a
	 * lock.
	 *
	 * @return list<HoldSeat>
	 */
	public function pickGeneralAdmissionSeats(string $eventId, int $quantity): array;
}
