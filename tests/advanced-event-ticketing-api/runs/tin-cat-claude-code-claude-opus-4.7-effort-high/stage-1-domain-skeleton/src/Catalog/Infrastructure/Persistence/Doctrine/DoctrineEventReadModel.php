<?php

declare(strict_types=1);

namespace Frontstage\Catalog\Infrastructure\Persistence\Doctrine;

use DateTimeImmutable;
use DateTimeZone;
use Doctrine\DBAL\Connection;
use Frontstage\Catalog\Application\Query\EventReadModel;
use Frontstage\Catalog\Application\Query\View\EventDetailView;
use Frontstage\Catalog\Application\Query\View\EventSummaryView;
use Frontstage\Catalog\Application\Query\View\PriceTierView;
use Frontstage\Catalog\Domain\Model\Event\EventId;
use Frontstage\Catalog\Domain\Model\Event\EventStatus;
use Frontstage\Catalog\Domain\Model\Venue\SeatStatus;

/**
 * Doctrine DBAL adapter for the {@see EventReadModel} query port.
 *
 * Reads denormalized projections of events directly from the database. Using
 * DBAL (not ORM) keeps queries explicit and cheap: there is no aggregate
 * hydration on the read path.
 */
final class DoctrineEventReadModel implements EventReadModel
{
	public function __construct(private readonly Connection $connection)
	{
	}

	public function findDetailById(EventId $id): ?EventDetailView
	{
		$row = $this->connection->fetchAssociative(
			'SELECT id, title, description, starts_at, status, venue_name, seating_type, ga_capacity, ga_price_tier_id
			 FROM catalog_events WHERE id = :id',
			['id' => $id->toString()],
		);

		if (false === $row) {
			return null;
		}

		$priceTiers = $this->fetchPriceTiers($id->toString());
		$seating = 'general_admission' === $row['seating_type']
			? $this->buildGaSeating($id->toString(), (int) $row['ga_capacity'], (string) $row['ga_price_tier_id'])
			: $this->buildSectionedSeating($id->toString());

		$totalCapacity = $seating['totalCapacity'];
		$availableSeatCount = $seating['availableSeatCount'];
		unset($seating['totalCapacity'], $seating['availableSeatCount']);

		return new EventDetailView(
			id: (string) $row['id'],
			title: (string) $row['title'],
			description: (string) $row['description'],
			startsAtIso: $this->toIso((string) $row['starts_at']),
			status: (string) $row['status'],
			venueName: (string) $row['venue_name'],
			priceTiers: $priceTiers,
			seating: $seating,
			totalCapacity: $totalCapacity,
			availableSeatCount: $availableSeatCount,
		);
	}

	public function listPublished(): array
	{
		$rows = $this->connection->fetchAllAssociative(
			'SELECT id, title, venue_name, starts_at, seating_type, ga_capacity
			 FROM catalog_events
			 WHERE status = :status
			 ORDER BY starts_at ASC, id ASC',
			['status' => EventStatus::Published->value],
		);

		$views = [];
		foreach ($rows as $row) {
			$capacity = 'general_admission' === $row['seating_type']
				? (int) $row['ga_capacity']
				: $this->countSectionedSeats((string) $row['id']);

			$available = 'general_admission' === $row['seating_type']
				? (int) $row['ga_capacity']
				: $this->countAvailableSectionedSeats((string) $row['id']);

			$views[] = new EventSummaryView(
				id: (string) $row['id'],
				title: (string) $row['title'],
				venueName: (string) $row['venue_name'],
				startsAtIso: $this->toIso((string) $row['starts_at']),
				totalCapacity: $capacity,
				availableSeatCount: $available,
			);
		}

		return $views;
	}

	/**
	 * @return list<PriceTierView>
	 */
	private function fetchPriceTiers(string $eventId): array
	{
		$rows = $this->connection->fetchAllAssociative(
			'SELECT tier_id, name, price_amount, price_currency
			 FROM catalog_price_tiers
			 WHERE event_id = :event_id
			 ORDER BY tier_id ASC',
			['event_id' => $eventId],
		);

		return array_map(
			static fn (array $r) => new PriceTierView(
				id: (string) $r['tier_id'],
				name: (string) $r['name'],
				priceAmount: (int) $r['price_amount'],
				priceCurrency: (string) $r['price_currency'],
			),
			$rows,
		);
	}

