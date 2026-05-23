<?php

declare(strict_types=1);

namespace Frontstage\Catalog\Domain\Model\Event;

use DateTimeImmutable;
use DateTimeZone;
use Frontstage\Catalog\Domain\Exception\InvalidArgument;

/**
 * The instant an event begins. Always stored in UTC. The value object refuses
 * any input that isn't already UTC: callers must convert before constructing
 * to avoid silent timezone bugs.
 */
final class StartsAt
{
	private function __construct(public readonly DateTimeImmutable $value)
	{
	}

	public static function fromDateTime(DateTimeImmutable $dateTime): self
	{
		if ('UTC' !== $dateTime->getTimezone()->getName()) {
			throw new InvalidArgument('StartsAt must be in UTC.');
		}

		return new self($dateTime);
	}

	public static function fromIsoString(string $iso): self
	{
		$dateTime = DateTimeImmutable::createFromFormat(DATE_ATOM, $iso, new DateTimeZone('UTC'));

		if (false === $dateTime) {
			throw new InvalidArgument(sprintf('"%s" is not a valid ISO-8601 datetime.', $iso));
		}

		// createFromFormat preserves the offset from the parsed string, so
		// normalize to UTC after parsing.
		return new self($dateTime->setTimezone(new DateTimeZone('UTC')));
	}

	public function toIsoString(): string
	{
		return $this->value->format(DATE_ATOM);
	}
}
