<?php

declare(strict_types=1);

namespace Frontstage\Ordering\Domain\Model\Order;

use DateTimeImmutable;
use Frontstage\Ordering\Domain\Exception\InvalidArgument;
use Frontstage\Ordering\Domain\Model\Shared\Money;

/**
 * Order aggregate root.
 *
 * An order is the result of converting a {@see Hold} into a sale: the seats
 * named on the originating hold are now owned by this order, the prices are
 * pinned to the tier values at sale time, and the total is the sum of the
 * line prices (Money). An order is immutable once placed — there are no
 * partial-cancel or update operations at this stage.
 */
final class Order
{
	/** @var list<OrderLine> */
	private array $lines;

	/**
	 * @param list<OrderLine> $lines
	 */
	private function __construct(
		public readonly OrderId $id,
		public readonly string $eventId,
		public readonly string $holdId,
		array $lines,
		public readonly Money $total,
		public readonly OrderStatus $status,
		public readonly DateTimeImmutable $placedAt,
	) {
		if ([] === $lines) {
			throw new InvalidArgument('An order must have at least one line.');
		}

		$seen = [];
		foreach ($lines as $line) {
			$key = $line->seatKey();
			if (isset($seen[$key])) {
				throw new InvalidArgument(sprintf('Duplicate seat "%s" on order.', $key));
			}
			$seen[$key] = true;
		}

		$this->lines = array_values($lines);
	}

	/**
	 * Factory used by the application layer when a hold is being converted
	 * into an order. Computes the total from the provided lines so the
	 * caller cannot pass in an inconsistent total.
	 *
	 * @param list<OrderLine> $lines
	 */
	public static function place(
		OrderId $id,
		string $eventId,
		string $holdId,
		array $lines,
		DateTimeImmutable $placedAt,
	): self {
		if ([] === $lines) {
			throw new InvalidArgument('An order must have at least one line.');
		}

		$total = Money::zero($lines[0]->price->currency);
		foreach ($lines as $line) {
			$total = $total->add($line->price);
		}

		return new self($id, $eventId, $holdId, $lines, $total, OrderStatus::Placed, $placedAt);
	}

	/**
	 * Hydration constructor for persistence adapters. Skips create-time
	 * validation because storage is assumed consistent.
	 *
	 * @param list<OrderLine> $lines
	 *
	 * @internal Use from persistence adapters only.
	 */
	public static function reconstitute(
		OrderId $id,
		string $eventId,
		string $holdId,
		array $lines,
		Money $total,
		OrderStatus $status,
		DateTimeImmutable $placedAt,
	): self {
		return new self($id, $eventId, $holdId, $lines, $total, $status, $placedAt);
	}

	/** @return list<OrderLine> */
	public function lines(): array
	{
		return $this->lines;
	}
}
