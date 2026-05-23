<?php

declare(strict_types=1);

namespace Frontstage\Ordering\Infrastructure\Persistence\Doctrine\Entity;

/**
 * Persistence shape for one sold seat within an order. Identity is generated
 * (the natural key is order + section + row + number, enforced by a unique
 * index in the schema).
 *
 * @internal infrastructure
 */
final class DoctrineOrderLine
{
	public ?int $id = null;

	public function __construct(
		public DoctrineOrder $order,
		public string $section,
		public string $rowLabel,
		public string $seatNumber,
		public string $priceTierId,
		public int $priceAmount,
		public string $priceCurrency,
	) {
	}
}
