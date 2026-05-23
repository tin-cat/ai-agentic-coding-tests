<?php

declare(strict_types=1);

namespace Frontstage\Catalog\Application\Query\GetEvent;

use Frontstage\Catalog\Application\Query\EventReadModel;
use Frontstage\Catalog\Application\Query\View\EventDetailView;
use Frontstage\Catalog\Domain\Exception\EventNotFound;
use Frontstage\Catalog\Domain\Model\Event\EventId;
use Symfony\Component\Messenger\Attribute\AsMessageHandler;

#[AsMessageHandler(bus: 'query.bus')]
final class GetEventHandler
{
	public function __construct(private readonly EventReadModel $events)
	{
	}

	public function __invoke(GetEventQuery $query): EventDetailView
	{
		$id = EventId::fromString($query->eventId);
		$view = $this->events->findDetailById($id);

		if (null === $view) {
			throw EventNotFound::withId($id);
		}

		return $view;
	}
}
