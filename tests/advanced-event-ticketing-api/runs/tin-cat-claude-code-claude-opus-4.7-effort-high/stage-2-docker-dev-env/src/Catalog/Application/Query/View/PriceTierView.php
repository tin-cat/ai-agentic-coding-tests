<?php

declare(strict_types=1);

namespace Frontstage\Catalog\Application\Query\View;

final class PriceTierView
{
	public function __construct(
		public readonly string $id,
		public readonly string $name,
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
			'id' => $this->id,
			'name' => $this->name,
			'price' => [
				'amount' => $this->priceAmount,
				'currency' => $this->priceCurrency,
			],
		];
	}
}
