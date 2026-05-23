<?php

declare(strict_types=1);

namespace Frontstage\Catalog\Domain\Exception;

use DomainException;

final class InvalidEventState extends DomainException
{
	public static function alreadyPublished(): self
	{
		return new self('Event has already been published.');
	}
}
