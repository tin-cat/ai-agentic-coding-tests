<?php

declare(strict_types=1);

namespace Frontstage\Reservations\Application\Command\PlaceHold;

/**
 * Place a time-limited hold on seats for an event. Either name specific seats
 * (sectioned events) or pass a quantity for general admission and let the
 * system pick the seats.
 */
final class PlaceHoldCommand
{
	/**
	 * @param list<array{section:string, row:string, number:string}> $seats
	 */
	public function __construct(
		public readonly string $holdId,
		public readonly string $eventId,
		public readonly array $seats,
		public readonly ?int $quantity,
		public readonly int $ttlSeconds,
	) {
	}
}
