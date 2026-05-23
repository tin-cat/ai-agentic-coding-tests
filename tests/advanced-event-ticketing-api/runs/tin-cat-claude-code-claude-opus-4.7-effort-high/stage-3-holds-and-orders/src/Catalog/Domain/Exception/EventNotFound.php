<?php

declare(strict_types=1);

namespace Frontstage\Catalog\Domain\Exception;

use Frontstage\Catalog\Domain\Model\Event\EventId;
use RuntimeException;

final class EventNotFound extends RuntimeException
{
	public static function withId(EventId $id): self
	{
		return new self(sprintf('Event "%s" does not exist.', $id->toString()));
	}
}
