<?php

declare(strict_types=1);

namespace Frontstage\Ordering\Domain\Service;

/**
 * Port through which Ordering talks to the Reservations context. Implemented
 * in the infrastructure layer by an adapter that delegates to Reservations'
 * own {@see \Frontstage\Reservations\Domain\Repository\HoldRepository}. The
 * Ordering domain never imports Reservations' types directly.
 */
interface HoldGateway
{
	/**
	 * Resolve a live hold. Returns null if the hold no longer exists (expired,
	 * released, or already consumed).
	 */
	public function findLive(string $holdId): ?HoldSnapshot;

	/**
	 * Remove the hold from the reservations store. Equivalent to a release —
	 * the seats are no longer marked as held. Idempotent.
	 */
	public function consume(string $holdId): void;
}
