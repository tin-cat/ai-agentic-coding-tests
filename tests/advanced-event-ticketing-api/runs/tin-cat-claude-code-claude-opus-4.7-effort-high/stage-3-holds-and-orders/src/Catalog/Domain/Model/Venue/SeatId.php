<?php

declare(strict_types=1);

namespace Frontstage\Catalog\Domain\Model\Venue;

use Frontstage\Catalog\Domain\Exception\InvalidArgument;

/**
 * Locator for a seat within an event. Composite of the section name, row
 * label, and seat number; for general admission the row label is empty and
 * the seat number is the 1-based position in the GA pool.
 */
final class SeatId
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
			throw new InvalidArgument('SeatId section must not be empty.');
		}

		if ('' === $number) {
			throw new InvalidArgument('SeatId number must not be empty.');
		}

		return new self($section, $row, $number);
	}

	public function toString(): string
	{
		return sprintf('%s/%s/%s', $this->section, $this->row, $this->number);
	}

	public function equals(SeatId $other): bool
	{
		return $this->section === $other->section
			&& $this->row === $other->row
			&& $this->number === $other->number;
	}
}
