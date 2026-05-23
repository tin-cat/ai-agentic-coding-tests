<?php

declare(strict_types=1);

namespace Frontstage\Catalog\Application\Command\PublishEvent;

use Frontstage\Catalog\Domain\Model\Event\EventId;
use Frontstage\Catalog\Domain\Repository\EventRepository;
use Symfony\Component\Messenger\Attribute\AsMessageHandler;

#[AsMessageHandler(bus: 'command.bus')]
final class PublishEventHandler
{
	public function __construct(private readonly EventRepository $events)
	{
	}

	public function __invoke(PublishEventCommand $command): void
	{
		$event = $this->events->get(EventId::fromString($command->eventId));
		$event->publish();
		$this->events->save($event);
	}
}
