<?php

declare(strict_types=1);

namespace Frontstage\Reservations\Application\Query\View;

/**
 * Event-level availability rollup. Lists every seat the event contains with
 * its current status (available/held/sold), plus aggregate counts.
 */
final class EventAvailabilityView
{
	/**
	 * @param list<SeatAvailabilityView> $seats
	 */
	public function __construct(
		public readonly string $eventId,
		public readonly array $seats,
		public readonly int $totalCapacity,
		public readonly int $availableCount,
		public readonly int $heldCount,
		public readonly int $soldCount,
	) {
	}

	/**
	 * @return array<string, mixed>
	 */
	public function toArray(): array
	{
		return [
			'eventId' => $this->eventId,
			'totalCapacity' => $this->totalCapacity,
			'availableCount' => $this->availableCount,
			'heldCount' => $this->heldCount,
			'soldCount' => $this->soldCount,
			'seats' => array_map(static fn (SeatAvailabilityView $s) => $s->toArray(), $this->seats),
		];
	}
}
