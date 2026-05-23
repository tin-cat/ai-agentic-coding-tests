<?php

declare(strict_types=1);

namespace Frontstage\Catalog\Application\Command\PublishEvent;

final class PublishEventCommand
{
	public function __construct(public readonly string $eventId)
	{
	}
}
