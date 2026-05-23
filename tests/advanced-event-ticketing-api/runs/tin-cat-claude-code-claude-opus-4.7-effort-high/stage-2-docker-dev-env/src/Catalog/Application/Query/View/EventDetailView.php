<?php

declare(strict_types=1);

namespace Frontstage\Catalog\Application\Query\View;

/**
 * Full view of an event: metadata + price tiers + seating map with per-seat
 * availability. The view's shape is the wire format minus the JSON serialization.
 */
final class EventDetailView
{
	/**
	 * @param list<PriceTierView>             $priceTiers
	 * @param array<string, mixed>            $seating  serialized seating map (see buildSectioned/buildGa in DoctrineEventReadModel)
	 */
	public function __construct(
		public readonly string $id,
		public readonly string $title,
		public readonly string $description,
		public readonly string $startsAtIso,
		public readonly string $status,
		public readonly string $venueName,
		public readonly array $priceTiers,
		public readonly array $seating,
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
			'description' => $this->description,
			'startsAt' => $this->startsAtIso,
			'status' => $this->status,
			'venueName' => $this->venueName,
			'priceTiers' => array_map(static fn (PriceTierView $tier) => $tier->toArray(), $this->priceTiers),
			'seating' => $this->seating,
			'totalCapacity' => $this->totalCapacity,
			'availableSeatCount' => $this->availableSeatCount,
		];
	}
}
