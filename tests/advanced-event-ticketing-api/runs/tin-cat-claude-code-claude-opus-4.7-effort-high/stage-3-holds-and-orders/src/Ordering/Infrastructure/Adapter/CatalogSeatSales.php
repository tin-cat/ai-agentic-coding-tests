<?php

declare(strict_types=1);

namespace Frontstage\Ordering\Infrastructure\Adapter;

use Frontstage\Catalog\Domain\Model\Event\EventId;
use Frontstage\Catalog\Domain\Model\Venue\SeatId;
use Frontstage\Catalog\Domain\Repository\EventRepository;
use Frontstage\Ordering\Domain\Service\SeatSales;

/**
 * Ordering→Catalog adapter for the {@see SeatSales} port. Loads the Catalog
 * Event aggregate, calls its `markSeatsSold` method, and saves it back. The
 * Ordering domain never reaches into Catalog directly — the dependency is
 * confined to this adapter in the infrastructure layer.
 */
final class CatalogSeatSales implements SeatSales
{
	public function __construct(private readonly EventRepository $events)
	{
	}

	public function markSold(string $eventId, array $seats): void
	{
		$event = $this->events->get(EventId::fromString($eventId));

		$seatIds = [];
		foreach ($seats as $seat) {
			$seatIds[] = SeatId::of(
				(string) $seat['section'],
				(string) $seat['row'],
				(string) $seat['number'],
			);
		}

		$event->markSeatsSold($seatIds);
		$this->events->save($event);
	}
}
