<?php

declare(strict_types=1);

namespace Frontstage\Reservations\Infrastructure\Persistence\Cache;

use DateTimeImmutable;
use DateTimeZone;
use Frontstage\Reservations\Domain\Exception\HoldNotFound;
use Frontstage\Reservations\Domain\Model\Hold\Hold;
use Frontstage\Reservations\Domain\Model\Hold\HoldId;
use Frontstage\Reservations\Domain\Model\Hold\HoldSeat;
use Frontstage\Reservations\Domain\Repository\HoldRepository;
use Frontstage\Reservations\Domain\Service\Clock;
use Psr\Cache\CacheItemPoolInterface;

/**
 * Cache-pool adapter for the {@see HoldRepository} port. In production the
 * pool is Symfony's Redis adapter; in tests it is the array adapter — both
 * honour per-item TTL so an expired hold disappears with no manual cleanup.
 *
 * The pool stores three flavours of entry:
 *
 *   - r_hold_{holdId}                     → serialized hold record, TTL = remaining hold time.
 *   - r_seat_{eventId}_{seatKey}          → owning holdId for the seat, TTL = remaining hold time.
 *   - r_event_{eventId}_index             → list of (seat, holdId, expiresAt) for the event, long TTL.
 *
 * The per-seat key is the source of truth for "is this seat held"; the index
 * is bookkeeping that we re-verify against the per-seat keys on every read.
 * That means a missed index update never invents a phantom hold — it only
 * adds a self-healing round trip.
 *
 * We also defend against clock skew between the cache backend and the
 * application by re-validating expiry against the injected {@see Clock} on
 * read, so tests using a controllable clock can observe expiry deterministically
 * without sleeping.
 */
final class CacheHoldRepository implements HoldRepository
{
	/** Hard upper bound for the bookkeeping index entry; in practice always longer than any individual hold. */
	private const INDEX_TTL_SECONDS = 86400;

	public function __construct(
		private readonly CacheItemPoolInterface $cache,
		private readonly Clock $clock,
	) {
	}

	public function save(Hold $hold): void
	{
		$ttl = $hold->ttlSecondsFrom($this->clock->now());

		$record = $this->cache->getItem($this->holdKey($hold->id));
		$record->set($this->serialize($hold));
		$record->expiresAfter($ttl);
		$this->cache->save($record);

		foreach ($hold->seats() as $seat) {
			$marker = $this->cache->getItem($this->seatKey($hold->eventId, $seat));
			$marker->set($hold->id->value);
			$marker->expiresAfter($ttl);
			$this->cache->save($marker);
		}

		$this->updateIndex($hold->eventId, function (array $index) use ($hold): array {
			$expiresTs = $hold->expiresAt->getTimestamp();
			foreach ($hold->seats() as $seat) {
				$index[$seat->toString()] = [
					'holdId' => $hold->id->value,
					'section' => $seat->section,
					'row' => $seat->row,
					'number' => $seat->number,
					'expiresAt' => $expiresTs,
				];
			}

			return $index;
		});
	}

	public function get(HoldId $id): Hold
	{
		$hold = $this->find($id);
		if (null === $hold) {
			throw HoldNotFound::withId($id);
		}

		return $hold;
	}

	public function find(HoldId $id): ?Hold
	{
		$item = $this->cache->getItem($this->holdKey($id));
		if (!$item->isHit()) {
			return null;
		}

		$payload = $item->get();
		if (!is_array($payload)) {
			return null;
		}

		$hold = $this->deserialize($id, $payload);
		if ($hold->isExpired($this->clock->now())) {
			// Storage hasn't evicted yet (test clock advanced, or skew); treat
			// as gone and delete eagerly so the index converges.
			$this->delete($id);

			return null;
		}

		return $hold;
	}

	public function delete(HoldId $id): void
	{
		$item = $this->cache->getItem($this->holdKey($id));
		$payload = $item->isHit() ? $item->get() : null;

		if (is_array($payload) && isset($payload['eventId'], $payload['seats']) && is_string($payload['eventId']) && is_array($payload['seats'])) {
			$eventId = $payload['eventId'];

			$seatKeys = [];
			foreach ($payload['seats'] as $raw) {
				if (!is_array($raw)) {
					continue;
				}
				$seat = HoldSeat::of(
					(string) ($raw['section'] ?? ''),
					(string) ($raw['row'] ?? ''),
					(string) ($raw['number'] ?? ''),
				);
				$seatKeys[] = $seat->toString();
				$this->cache->deleteItem($this->seatKey($eventId, $seat));
			}

			$this->updateIndex($eventId, function (array $index) use ($seatKeys): array {
				foreach ($seatKeys as $key) {
					unset($index[$key]);
				}

				return $index;
			});
		}

		$this->cache->deleteItem($this->holdKey($id));
	}

