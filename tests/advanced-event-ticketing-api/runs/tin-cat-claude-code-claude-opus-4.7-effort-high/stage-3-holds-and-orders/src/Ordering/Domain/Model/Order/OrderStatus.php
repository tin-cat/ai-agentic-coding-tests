<?php

declare(strict_types=1);

namespace Frontstage\Ordering\Domain\Model\Order;

enum OrderStatus: string
{
	case Placed = 'placed';
}
