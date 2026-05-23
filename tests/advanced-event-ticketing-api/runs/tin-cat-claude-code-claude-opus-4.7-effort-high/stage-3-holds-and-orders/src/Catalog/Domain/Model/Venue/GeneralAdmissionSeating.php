<?php

declare(strict_types=1);

namespace Frontstage\Catalog\Domain\Model\Venue;

use Frontstage\Catalog\Domain\Exception\InvalidArgument;
use Frontstage\Catalog\Domain\Model\PriceTier\PriceTierId;

/**
 * A single pool of unreserved seats with a fixed capacity, all charged at one
 * price tier. The aggregate still materializes one {@see Seat} per unit of
 * capacity (with empty row label and a 1-based number) so availability rolls
 * up uniformly with sectioned events.
 */
final class GeneralAdmissionSeating implements SeatingDefinition
{
	private const SECTION_NAME = 'GA';

	/** @var list<Seat> */
	private array $seats;

	public function __construct(
		public readonly int $capacity,
		public readonly PriceTierId $priceTierId,
	) {
		if ($capacity < 1) {
			throw new InvalidArgument('General admission capacity must be at least 1.');
		}

		$seats = [];
		for ($i = 1; $i <= $capacity; ++$i) {
			$seats[] = new Seat(
				SeatId::of(self::SECTION_NAME, '', (string) $i),
				$priceTierId,
			);
		}
		$this->seats = $seats;
	}

	public function seats(): iterable
	{
		foreach ($this->seats as $seat) {
			yield $seat;
		}
	}

	public function totalCapacity(): int
	{
		return $this->capacity;
	}

	public function referencedPriceTiers(): iterable
	{
		yield $this->priceTierId;
	}

	public function sectionName(): string
	{
		return self::SECTION_NAME;
	}
}
