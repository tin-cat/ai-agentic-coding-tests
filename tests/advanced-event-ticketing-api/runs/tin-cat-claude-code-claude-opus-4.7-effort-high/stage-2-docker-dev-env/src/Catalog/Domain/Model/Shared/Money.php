<?php

declare(strict_types=1);

namespace Frontstage\Catalog\Domain\Model\Shared;

use Frontstage\Catalog\Domain\Exception\InvalidArgument;

/**
 * Money is a value object: an amount in the smallest currency unit (e.g.
 * cents) plus an ISO-4217 currency code. The domain never represents money
 * as a primitive int or float.
 */
final class Money
{
	private function __construct(
		public readonly int $amount,
		public readonly Currency $currency,
	) {
	}

	public static function of(int $amount, Currency $currency): self
	{
		if ($amount < 0) {
			throw new InvalidArgument('Money amount must be zero or positive.');
		}

		return new self($amount, $currency);
	}

	public function equals(Money $other): bool
	{
		return $this->amount === $other->amount
			&& $this->currency->equals($other->currency);
	}

	public function isZero(): bool
	{
		return $this->amount === 0;
	}
}
