<?php

declare(strict_types=1);

namespace Frontstage\Catalog\Domain\Exception;

use DomainException;
use Frontstage\Catalog\Domain\Model\Venue\SeatId;

final class InvalidEventState extends DomainException
{
	public static function alreadyPublished(): self
	{
		return new self('Event has already been published.');
	}

	public static function seatAlreadySold(SeatId $id): self
	{
		return new self(sprintf('Seat "%s" has already been sold.', $id->toString()));
	}
}
