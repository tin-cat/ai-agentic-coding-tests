<?php

declare(strict_types=1);

namespace Frontstage\Catalog\Domain\Model\PriceTier;

use Frontstage\Catalog\Domain\Exception\InvalidArgument;

final class PriceTierName
{
	private const MAX_LENGTH = 100;

	private function __construct(public readonly string $value)
	{
	}

	public static function of(string $value): self
	{
		$trimmed = trim($value);

		if ('' === $trimmed) {
			throw new InvalidArgument('Price tier name must not be empty.');
		}

		if (mb_strlen($trimmed) > self::MAX_LENGTH) {
			throw new InvalidArgument(sprintf('Price tier name must be at most %d characters.', self::MAX_LENGTH));
		}

		return new self($trimmed);
	}
}
