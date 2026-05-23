<?php

declare(strict_types=1);

namespace Frontstage\Ordering\Infrastructure\Messenger;

use Frontstage\Ordering\Application\Bus\CommandBus;
use Symfony\Component\DependencyInjection\Attribute\Autowire;
use Symfony\Component\Messenger\MessageBusInterface;
use Symfony\Component\Messenger\Stamp\HandledStamp;

final class MessengerCommandBus implements CommandBus
{
	public function __construct(
		#[Autowire(service: 'command.bus')]
		private readonly MessageBusInterface $bus,
	) {
	}

	public function dispatch(object $command): mixed
	{
		$envelope = $this->bus->dispatch($command);
		/** @var HandledStamp|null $stamp */
		$stamp = $envelope->last(HandledStamp::class);

		return $stamp?->getResult();
	}
}
