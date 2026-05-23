<?php

declare(strict_types=1);

namespace Frontstage\Reservations\Application\Query\GetAvailability;

final class GetAvailabilityQuery
{
	public function __construct(public readonly string $eventId)
	{
	}
}
