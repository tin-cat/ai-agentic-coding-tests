<?php

declare(strict_types=1);

namespace Frontstage\Catalog\Domain\Model\Venue;

/**
 * A venue paired with its seating definition. Value object: two venues with
 * the same name and seating layout are interchangeable. The Event aggregate
 * owns its Venue rather than referencing an externally managed catalog.
 */
final class Venue
{
	public function __construct(
		public readonly VenueName $name,
		public readonly SeatingDefinition $seating,
	) {
	}
}
