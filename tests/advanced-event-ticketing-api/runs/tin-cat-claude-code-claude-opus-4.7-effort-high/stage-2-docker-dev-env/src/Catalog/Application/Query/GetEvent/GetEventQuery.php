<?php

declare(strict_types=1);

namespace Frontstage\Catalog\Application\Query\GetEvent;

final class GetEventQuery
{
	public function __construct(public readonly string $eventId)
	{
	}
}
