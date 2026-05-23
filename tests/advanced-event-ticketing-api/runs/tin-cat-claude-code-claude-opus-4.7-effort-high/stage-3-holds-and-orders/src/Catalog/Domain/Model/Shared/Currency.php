<?php

declare(strict_types=1);

namespace Frontstage\Catalog\Domain\Model\Shared;

use Frontstage\Catalog\Domain\Exception\InvalidArgument;

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
