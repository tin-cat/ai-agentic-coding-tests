<?php

declare(strict_types=1);

namespace Frontstage\Ordering\Application\Bus;

interface CommandBus
{
	public function dispatch(object $command): mixed;
}
