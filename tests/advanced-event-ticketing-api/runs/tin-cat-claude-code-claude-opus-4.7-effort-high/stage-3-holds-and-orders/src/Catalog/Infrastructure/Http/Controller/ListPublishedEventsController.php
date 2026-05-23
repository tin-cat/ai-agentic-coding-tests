<?php

declare(strict_types=1);

namespace Frontstage\Catalog\Infrastructure\Http\Controller;

use Frontstage\Catalog\Application\Bus\QueryBus;
use Frontstage\Catalog\Application\Query\ListPublishedEvents\ListPublishedEventsQuery;
use Frontstage\Catalog\Application\Query\View\EventSummaryView;
use Symfony\Component\HttpFoundation\JsonResponse;
use Symfony\Component\HttpFoundation\Response;
use Symfony\Component\Routing\Attribute\Route;

final class ListPublishedEventsController
{
	public function __construct(private readonly QueryBus $queries)
	{
	}

	#[Route('/events', name: 'catalog_event_list', methods: ['GET'])]
	public function __invoke(): Response
	{
		/** @var list<EventSummaryView> $views */
		$views = $this->queries->ask(new ListPublishedEventsQuery());

		return new JsonResponse([
			'events' => array_map(static fn (EventSummaryView $v) => $v->toArray(), $views),
		], Response::HTTP_OK);
	}
}
