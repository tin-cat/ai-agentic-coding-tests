<?php

declare(strict_types=1);

namespace Frontstage\Ordering\Infrastructure\Persistence\Doctrine\Entity;

use DateTimeImmutable;
use Doctrine\Common\Collections\ArrayCollection;
use Doctrine\Common\Collections\Collection;

/**
 * Persistence shape for an order. Lives entirely in the infrastructure layer;
 * the domain {@see \Frontstage\Ordering\Domain\Model\Order\Order} never
 * imports it.
 *
 * @internal infrastructure
 */
final class DoctrineOrder
{
	/** @var Collection<int, DoctrineOrderLine> */
	public Collection $lines;

	public function __construct(
		public string $id,
		public string $eventId,
		public string $holdId,
		public int $totalAmount,
		public string $totalCurrency,
		public string $status,
		public DateTimeImmutable $placedAt,
	) {
		$this->lines = new ArrayCollection();
	}
}
