<?php

declare(strict_types=1);

namespace Frontstage\Reservations\Domain\Exception;

use Frontstage\Reservations\Domain\Model\Hold\HoldId;
use RuntimeException;

final class HoldNotFound extends RuntimeException
{
	public static function withId(HoldId $id): self
	{
		return new self(sprintf('Hold "%s" does not exist or has expired.', $id->toString()));
	}
}
