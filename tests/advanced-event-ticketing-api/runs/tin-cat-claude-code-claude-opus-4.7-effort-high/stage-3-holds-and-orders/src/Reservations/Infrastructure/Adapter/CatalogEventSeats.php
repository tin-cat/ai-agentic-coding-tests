<?php

declare(strict_types=1);

namespace Frontstage\Reservations\Infrastructure\Adapter;

use Doctrine\DBAL\Connection;
use Frontstage\Catalog\Domain\Model\Venue\SeatStatus;
use Frontstage\Reservations\Domain\Model\Hold\HoldSeat;
use Frontstage\Reservations\Domain\Service\EventSeats;

/**
 * Adapter that fulfils the {@see EventSeats} port by reading the Catalog
 * context's persistence directly through Doctrine DBAL.
 *
 * Reservations does not import Catalog's domain types other than the
 * persistence-only {@see SeatStatus} enum, which is treated here as a stable
 * label rather than an aggregate dependency. Mutations to the catalog still
 * flow through Catalog's own aggregate methods (see Ordering's seat sales
 * adapter).
 */
final class CatalogEventSeats implements EventSeats
{
	public function __construct(private readonly Connection $connection)
	{
	}

	public function eventExists(string $eventId): bool
	{
		$id = $this->connection->fetchOne(
			'SELECT id FROM catalog_events WHERE id = :id',
			['id' => $eventId],
		);

		return false !== $id;
	}

	public function unknownSeats(string $eventId, array $seats): array
	{
		if ([] === $seats) {
			return [];
		}

		$unknown = [];
		foreach ($seats as $seat) {
			$row = $this->connection->fetchAssociative(
				'SELECT 1 FROM catalog_seats
				 WHERE event_id = :event_id AND section = :section AND row_label = :row AND seat_number = :number',
				[
					'event_id' => $eventId,
					'section' => $seat->section,
					'row' => $seat->row,
					'number' => $seat->number,
				],
			);

			if (false === $row) {
				$unknown[] = $seat;
			}
		}

		return $unknown;
	}

	public function soldSeats(string $eventId): array
	{
		$rows = $this->connection->fetchAllAssociative(
			'SELECT section, row_label, seat_number FROM catalog_seats
			 WHERE event_id = :event_id AND status = :status
			 ORDER BY section, row_label, seat_number',
			['event_id' => $eventId, 'status' => SeatStatus::Sold->value],
		);

		$out = [];
		foreach ($rows as $row) {
			$out[] = HoldSeat::of(
				(string) $row['section'],
				(string) $row['row_label'],
				(string) $row['seat_number'],
			);
		}

		return $out;
	}

	public function pickGeneralAdmissionSeats(string $eventId, int $quantity): array
	{
		if ($quantity < 1) {
			return [];
		}

		$rows = $this->connection->fetchAllAssociative(
			'SELECT section, row_label, seat_number FROM catalog_seats
			 WHERE event_id = :event_id AND status = :status
			 ORDER BY CAST(seat_number AS INTEGER) ASC, seat_number ASC',
			['event_id' => $eventId, 'status' => SeatStatus::Available->value],
		);

		$out = [];
		foreach ($rows as $row) {
			if (count($out) >= $quantity) {
				break;
			}
			$out[] = HoldSeat::of(
				(string) $row['section'],
				(string) $row['row_label'],
				(string) $row['seat_number'],
			);
		}

		return $out;
	}
}
