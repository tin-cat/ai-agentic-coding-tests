<?php

declare(strict_types=1);

namespace Frontstage\Ordering\Application\Bus;

interface QueryBus
{
	public function ask(object $query): mixed;
}
