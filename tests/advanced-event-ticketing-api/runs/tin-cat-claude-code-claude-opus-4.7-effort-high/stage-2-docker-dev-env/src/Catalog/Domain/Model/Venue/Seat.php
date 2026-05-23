<?php

declare(strict_types=1);

namespace Frontstage\Catalog\Domain\Model\Venue;

use Frontstage\Catalog\Domain\Model\PriceTier\PriceTierId;

/**
 * A single seat slot. Entity within the Event aggregate; its identity comes
 * from {@see SeatId} (section/row/number). Status is mutable so future
 * stages (reservation, sale) can transition it without leaving the aggregate.
 */
final class Seat
{
	public function __construct(
		public readonly SeatId $id,
		public readonly PriceTierId $priceTierId,
		private SeatStatus $status = SeatStatus::Available,
	) {
	}

	public function status(): SeatStatus
	{
		return $this->status;
	}

	public function isAvailable(): bool
	{
		return SeatStatus::Available === $this->status;
	}
}
