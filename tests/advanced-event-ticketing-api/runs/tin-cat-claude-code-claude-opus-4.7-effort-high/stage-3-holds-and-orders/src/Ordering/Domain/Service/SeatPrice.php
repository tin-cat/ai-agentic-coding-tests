<?php

declare(strict_types=1);

namespace Frontstage\Ordering\Domain\Service;

use Frontstage\Ordering\Domain\Model\Shared\Money;

final class SeatPrice
{
	public function __construct(
		public readonly string $priceTierId,
		public readonly Money $price,
	) {
	}
}
