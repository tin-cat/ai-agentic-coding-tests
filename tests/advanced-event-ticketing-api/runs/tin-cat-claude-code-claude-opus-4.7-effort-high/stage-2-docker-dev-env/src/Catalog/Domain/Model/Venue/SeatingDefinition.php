<?php

declare(strict_types=1);

namespace Frontstage\Catalog\Domain\Model\Venue;

use Frontstage\Catalog\Domain\Model\PriceTier\PriceTierId;

/**
 * A venue's seating is either explicitly mapped (sections of numbered seats)
 * or a single general-admission pool with a capacity. Both shapes implement
 * this port so the Event aggregate can hold one polymorphic value.
 *
 * Implementations: {@see SectionedSeating}, {@see GeneralAdmissionSeating}.
 */
interface SeatingDefinition
{
	/**
	 * Every seat slot the venue contains, regardless of section shape. For GA
	 * this yields one synthetic Seat per unit of capacity. For sectioned this
	 * yields every numbered seat. Useful for availability rollups.
	 *
	 * @return iterable<Seat>
	 */
	public function seats(): iterable;

	public function totalCapacity(): int;

	/**
	 * The set of distinct price tiers referenced by this seating definition.
	 * Used to validate that every referenced tier exists on the parent event.
	 *
	 * @return iterable<PriceTierId>
	 */
	public function referencedPriceTiers(): iterable;
}
