<?php

declare(strict_types=1);

namespace Frontstage\Catalog\Domain\Model\Venue;

use Frontstage\Catalog\Domain\Exception\InvalidArgument;

final class Row
{
	/** @var list<Seat> */
	private array $seats;

	/**
	 * @param list<Seat> $seats
	 */
	public function __construct(public readonly string $label, array $seats)
	{
		if ('' === trim($label)) {
			throw new InvalidArgument('Row label must not be empty.');
		}

		if ([] === $seats) {
			throw new InvalidArgument('Row must contain at least one seat.');
		}

		$this->seats = array_values($seats);
	}

	/** @return list<Seat> */
	public function seats(): array
	{
		return $this->seats;
	}
}
