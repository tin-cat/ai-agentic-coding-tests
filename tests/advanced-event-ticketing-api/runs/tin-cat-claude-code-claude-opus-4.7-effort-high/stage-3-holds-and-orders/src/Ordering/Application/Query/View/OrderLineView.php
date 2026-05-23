<?php

declare(strict_types=1);

namespace Frontstage\Ordering\Application\Query\View;

final class OrderLineView
{
	public function __construct(
		public readonly string $section,
		public readonly string $row,
		public readonly string $number,
		public readonly string $priceTierId,
		public readonly int $priceAmount,
		public readonly string $priceCurrency,
	) {
	}

	/**
	 * @return array<string, mixed>
	 */
	public function toArray(): array
	{
		return [
			'section' => $this->section,
			'row' => $this->row,
			'number' => $this->number,
			'priceTierId' => $this->priceTierId,
			'price' => [
				'amount' => $this->priceAmount,
				'currency' => $this->priceCurrency,
			],
		];
	}
}
