<?php

declare(strict_types=1);

namespace Frontstage\Ordering\Infrastructure\Messenger;

use Frontstage\Ordering\Application\Bus\QueryBus;
use Symfony\Component\DependencyInjection\Attribute\Autowire;
use Symfony\Component\Messenger\MessageBusInterface;
use Symfony\Component\Messenger\Stamp\HandledStamp;

final class MessengerQueryBus implements QueryBus
{
	public function __construct(
		#[Autowire(service: 'query.bus')]
		private readonly MessageBusInterface $bus,
	) {
	}

	public function ask(object $query): mixed
	{
		$envelope = $this->bus->dispatch($query);
		/** @var HandledStamp|null $stamp */
		$stamp = $envelope->last(HandledStamp::class);

		return $stamp?->getResult();
	}
}
