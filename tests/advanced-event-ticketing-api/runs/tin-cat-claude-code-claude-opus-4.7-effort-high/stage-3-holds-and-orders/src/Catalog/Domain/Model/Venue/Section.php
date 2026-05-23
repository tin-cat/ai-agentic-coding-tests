<?php

declare(strict_types=1);

namespace Frontstage\Catalog\Domain\Model\Venue;

use Frontstage\Catalog\Domain\Exception\InvalidArgument;

final class Section
{
	/** @var list<Row> */
	private array $rows;

	/**
	 * @param list<Row> $rows
	 */
	public function __construct(public readonly string $name, array $rows)
	{
		if ('' === trim($name)) {
			throw new InvalidArgument('Section name must not be empty.');
		}

		if ([] === $rows) {
			throw new InvalidArgument(sprintf('Section "%s" must contain at least one row.', $name));
		}

		$this->rows = array_values($rows);
	}

	/** @return list<Row> */
	public function rows(): array
	{
		return $this->rows;
	}
}
