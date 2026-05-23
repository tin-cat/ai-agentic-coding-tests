<?php

declare(strict_types=1);

namespace Frontstage\Catalog\Application\Bus;

/**
 * Port for dispatching queries. Queries are read-only and return a result.
 * The bus stays separate from the command bus to make the CQRS split
 * explicit at the type level.
 */
interface QueryBus
{
	public function ask(object $query): mixed;
}
