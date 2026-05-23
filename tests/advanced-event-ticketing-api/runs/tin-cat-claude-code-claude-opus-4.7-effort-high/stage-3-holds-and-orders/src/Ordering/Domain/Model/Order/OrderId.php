<?php

declare(strict_types=1);

namespace Frontstage\Ordering\Domain\Model\Order;

use Frontstage\Ordering\Domain\Exception\InvalidArgument;

final class OrderId
{
	private const UUID_REGEX = '/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/';

	private function __construct(public readonly string $value)
	{
	}

	public static function fromString(string $value): self
	{
		$normalized = strtolower(trim($value));

		if (!preg_match(self::UUID_REGEX, $normalized)) {
			throw new InvalidArgument(sprintf('"%s" is not a valid order id.', $value));
		}

		return new self($normalized);
	}

	public function toString(): string
	{
		return $this->value;
	}

	public function equals(OrderId $other): bool
	{
		return $this->value === $other->value;
	}
}
