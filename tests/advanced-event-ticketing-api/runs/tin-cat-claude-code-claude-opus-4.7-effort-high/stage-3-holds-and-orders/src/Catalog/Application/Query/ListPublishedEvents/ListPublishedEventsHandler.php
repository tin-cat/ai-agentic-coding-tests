<?php

declare(strict_types=1);

namespace Frontstage\Catalog\Application\Query\ListPublishedEvents;

use Frontstage\Catalog\Application\Query\EventReadModel;
use Symfony\Component\Messenger\Attribute\AsMessageHandler;

#[AsMessageHandler(bus: 'query.bus')]
final class ListPublishedEventsHandler
{
	public function __construct(private readonly EventReadModel $events)
	{
	}

	/**
	 * @return list<\Frontstage\Catalog\Application\Query\View\EventSummaryView>
	 */
	public function __invoke(ListPublishedEventsQuery $query): array
	{
		return $this->events->listPublished();
	}
}
