<?php

declare(strict_types=1);

namespace Frontstage\Tests\Unit\Reservations\Application;

use DateTimeImmutable;
use DateTimeZone;
use Frontstage\Reservations\Application\Command\PlaceHold\PlaceHoldCommand;
use Frontstage\Reservations\Application\Command\PlaceHold\PlaceHoldHandler;
use Frontstage\Reservations\Domain\Exception\SeatUnavailable;
use Frontstage\Reservations\Domain\Model\Hold\Hold;
use Frontstage\Reservations\Domain\Model\Hold\HoldId;
use Frontstage\Reservations\Domain\Model\Hold\HoldSeat;
use Frontstage\Reservations\Domain\Repository\HoldRepository;
use Frontstage\Reservations\Domain\Service\Clock;
use Frontstage\Reservations\Domain\Service\EventSeats;
use Frontstage\Reservations\Domain\Service\LockHandle;
use Frontstage\Reservations\Domain\Service\SeatLocker;
use PHPUnit\Framework\TestCase;

/**
 * Drives the place-hold handler against in-memory fakes so the concurrency
 * invariants can be asserted without booting Redis or Postgres.
 */
final class PlaceHoldHandlerTest extends TestCase
{
	public function testTwoConcurrentHoldsOnSameSeatCannotBothSucceed(): void
	{
		[$repo, $locker, $seats, $clock] = $this->newFakes();
		$handler = new PlaceHoldHandler($repo, $locker, $seats, $clock);

		// First hold wins.
		$first = $handler(new PlaceHoldCommand(
			holdId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
			eventId: 'event-1',
			seats: [['section' => 'Orchestra', 'row' => 'A', 'number' => '1']],
			quantity: null,
			ttlSeconds: 60,
		));

		$this->assertNotEmpty($first);

		// Second hold on the same seat must fail.
		$this->expectException(SeatUnavailable::class);
		$handler(new PlaceHoldCommand(
			holdId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
			eventId: 'event-1',
			seats: [['section' => 'Orchestra', 'row' => 'A', 'number' => '1']],
			quantity: null,
			ttlSeconds: 60,
		));
	}

	public function testLockRejectionMakesPlacementFail(): void
	{
		[$repo, , $seats, $clock] = $this->newFakes();
		// Locker that always denies acquisition simulates a concurrent attempt
		// already holding the lock.
		$blockingLocker = new class implements SeatLocker {
			public function acquire(string $eventId, HoldSeat $seat): ?LockHandle
			{
				return null;
			}
		};

		$handler = new PlaceHoldHandler($repo, $blockingLocker, $seats, $clock);

		$this->expectException(SeatUnavailable::class);
		$handler(new PlaceHoldCommand(
			holdId: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
			eventId: 'event-1',
			seats: [['section' => 'Orchestra', 'row' => 'A', 'number' => '1']],
			quantity: null,
			ttlSeconds: 60,
		));
	}

	public function testHoldOnSoldSeatFails(): void
	{
		[$repo, $locker, $seats, $clock] = $this->newFakes();
		$seats->soldSeats[] = HoldSeat::of('Orchestra', 'A', '1');

		$handler = new PlaceHoldHandler($repo, $locker, $seats, $clock);

		$this->expectException(SeatUnavailable::class);
		$handler(new PlaceHoldCommand(
			holdId: 'dddddddd-dddd-4ddd-8ddd-dddddddddddd',
			eventId: 'event-1',
			seats: [['section' => 'Orchestra', 'row' => 'A', 'number' => '1']],
			quantity: null,
			ttlSeconds: 60,
		));
	}

	public function testReleasingAHoldFreesItsSeats(): void
	{
		[$repo, $locker, $seats, $clock] = $this->newFakes();
		$handler = new PlaceHoldHandler($repo, $locker, $seats, $clock);

		$handler(new PlaceHoldCommand(
			holdId: 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee',
			eventId: 'event-1',
			seats: [['section' => 'Orchestra', 'row' => 'A', 'number' => '1']],
			quantity: null,
			ttlSeconds: 60,
		));

		$repo->delete(HoldId::fromString('eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee'));

		// Second hold on the same seat should now succeed.
		$second = $handler(new PlaceHoldCommand(
			holdId: 'ffffffff-ffff-4fff-8fff-ffffffffffff',
			eventId: 'event-1',
			seats: [['section' => 'Orchestra', 'row' => 'A', 'number' => '1']],
			quantity: null,
			ttlSeconds: 60,
		));

		$this->assertSame('ffffffff-ffff-4fff-8fff-ffffffffffff', $second);
	}

	/**
	 * @return array{0:InMemoryHoldRepository, 1:AlwaysAcquiringLocker, 2:KnownEventSeats, 3:FrozenClock}
	 */
	private function newFakes(): array
	{
		return [
			new InMemoryHoldRepository(),
			new AlwaysAcquiringLocker(),
			new KnownEventSeats(),
			new FrozenClock(new DateTimeImmutable('2026-01-01T00:00:00+00:00', new DateTimeZone('UTC'))),
		];
	}
}

final class InMemoryHoldRepository implements HoldRepository
{
	/** @var array<string, Hold> */
	public array $holds = [];

	/** @var array<string, array<string, HoldId>> eventId -> seatKey -> holdId */
	public array $seatIndex = [];

	public function save(Hold $hold): void
	{
		$this->holds[$hold->id->value] = $hold;
		foreach ($hold->seats() as $seat) {
			$this->seatIndex[$hold->eventId][$seat->toString()] = $hold->id;
		}
	}

	public function get(HoldId $id): Hold
	{
		return $this->holds[$id->value];
	}

	public function find(HoldId $id): ?Hold
	{
		return $this->holds[$id->value] ?? null;
	}

	public function delete(HoldId $id): void
	{
		$hold = $this->holds[$id->value] ?? null;
		if (null === $hold) {
			return;
		}
		foreach ($hold->seats() as $seat) {
			unset($this->seatIndex[$hold->eventId][$seat->toString()]);
		}
		unset($this->holds[$id->value]);
	}

	public function seatHoldId(string $eventId, HoldSeat $seat): ?HoldId
	{
		return $this->seatIndex[$eventId][$seat->toString()] ?? null;
	}

	public function heldSeatsForEvent(string $eventId): array
	{
		$out = [];
		foreach ($this->seatIndex[$eventId] ?? [] as $seatKey => $_) {
			[$section, $row, $number] = explode('/', $seatKey, 3);
			$out[] = HoldSeat::of($section, $row, $number);
		}

		return $out;
	}
}

final class AlwaysAcquiringLocker implements SeatLocker
{
	public function acquire(string $eventId, HoldSeat $seat): ?LockHandle
	{
		return new class implements LockHandle {
			public function release(): void
			{
			}
		};
	}
}

final class KnownEventSeats implements EventSeats
{
	/** @var list<HoldSeat> */
	public array $soldSeats = [];

	public bool $exists = true;

	public function eventExists(string $eventId): bool
	{
		return $this->exists;
	}

	public function unknownSeats(string $eventId, array $seats): array
	{
		return [];
	}

	public function soldSeats(string $eventId): array
	{
		return $this->soldSeats;
	}

	public function pickGeneralAdmissionSeats(string $eventId, int $quantity): array
	{
		return [];
	}
}

final class FrozenClock implements Clock
{
	public function __construct(public DateTimeImmutable $now)
	{
	}

	public function now(): DateTimeImmutable
	{
		return $this->now;
	}
}
