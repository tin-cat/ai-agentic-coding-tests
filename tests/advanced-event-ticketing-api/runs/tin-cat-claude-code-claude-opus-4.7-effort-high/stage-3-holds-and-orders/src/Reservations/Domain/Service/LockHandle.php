<?php

declare(strict_types=1);

namespace Frontstage\Reservations\Domain\Service;

/**
 * Opaque handle returned by {@see SeatLocker::acquire()}. Released explicitly
 * once the protected section finishes (success or failure).
 */
interface LockHandle
{
	public function release(): void;
}
