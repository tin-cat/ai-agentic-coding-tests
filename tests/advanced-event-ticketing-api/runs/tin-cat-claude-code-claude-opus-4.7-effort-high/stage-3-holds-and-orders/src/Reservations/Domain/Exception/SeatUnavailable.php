<?php

declare(strict_types=1);

namespace Frontstage\Reservations\Domain\Exception;

use DomainException;
use Frontstage\Reservations\Domain\Model\Hold\HoldSeat;

/**
 * Raised when a hold cannot be placed because one or more requested seats are
 * already held by another customer or have been sold.
 */
final class SeatUnavailable extends DomainException
{
	public static function forSeat(HoldSeat $seat): self
	{
		return new self(sprintf('Seat "%s" is not available.', $seat->toString()));
	}

	public static function notEnoughCapacity(int $requested, int $available): self
	{
		return new self(sprintf(
			'Requested %d seats but only %d are available.',
			$requested,
			$available,
		));
	}
}
