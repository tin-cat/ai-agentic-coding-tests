<?php

declare(strict_types=1);

namespace Frontstage\Reservations\Domain\Repository;

use Frontstage\Reservations\Domain\Exception\HoldNotFound;
use Frontstage\Reservations\Domain\Model\Hold\Hold;
use Frontstage\Reservations\Domain\Model\Hold\HoldId;
use Frontstage\Reservations\Domain\Model\Hold\HoldSeat;

/**
 * Domain port for Hold persistence. Adapters in the infrastructure layer
 * store holds in a TTL-aware backend (Redis today) so expiry is enforced by
 * the storage rather than by application code.
 */
interface HoldRepository
{
	/**
	 * Persist a hold with a TTL derived from {@see Hold::ttlSecondsFrom()}.
	 * Implementations also record per-seat markers under the hold's event so
	 * {@see seatHoldId()} can answer concurrent placement attempts.
	 */
	public function save(Hold $hold): void;

	/**
	 * @throws HoldNotFound when no live hold matches the given id.
	 */
	public function get(HoldId $id): Hold;

	public function find(HoldId $id): ?Hold;

	/**
	 * Delete a hold and its per-seat markers. Idempotent: deleting a hold that
	 * has already expired or been removed is a no-op.
	 */
	public function delete(HoldId $id): void;

	/**
	 * Return the id of the live hold currently covering this seat for this
	 * event, or null if none. Used by both the placement path (to refuse a
	 * second hold on a seat) and the availability projection.
	 */
	public function seatHoldId(string $eventId, HoldSeat $seat): ?HoldId;

	/**
	 * @return list<HoldSeat> seats currently held for the given event.
	 */
	public function heldSeatsForEvent(string $eventId): array;
}
