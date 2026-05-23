<?php

declare(strict_types=1);

namespace Frontstage\Ordering\Infrastructure\Persistence\Doctrine;

use DateTimeImmutable;
use DateTimeZone;
use Doctrine\DBAL\Connection;
use Frontstage\Ordering\Application\Query\OrderReadModel;
use Frontstage\Ordering\Application\Query\View\OrderLineView;
use Frontstage\Ordering\Application\Query\View\OrderView;
use Frontstage\Ordering\Domain\Model\Order\OrderId;

final class DoctrineOrderReadModel implements OrderReadModel
{
	public function __construct(private readonly Connection $connection)
	{
	}

	public function findById(OrderId $id): ?OrderView
	{
		$row = $this->connection->fetchAssociative(
			'SELECT id, event_id, hold_id, total_amount, total_currency, status, placed_at
			 FROM ordering_orders WHERE id = :id',
			['id' => $id->toString()],
		);

		if (false === $row) {
			return null;
		}

		$lineRows = $this->connection->fetchAllAssociative(
			'SELECT section, row_label, seat_number, price_tier_id, price_amount, price_currency
			 FROM ordering_order_lines
			 WHERE order_id = :order_id
			 ORDER BY section, row_label, seat_number',
			['order_id' => $id->toString()],
		);

		$lines = [];
		foreach ($lineRows as $line) {
			$lines[] = new OrderLineView(
				section: (string) $line['section'],
				row: (string) $line['row_label'],
				number: (string) $line['seat_number'],
				priceTierId: (string) $line['price_tier_id'],
				priceAmount: (int) $line['price_amount'],
				priceCurrency: (string) $line['price_currency'],
			);
		}

		return new OrderView(
			id: (string) $row['id'],
			eventId: (string) $row['event_id'],
			holdId: (string) $row['hold_id'],
			lines: $lines,
			totalAmount: (int) $row['total_amount'],
			totalCurrency: (string) $row['total_currency'],
			status: (string) $row['status'],
			placedAtIso: $this->toIso((string) $row['placed_at']),
		);
	}

	private function toIso(string $raw): string
	{
		$candidates = [DATE_ATOM, 'Y-m-d H:i:s.u', 'Y-m-d H:i:s', 'Y-m-d\TH:i:sP'];
		foreach ($candidates as $format) {
			$d = DateTimeImmutable::createFromFormat($format, $raw, new DateTimeZone('UTC'));
			if (false !== $d) {
				return $d->setTimezone(new DateTimeZone('UTC'))->format(DATE_ATOM);
			}
		}

		return (new DateTimeImmutable($raw, new DateTimeZone('UTC')))->format(DATE_ATOM);
	}
}
