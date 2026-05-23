<?php

declare(strict_types=1);

namespace Frontstage\Catalog\Infrastructure\Persistence\Doctrine\Entity;

use DateTimeImmutable;
use Doctrine\Common\Collections\ArrayCollection;
use Doctrine\Common\Collections\Collection;

/**
 * Persistence shape for an event. This class is the Doctrine-facing model
 * and never leaves the infrastructure layer. The domain {@see \Frontstage\Catalog\Domain\Model\Event\Event}
 * is mapped to/from this class by {@see \Frontstage\Catalog\Infrastructure\Persistence\Doctrine\EventMapper}.
 *
 * Public properties so the mapper can hydrate directly without ceremony.
 * Doctrine sets fields via reflection; no annotations needed because the
 * mapping is configured in XML.
 *
 * @internal infrastructure
 */
final class DoctrineEvent
{
	/** @var Collection<int, DoctrinePriceTier> */
	public Collection $priceTiers;

	/** @var Collection<int, DoctrineSeat> */
	public Collection $seats;

	public function __construct(
		public string $id,
		public string $title,
		public string $description,
		public DateTimeImmutable $startsAt,
		public string $status,
		public string $venueName,
		public string $seatingType,
		public ?int $gaCapacity = null,
		public ?string $gaPriceTierId = null,
	) {
		$this->priceTiers = new ArrayCollection();
		$this->seats = new ArrayCollection();
	}
}
