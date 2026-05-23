<?php

declare(strict_types=1);

namespace Frontstage\Ordering\Infrastructure\Persistence\Doctrine;

use Doctrine\ORM\EntityManagerInterface;
use Frontstage\Ordering\Domain\Exception\OrderNotFound;
use Frontstage\Ordering\Domain\Model\Order\Order;
use Frontstage\Ordering\Domain\Model\Order\OrderId;
use Frontstage\Ordering\Domain\Repository\OrderRepository;
use Frontstage\Ordering\Infrastructure\Persistence\Doctrine\Entity\DoctrineOrder;

final class DoctrineOrderRepository implements OrderRepository
{
	public function __construct(
		private readonly EntityManagerInterface $em,
		private readonly OrderMapper $mapper,
	) {
	}

	public function save(Order $order): void
	{
		$row = $this->mapper->toDoctrine($order);
		$this->em->persist($row);
		$this->em->flush();
	}

	public function get(OrderId $id): Order
	{
		$order = $this->find($id);
		if (null === $order) {
			throw OrderNotFound::withId($id);
		}

		return $order;
	}

	public function find(OrderId $id): ?Order
	{
		$row = $this->em->find(DoctrineOrder::class, $id->toString());
		if (null === $row) {
			return null;
		}

		return $this->mapper->toDomain($row);
	}
}
