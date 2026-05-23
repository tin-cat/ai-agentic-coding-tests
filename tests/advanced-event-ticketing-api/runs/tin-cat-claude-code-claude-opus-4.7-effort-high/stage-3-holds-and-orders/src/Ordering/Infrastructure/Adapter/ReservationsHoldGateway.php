<?php

declare(strict_types=1);

namespace Frontstage\Ordering\Infrastructure\Adapter;

use Frontstage\Ordering\Domain\Service\HoldGateway;
use Frontstage\Ordering\Domain\Service\HoldSnapshot;
use Frontstage\Reservations\Domain\Exception\InvalidArgument as ReservationsInvalidArgument;
use Frontstage\Reservations\Domain\Model\Hold\HoldId;
use Frontstage\Reservations\Domain\Repository\HoldRepository;

/**
 * Ordering→Reservations adapter for the {@see HoldGateway} port. Translates
 * Reservations' rich Hold aggregate into the slim {@see HoldSnapshot} that
 * Ordering needs, and forwards consume() to the Reservations repository.
 */
final class ReservationsHoldGateway implements HoldGateway
{
	public function __construct(private readonly HoldRepository $holds)
	{
	}

	public function findLive(string $holdId): ?HoldSnapshot
	{
		try {
			$id = HoldId::fromString($holdId);
		} catch (ReservationsInvalidArgument) {
			return null;
		}

		$hold = $this->holds->find($id);
		if (null === $hold) {
			return null;
		}

		$seats = [];
		foreach ($hold->seats() as $seat) {
			$seats[] = [
				'section' => $seat->section,
				'row' => $seat->row,
				'number' => $seat->number,
			];
		}

		return new HoldSnapshot(
			holdId: $hold->id->value,
			eventId: $hold->eventId,
			seats: $seats,
		);
	}

	public function consume(string $holdId): void
	{
		try {
			$id = HoldId::fromString($holdId);
		} catch (ReservationsInvalidArgument) {
			return;
		}

		$this->holds->delete($id);
	}
}
