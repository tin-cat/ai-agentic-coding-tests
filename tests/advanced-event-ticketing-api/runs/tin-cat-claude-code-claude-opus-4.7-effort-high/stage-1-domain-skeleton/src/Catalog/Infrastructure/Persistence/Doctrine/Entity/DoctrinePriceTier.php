<?php

declare(strict_types=1);

namespace Frontstage\Catalog\Infrastructure\Persistence\Doctrine\Entity;

/**
 * @internal infrastructure
 */
final class DoctrinePriceTier
{
	public ?int $id = null;

	public function __construct(
		public DoctrineEvent $event,
		public string $tierId,
		public string $name,
		public int $priceAmount,
		public string $priceCurrency,
	) {
	}
}
