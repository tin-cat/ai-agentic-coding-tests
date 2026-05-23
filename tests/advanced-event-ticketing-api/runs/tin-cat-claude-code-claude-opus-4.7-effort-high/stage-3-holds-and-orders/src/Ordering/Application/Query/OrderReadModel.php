<?php

declare(strict_types=1);

namespace Frontstage\Ordering\Application\Query;

use Frontstage\Ordering\Application\Query\View\OrderView;
use Frontstage\Ordering\Domain\Model\Order\OrderId;

/**
 * Read-side port for orders. Returns denormalized views suitable for direct
 * JSON serialization; the write-side {@see \Frontstage\Ordering\Domain\Repository\OrderRepository}
 * is not used on the read path.
 */
interface OrderReadModel
{
	public function findById(OrderId $id): ?OrderView;
}
