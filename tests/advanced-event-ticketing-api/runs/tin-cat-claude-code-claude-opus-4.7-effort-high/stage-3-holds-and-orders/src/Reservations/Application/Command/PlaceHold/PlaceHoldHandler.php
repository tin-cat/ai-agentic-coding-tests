<?php

declare(strict_types=1);

namespace Frontstage\Reservations\Application\Command\PlaceHold;

use Frontstage\Reservations\Domain\Exception\EventUnknown;
use Frontstage\Reservations\Domain\Exception\InvalidArgument;
use Frontstage\Reservations\Domain\Exception\SeatUnavailable;
use Frontstage\Reservations\Domain\Model\Hold\Hold;
use Frontstage\Reservations\Domain\Model\Hold\HoldId;
use Frontstage\Reservations\Domain\Model\Hold\HoldSeat;
use Frontstage\Reservations\Domain\Repository\HoldRepository;
use Frontstage\Reservations\Domain\Service\Clock;
use Frontstage\Reservations\Domain\Service\EventSeats;
use Frontstage\Reservations\Domain\Service\LockHandle;
use Frontstage\Reservations\Domain\Service\SeatLocker;
use Symfony\Component\Messenger\Attribute\AsMessageHandler;

/**
 * Place a hold on a set of seats.
 *
 * Concurrency model: every requested seat is wrapped in a per-seat lock
 * acquired through the {@see SeatLocker} port. Two simultaneous attempts to
 * hold the same seat cannot both succeed because at most one will hold the
 * lock at a time; the loser sees {@see SeatLocker::acquire()} return null
 * and is reported the seat as unavailable. Inside the lock we also check
 * the persistent state (any existing live hold, any sold seat) to catch the
 * case where the previous winner finished while the loser was waiting.
 *
 * Locks are always released — success or failure — in reverse order.
 */
#[AsMessageHandler(bus: 'command.bus')]
final class PlaceHoldHandler
{
	public function __construct(
		private readonly HoldRepository $holds,
		private readonly SeatLocker $seatLocker,
		private readonly EventSeats $eventSeats,
		private readonly Clock $clock,
	) {
	}

	public function __invoke(PlaceHoldCommand $command): string
	{
		$holdId = HoldId::fromString($command->holdId);
		$eventId = $this->normalizeEventId($command->eventId);

		if (!$this->eventSeats->eventExists($eventId)) {
			throw EventUnknown::withId($eventId);
		}

		$requestedSeats = $this->resolveSeats($eventId, $command);

		$unknown = $this->eventSeats->unknownSeats($eventId, $requestedSeats);
		if ([] !== $unknown) {
			throw new InvalidArgument(sprintf(
				'Event does not contain seat(s): %s.',
				implode(', ', array_map(static fn (HoldSeat $s) => $s->toString(), $unknown)),
			));
		}

		/** @var list<LockHandle> $acquired */
		$acquired = [];
		try {
			foreach ($requestedSeats as $seat) {
				$handle = $this->seatLocker->acquire($eventId, $seat);
				if (null === $handle) {
					throw SeatUnavailable::forSeat($seat);
				}
				$acquired[] = $handle;
			}

			$soldIndex = $this->indexSeats($this->eventSeats->soldSeats($eventId));
			foreach ($requestedSeats as $seat) {
				if (isset($soldIndex[$seat->toString()])) {
					throw SeatUnavailable::forSeat($seat);
				}
				if (null !== $this->holds->seatHoldId($eventId, $seat)) {
					throw SeatUnavailable::forSeat($seat);
				}
			}

			$hold = Hold::place(
				$holdId,
				$eventId,
				$requestedSeats,
				$this->clock->now(),
				$command->ttlSeconds,
			);

			$this->holds->save($hold);

			return $holdId->toString();
		} finally {
			foreach (array_reverse($acquired) as $handle) {
				$handle->release();
			}
		}
	}

	/**
	 * @return list<HoldSeat>
	 */
	private function resolveSeats(string $eventId, PlaceHoldCommand $command): array
	{
		if ([] !== $command->seats) {
			$seats = [];
			foreach ($command->seats as $raw) {
				$seats[] = HoldSeat::of(
					(string) ($raw['section'] ?? ''),
					(string) ($raw['row'] ?? ''),
					(string) ($raw['number'] ?? ''),
				);
			}

			return $seats;
		}

		if (null === $command->quantity || $command->quantity < 1) {
			throw new InvalidArgument('Hold request must name seats or supply a positive quantity.');
		}

		$picked = $this->eventSeats->pickGeneralAdmissionSeats($eventId, $command->quantity);
		if (count($picked) < $command->quantity) {
			throw SeatUnavailable::notEnoughCapacity($command->quantity, count($picked));
		}

		return $picked;
	}

	/**
	 * @param list<HoldSeat> $seats
	 *
	 * @return array<string, true>
	 */
	private function indexSeats(array $seats): array
	{
		$out = [];
		foreach ($seats as $seat) {
			$out[$seat->toString()] = true;
		}

		return $out;
	}

	private function normalizeEventId(string $eventId): string
	{
		$normalized = strtolower(trim($eventId));
		if ('' === $normalized) {
			throw new InvalidArgument('Hold requires an event id.');
		}

		return $normalized;
	}
}
