<?php

declare(strict_types=1);

namespace Frontstage\Reservations\Domain\Model\Hold;

use DateTimeImmutable;
use Frontstage\Reservations\Domain\Exception\InvalidArgument;

/**
 * Hold aggregate root.
 *
 * Represents a customer's time-limited claim on a set of seats for an event.
 * A hold is "alive" while its expiry has not passed and it has not been
 * released or consumed; once any of those happen the hold ceases to exist as
 * far as the rest of the system is concerned.
 *
 * Persistence is the infrastructure's problem: the {@see \Frontstage\Reservations\Domain\Repository\HoldRepository}
 * port writes holds to a Redis-backed store with a TTL matching `expiresAt`,
 * so expiry is enforced by storage, not by polling code. Releases and
 * consumes simply delete the hold from that store.
 */
final class Hold
{
	/** @var list<HoldSeat> */
	private array $seats;

	/**
	 * @param list<HoldSeat> $seats
	 */
	private function __construct(
		public readonly HoldId $id,
		public readonly string $eventId,
		array $seats,
		public readonly DateTimeImmutable $expiresAt,
	) {
		if ([] === $seats) {
			throw new InvalidArgument('A hold must cover at least one seat.');
		}

		$seen = [];
		foreach ($seats as $seat) {
			$key = $seat->toString();
			if (isset($seen[$key])) {
				throw new InvalidArgument(sprintf('Duplicate seat "%s" in hold.', $key));
			}
			$seen[$key] = true;
		}

		$this->seats = array_values($seats);
	}

	/**
	 * @param list<HoldSeat> $seats
	 */
	public static function place(
		HoldId $id,
		string $eventId,
		array $seats,
		DateTimeImmutable $now,
		int $ttlSeconds,
	): self {
		if ($ttlSeconds < 1) {
			throw new InvalidArgument('Hold TTL must be at least one second.');
		}

		$expiresAt = $now->modify(sprintf('+%d seconds', $ttlSeconds));

		return new self($id, $eventId, $seats, $expiresAt);
	}

	/**
	 * Rehydrate a hold from persistence. Skips the create-time validation
	 * because storage is assumed to contain valid state.
	 *
	 * @param list<HoldSeat>    $seats
	 *
	 * @internal Use from persistence adapters only.
	 */
	public static function reconstitute(
		HoldId $id,
		string $eventId,
		array $seats,
		DateTimeImmutable $expiresAt,
	): self {
		return new self($id, $eventId, $seats, $expiresAt);
	}

	/** @return list<HoldSeat> */
	public function seats(): array
	{
		return $this->seats;
	}

	public function isExpired(DateTimeImmutable $now): bool
	{
		return $now >= $this->expiresAt;
	}

	public function ttlSecondsFrom(DateTimeImmutable $now): int
	{
		return max(1, $this->expiresAt->getTimestamp() - $now->getTimestamp());
	}
}
