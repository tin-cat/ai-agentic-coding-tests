<?php

declare(strict_types=1);

namespace Frontstage\Catalog\Application\Bus;

/**
 * Port for dispatching commands. Commands are state mutations and return
 * nothing meaningful. Implementations belong in the infrastructure layer
 * (e.g. {@see \Frontstage\Catalog\Infrastructure\Messenger\MessengerCommandBus}).
 */
interface CommandBus
{
	public function dispatch(object $command): void;
}
