<?php

declare(strict_types=1);

namespace Frontstage\Reservations\Domain\Service;

use Frontstage\Reservations\Domain\Model\Hold\HoldSeat;

/**
 * Port for serializing concurrent placement attempts on the same seat.
 *
 * A correct adapter (the Symfony Lock component over Redis in production)
 * gives at most one caller exclusive access to a given (eventId, seat) pair.
 * Two simultaneous requests to hold the same seat must not both succeed:
 * one acquires the lock and writes the hold, the other gets {@see acquire()}
 * returning null and must abort.
 */
interface SeatLocker
{
	/**
	 * Attempt to acquire an exclusive, time-bounded lock for the given seat.
	 * Returns a handle to release the lock, or null if the lock is currently
	 * held by another caller.
	 */
	public function acquire(string $eventId, HoldSeat $seat): ?LockHandle;
}
