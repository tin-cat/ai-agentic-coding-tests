<?php

declare(strict_types=1);

namespace Frontstage\Catalog\Infrastructure\Persistence\Doctrine\Entity;

/**
 * @internal infrastructure
 */
final class DoctrineSeat
{
	public ?int $id = null;

	public function __construct(
		public DoctrineEvent $event,
		public string $section,
		public string $rowLabel,
		public string $seatNumber,
		public string $priceTierId,
		public string $status,
	) {
	}
}
