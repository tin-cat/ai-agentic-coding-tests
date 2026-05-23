<?php

declare(strict_types=1);

namespace Frontstage\Catalog\Domain\Model\PriceTier;

use Frontstage\Catalog\Domain\Exception\InvalidArgument;

/**
 * Identity of a price tier within an event. We use organizer-supplied slugs
 * (e.g. "general", "vip") rather than UUIDs so the API payload reads
 * naturally and seats can reference tiers by stable, human-meaningful names.
 */
final class PriceTierId
{
	private const REGEX = '/^[a-z0-9][a-z0-9_-]{0,62}$/';

	private function __construct(public readonly string $value)
	{
	}

	public static function of(string $value): self
	{
		$normalized = strtolower(trim($value));

		if (!preg_match(self::REGEX, $normalized)) {
			throw new InvalidArgument(sprintf('"%s" is not a valid price tier id (lowercase letters, digits, hyphen, underscore; max 63 chars).', $value));
		}

		return new self($normalized);
	}

	public function equals(PriceTierId $other): bool
	{
		return $this->value === $other->value;
	}
}