	/**
	 * @return array{type:string, capacity:int, priceTierId:string, availableSeatCount:int, totalCapacity:int, availableSeatCount:int}
	 */
	private function buildGaSeating(string $eventId, int $capacity, string $priceTierId): array
	{
		$soldOrHeld = (int) $this->connection->fetchOne(
			'SELECT COUNT(*) FROM catalog_seats WHERE event_id = :event_id AND status != :available',
			['event_id' => $eventId, 'available' => SeatStatus::Available->value],
		);

		$available = max(0, $capacity - $soldOrHeld);

		return [
			'type' => 'general_admission',
			'capacity' => $capacity,
			'priceTierId' => $priceTierId,
			'availableSeatCount' => $available,
			'totalCapacity' => $capacity,
		];
	}

	/**
	 * @return array{type:string, sections:list<array<string, mixed>>, totalCapacity:int, availableSeatCount:int}
	 */
	private function buildSectionedSeating(string $eventId): array
	{
		$rows = $this->connection->fetchAllAssociative(
			'SELECT section, row_label, seat_number, price_tier_id, status
			 FROM catalog_seats
			 WHERE event_id = :event_id
			 ORDER BY section ASC, row_label ASC, seat_number ASC',
			['event_id' => $eventId],
		);

		$sections = [];
		$total = 0;
		$available = 0;

		foreach ($rows as $row) {
			++$total;
			$isAvailable = SeatStatus::Available->value === $row['status'];
			if ($isAvailable) {
				++$available;
			}

			$sectionName = (string) $row['section'];
			$rowLabel = (string) $row['row_label'];

			if (!isset($sections[$sectionName])) {
				$sections[$sectionName] = ['name' => $sectionName, 'rows' => []];
			}
			if (!isset($sections[$sectionName]['rows'][$rowLabel])) {
				$sections[$sectionName]['rows'][$rowLabel] = ['label' => $rowLabel, 'seats' => []];
			}

			$sections[$sectionName]['rows'][$rowLabel]['seats'][] = [
				'number' => (string) $row['seat_number'],
				'priceTierId' => (string) $row['price_tier_id'],
				'status' => (string) $row['status'],
				'available' => $isAvailable,
			];
		}

		// Re-key as lists for JSON friendliness.
		$shapedSections = [];
		foreach ($sections as $section) {
			$shapedSections[] = [
				'name' => $section['name'],
				'rows' => array_values($section['rows']),
			];
		}

		return [
			'type' => 'sectioned',
			'sections' => $shapedSections,
			'totalCapacity' => $total,
			'availableSeatCount' => $available,
		];
	}

	private function countSectionedSeats(string $eventId): int
	{
		return (int) $this->connection->fetchOne(
			'SELECT COUNT(*) FROM catalog_seats WHERE event_id = :event_id',
			['event_id' => $eventId],
		);
	}

	private function countAvailableSectionedSeats(string $eventId): int
	{
		return (int) $this->connection->fetchOne(
			'SELECT COUNT(*) FROM catalog_seats WHERE event_id = :event_id AND status = :status',
			['event_id' => $eventId, 'status' => SeatStatus::Available->value],
		);
	}

	private function toIso(string $raw): string
	{
		// SQLite stores datetimes as 'Y-m-d H:i:s'. Postgres returns ISO with
		// possible offset. Normalize both to UTC ISO-8601.
		$candidates = [DATE_ATOM, 'Y-m-d H:i:s.u', 'Y-m-d H:i:s', 'Y-m-d\TH:i:sP'];
		foreach ($candidates as $format) {
			$d = DateTimeImmutable::createFromFormat($format, $raw, new DateTimeZone('UTC'));
			if (false !== $d) {
				return $d->setTimezone(new DateTimeZone('UTC'))->format(DATE_ATOM);
			}
		}

		// Last-resort fallback.
		return (new DateTimeImmutable($raw, new DateTimeZone('UTC')))->format(DATE_ATOM);
	}
}
