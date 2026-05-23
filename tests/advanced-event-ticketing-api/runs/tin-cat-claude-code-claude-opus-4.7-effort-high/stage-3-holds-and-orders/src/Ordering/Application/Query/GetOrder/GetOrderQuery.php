<?php

declare(strict_types=1);

namespace Frontstage\Ordering\Application\Query\GetOrder;

final class GetOrderQuery
{
	public function __construct(public readonly string $orderId)
	{
	}
}
