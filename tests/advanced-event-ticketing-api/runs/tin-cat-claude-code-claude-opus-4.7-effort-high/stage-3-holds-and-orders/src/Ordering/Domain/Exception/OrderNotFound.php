<?php

declare(strict_types=1);

namespace Frontstage\Ordering\Domain\Exception;

use Frontstage\Ordering\Domain\Model\Order\OrderId;
use RuntimeException;

final class OrderNotFound extends RuntimeException
{
	public static function withId(OrderId $id): self
	{
		return new self(sprintf('Order "%s" does not exist.', $id->toString()));
	}
}
