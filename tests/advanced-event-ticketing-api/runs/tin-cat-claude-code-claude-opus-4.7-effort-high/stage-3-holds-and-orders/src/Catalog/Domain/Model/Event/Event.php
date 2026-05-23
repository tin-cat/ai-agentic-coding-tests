<?php

declare(strict_types=1);

namespace Frontstage\Catalog\Domain\Model\Event;

use Frontstage\Catalog\Domain\Exception\InvalidArgument;
use Frontstage\Catalog\Domain\Exception\InvalidEventState;
use Frontstage\Catalog\Domain\Model\PriceTier\PriceTier;
use Frontstage\Catalog\Domain\Model\PriceTier\PriceTierId;
use Frontstage\Catalog\Domain\Model\Venue\Seat;
use Frontstage\Catalog\Domain\Model\Venue\SeatId;
use Frontstage\Catalog\Domain\Model\Venue\SeatStatus;
use Frontstage\Catalog\Domain\Model\Venue\Venue;

/**
 * Event aggregate root.
 *
 * Owns its Venue (seating definition + every seat), its price tiers, and its
 * lifecycle status (draft -> published). The aggregate enforces:
 *
 *   - every seat references a price tier that exists on this event;
 *   - publishing is idempotent only in the sense that a second call fails
 *     loudly rather than silently no-opping;
 *   - all mutations go through aggregate methods, never through inner
 *     entities or value objects directly.
 *
 * Persistence is the infrastructure's problem; this class knows nothing
 * about Doctrine, the database, or HTTP.
 */
final class Event
{
	/** @var array<string, PriceTier> indexed by PriceTierId value */
	private array $priceTiers;

	/**
	 * Use {@see Event::create()} or {@see Event::reconstitute()} rather than
	 * calling the constructor directly. Private to keep invariants in one
	 * place.
	 *
	 * @param list<PriceTier> $priceTiers
	 */
	private function __construct(
		public readonly EventId $id,
		private EventTitle $title,
		private EventDescription $description,
		private StartsAt $startsAt,
		private Venue $venue,
		array $priceTiers,
		private EventStatus $status,
	) {
		$this->priceTiers = [];
		foreach ($priceTiers as $tier) {
			$this->priceTiers[$tier->id->value] = $tier;
		}
	}

	/**
	 * Factory used by the application layer when an organizer creates a new
	 * event. Validates the aggregate's cross-cutting invariants (that the
	 * seating's price tiers are all defined on the event, that there is at
	 * least one tier, that tiers have distinct ids).
	 *
	 * @param list<PriceTier> $priceTiers
	 */
	public static function create(
		EventId $id,
		EventTitle $title,
		EventDescription $description,
		StartsAt $startsAt,
		Venue $venue,
		array $priceTiers,
	): self {
		if ([] === $priceTiers) {
			throw new InvalidArgument('An event must declare at least one price tier.');
		}

		$tierIndex = [];
		foreach ($priceTiers as $tier) {
			if (isset($tierIndex[$tier->id->value])) {
				throw new InvalidArgument(sprintf('Duplicate price tier id "%s".', $tier->id->value));
			}
			$tierIndex[$tier->id->value] = true;
		}

		foreach ($venue->seating->referencedPriceTiers() as $referenced) {
			if (!isset($tierIndex[$referenced->value])) {
				throw new InvalidArgument(sprintf(
					'Seating references undefined price tier "%s".',
					$referenced->value,
				));
			}
		}

		return new self(
			$id,
			$title,
			$description,
			$startsAt,
			$venue,
			array_values($priceTiers),
			EventStatus::Draft,
		);
	}

	/**
	 * Hydration constructor for the persistence adapter. Skips the create-time
	 * invariant checks because the database is assumed to hold valid state.
	 *
	 * @param list<PriceTier> $priceTiers
	 *
	 * @internal Use from persistence adapters only.
	 */
	public static function reconstitute(
		EventId $id,
		EventTitle $title,
		EventDescription $description,
		StartsAt $startsAt,
		Venue $venue,
		array $priceTiers,
		EventStatus $status,
	): self {
		return new self($id, $title, $description, $startsAt, $venue, $priceTiers, $status);
	}

	public function publish(): void
	{
		if (EventStatus::Published === $this->status) {
			throw InvalidEventState::alreadyPublished();
		}

		$this->status = EventStatus::Published;
	}

	public function title(): EventTitle
	{
		return $this->title;
	}

	public function description(): EventDescription
	{
		return $this->description;
	}

	public function startsAt(): StartsAt
	{
		return $this->startsAt;
	}

	public function venue(): Venue
	{
		return $this->venue;
	}

	public function status(): EventStatus
	{
		return $this->status;
	}

	/** @return list<PriceTier> */
	public function priceTiers(): array
	{
		return array_values($this->priceTiers);
	}

	public function priceTier(PriceTierId $id): PriceTier
	{
		if (!isset($this->priceTiers[$id->value])) {
			throw new InvalidArgument(sprintf('Event has no price tier "%s".', $id->value));
		}

		return $this->priceTiers[$id->value];
	}

	/** @return iterable<Seat> */
	public function seats(): iterable
	{
		return $this->venue->seating->seats();
	}

	public function availableSeatCount(): int
	{
		$count = 0;
		foreach ($this->seats() as $seat) {
			if ($seat->isAvailable()) {
				++$count;
			}
		}

		return $count;
	}

	/**
	 * Mark the named seats as sold. Called via a Catalog port when the
	 * Ordering context confirms a purchase. All seats are transitioned in one
	 * call so the aggregate never reaches a half-sold state; if any seat is
	 * missing or already sold the whole operation is rejected.
	 *
	 * @param list<SeatId> $seatIds
	 */
	public function markSeatsSold(array $seatIds): void
	{
		if ([] === $seatIds) {
			throw new InvalidArgument('markSeatsSold requires at least one seat.');
		}

		$wanted = [];
		foreach ($seatIds as $seatId) {
			$wanted[$seatId->toString()] = $seatId;
		}

		$matched = [];
		foreach ($this->seats() as $seat) {
			$key = $seat->id->toString();
			if (!isset($wanted[$key])) {
				continue;
			}
			if (SeatStatus::Sold === $seat->status()) {
				throw InvalidEventState::seatAlreadySold($seat->id);
			}
			$matched[$key] = $seat;
		}

		foreach ($wanted as $key => $seatId) {
			if (!isset($matched[$key])) {
				throw new InvalidArgument(sprintf('Event has no seat "%s".', $seatId->toString()));
			}
		}

		foreach ($matched as $seat) {
			$seat->markSold();
		}
	}
}
