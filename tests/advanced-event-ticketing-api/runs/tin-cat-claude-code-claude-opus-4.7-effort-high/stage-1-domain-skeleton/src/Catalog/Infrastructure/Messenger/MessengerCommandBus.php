<?php

declare(strict_types=1);

namespace Frontstage\Catalog\Infrastructure\Messenger;

use Frontstage\Catalog\Application\Bus\CommandBus;
use Symfony\Component\DependencyInjection\Attribute\Autowire;
use Symfony\Component\Messenger\MessageBusInterface;

final class MessengerCommandBus implements CommandBus
{
	public function __construct(
		#[Autowire(service: 'command.bus')]
		private readonly MessageBusInterface $bus,
	) {
	}

	public function dispatch(object $command): void
	{
		$this->bus->dispatch($command);
	}
}
