<?php

declare(strict_types=1);

namespace Frontstage\Reservations\Application\Command\ReleaseHold;

final class ReleaseHoldCommand
{
	public function __construct(public readonly string $holdId)
	{
	}
}
