<?php

declare(strict_types=1);

namespace Frontstage\Ordering\Application\Command\PlaceOrder;

/**
 * Convert an active hold into a confirmed order. The hold's seats are sold,
 * the hold is consumed, and the order id is returned so the caller can fetch
 * it back.
 */
final class PlaceOrderCommand
{
	public function __construct(
		public readonly string $orderId,
		public readonly string $holdId,
	) {
	}
}