	public function seatHoldId(string $eventId, HoldSeat $seat): ?HoldId
	{
		$item = $this->cache->getItem($this->seatKey($eventId, $seat));
		if (!$item->isHit()) {
			return null;
		}

		$value = $item->get();
		if (!is_string($value) || '' === $value) {
			return null;
		}

		// Defence in depth: confirm the owning hold is still live under our
		// clock. If not, evict the marker and report the seat as free.
		$holdId = HoldId::fromString($value);
		if (null === $this->find($holdId)) {
			$this->cache->deleteItem($this->seatKey($eventId, $seat));

			return null;
		}

		return $holdId;
	}

	public function heldSeatsForEvent(string $eventId): array
	{
		$index = $this->loadIndex($eventId);
		$now = $this->clock->now();

		$result = [];
		$pruned = false;
		foreach ($index as $key => $entry) {
			if (!is_array($entry)) {
				$pruned = true;
				unset($index[$key]);
				continue;
			}

			$expiresAt = (int) ($entry['expiresAt'] ?? 0);
			if ($expiresAt <= $now->getTimestamp()) {
				$pruned = true;
				unset($index[$key]);
				continue;
			}

			$seat = HoldSeat::of(
				(string) ($entry['section'] ?? ''),
				(string) ($entry['row'] ?? ''),
				(string) ($entry['number'] ?? ''),
			);

			$marker = $this->cache->getItem($this->seatKey($eventId, $seat));
			if (!$marker->isHit()) {
				$pruned = true;
				unset($index[$key]);
				continue;
			}

			$result[] = $seat;
		}

		if ($pruned) {
			$item = $this->cache->getItem($this->eventIndexKey($eventId));
			$item->set($index);
			$item->expiresAfter(self::INDEX_TTL_SECONDS);
			$this->cache->save($item);
		}

		return $result;
	}

	private function holdKey(HoldId $id): string
	{
		return 'r_hold_'.$id->value;
	}

	private function seatKey(string $eventId, HoldSeat $seat): string
	{
		// PSR-6 forbids `{}()/\@:` in cache keys. Build a safe ASCII key.
		return sprintf(
			'r_seat_%s_%s',
			$this->safe($eventId),
			$this->safe($seat->toString()),
		);
	}

	private function eventIndexKey(string $eventId): string
	{
		return 'r_event_'.$this->safe($eventId).'_index';
	}

	private function safe(string $raw): string
	{
		return preg_replace('/[^A-Za-z0-9_]/', '_', $raw) ?? '';
	}

	/**
	 * @return array<string, mixed>
	 */
	private function serialize(Hold $hold): array
	{
		$seats = [];
		foreach ($hold->seats() as $seat) {
			$seats[] = [
				'section' => $seat->section,
				'row' => $seat->row,
				'number' => $seat->number,
			];
		}

		return [
			'id' => $hold->id->value,
			'eventId' => $hold->eventId,
			'seats' => $seats,
			'expiresAt' => $hold->expiresAt->getTimestamp(),
		];
	}

	/**
	 * @param array<string, mixed> $payload
	 */
	private function deserialize(HoldId $id, array $payload): Hold
	{
		$seats = [];
		foreach ((array) ($payload['seats'] ?? []) as $raw) {
			if (!is_array($raw)) {
				continue;
			}
			$seats[] = HoldSeat::of(
				(string) ($raw['section'] ?? ''),
				(string) ($raw['row'] ?? ''),
				(string) ($raw['number'] ?? ''),
			);
		}

		$expiresAt = new DateTimeImmutable('@'.(int) ($payload['expiresAt'] ?? 0));
		$expiresAt = $expiresAt->setTimezone(new DateTimeZone('UTC'));

		return Hold::reconstitute(
			$id,
			(string) ($payload['eventId'] ?? ''),
			$seats,
			$expiresAt,
		);
	}

	/**
	 * @return array<string, array{holdId:string, section:string, row:string, number:string, expiresAt:int}>
	 */
	private function loadIndex(string $eventId): array
	{
		$item = $this->cache->getItem($this->eventIndexKey($eventId));
		if (!$item->isHit()) {
			return [];
		}

		$value = $item->get();

		return is_array($value) ? $value : [];
	}

	/**
	 * @param callable(array<string, mixed>): array<string, mixed> $mutate
	 */
	private function updateIndex(string $eventId, callable $mutate): void
	{
		$index = $this->loadIndex($eventId);
		$index = $mutate($index);

		$item = $this->cache->getItem($this->eventIndexKey($eventId));
		$item->set($index);
		$item->expiresAfter(self::INDEX_TTL_SECONDS);
		$this->cache->save($item);
	}
}
