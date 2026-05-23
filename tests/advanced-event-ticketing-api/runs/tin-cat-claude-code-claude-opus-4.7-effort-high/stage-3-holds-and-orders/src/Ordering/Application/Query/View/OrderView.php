<?php

declare(strict_types=1);

namespace Frontstage\Ordering\Application\Query\View;

final class OrderView
{
	/**
	 * @param list<OrderLineView> $lines
	 */
	public function __construct(
		public readonly string $id,
		public readonly string $eventId,
		public readonly string $holdId,
		public readonly array $lines,
		public readonly int $totalAmount,
		public readonly string $totalCurrency,
		public readonly string $status,
		public readonly string $placedAtIso,
	) {
	}

	/**
	 * @return array<string, mixed>
	 */
	public function toArray(): array
	{
		return [
			'id' => $this->id,
			'eventId' => $this->eventId,
			'holdId' => $this->holdId,
			'lines' => array_map(static fn (OrderLineView $line) => $line->toArray(), $this->lines),
			'total' => [
				'amount' => $this->totalAmount,
				'currency' => $this->totalCurrency,
			],
			'status' => $this->status,
			'placedAt' => $this->placedAtIso,
		];
	}
}
