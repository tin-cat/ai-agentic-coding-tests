<?php

declare(strict_types=1);

namespace Frontstage\Ordering\Domain\Repository;

use Frontstage\Ordering\Domain\Exception\OrderNotFound;
use Frontstage\Ordering\Domain\Model\Order\Order;
use Frontstage\Ordering\Domain\Model\Order\OrderId;

/**
 * Domain port for Order persistence. The Doctrine adapter in the
 * infrastructure layer implements this contract.
 */
interface OrderRepository
{
	public function save(Order $order): void;

	/**
	 * @throws OrderNotFound when no order matches the given id.
	 */
	public function get(OrderId $id): Order;

	public function find(OrderId $id): ?Order;
}
