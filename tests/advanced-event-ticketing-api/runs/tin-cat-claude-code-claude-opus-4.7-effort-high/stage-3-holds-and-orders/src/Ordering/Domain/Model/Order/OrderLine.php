<?php

declare(strict_types=1);

namespace Frontstage\Ordering\Domain\Model\Order;

use Frontstage\Ordering\Domain\Exception\InvalidArgument;
use Frontstage\Ordering\Domain\Model\Shared\Money;

/**
 * A single seat sold on an order. Value object owned by the {@see Order}
 * aggregate; identity comes from the (section, row, number) tuple within the
 * order's event.
 */
final class OrderLine
{
	public function __construct(
		public readonly string $section,
		public readonly string $row,
		public readonly string $number,
		public readonly string $priceTierId,
		public readonly Money $price,
	) {
		if ('' === trim($section)) {
			throw new InvalidArgument('OrderLine section must not be empty.');
		}
		if ('' === trim($number)) {
			throw new InvalidArgument('OrderLine seat number must not be empty.');
		}
		if ('' === trim($priceTierId)) {
			throw new InvalidArgument('OrderLine price tier must not be empty.');
		}
	}

	public function seatKey(): string
	{
		return sprintf('%s/%s/%s', $this->section, $this->row, $this->number);
	}
}
