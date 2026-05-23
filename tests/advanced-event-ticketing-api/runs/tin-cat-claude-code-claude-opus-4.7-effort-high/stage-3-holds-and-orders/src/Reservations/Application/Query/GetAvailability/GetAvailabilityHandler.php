<?php

declare(strict_types=1);

namespace Frontstage\Reservations\Application\Query\GetAvailability;

use Frontstage\Reservations\Application\Query\AvailabilityReadModel;
use Frontstage\Reservations\Application\Query\View\EventAvailabilityView;
use Frontstage\Reservations\Domain\Exception\EventUnknown;
use Symfony\Component\Messenger\Attribute\AsMessageHandler;

#[AsMessageHandler(bus: 'query.bus')]
final class GetAvailabilityHandler
{
	public function __construct(private readonly AvailabilityReadModel $availability)
	{
	}

	public function __invoke(GetAvailabilityQuery $query): EventAvailabilityView
	{
		$view = $this->availability->forEvent($query->eventId);
		if (null === $view) {
			throw EventUnknown::withId($query->eventId);
		}

		return $view;
	}
}
