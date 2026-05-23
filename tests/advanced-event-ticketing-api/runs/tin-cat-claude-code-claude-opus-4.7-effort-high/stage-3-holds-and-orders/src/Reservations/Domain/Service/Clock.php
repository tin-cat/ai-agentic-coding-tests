<?php

declare(strict_types=1);

namespace Frontstage\Reservations\Domain\Service;

use DateTimeImmutable;

/**
 * Time as a port so the domain never reads the system clock directly. Tests
 * can substitute a frozen or controllable clock without monkey-patching.
 */
interface Clock
{
	public function now(): DateTimeImmutable;
}
