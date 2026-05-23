<?php

declare(strict_types=1);

namespace Frontstage\Catalog\Domain\Model\Event;

use Frontstage\Catalog\Domain\Exception\InvalidArgument;

final class EventDescription
{
	private const MAX_LENGTH = 5000;

	private function __construct(public readonly string $value)
	{
	}

	public static function of(string $value): self
	{
		$trimmed = trim($value);

		if (mb_strlen($trimmed) > self::MAX_LENGTH) {
			throw new InvalidArgument(sprintf('Event description must be at most %d characters.', self::MAX_LENGTH));
		}

		return new self($trimmed);
	}
}
