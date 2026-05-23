<?php

declare(strict_types=1);

namespace Frontstage\Catalog\Infrastructure\Http\Controller;

use Frontstage\Catalog\Application\Bus\QueryBus;
use Frontstage\Catalog\Application\Query\GetEvent\GetEventQuery;
use Frontstage\Catalog\Application\Query\View\EventDetailView;
use Symfony\Component\HttpFoundation\JsonResponse;
use Symfony\Component\HttpFoundation\Response;
use Symfony\Component\Routing\Attribute\Route;

final class GetEventController
{
	public function __construct(private readonly QueryBus $queries)
	{
	}

	#[Route('/events/{id}', name: 'catalog_event_get', methods: ['GET'])]
	public function __invoke(string $id): Response
	{
		/** @var EventDetailView $view */
		$view = $this->queries->ask(new GetEventQuery($id));

		return new JsonResponse($view->toArray(), Response::HTTP_OK);
	}
}
