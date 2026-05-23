<?php

declare(strict_types=1);

namespace Frontstage\Ordering\Domain\Service;

/**
 * Immutable snapshot of a hold as observed by Ordering. Carries only the
 * fields Ordering actually needs to build an order; richer Hold state stays
 * inside the Reservations context.
 */
final class HoldSnapshot
{
	/**
	 * @param list<array{section:string, row:string, number:string}> $seats
	 */
	public function __construct(
		public readonly string $holdId,
		public readonly string $eventId,
		public readonly array $seats,
	) {
	}
}
