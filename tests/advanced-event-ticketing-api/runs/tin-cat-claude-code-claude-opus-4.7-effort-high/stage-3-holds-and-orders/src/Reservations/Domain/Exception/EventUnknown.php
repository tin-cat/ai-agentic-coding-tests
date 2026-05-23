<?php

declare(strict_types=1);

namespace Frontstage\Reservations\Domain\Exception;

use RuntimeException;

final class EventUnknown extends RuntimeException
{
	public static function withId(string $eventId): self
	{
		return new self(sprintf('Event "%s" is not known to the reservations context.', $eventId));
	}
}
