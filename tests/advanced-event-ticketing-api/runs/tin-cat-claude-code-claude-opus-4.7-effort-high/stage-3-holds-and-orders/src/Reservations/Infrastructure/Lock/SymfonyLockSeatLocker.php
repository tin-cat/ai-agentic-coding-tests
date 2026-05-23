<?php

declare(strict_types=1);

namespace Frontstage\Reservations\Infrastructure\Lock;

use Frontstage\Reservations\Domain\Model\Hold\HoldSeat;
use Frontstage\Reservations\Domain\Service\LockHandle;
use Frontstage\Reservations\Domain\Service\SeatLocker;
use Symfony\Component\Lock\LockFactory;

/**
 * Adapter for the {@see SeatLocker} port backed by Symfony's Lock component.
 *
 * Configured in production against Redis (`LOCK_DSN`) so locks coordinate
 * across application instances; tests fall back to `flock`. Locks have a TTL
 * so a crashed process can never block a seat forever.
 */
final class SymfonyLockSeatLocker implements SeatLocker
{
	private const TTL_SECONDS = 5.0;

	public function __construct(private readonly LockFactory $locks)
	{
	}

	public function acquire(string $eventId, HoldSeat $seat): ?LockHandle
	{
		$key = sprintf('reservations:lock:%s:%s', $eventId, $seat->toString());
		$lock = $this->locks->createLock($key, self::TTL_SECONDS, autoRelease: false);

		// Non-blocking: if anyone else holds the lock right now, we lose the
		// race and report the seat as unavailable rather than waiting in line.
		if (!$lock->acquire(false)) {
			return null;
		}

		return new class($lock) implements LockHandle {
			public function __construct(private readonly \Symfony\Component\Lock\LockInterface $lock)
			{
			}

			public function release(): void
			{
				if ($this->lock->isAcquired()) {
					$this->lock->release();
				}
			}
		};
	}
}
