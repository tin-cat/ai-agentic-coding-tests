<?php

declare(strict_types=1);

namespace Frontstage\Reservations\Infrastructure\Query;

use Doctrine\DBAL\Connection;
use Frontstage\Catalog\Domain\Model\Venue\SeatStatus;
use Frontstage\Reservations\Application\Query\AvailabilityReadModel;
use Frontstage\Reservations\Application\Query\View\EventAvailabilityView;
use Frontstage\Reservations\Application\Query\View\SeatAvailabilityView;
use Frontstage\Reservations\Domain\Repository\HoldRepository;

/**
 * Composite read model for seat availability.
 *
 * The Catalog database holds the source-of-truth seat status (Available /
 * Sold) and the price-tier metadata. The Reservations Redis store knows
 * which seats are currently *held* but not yet sold. This adapter projects
 * both into a single per-event view that callers can render directly.
 *
 * Kept on the read side: builds projections directly from storage and never
 * touches the Event aggregate, so a busy seat map does not hydrate the whole
 * catalog write model on every page load.
 */
final class CompositeAvailabilityReadModel implements AvailabilityReadModel
{
	public function __construct(
		private readonly Connection $connection,
		private readonly HoldRepository $holds,
	) {
	}

	public function forEvent(string $eventId): ?EventAvailabilityView
	{
		$exists = $this->connection->fetchOne(
			'SELECT id FROM catalog_events WHERE id = :id',
			['id' => $eventId],
		);

		if (false === $exists) {
			return null;
		}

		$seatRows = $this->connection->fetchAllAssociative(
			'SELECT section, row_label, seat_number, price_tier_id, status
			 FROM catalog_seats
			 WHERE event_id = :event_id
			 ORDER BY section ASC, row_label ASC, seat_number ASC',
			['event_id' => $eventId],
		);

		$heldSet = [];
		foreach ($this->holds->heldSeatsForEvent($eventId) as $heldSeat) {
			$heldSet[$heldSeat->toString()] = true;
		}

		$seats = [];
		$available = 0;
		$held = 0;
		$sold = 0;

		foreach ($seatRows as $row) {
			$section = (string) $row['section'];
			$rowLabel = (string) $row['row_label'];
			$number = (string) $row['seat_number'];
			$catalogStatus = (string) $row['status'];

			$status = $this->projectStatus($catalogStatus, $section, $rowLabel, $number, $heldSet);
			match ($status) {
				'sold' => ++$sold,
				'held' => ++$held,
				default => ++$available,
			};

			$seats[] = new SeatAvailabilityView(
				section: $section,
				row: $rowLabel,
				number: $number,
				priceTierId: (string) $row['price_tier_id'],
				status: $status,
			);
		}

		return new EventAvailabilityView(
			eventId: $eventId,
			seats: $seats,
			totalCapacity: count($seats),
			availableCount: $available,
			heldCount: $held,
			soldCount: $sold,
		);
	}

	/**
	 * @param array<string, true> $heldSet
	 */
	private function projectStatus(
		string $catalogStatus,
		string $section,
		string $row,
		string $number,
		array $heldSet,
	): string {
		if (SeatStatus::Sold->value === $catalogStatus) {
			return 'sold';
		}

		$key = sprintf('%s/%s/%s', $section, $row, $number);
		if (isset($heldSet[$key])) {
			return 'held';
		}

		return 'available';
	}
}
