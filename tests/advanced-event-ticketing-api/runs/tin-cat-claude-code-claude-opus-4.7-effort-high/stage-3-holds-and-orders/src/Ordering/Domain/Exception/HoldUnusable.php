<?php

declare(strict_types=1);

namespace Frontstage\Ordering\Domain\Exception;

use DomainException;

/**
 * Raised when a hold cannot be turned into an order — most often because it
 * has already expired, been released, or already been consumed by an earlier
 * order.
 */
final class HoldUnusable extends DomainException
{
	public static function notLive(string $holdId): self
	{
		return new self(sprintf('Hold "%s" is no longer live and cannot be ordered.', $holdId));
	}

	public static function seatSold(string $seat): self
	{
		return new self(sprintf('Seat "%s" has already been sold and cannot be ordered.', $seat));
	}
}
