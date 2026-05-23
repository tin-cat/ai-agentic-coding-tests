<?php

declare(strict_types=1);

namespace Frontstage\Catalog\Domain\Model\Venue;

use Frontstage\Catalog\Domain\Exception\InvalidArgument;

final class SectionedSeating implements SeatingDefinition
{
	/** @var list<Section> */
	private array $sections;

	/**
	 * @param list<Section> $sections
	 */
	public function __construct(array $sections)
	{
		if ([] === $sections) {
			throw new InvalidArgument('Sectioned seating requires at least one section.');
		}

		$seen = [];
		foreach ($sections as $section) {
			if (isset($seen[$section->name])) {
				throw new InvalidArgument(sprintf('Duplicate section name "%s".', $section->name));
			}
			$seen[$section->name] = true;
		}

		$this->sections = array_values($sections);
	}

	/** @return list<Section> */
	public function sections(): array
	{
		return $this->sections;
	}

	public function seats(): iterable
	{
		foreach ($this->sections as $section) {
			foreach ($section->rows() as $row) {
				foreach ($row->seats() as $seat) {
					yield $seat;
				}
			}
		}
	}

	public function totalCapacity(): int
	{
		$total = 0;
		foreach ($this->sections as $section) {
			foreach ($section->rows() as $row) {
				$total += count($row->seats());
			}
		}

		return $total;
	}

	public function referencedPriceTiers(): iterable
	{
		$seen = [];
		foreach ($this->seats() as $seat) {
			$key = $seat->priceTierId->value;
			if (!isset($seen[$key])) {
				$seen[$key] = true;
				yield $seat->priceTierId;
			}
		}
	}
}
