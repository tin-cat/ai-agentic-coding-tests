<?php

declare(strict_types=1);

namespace Frontstage\Ordering\Domain\Model\Shared;

use Frontstage\Ordering\Domain\Exception\InvalidArgument;

/**
 * ISO-4217 three-letter currency code.
 *
 * Deliberately local to the Ordering context: contexts communicate by value
 * snapshots, not by sharing domain types. The shape mirrors Catalog's own
 * Currency value object so a future shared-kernel extraction is mechanical.
 */
final class Currency
{
	private function __construct(public readonly string $code)
	{
	}

	public static function of(string $code): self
	{
		$normalized = strtoupper(trim($code));

		if (!preg_match('/^[A-Z]{3}$/', $normalized)) {
			throw new InvalidArgument('Currency must be an ISO-4217 three-letter code.');
		}

		return new self($normalized);
	}

	public function equals(Currency $other): bool
	{
		return $this->code === $other->code;
	}
}
