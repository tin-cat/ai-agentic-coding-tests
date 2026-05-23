<?php

declare(strict_types=1);

namespace Frontstage\Reservations\Domain\Model\Hold;

use Frontstage\Reservations\Domain\Exception\InvalidArgument;

/**
 * A seat reference within the Reservations context. Mirrors the shape of the
 * Catalog seat locator (section / row / number) without depending on Catalog's
 * types — bounded contexts communicate through value snapshots, not by sharing
 * domain models.
 */
final class HoldSeat
{
	private function __construct(
		public readonly string $section,
		public readonly string $row,
		public readonly string $number,
	) {
	}

	public static function of(string $section, string $row, string $number): self
	{
		$section = trim($section);
		$row = trim($row);
		$number = trim($number);

		if ('' === $section) {
			throw new InvalidArgument('Seat section must not be empty.');
		}

		if ('' === $number) {
			throw new InvalidArgument('Seat number must not be empty.');
		}

		return new self($section, $row, $number);
	}

	public function toString(): string
	{
		return sprintf('%s/%s/%s', $this->section, $this->row, $this->number);
	}

	public function equals(HoldSeat $other): bool
	{
		return $this->section === $other->section
			&& $this->row === $other->row
			&& $this->number === $other->number;
	}
}
