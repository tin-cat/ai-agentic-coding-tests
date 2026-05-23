<?php

declare(strict_types=1);

namespace Frontstage\Reservations\Application\Command\ReleaseHold;

use Frontstage\Reservations\Domain\Exception\HoldNotFound;
use Frontstage\Reservations\Domain\Model\Hold\HoldId;
use Frontstage\Reservations\Domain\Repository\HoldRepository;
use Symfony\Component\Messenger\Attribute\AsMessageHandler;

#[AsMessageHandler(bus: 'command.bus')]
final class ReleaseHoldHandler
{
	public function __construct(private readonly HoldRepository $holds)
	{
	}

	public function __invoke(ReleaseHoldCommand $command): void
	{
		$id = HoldId::fromString($command->holdId);

		// Surface a 404 when nothing exists to release so callers can tell
		// the difference between "released" and "never existed".
		if (null === $this->holds->find($id)) {
			throw HoldNotFound::withId($id);
		}

		$this->holds->delete($id);
	}
}
