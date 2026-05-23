<?php

declare(strict_types=1);

namespace Frontstage\Ordering\Domain\Model\Shared;

use Frontstage\Ordering\Domain\Exception\InvalidArgument;

/**
 * Money value object: integer minor units (cents for USD) plus a currency.
 * Local to the Ordering context for the same reasons as {@see Currency}.
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

	public static function zero(Currency $currency): self
	{
		return new self(0, $currency);
	}

	public function add(Money $other): self
	{
		if (!$this->currency->equals($other->currency)) {
			throw new InvalidArgument(sprintf(
				'Cannot add Money values in different currencies (%s + %s).',
				$this->currency->code,
				$other->currency->code,
			));
		}

		return new self($this->amount + $other->amount, $this->currency);
	}

	public function equals(Money $other): bool
	{
		return $this->amount === $other->amount
			&& $this->currency->equals($other->currency);
	}
}
