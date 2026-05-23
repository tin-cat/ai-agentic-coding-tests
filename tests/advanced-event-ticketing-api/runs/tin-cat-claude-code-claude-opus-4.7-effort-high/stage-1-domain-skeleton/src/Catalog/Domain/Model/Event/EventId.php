<?php

declare(strict_types=1);

namespace Frontstage\Catalog\Domain\Model\Event;

use Frontstage\Catalog\Domain\Exception\InvalidArgument;

/**
 * Identity of an Event aggregate. We accept any RFC-4122 UUID string; the
 * domain is agnostic to how it was generated so the application layer can
 * pick a generator (Symfony UID, Ramsey UUID, externally supplied id).
 */
final class EventId
{
	private const UUID_REGEX = '/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/';

	private function __construct(public readonly string $value)
	{
	}

	public static function fromString(string $value): self
	{
		$normalized = strtolower(trim($value));

		if (!preg_match(self::UUID_REGEX, $normalized)) {
			throw new InvalidArgument(sprintf('"%s" is not a valid event id.', $value));
		}

		return new self($normalized);
	}

	public function toString(): string
	{
		return $this->value;
	}

	public function equals(EventId $other): bool
	{
		return $this->value === $other->value;
	}
}
