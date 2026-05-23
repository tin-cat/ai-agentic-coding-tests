<?php

declare(strict_types=1);

namespace Frontstage\Reservations\Application\Query\View;

/**
 * Per-seat availability snapshot for an event. The status is one of
 * "available", "held", or "sold" — the wire-level union of the catalog
 * state and the Reservations hold store.
 */
final class SeatAvailabilityView
{
	public function __construct(
		public readonly string $section,
		public readonly string $row,
		public readonly string $number,
		public readonly string $priceTierId,
		public readonly string $status,
	) {
	}

	/**
	 * @return array<string, mixed>
	 */
	public function toArray(): array
	{
		return [
			'section' => $this->section,
			'row' => $this->row,
			'number' => $this->number,
			'priceTierId' => $this->priceTierId,
			'status' => $this->status,
			'available' => 'available' === $this->status,
		];
	}
}
