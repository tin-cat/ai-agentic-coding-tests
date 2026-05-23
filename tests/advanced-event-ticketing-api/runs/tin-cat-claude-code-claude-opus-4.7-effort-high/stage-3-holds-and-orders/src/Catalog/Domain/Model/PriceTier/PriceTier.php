<?php

declare(strict_types=1);

namespace Frontstage\Catalog\Domain\Model\PriceTier;

use Frontstage\Catalog\Domain\Model\Shared\Money;

/**
 * A priced ticket category attached to an Event. Entity within the Event
 * aggregate: its identity is local to the event, and modifications happen
 * only through the aggregate root.
 */
final class PriceTier
{
	public function __construct(
		public readonly PriceTierId $id,
		public readonly PriceTierName $name,
		public readonly Money $price,
	) {
	}
}
