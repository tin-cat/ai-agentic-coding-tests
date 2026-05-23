<?php

declare(strict_types=1);

namespace Frontstage\Catalog\Application\Query\View;

/**
 * Compact view of a published event, suitable for list endpoints. No seating
 * map: callers fetch the detail view when they want availability.
 */
final class EventSummaryView
{
	public function __construct(
		public readonly string $id,
		public readonly string $title,
		public readonly string $venueName,
		public readonly string $startsAtIso,
		public readonly int $totalCapacity,
		public readonly int $availableSeatCount,
	) {
	}

	/**
	 * @return array<string, mixed>
	 */
	public function toArray(): array
	{
		return [
			'id' => $this->id,
			'title' => $this->title,
			'venueName' => $this->venueName,
			'startsAt' => $this->startsAtIso,
			'totalCapacity' => $this->totalCapacity,
			'availableSeatCount' => $this->availableSeatCount,
		];
	}
}
