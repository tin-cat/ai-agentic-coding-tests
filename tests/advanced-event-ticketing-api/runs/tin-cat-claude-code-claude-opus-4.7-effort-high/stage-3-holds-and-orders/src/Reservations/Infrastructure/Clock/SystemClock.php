<?php

declare(strict_types=1);

namespace Frontstage\Reservations\Infrastructure\Clock;

use DateTimeImmutable;
use DateTimeZone;
use Frontstage\Reservations\Domain\Service\Clock;

/**
 * Adapter that reads the wall clock. Tests substitute a controllable clock so
 * the suite never depends on real time.
 */
final class SystemClock implements Clock
{
	public function now(): DateTimeImmutable
	{
		return new DateTimeImmutable('now', new DateTimeZone('UTC'));
	}
}
